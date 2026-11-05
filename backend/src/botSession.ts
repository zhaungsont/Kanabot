import mineflayer, { Bot } from "mineflayer";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements } = pkg;
import pvpPkg from "mineflayer-pvp";
const pvp = (pvpPkg as any).plugin;
import { plugin as toolPlugin } from "mineflayer-tool";
import { loader as autoEatPlugin } from "mineflayer-auto-eat";
import { IdleBehaviors } from "./behaviors/idleBehaviors.js";
import { EquipmentService, type EquipmentOwner } from "./runtime/equipment.js";
import { Upkeep, defaultUpkeep, validUpkeep } from "./upkeep/upkeep.js";
import type {
	UpkeepSettings,
	UpkeepStatus,
} from "../../shared/upkeepContracts.js";
import {
	defaultBehaviors,
	copySettings,
	validBehaviorSettings,
} from "./behaviors/settings.js";
import type {
	BehaviorSettings,
	BehaviorStatus,
} from "../../shared/behaviorContracts.js";
import type { SessionResult } from "./types.js";
import {
	BotState,
	BotConfig,
	ChatMessage,
	EventLogEntry,
	TaskType,
	BotSessionInfo,
	ExcavateRegion,
	ArmorSlotId,
	ArmorSlot,
	PlayerCommand,
	PlayerCommandResult,
	PlayerListSnapshot,
} from "./types.js";
import { ExcavateTask } from "./tasks/excavateTask.js";
import { FollowTask } from "./tasks/followTask.js";
import { AttackTask } from "./tasks/attackTask.js";
import { ProtectTask } from "./tasks/protect/protectTask.js";
import type { ProtectStatus } from "../../shared/botContracts.js";
import { BotConnection } from "./runtime/botConnection.js";
import { TaskCoordinator } from "./tasks/taskCoordinator.js";
import type { TaskOutcome } from "../../shared/taskContracts.js";
import { PlayerRoster } from "./players/playerRoster.js";
import { resolvePlayerTarget } from "./players/playerTarget.js";
import { whisperToPlayer } from "./players/whisper.js";
import { PlayerRoleStore } from "./access/playerRoleStore.js";
import { normalizePlayerName } from "./access/roleCatalog.js";
import { BotCommandService } from "./commands/botCommandService.js";
import { parseMinecraftCommand } from "./commands/minecraftCommand.js";
import type { CommandActor } from "./commands/botCommandService.js";
import type { ExcavationResult } from "../../shared/excavationContracts.js";
import { ExcavationService } from "./excavation/service.js";
import type { BotAction } from "./types.js";
import type {
	PlayerAccessSnapshot,
	PlayerAccessResult,
} from "../../shared/accessContracts.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_BASE_MS = 5000;

export interface BotSessionCallbacks {
	onAccess?: (snapshot: PlayerAccessSnapshot) => void;
	onChat: (msg: ChatMessage) => void;
	onEvent: (entry: EventLogEntry) => void;
	onStateChange: () => void;
	onDestroy: () => void;
	onArmor: (slots: ArmorSlot[]) => void;
	onPlayers: (snapshot: PlayerListSnapshot) => void;
}

export class BotSession {
	readonly sessionId: string;
	readonly config: BotConfig;

	state: BotState = "disconnected";
	currentTask: TaskType = null;
	taskTarget: string | null = null;
	spawnedAt: Date | null = null;

	private bot: Bot | null = null;
	private connection: BotConnection | null = null;
	private connectionClosing = false;
	private retryAfterClose = false;
	private connectionErrorTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly greetingTimers = new Set<ReturnType<typeof setTimeout>>();
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private protectStatus: ProtectStatus | undefined;
	private behaviorSettings = defaultBehaviors();
	private behaviorStatus: BehaviorStatus = {
		settings: defaultBehaviors(),
		activity: "idle",
		detail: "Enabled behaviors run only while idle.",
	};
	private idleBehaviors: IdleBehaviors | null = null;
	private upkeepSettings = defaultUpkeep();
	private upkeepStatus: UpkeepStatus = {
		settings: defaultUpkeep(),
		activity: "monitoring",
		detail: "Upkeep disabled.",
	};
	private upkeep: Upkeep | null = null;
	private equipmentService: EquipmentService | null = null;
	private manualInventoryBusy: symbol | null = null;
	private readonly tasks: TaskCoordinator;
	private lastTaskOutcome: TaskOutcome | undefined;
	private playerRoster: PlayerRoster | null = null;
	private playersSubscribed = false;
	private retryCount = 0;
	private destroyed = false;
	private wasKicked = false;
	private tickErrorLogged = false;
	private readonly callbacks: BotSessionCallbacks;
	private readonly playerRoles: PlayerRoleStore;
	private readonly commands: BotCommandService;
	private readonly excavation: ExcavationService;

