import mineflayer, { Bot } from "mineflayer";
import pkg from "mineflayer-pathfinder";
const { pathfinder, Movements } = pkg;
import pvpPkg from "mineflayer-pvp";
const pvp = (pvpPkg as any).plugin;
import armorManager from "mineflayer-armor-manager";
import { plugin as toolPlugin } from "mineflayer-tool";
import { loader as autoEatPlugin } from "mineflayer-auto-eat";
import { IdleBehaviors } from "./behaviors/idleBehaviors.js";
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
import type {
	TrackedPlayerTask,
	PlayerTaskOutcome,
} from "./tasks/trackedPlayerTask.js";
import { PlayerRoster } from "./players/playerRoster.js";
import { resolvePlayerTarget } from "./players/playerTarget.js";
import { whisperToPlayer } from "./players/whisper.js";
import { PlayerRoleStore } from "./access/playerRoleStore.js";
import { normalizePlayerName } from "./access/roleCatalog.js";
import { BotCommandService } from "./commands/botCommandService.js";
import { parseMinecraftCommand } from "./commands/minecraftCommand.js";
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
	private manualInventoryBusy: symbol | null = null;
	private activePlayerTask: TrackedPlayerTask | ProtectTask | null = null;
	private playerTaskCleanup: Promise<void> | null = null;
	private playerRoster: PlayerRoster | null = null;
	private playersSubscribed = false;
	private activeExcavateTask: ExcavateTask | null = null;
	private retryCount = 0;
	private destroyed = false;
	private wasKicked = false;
	private tickErrorLogged = false;
	private readonly callbacks: BotSessionCallbacks;
	private readonly playerRoles: PlayerRoleStore;
	private readonly commands: BotCommandService;

	constructor(
		sessionId: string,
		config: BotConfig,
		callbacks: BotSessionCallbacks,
	) {
		this.sessionId = sessionId;
		this.config = config;
		this.callbacks = callbacks;
		this.playerRoles = new PlayerRoleStore(sessionId);
		this.commands = new BotCommandService(this.playerRoles, (action) =>
			this.executeAction(action),
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
			behaviors: {
				...this.behaviorStatus,
				settings: copySettings(this.behaviorSettings),
			},
		};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────────

	spawn(): void {
		if (this.destroyed) return;
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
			this.bot = mineflayer.createBot({
				host: this.config.serverHost,
				...(this.config.serverPort !== undefined && {
					port: this.config.serverPort,
				}),
				username: this.config.botName,
				version: this.config.version || undefined,
				auth: "offline",
			});
			this.bot.loadPlugin(pathfinder);
			this.bot.loadPlugin(pvp);
			this.bot.loadPlugin(armorManager);
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
		this.manualInventoryBusy = null;
		this.idleBehaviors?.dispose();
		this.idleBehaviors = new IdleBehaviors(
			bot,
			this.behaviorSettings,
			() =>
				this.bot === bot &&
				!this.destroyed &&
				this.state === "idle" &&
				this.currentTask === null &&
				!this.playerTaskCleanup &&
				!this.activeExcavateTask &&
				!this.manualInventoryBusy,
			(status) => {
				if (this.bot !== bot || this.destroyed) return;
				this.behaviorStatus = status;
				this.callbacks.onStateChange();
			},
			(message, level = "warning") => {
				if (this.bot === bot && !this.destroyed) this.emitEvent(level, message);
			},
		);
		this.playerRoster?.dispose();
		this.playerRoster = new PlayerRoster(bot, (snapshot) => {
			if (this.bot === bot && !this.destroyed) {
				this.callbacks.onPlayers({ sessionId: this.sessionId, ...snapshot });
			}
		});

		bot.on("spawn", () => {
			// Stale-event guard: skip if this bot has already been replaced or destroyed.
			if (this.bot !== bot || this.destroyed) return;

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

			(bot as any).armorManager.equipAll();
			this.setState("idle");
			this.resetIdleTimer();
			this.emitArmorUpdate(bot);
			this.playerRoster?.setSubscribed(this.playersSubscribed);
		});

		bot.on("entityEquip", (entity: any) => {
			// console.log('in entityEquip');
			if (this.bot !== bot || this.destroyed) return;
			// console.log("entity", entity);
			if (entity !== bot.entity) return;
			// console.log("entityEquip", entity);
			this.emitArmorUpdate(bot);
		});

		bot.on("physicsTick", () => {
			if (this.bot !== bot) return;
			try {
				// Pathfinder/combat owns looking during tasks; passive glances must not fight it.
				if (this.state === "idle" && !this.idleBehaviors?.busy)
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
			if (this.bot !== bot) return;
			if (username === this.config.botName) return;

			this.callbacks.onChat({ username, message, timestamp: Date.now() });
			this.handleGreeting(username, message);
			this.handleChatCommands(username, message);
		});

		bot.on("whisper", (username: string, message: string) => {
			if (
				this.bot !== bot ||
				this.destroyed ||
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
		});

		bot.on("death", () => {
			if (this.bot !== bot) return;
			this.stopTask();
			this.clearIdleTimer();
			this.setState("dead");
			this.playerRoster?.setSubscribed(false);
			this.emitEvent("warning", `Bot "${this.config.botName}" has died.`);
			this.emitSystemChat(`Bot "${this.config.botName}" has died.`);
		});

		bot.on("kicked", (reason: string) => {
			if (this.bot !== bot) return;
			this.wasKicked = true;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent("error", `Bot was kicked: ${reason}`);
			this.emitSystemChat(`Bot was kicked: ${reason}`);
			// 'end' fires right after 'kicked'; wasKicked flag blocks retry there.
		});

		bot.on("error", (err: Error & { name?: string }) => {
			if (this.bot !== bot) return;

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
				return;
			}

			const msg = friendlyErrorMessage(err);
			this.emitEvent("error", `Bot error: ${msg}`);

			// If 'end' never fires (e.g. DNS failure, early ECONNRESET), recover the
			// session so it doesn't stay stuck in 'spawning' forever.
			if (this.state === "spawning") {
				this.stopTask();
				this.clearIdleTimer();
				setTimeout(() => {
					if (this.state === "spawning" && !this.destroyed) {
						this.handleDisconnect(!this.wasKicked);
					}
				}, 500);
			}
		});

		bot.on("end", (reason: string) => {
			if (this.bot !== bot || this.destroyed) return;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent("info", `Bot disconnected: ${reason}`);
			this.emitSystemChat(`Bot disconnected (${reason}).`);
			this.handleDisconnect(!this.wasKicked);
		});
	}

	private handleDisconnect(shouldRetry: boolean): void {
		if (this.destroyed) return;
		this.clearRetryTimer();
		this.idleBehaviors?.dispose();
		this.idleBehaviors = null;
		this.playerRoster?.dispose();
		this.playerRoster = null;
		this.bot = null;
		this.setState("disconnected");

		if (shouldRetry && this.retryCount < MAX_RETRY_ATTEMPTS) {
			this.retryCount++;
			const delay = RETRY_DELAY_BASE_MS * this.retryCount;
			this.emitEvent(
				"info",
				`Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay / 1000}s...`,
			);
			this.retryTimer = setTimeout(() => {
				this.retryTimer = null;
				if (!this.destroyed && this.state === "disconnected") {
					this.setState("spawning");
					this.createBot();
				}
			}, delay);
		} else if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
			this.emitEvent("error", "Max retry attempts reached. Session ended.");
			this.destroy();
		}
	}

	disconnect(): void {
		this.clearRetryTimer();
		this.idleBehaviors?.dispose();
		this.idleBehaviors = null;
		this.stopTask();
		this.playerRoster?.dispose();
		this.playerRoster = null;
		this.playersSubscribed = false;
		this.clearIdleTimer();
		if (this.bot) {
			try {
				this.bot.quit();
			} catch (_) {
				/* swallow quit errors */
			}
			this.bot = null;
		}
		this.setState("disconnected");
		this.emitEvent("info", "Bot disconnected by user.");
		this.emitSystemChat("Bot has disconnected.");
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
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
		this.behaviorSettings = copySettings(input);
		this.idleBehaviors?.update(this.behaviorSettings);
		this.callbacks.onStateChange();
		return { ok: true, value: copySettings(this.behaviorSettings) };
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

	private executeAction(action: BotAction): PlayerCommandResult {
		if (!this.bot || this.destroyed || !["idle", "task"].includes(this.state))
			return { ok: false, error: "The bot is not active." };
		if (action.type === "stop") {
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
		if (this.playerTaskCleanup || this.activeExcavateTask)
			return {
				ok: false,
				error: "The previous task is still stopping. Try again shortly.",
			};
		if (this.manualInventoryBusy)
			return {
				ok: false,
				error: "An inventory operation is still finishing. Try again shortly.",
			};
		if (this.idleBehaviors && !this.idleBehaviors.prepareForTask())
			return {
				ok: false,
				error:
					"Idle behavior is stopping before this task can start. Retry once cleanup finishes.",
			};
		if (action.type === "excavate") {
			const r = action.region;
			const volume =
				(Math.abs(r.x2 - r.x1) + 1) *
				(Math.abs(r.y2 - r.y1) + 1) *
				(Math.abs(r.z2 - r.z1) + 1);
			if (volume > 10_000)
				return {
					ok: false,
					error: "Excavation region too large (max 10000 blocks).",
				};
			this.startExcavate(r);
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
		if (this.playerTaskCleanup || this.activeExcavateTask)
			return {
				ok: false,
				error: "The previous task is still stopping. Try again shortly.",
			};
		const target = resolvePlayerTarget(bot, playerName);
		if (!target.ok) return target;
		if (type === "attack" && target.player.gamemode === 1) {
			return { ok: false, error: "Creative-mode players are invulnerable." };
		}
		const onFinished = (outcome: PlayerTaskOutcome): void => {
			if (this.activePlayerTask !== task || this.bot !== bot || this.destroyed)
				return;
			this.activePlayerTask = null;
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
				? new FollowTask(bot, target.player.username, onFinished)
				: type === "attack"
					? new AttackTask(bot, target.player.username, onFinished)
					: new ProtectTask(
							bot,
							target.player.username,
							onFinished,
							(status) => {
								if (
									this.activePlayerTask !== task ||
									this.bot !== bot ||
									this.destroyed
								)
									return;
								this.protectStatus = status;
								this.callbacks.onStateChange();
							},
						);
		this.activePlayerTask = task;
		this.currentTask = type;
		this.taskTarget = target.player.username;
		this.setState("task");
		this.resetIdleTimer();
		try {
			void task.start().catch(() => {
				/* task reports its asynchronous failure */
			});
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

	private startExcavate(region: ExcavateRegion): void {
		if (!this.bot) return;

		this.currentTask = "excavate";
		this.taskTarget = null;
		this.setState("task");

		const task = new ExcavateTask();
		this.activeExcavateTask = task;

		const { x1, y1, z1, x2, y2, z2 } = region;
		this.emitEvent(
			"info",
			`Excavate task started: (${x1},${y1},${z1}) → (${x2},${y2},${z2}).`,
		);
		if (this.bot) {
			this.bot.chat(
				`Starting excavation from (${x1},${y1},${z1}) to (${x2},${y2},${z2}).`,
			);
		}

		task
			.run(this.bot, region, {
				onEvent: (type, message) => this.emitEvent(type, message),
				onProgress: (current, total) => {
					// Report every 10% milestone to avoid spamming the event log.
					const pct = Math.floor((current / total) * 100);
					const prevPct = Math.floor(((current - 1) / total) * 100);
					if (pct !== prevPct && pct % 10 === 0) {
						this.emitEvent(
							"info",
							`Excavation progress: ${pct}% (${current}/${total})`,
						);
					}
				},
				onComplete: () => {
					this.emitEvent("success", "Excavation complete!");
					if (this.bot) this.bot.chat("Excavation complete!");
					this.activeExcavateTask = null;
					this.currentTask = null;
					this.taskTarget = null;
					this.setState("idle");
					this.resetIdleTimer();
				},
				onAbort: () => {
					this.activeExcavateTask = null;
					this.currentTask = null;
					this.taskTarget = null;
					if (this.state === "task") this.setState("idle");
					this.resetIdleTimer();
				},
			})
			.catch((err: Error) => {
				this.emitEvent("error", `Excavation error: ${err.message}`);
				this.activeExcavateTask = null;
				this.currentTask = null;
				this.taskTarget = null;
				if (this.state === "task") this.setState("idle");
				this.resetIdleTimer();
			});
	}

	private stopTask(): void {
		const playerTask = this.activePlayerTask;
		if (playerTask instanceof ProtectTask) {
			if (this.playerTaskCleanup) return;
			const cleanup = playerTask
				.stop()
				.then(
					() => {
						if (this.activePlayerTask !== playerTask) return;
						this.activePlayerTask = null;
						this.protectStatus = undefined;
						this.currentTask = null;
						this.taskTarget = null;
						if (this.state === "task") this.setState("idle");
						this.resetIdleTimer();
					},
					(error: unknown) => {
						this.emitEvent(
							"error",
							`Protect cleanup failed; retire this deployment: ${String(error)}`,
						);
					},
				)
				.then(() => {
					// Failed cleanup keeps both the task and lease, blocking successors.
					if (
						this.activePlayerTask !== playerTask &&
						this.playerTaskCleanup === cleanup
					)
						this.playerTaskCleanup = null;
				});
			this.playerTaskCleanup = cleanup;
			return;
		}
		this.activePlayerTask = null;
		if (playerTask) {
			const cleanup = playerTask
				.stop()
				.catch((error: unknown) => {
					this.emitEvent(
						"warning",
						`Player task cleanup failed: ${String(error)}`,
					);
				})
				.finally(() => {
					if (this.playerTaskCleanup === cleanup) this.playerTaskCleanup = null;
				});
			this.playerTaskCleanup = cleanup;
		}

		if (this.activeExcavateTask) {
			this.activeExcavateTask.abort();
			// activeExcavateTask is cleared in the onAbort callback of run().
		}

		if (this.bot && this.state === "task" && !playerTask) {
			try {
				const cleanup = Promise.resolve(this.bot.pvp.stop())
					.catch((error: unknown) => {
						this.emitEvent(
							"warning",
							`Combat cleanup failed: ${String(error)}`,
						);
					})
					.finally(() => {
						if (this.playerTaskCleanup === cleanup)
							this.playerTaskCleanup = null;
					});
				this.playerTaskCleanup = cleanup;
			} catch (_) {
				/* ignore if pvp not active */
			}
			try {
				this.bot.pathfinder.setGoal(null);
			} catch (_) {
				/* ignore if pathfinder not active */
			}
		}

		this.currentTask = null;
		this.taskTarget = null;

		if (this.state === "task") {
			this.setState("idle");
		}
	}

	// ─── Greeting & Chat Commands ─────────────────────────────────────────────────

	private handleGreeting(username: string, message: string): void {
		const lower = message.toLowerCase();
		if (lower.includes("hi bot") || lower.includes("hello bot")) {
			setTimeout(() => {
				if (!this.bot) return;
				this.bot.chat("Hi there!");
				this.callbacks.onChat({
					username: this.config.botName,
					message: "Hi there!",
					timestamp: Date.now(),
					isBot: true,
				});
			}, 500);
		}
	}

	private handleChatCommands(username: string, message: string): void {
		const parsed = parseMinecraftCommand(username, message);
		if (parsed.kind === "ignore") return;
		const result =
			parsed.kind === "invalid"
				? { ok: false as const, error: parsed.error }
				: this.commands.submit({ kind: "minecraft", username }, parsed.action);
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
		if (!bot) return;
		if (
			this.manualInventoryBusy ||
			(this.idleBehaviors && !this.idleBehaviors.prepareForTask())
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

		try {
			await bot.unequip(slot);
			const invItem = bot.inventory.items().find((i) => i.type === item.type);
			if (invItem) await bot.tossStack(invItem);
			this.emitEvent(
				"info",
				`Un-equipped and dropped ${item.displayName ?? item.name}.`,
			);
			this.emitArmorUpdate(bot);
		} catch (err) {
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