	constructor(
		sessionId: string,
		config: BotConfig,
		callbacks: BotSessionCallbacks,
		private readonly createMineflayerBot: typeof mineflayer.createBot = mineflayer.createBot,
	) {
		this.sessionId = sessionId;
		this.config = config;
		this.callbacks = callbacks;
		this.tasks = new TaskCoordinator(
			() => {
				this.excavation?.lifecycle(this.tasks.status);
				if (!this.destroyed) this.callbacks.onStateChange();
			},
			(message) => {
				if (!this.destroyed) this.emitEvent("error", message);
			},
		);
		this.playerRoles = new PlayerRoleStore(sessionId);
		this.commands = new BotCommandService(this.playerRoles, (action, actor) =>
			this.executeAction(action, actor),
		);
		this.excavation = new ExcavationService(
			() =>
				this.bot &&
				!this.destroyed &&
				!this.connectionClosing &&
				["idle", "task"].includes(this.state)
					? {
							bot: this.bot,
							available:
								this.state === "idle" &&
								!this.tasks.busy &&
								!this.manualInventoryBusy,
						}
					: null,
			(actor, stopOthers) =>
				this.commands.authorizeExcavation(actor, stopOthers),
			(region, taskId, actor) =>
				this.executeAction({ type: "excavate", region }, actor, taskId),
			() => this.stopTask(),
			() => this.callbacks.onStateChange(),
		);
	}

	// ─── Public Getters ─────────────────────────────────────────────────────────

	get uptime(): number {
		if (!this.spawnedAt) return 0;
		return Math.floor((Date.now() - this.spawnedAt.getTime()) / 1000);
	}

	getInfo(): BotSessionInfo {
		return {
			sessionId: this.sessionId,
			config: this.config,
			state: this.state,
			currentTask: this.currentTask,
			taskTarget: this.taskTarget,
			spawnedAt: this.spawnedAt?.toISOString() ?? null,
			uptime: this.uptime,
			protect: this.protectStatus,
			taskLifecycle: this.tasks.status,
			lastTaskOutcome: this.lastTaskOutcome,
			excavationPlan: this.excavation.preview({ kind: "deployment" }),
			excavationStatus: this.excavation.latest(),
			upkeep: { ...this.upkeepStatus, settings: { ...this.upkeepSettings } },
			behaviors: {
				...this.behaviorStatus,
				settings: copySettings(this.behaviorSettings),
			},
		};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────────

	spawn(): void {
		if (this.destroyed || this.connectionClosing) return;
		if (this.state !== "disconnected" && this.state !== "dead") return;
		this.setState("spawning");
		const target = this.config.serverPort
			? `${this.config.serverHost}:${this.config.serverPort}`
			: this.config.serverHost;
		this.emitEvent("info", `Connecting to ${target}...`);
		this.createBot();
	}

	private createBot(): void {
		if (this.destroyed) return;
		this.wasKicked = false;
		this.tickErrorLogged = false;
		try {
			this.bot = this.createMineflayerBot({
				host: this.config.serverHost,
				...(this.config.serverPort !== undefined && {
					port: this.config.serverPort,
				}),
				username: this.config.botName,
				version: this.config.version || undefined,
				auth: "offline",
			});
			this.captureConnection(this.bot);
			this.bot.loadPlugin(pathfinder);
			this.bot.loadPlugin(pvp);
			this.bot.loadPlugin(toolPlugin);
			this.bot.loadPlugin(autoEatPlugin);
			this.setupBotEvents();
		} catch (err) {
			this.emitEvent("error", `Failed to create bot: ${err}`);
			this.handleDisconnect(false);
		}
	}

	private setupBotEvents(): void {
		// Capture the bot instance now so every callback uses this exact reference.
		// this.bot may be set to null later (on disconnect/retry), which would cause
		// "Cannot read properties of null" if callbacks used this.bot! directly.
		const bot = this.bot;
		if (!bot) return;
		this.clearConnectionTimers();
		this.captureConnection(bot);
		this.manualInventoryBusy = null;
		this.idleBehaviors?.dispose();
		this.upkeep?.dispose();
		this.equipmentService = new EquipmentService(bot);
		this.upkeep = new Upkeep(
			bot,
			this.upkeepSettings,
			this.equipmentService,
			() => this.equipmentOwner(),
			() =>
				this.bot === bot &&
				!this.destroyed &&
				!this.connectionClosing &&
				["idle", "task"].includes(this.state) &&
				!this.taskCleanupPending &&
				!this.manualInventoryBusy &&
				(this.state === "task"
					? !!this.equipmentOwner()
					: !this.idleBehaviors?.busy || !!this.idleBehaviors.runtimeOwner),
			(status) => {
				if (this.bot === bot && !this.destroyed && !this.connectionClosing) {
					this.upkeepStatus = status;
					this.callbacks.onStateChange();
				}
			},
			(message, level = "info") => {
				if (this.bot === bot && !this.destroyed && !this.connectionClosing) {
					this.emitEvent(level, message);
					this.emitArmorUpdate(bot);
				}
			},
		);
		this.idleBehaviors = new IdleBehaviors(
			bot,
			this.behaviorSettings,
			() =>
				this.bot === bot &&
				!this.destroyed &&
				this.state === "idle" &&
				this.currentTask === null &&
				!this.taskCleanupPending &&
				!this.tasks.busy &&
				!this.manualInventoryBusy &&
				!this.upkeep?.busy,
			(status) => {
				if (this.bot !== bot || this.destroyed || this.connectionClosing)
					return;
				this.behaviorStatus = status;
				this.callbacks.onStateChange();
			},
			(message, level = "warning") => {
				if (this.bot === bot && !this.destroyed && !this.connectionClosing)
					this.emitEvent(level, message);
			},
		);
		this.playerRoster?.dispose();
		this.playerRoster = new PlayerRoster(bot, (snapshot) => {
			if (this.bot === bot && !this.destroyed && !this.connectionClosing) {
				this.callbacks.onPlayers({ sessionId: this.sessionId, ...snapshot });
			}
		});

		bot.on("spawn", () => {
			if (this.bot === bot) this.excavation.invalidate();
			// Stale-event guard: skip if this bot has already been replaced or destroyed.
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;

			if (this.connectionErrorTimer) clearTimeout(this.connectionErrorTimer);
			this.connectionErrorTimer = null;
			const isRespawn = this.state === "dead";

			if (!isRespawn) {
				// Initial spawn: one-time setup.
				this.spawnedAt = new Date();
				this.retryCount = 0;

				const defaultMove = new Movements(bot);
				bot.pathfinder.setMovements(defaultMove);

				this.emitEvent(
					"success",
					`Bot "${this.config.botName}" spawned successfully!`,
				);
				this.emitSystemChat(
					`Bot "${this.config.botName}" has joined the server.`,
				);
			} else {
				// Respawn after death: restore active state.
				this.emitEvent("info", `Bot "${this.config.botName}" has respawned.`);
				this.emitSystemChat(`Bot "${this.config.botName}" has respawned.`);
			}

			this.setState("idle");
			this.resetIdleTimer();
			this.emitArmorUpdate(bot);
			this.playerRoster?.setSubscribed(this.playersSubscribed);
		});
		bot.on("game", () => {
			if (this.bot === bot && !this.connectionClosing)
				this.excavation.invalidate();
		});

		bot.on("entityEquip", (entity: any) => {
			// console.log('in entityEquip');
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			// console.log("entity", entity);
			if (entity !== bot.entity) return;
			// console.log("entityEquip", entity);
			this.emitArmorUpdate(bot);
		});

		bot.on("physicsTick", () => {
			if (this.bot !== bot || this.connectionClosing) return;
			try {
				// Pathfinder/combat owns looking during tasks; passive glances must not fight it.
				if (
					this.state === "idle" &&
					!this.idleBehaviors?.busy &&
					!this.upkeep?.busy
				)
					this.lookAtNearestEntity(bot);
			} catch (err) {
				if (!this.tickErrorLogged) {
					this.tickErrorLogged = true;
					this.emitEvent(
						"error",
						`physicsTick error: ${(err as Error).message}`,
					);
				}
			}
		});

		bot.on("chat", (username: string, message: string) => {
			if (this.bot !== bot || this.connectionClosing) return;
			if (username === this.config.botName) return;

			this.callbacks.onChat({ username, message, timestamp: Date.now() });
			this.handleGreeting(username, message);
			this.handleChatCommands(username, message);
		});

		bot.on("whisper", (username: string, message: string) => {
			if (
				this.bot !== bot ||
				this.destroyed ||
				this.connectionClosing ||
				username === this.config.botName
			)
				return;
			this.callbacks.onChat({
				username,
				message,
				timestamp: Date.now(),
				channel: "whisper",
				recipient: this.config.botName,
			});
			// Tell uses the same parser and backend authority as public commands.
			this.handleChatCommands(username, message);
		});

		bot.on("death", () => {
			if (this.bot !== bot || this.connectionClosing) return;
			this.excavation.invalidate();
			this.stopTask();
			this.clearIdleTimer();
			this.setState("dead");
			this.playerRoster?.setSubscribed(false);
			this.emitEvent("warning", `Bot "${this.config.botName}" has died.`);
			this.emitSystemChat(`Bot "${this.config.botName}" has died.`);
		});

		bot.on("kicked", (reason: string) => {
			if (this.bot !== bot || this.connectionClosing) return;
			this.wasKicked = true;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent("error", `Bot was kicked: ${reason}`);
			this.emitSystemChat(`Bot was kicked: ${reason}`);
			// 'end' fires right after 'kicked'; wasKicked flag blocks retry there.
		});

		bot.on("error", (err: Error & { name?: string }) => {
			if (this.bot !== bot || this.connectionClosing) return;

			// protodef PartialReadError — indicates a Minecraft version mismatch between
			// the bot config and the actual server. The session will end and retry, so
			// just surface a clear diagnostic rather than a raw stack trace.
			if (
				err.name === "PartialReadError" ||
				err.constructor?.name === "PartialReadError" ||
				err.message?.includes("Unexpected buffer end")
			) {
				this.emitEvent(
					"error",
					`Packet parse error — possible version mismatch. ` +
						`Try setting the Minecraft version explicitly (e.g. "1.21.4"). ` +
						`[${err.message}]`,
				);
			} else {
				const msg = friendlyErrorMessage(err);
				this.emitEvent("error", `Bot error: ${msg}`);
			}

			// If 'end' never fires (e.g. DNS failure, early ECONNRESET), recover the
			// session so it doesn't stay stuck in 'spawning' forever.
			if (this.state === "spawning") {
				this.stopTask();
				this.clearIdleTimer();
				if (this.connectionErrorTimer) return;
				this.connectionErrorTimer = setTimeout(() => {
					this.connectionErrorTimer = null;
					if (
						this.bot === bot &&
						this.state === "spawning" &&
						!this.destroyed &&
						!this.connectionClosing
					)
						this.handleDisconnect(!this.wasKicked);
				}, 500);
			}
		});

		bot.on("end", (reason: string) => {
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent("info", `Bot disconnected: ${reason}`);
			this.emitSystemChat(`Bot disconnected (${reason}).`);
			this.handleDisconnect(!this.wasKicked);
		});
	}

	private captureConnection(bot: Bot): BotConnection {
		if (!this.connection || this.connection.bot !== bot) {
			this.connection = new BotConnection(bot, (message) => {
				if (!this.destroyed && this.bot === bot)
					this.emitEvent("error", message);
			});
		}
		return this.connection;
	}

	private clearConnectionTimers(): void {
		if (this.connectionErrorTimer) clearTimeout(this.connectionErrorTimer);
		this.connectionErrorTimer = null;
		for (const timer of this.greetingTimers) clearTimeout(timer);
		this.greetingTimers.clear();
	}

	private handleDisconnect(shouldRetry: boolean): void {
		this.excavation.invalidate();
		this.clearRetryTimer();
		this.clearConnectionTimers();
		if (this.connectionClosing) {
			if (!shouldRetry) this.retryAfterClose = false;
			return;
		}
		this.retryAfterClose = shouldRetry;
		this.connectionClosing = true;
		this.stopTask();
		this.upkeep?.dispose();
		this.upkeep = null;
		this.idleBehaviors?.dispose();
		this.idleBehaviors = null;
		this.playerRoster?.dispose();
		this.playerRoster = null;
		this.clearIdleTimer();
		this.currentTask = null;
		this.taskTarget = null;
		this.protectStatus = undefined;
		this.setState("disconnected");
		const bot = this.bot;
		const closed = bot
			? this.captureConnection(bot).close()
			: Promise.resolve();
		void closed
			.then(() => {
				if (this.bot !== bot) return;
				this.bot = null;
				this.connection = null;
				this.connectionClosing = false;
				if (this.destroyed) return;
				if (this.retryAfterClose && this.retryCount < MAX_RETRY_ATTEMPTS) {
					this.retryCount++;
					const delay = RETRY_DELAY_BASE_MS * this.retryCount;
					this.emitEvent(
						"info",
						`Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay / 1000}s...`,
					);
					this.retryTimer = setTimeout(() => {
						this.retryTimer = null;
						if (
							!this.destroyed &&
							this.state === "disconnected" &&
							!this.connectionClosing
						) {
							this.setState("spawning");
							this.createBot();
						}
					}, delay);
				} else if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
					this.emitEvent("error", "Max retry attempts reached. Session ended.");
					this.destroy();
				}
			})
			.catch(() => {
				this.emitEvent(
					"error",
					"Connection teardown failed; retire this deployment.",
				);
			});
	}

	disconnect(): void {
		this.playersSubscribed = false;
		this.handleDisconnect(false);
		this.emitEvent("info", "Bot disconnected by user.");
		this.emitSystemChat("Bot has disconnected.");
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.tasks.dispose();
		this.disconnect();
		this.callbacks.onDestroy();
	}

	// ─── Actions ─────────────────────────────────────────────────────────────────

	updateBehaviors(input: unknown): SessionResult<BehaviorSettings> {
		if (!validBehaviorSettings(input))
			return {
				ok: false,
				code: "INVALID_REQUEST",
				error:
					"Invalid behavior settings. Response duration must be 1–120 whole seconds.",
			};
		if (this.destroyed)
			return { ok: false, code: "UNAVAILABLE", error: "Bot has been retired." };
		if (input.autoEat !== undefined)
			this.updateUpkeep({ ...this.upkeepSettings, autoEat: input.autoEat });
		this.behaviorSettings = copySettings(input);
		this.idleBehaviors?.update(this.behaviorSettings);
		this.callbacks.onStateChange();
		return { ok: true, value: copySettings(this.behaviorSettings) };
	}

	private get taskCleanupPending(): boolean {
		return this.tasks.busy && this.tasks.status?.phase !== "running";
	}
	private equipmentOwner(): EquipmentOwner | null {
		return (
			this.tasks.owner ??
			(this.idleBehaviors?.runtimeOwner?.active
				? this.idleBehaviors.runtimeOwner
				: null)
		);
	}
	private equipmentFor(bot: Bot): EquipmentService {
		if (!this.equipmentService || this.equipmentService.bot !== bot)
			this.equipmentService = new EquipmentService(bot);
		return this.equipmentService;
	}
	updateUpkeep(input: unknown): SessionResult<UpkeepSettings> {
		if (!validUpkeep(input))
			return {
				ok: false,
				code: "INVALID_REQUEST",
				error: "Invalid upkeep settings.",
			};
		if (this.destroyed)
			return { ok: false, code: "UNAVAILABLE", error: "Bot retired." };
		if (input.autoArmor && !this.upkeepSettings.autoArmor)
			this.equipmentService?.armorOverrides.clear();
		this.upkeepSettings = { ...input };
		this.upkeep?.update(input);
		this.callbacks.onStateChange();
		return { ok: true, value: { ...input } };
	}

	sendChat(message: string): void {
		if (!this.bot || this.state === "disconnected" || this.state === "spawning")
			return;
		this.bot.chat(message);
		this.callbacks.onChat({
			username: this.config.botName,
			message,
			timestamp: Date.now(),
			isBot: true,
		});
		this.resetIdleTimer();
	}

	getPlayerAccess(): PlayerAccessSnapshot {
		return this.playerRoles.snapshot();
	}

	updatePlayerRole(input: unknown): PlayerAccessResult {
		const result = this.playerRoles.update(input);
		if (result.ok) {
			this.callbacks.onAccess?.(result.value);
			this.emitEvent(
				"info",
				`Deployment administrator updated player roles (revision ${result.value.revision}).`,
			);
		}
		return result;
	}

	/** Deployment adapters must authenticate attachment before calling this boundary. */
	performAction(
		type: BotAction["type"],
		target?: string,
		region?: ExcavateRegion,
	): PlayerCommandResult {
		const result = this.commands.submit(
			{ kind: "deployment" },
			{ type, target, region },
		);
		if (!result.ok) this.emitEvent("warning", result.error);
		return result;
	}

	performExcavation(
		request: unknown,
		actor: CommandActor = { kind: "deployment" },
	): ExcavationResult {
		return this.excavation.submit(actor, request);
	}

	private executeAction(
		action: BotAction,
		actor: CommandActor = { kind: "deployment" },
		taskId?: string,
	): PlayerCommandResult {
		if (!this.bot || this.destroyed || !["idle", "task"].includes(this.state))
			return { ok: false, error: "The bot is not active." };
		// Compatibility wire requests prepare a plan; only the service can confirm it.
		if (action.type === "excavate" && !taskId)
			return this.excavation.prepare(actor, action.region, true);
		if (action.type === "stop") {
			this.upkeep?.prepareForTask();
			this.idleBehaviors?.prepareForTask();
			this.stopTask();
			this.emitEvent("info", "Task stop requested.");
			this.resetIdleTimer();
			return { ok: true };
		}
		if (this.state !== "idle")
			return {
				ok: false,
				error: `Cannot start task: bot is currently in state "${this.state}".`,
			};
		if (this.tasks.busy)
			return {
				ok: false,
				error: "The previous task is still stopping. Try again shortly.",
			};
		if (this.manualInventoryBusy)
			return {
				ok: false,
				error: "An inventory operation is still finishing. Try again shortly.",
			};
		if (this.upkeep && !this.upkeep.prepareForTask())
			return {
				ok: false,
				error: "Upkeep is finishing cleanup; retry shortly.",
			};
		if (this.idleBehaviors && !this.idleBehaviors.prepareForTask())
			return {
				ok: false,
				error:
					"Idle behavior is stopping before this task can start. Retry once cleanup finishes.",
			};
		if (action.type === "excavate") {
			this.startExcavate(action.region, taskId!, actor);
			this.resetIdleTimer();
			return { ok: true };
		}
		if (action.type === "follow" || action.type === "attack")
			return this.startPlayerTask(action.type, action.target);
		return this.startPlayerTask("protect", action.target);
	}

	// ─── Abilities ───────────────────────────────────────────────────────────────

	/** Looks toward the nearest player or mob every physics tick. */
	private lookAtNearestEntity(bot: Bot): void {
		console.log(bot.nearestEntity((e) => e.type == "mob"));
		const target = bot.nearestEntity(
			// 'animal' is a valid runtime type; cast until mineflayer typings catch up
			(e) => e.type === "player" || (e.type as string) === "animal",
		);
		if (!target) return;
		bot.lookAt(target.position.offset(0, target.height * 0.9, 0));
	}
	setPlayersSubscribed(enabled: boolean): PlayerCommandResult {
		if (enabled && (!this.bot || !["idle", "task"].includes(this.state))) {
			return { ok: false, error: "The bot must be connected to view players." };
		}
		this.playersSubscribed = enabled;
		this.playerRoster?.setSubscribed(enabled);
		return { ok: true };
	}

	performPlayerCommand(command: PlayerCommand): PlayerCommandResult {
		if (!this.bot || this.destroyed || !["idle", "task"].includes(this.state)) {
			return { ok: false, error: "The bot is not active." };
		}
		if (command.type !== "whisper")
			return this.performAction(command.type, command.target);
		try {
			const result = whisperToPlayer(this.bot, command.target, command.message);
			if (result.ok) {
				this.callbacks.onChat({
					username: this.config.botName,
					message: command.message.trim(),
					timestamp: Date.now(),
					isBot: true,
					channel: "whisper",
					recipient: command.target,
				});
				this.resetIdleTimer();
			}
			return result;
		} catch (error) {
			return { ok: false, error: `Could not send whisper: ${String(error)}` };
		}
	}

	private startPlayerTask(
		type: "follow" | "attack" | "protect",
		playerName: string,
	): PlayerCommandResult {
		const bot = this.bot;
		if (!bot || this.state !== "idle" || this.destroyed) {
			return {
				ok: false,
				error: "Stop the current task before starting another player task.",
			};
		}
		if (this.tasks.busy)
			return {
				ok: false,
				error: "The previous task is still stopping. Try again shortly.",
			};
		const target = resolvePlayerTarget(bot, playerName);
		if (!target.ok) return target;
		if (type === "attack" && target.player.gamemode === 1) {
			return { ok: false, error: "Creative-mode players are invulnerable." };
		}
		const onFinished = (outcome: TaskOutcome): void => {
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			this.lastTaskOutcome = outcome;
			this.protectStatus = undefined;
			this.currentTask = null;
			this.taskTarget = null;
			if (this.state === "task") this.setState("idle");
			this.emitEvent(outcome.level, outcome.message);
			if (type === "protect" && outcome.code === "PLAYER_UNREACHABLE") {
				const message =
					"I can't reach you: no usable route was found within my navigation limits. Protect has stopped. Move somewhere accessible and ask me to protect you again.";
				try {
					const sent = whisperToPlayer(bot, target.player.username, message);
					if (sent.ok)
						this.callbacks.onChat({
							username: bot.username,
							message,
							timestamp: Date.now(),
							isBot: true,
							channel: "whisper",
							recipient: target.player.username,
						});
					else
						this.emitEvent(
							"warning",
							`Could not notify protected player: ${sent.error}`,
						);
				} catch (error) {
					this.emitEvent(
						"warning",
						`Could not notify protected player: ${String(error)}`,
					);
				}
			}
			this.resetIdleTimer();
		};
		const task =
			type === "follow"
				? new FollowTask(
						bot,
						target.player.username,
						undefined,
						this.equipmentFor(bot),
					)
				: type === "attack"
					? new AttackTask(
							bot,
							target.player.username,
							undefined,
							this.equipmentFor(bot),
						)
					: new ProtectTask(
							bot,
							target.player.username,
							() => {},
							(status) => {
								if (
									this.tasks.current !== task ||
									this.bot !== bot ||
									this.destroyed
								)
									return;
								this.protectStatus = status;
								this.callbacks.onStateChange();
							},
							undefined,
							undefined,
							this.equipmentFor(bot),
						);
		this.lastTaskOutcome = undefined;
		this.currentTask = type;
		this.taskTarget = target.player.username;
		this.setState("task");
		this.resetIdleTimer();
		try {
			this.tasks.start(task, onFinished);
		} catch (error) {
			this.stopTask();
			return {
				ok: false,
				error: `Could not start player task: ${String(error)}`,
			};
		}
		this.emitEvent(
			"info",
			`${type === "follow" ? "Following" : type === "protect" ? "Protecting" : "Attacking"} "${target.player.username}".`,
		);
		this.emitSystemChat(
			`Bot acknowledged: ${type} "${target.player.username}".`,
		);
		return { ok: true };
	}

	private startExcavate(
		region: ExcavateRegion,
		taskId: string,
		actor: CommandActor,
	): void {
		const bot = this.bot;
		if (!bot) return;
		let lastFeedbackAt = Date.now();
		const task = new ExcavateTask(
			bot,
			region,
			{
				onEvent: (level, message) => {
					if (this.bot === bot && !this.destroyed && !this.connectionClosing)
						this.emitEvent(level, message);
				},
				onProgress: (current, total) => {
					this.excavation.progress(taskId, current);
					if (this.bot !== bot || this.destroyed || this.connectionClosing)
						return;
					if (
						actor.kind === "minecraft" &&
						Date.now() - lastFeedbackAt >= 5_000
					) {
						lastFeedbackAt = Date.now();
						this.excavationFeedback(
							actor.username,
							`Task ${taskId}: ${current}/${total} positions checked; status is available with !dig status ${taskId}.`,
						);
					}
					const pct = Math.floor((current / total) * 100);
					const prevPct = Math.floor(((current - 1) / total) * 100);
					if (pct !== prevPct && pct % 10 === 0)
						this.emitEvent(
							"info",
							`Excavation progress: ${pct}% (${current}/${total})`,
						);
				},
			},
			this.equipmentFor(bot),
		);
		this.currentTask = "excavate";
		this.taskTarget = null;
		this.lastTaskOutcome = undefined;
		this.setState("task");
		this.tasks.start(task, (outcome) => {
			this.excavation.finish(taskId, outcome);
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			this.lastTaskOutcome = outcome;
			this.currentTask = null;
			this.taskTarget = null;
			if (this.state === "task") this.setState("idle");
			this.resetIdleTimer();
			this.emitEvent(outcome.level, outcome.message);
			if (actor.kind === "minecraft")
				this.excavationFeedback(
					actor.username,
					`Task ${taskId}: ${outcome.message}`,
				);
		});
		const { x1, y1, z1, x2, y2, z2 } = region;
		this.emitEvent(
			"info",
			`Excavate task started: (${x1},${y1},${z1}) → (${x2},${y2},${z2}).`,
		);
	}

	private stopTask(): void {
		this.tasks.stop();
	}

	// ─── Greeting & Chat Commands ─────────────────────────────────────────────────

	private handleGreeting(username: string, message: string): void {
		const lower = message.toLowerCase();
		if (lower.includes("hi bot") || lower.includes("hello bot")) {
			const bot = this.bot;
			const timer = setTimeout(() => {
				this.greetingTimers.delete(timer);
				if (
					!bot ||
					this.bot !== bot ||
					this.destroyed ||
					this.connectionClosing
				)
					return;
				bot.chat("Hi there!");
				this.callbacks.onChat({
					username: this.config.botName,
					message: "Hi there!",
					timestamp: Date.now(),
					isBot: true,
				});
			}, 500);
			this.greetingTimers.add(timer);
		}
	}

	private handleChatCommands(username: string, message: string): void {
		const parsed = parseMinecraftCommand(username, message);
		if (parsed.kind === "ignore") return;
		const result =
			parsed.kind === "invalid"
				? { ok: false as const, error: parsed.error }
				: parsed.kind === "excavation"
					? this.performExcavation(parsed.request, {
							kind: "minecraft",
							username,
						})
					: this.commands.submit(
							{ kind: "minecraft", username },
							parsed.action,
						);
		if (result.ok && "message" in result && typeof result.message === "string")
			this.excavationFeedback(username, result.message);
		if (!result.ok) {
			this.emitEvent(
				"warning",
				`Player command denied/rejected for ${username}: ${result.error}`,
			);
			if (normalizePlayerName(username) && username === username.trim()) {
				try {
					this.bot?.whisper(username, result.error);
				} catch {
					/* server may not support /tell */
				}
			}
		}
	}

	private excavationFeedback(username: string, message: string): void {
		if (
			!this.bot ||
			!normalizePlayerName(username) ||
			username !== username.trim()
		)
			return;
		// Keep tell packets short and mirror only to the authorized dashboard.
		for (const part of message.match(/.{1,190}(?:\s|$)|.{1,190}/g) ?? []) {
			try {
				const result = whisperToPlayer(this.bot, username, part.trim());
				if (result.ok)
					this.callbacks.onChat({
						username: this.config.botName,
						message: part.trim(),
						timestamp: Date.now(),
						isBot: true,
						channel: "whisper",
						recipient: username,
					});
			} catch {
				/* No public fallback when tell is unavailable. */
			}
		}
	}

	// ─── Timers ──────────────────────────────────────────────────────────────────

	resetIdleTimer(): void {
		this.clearIdleTimer();
		if (
			this.destroyed ||
			this.state === "disconnected" ||
			this.state === "spawning"
		)
			return;

		this.idleTimer = setTimeout(() => {
			if (this.state === "idle" && this.currentTask === null) {
				this.emitEvent("warning", "Idle for 10 minutes — auto-disconnecting.");
				this.destroy();
			}
		}, IDLE_TIMEOUT_MS);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private clearRetryTimer(): void {
		if (this.retryTimer !== null) clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}

	// ─── Armor ───────────────────────────────────────────────────────────────────

	/** Inventory slot indices for each armor slot in mineflayer. */
	private static readonly ARMOR_SLOT_INDICES: Record<ArmorSlotId, number> = {
		head: 5,
		torso: 6,
		legs: 7,
		feet: 8,
	};

	private getArmorItems(bot: Bot): ArmorSlot[] {
		return (["head", "torso", "legs", "feet"] as ArmorSlotId[]).map(
			(slotId) => {
				const item = bot.inventory.slots[BotSession.ARMOR_SLOT_INDICES[slotId]];
				return {
					slot: slotId,
					name: item?.name ?? null,
					displayName: item?.displayName ?? null,
				};
			},
		);
	}

	private emitArmorUpdate(bot: Bot): void {
		this.callbacks.onArmor(this.getArmorItems(bot));
	}

	async unequipAndDropArmor(slot: ArmorSlotId): Promise<void> {
		const bot = this.bot;
		if (
			!bot ||
			this.destroyed ||
			this.connectionClosing ||
			!["idle", "task"].includes(this.state)
		)
			return;
		if (
			this.manualInventoryBusy ||
			(this.idleBehaviors && !this.idleBehaviors.prepareForTask()) ||
			(this.upkeep && !this.upkeep.prepareForTask())
		) {
			this.emitEvent(
				"warning",
				"An idle behavior or inventory operation is stopping. Retry the armor action after cleanup.",
			);
			return;
		}

		const slotIndex = BotSession.ARMOR_SLOT_INDICES[slot];
		const item = bot.inventory.slots[slotIndex];
		if (!item) return;
		const inventoryOperation = Symbol("manual inventory");
		this.manualInventoryBusy = inventoryOperation;
		const equipment = this.equipmentFor(bot);

		try {
			equipment.armorOverrides.add(slot);
			await equipment.exclusive(async () => {
				if (this.bot !== bot || this.destroyed || this.connectionClosing)
					return;
				await bot.unequip(slot);
				if (this.bot !== bot || this.destroyed || this.connectionClosing)
					return;
				const invItem = bot.inventory
					.items()
					.find((i) => equipment.sameItem(i, item));
				if (invItem) await bot.tossStack(invItem);
			});
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			this.emitEvent(
				"info",
				`Un-equipped and dropped ${item.displayName ?? item.name}.`,
			);
			this.emitArmorUpdate(bot);
		} catch (err) {
			if (this.bot !== bot || this.destroyed || this.connectionClosing) return;
			this.emitEvent(
				"error",
				`Failed to drop armor: ${(err as Error).message}`,
			);
		} finally {
			if (this.manualInventoryBusy === inventoryOperation)
				this.manualInventoryBusy = null;
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────────

	private setState(state: BotState): void {
		this.state = state;
		this.callbacks.onStateChange();
	}

	private emitEvent(type: EventLogEntry["type"], message: string): void {
		this.callbacks.onEvent({ type, message, timestamp: Date.now() });
	}

	private emitSystemChat(message: string): void {
		this.callbacks.onChat({
			username: "System",
			message,
			timestamp: Date.now(),
			isBot: true,
		});
	}
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

/** Converts raw Node.js network errors into human-readable messages. */
function friendlyErrorMessage(err: Error & { code?: string }): string {
	switch (err.code) {
		case "ECONNRESET":
			return "Connection was reset by the server (ECONNRESET). The server may be offline or unreachable.";
		case "ECONNREFUSED":
			return "Connection refused (ECONNREFUSED). Check the server IP and port.";
		case "ENOTFOUND":
			return `Host not found (ENOTFOUND). Check the server address.`;
		case "ETIMEDOUT":
			return "Connection timed out (ETIMEDOUT). The server may be offline or behind a firewall.";
		default:
			return err.message;
	}
}
