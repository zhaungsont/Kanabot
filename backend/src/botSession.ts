import mineflayer, { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;
import pvpPkg from 'mineflayer-pvp';
const pvp = (pvpPkg as any).plugin;
import armorManager from 'mineflayer-armor-manager';
import { plugin as toolPlugin } from 'mineflayer-tool';
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
} from './types.js';
import { ExcavateTask } from './tasks/excavateTask.js';
import { FollowTask } from './tasks/followTask.js';
import { AttackTask } from './tasks/attackTask.js';
import type { TrackedPlayerTask, PlayerTaskOutcome } from './tasks/trackedPlayerTask.js';
import { PlayerRoster } from './players/playerRoster.js';
import { resolvePlayerTarget } from './players/playerTarget.js';
import { whisperToPlayer } from './players/whisper.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_BASE_MS = 5000;
const GUARD_FOLLOW_RANGE = 3; // stay within 3 blocks when no threat
const GUARD_MOB_RANGE = 10; // threat detection radius around guarded player
const GUARD_TICK_MS = 333;

/** Entity type names treated as hostile in the guard ability. */

export interface BotSessionCallbacks {
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

	state: BotState = 'disconnected';
	currentTask: TaskType = null;
	taskTarget: string | null = null;
	spawnedAt: Date | null = null;

	private bot: Bot | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private guardInterval: ReturnType<typeof setInterval> | null = null;
	private guardWeaponListener: ((collector: any) => void) | null = null;
	private activePlayerTask: TrackedPlayerTask | null = null;
	private playerTaskCleanup: Promise<void> | null = null;
	private playerRoster: PlayerRoster | null = null;
	private playersSubscribed = false;
	private activeExcavateTask: ExcavateTask | null = null;
	private retryCount = 0;
	private destroyed = false;
	private wasKicked = false;
	private tickErrorLogged = false;
	private readonly callbacks: BotSessionCallbacks;

	constructor(
		sessionId: string,
		config: BotConfig,
		callbacks: BotSessionCallbacks,
	) {
		this.sessionId = sessionId;
		this.config = config;
		this.callbacks = callbacks;
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
		};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────────

	spawn(): void {
		if (this.destroyed) return;
		if (this.state !== 'disconnected' && this.state !== 'dead') return;
		this.setState('spawning');
		const target = this.config.serverPort
			? `${this.config.serverHost}:${this.config.serverPort}`
			: this.config.serverHost;
		this.emitEvent('info', `Connecting to ${target}...`);
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
				auth: 'offline',
			});
			this.bot.loadPlugin(pathfinder);
			this.bot.loadPlugin(pvp);
			this.bot.loadPlugin(armorManager);
			this.bot.loadPlugin(toolPlugin);
			this.setupBotEvents();
		} catch (err) {
			this.emitEvent('error', `Failed to create bot: ${err}`);
			this.handleDisconnect(false);
		}
	}

	private setupBotEvents(): void {
		// Capture the bot instance now so every callback uses this exact reference.
		// this.bot may be set to null later (on disconnect/retry), which would cause
		// "Cannot read properties of null" if callbacks used this.bot! directly.
		const bot = this.bot;
		if (!bot) return;
		this.playerRoster?.dispose();
		this.playerRoster = new PlayerRoster(bot, (snapshot) => {
			if (this.bot === bot && !this.destroyed) {
				this.callbacks.onPlayers({ sessionId: this.sessionId, ...snapshot });
			}
		});

		bot.on('spawn', () => {
			// Stale-event guard: skip if this bot has already been replaced or destroyed.
			if (this.bot !== bot || this.destroyed) return;

			const isRespawn = this.state === 'dead';

			if (!isRespawn) {
				// Initial spawn: one-time setup.
				this.spawnedAt = new Date();
				this.retryCount = 0;

				const defaultMove = new Movements(bot);
				bot.pathfinder.setMovements(defaultMove);

				this.emitEvent(
					'success',
					`Bot "${this.config.botName}" spawned successfully!`,
				);
				this.emitSystemChat(
					`Bot "${this.config.botName}" has joined the server.`,
				);
			} else {
				// Respawn after death: restore active state.
				this.emitEvent('info', `Bot "${this.config.botName}" has respawned.`);
				this.emitSystemChat(`Bot "${this.config.botName}" has respawned.`);
			}

			(bot as any).armorManager.equipAll();
			this.setState('idle');
			this.resetIdleTimer();
			this.emitArmorUpdate(bot);
			this.playerRoster?.setSubscribed(this.playersSubscribed);
		});

		bot.on('entityEquip', (entity: any) => {
			console.log('in entityEquip');
			if (this.bot !== bot || this.destroyed) return;
			console.log('entity', entity);
			if (entity !== bot.entity) return;
			console.log('entityEquip', entity);
			this.emitArmorUpdate(bot);
		});

		bot.on('physicsTick', () => {
			if (this.bot !== bot) return;
			try {
				// Pathfinder/combat owns looking during tasks; passive glances must not fight it.
				if (this.state === 'idle') this.lookAtNearestEntity(bot);
			} catch (err) {
				if (!this.tickErrorLogged) {
					this.tickErrorLogged = true;
					this.emitEvent(
						'error',
						`physicsTick error: ${(err as Error).message}`,
					);
				}
			}
		});

		bot.on('chat', (username: string, message: string) => {
			if (this.bot !== bot) return;
			if (username === this.config.botName) return;

			this.callbacks.onChat({ username, message, timestamp: Date.now() });
			this.handleGreeting(username, message);
			this.handleChatCommands(username, message);
		});

		bot.on('whisper', (username: string, message: string) => {
			if (this.bot !== bot || this.destroyed || username === this.config.botName) return;
			this.callbacks.onChat({ username, message, timestamp: Date.now(), channel: 'whisper', recipient: this.config.botName });
		});

		bot.on('death', () => {
			if (this.bot !== bot) return;
			this.stopTask();
			this.clearIdleTimer();
			this.setState('dead');
			this.playerRoster?.setSubscribed(false);
			this.emitEvent('warning', `Bot "${this.config.botName}" has died.`);
			this.emitSystemChat(`Bot "${this.config.botName}" has died.`);
		});

		bot.on('kicked', (reason: string) => {
			if (this.bot !== bot) return;
			this.wasKicked = true;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent('error', `Bot was kicked: ${reason}`);
			this.emitSystemChat(`Bot was kicked: ${reason}`);
			// 'end' fires right after 'kicked'; wasKicked flag blocks retry there.
		});

		bot.on('error', (err: Error & { name?: string }) => {
			if (this.bot !== bot) return;

			// protodef PartialReadError — indicates a Minecraft version mismatch between
			// the bot config and the actual server. The session will end and retry, so
			// just surface a clear diagnostic rather than a raw stack trace.
			if (
				err.name === 'PartialReadError' ||
				err.constructor?.name === 'PartialReadError' ||
				err.message?.includes('Unexpected buffer end')
			) {
				this.emitEvent(
					'error',
					`Packet parse error — possible version mismatch. ` +
						`Try setting the Minecraft version explicitly (e.g. "1.21.4"). ` +
						`[${err.message}]`,
				);
				return;
			}

			const msg = friendlyErrorMessage(err);
			this.emitEvent('error', `Bot error: ${msg}`);

			// If 'end' never fires (e.g. DNS failure, early ECONNRESET), recover the
			// session so it doesn't stay stuck in 'spawning' forever.
			if (this.state === 'spawning') {
				this.stopTask();
				this.clearIdleTimer();
				setTimeout(() => {
					if (this.state === 'spawning' && !this.destroyed) {
						this.handleDisconnect(!this.wasKicked);
					}
				}, 500);
			}
		});

		bot.on('end', (reason: string) => {
			if (this.bot !== bot || this.destroyed) return;
			this.stopTask();
			this.clearIdleTimer();
			this.emitEvent('info', `Bot disconnected: ${reason}`);
			this.emitSystemChat(`Bot disconnected (${reason}).`);
			this.handleDisconnect(!this.wasKicked);
		});
	}

	private handleDisconnect(shouldRetry: boolean): void {
		if (this.destroyed) return;
		this.clearRetryTimer();
		this.playerRoster?.dispose();
		this.playerRoster = null;
		this.bot = null;
		this.setState('disconnected');

		if (shouldRetry && this.retryCount < MAX_RETRY_ATTEMPTS) {
			this.retryCount++;
			const delay = RETRY_DELAY_BASE_MS * this.retryCount;
			this.emitEvent(
				'info',
				`Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay / 1000}s...`,
			);
			this.retryTimer = setTimeout(() => {
				this.retryTimer = null;
				if (!this.destroyed && this.state === 'disconnected') {
					this.setState('spawning');
					this.createBot();
				}
			}, delay);
		} else if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
			this.emitEvent('error', 'Max retry attempts reached. Session ended.');
			this.destroy();
		}
	}

	disconnect(): void {
		this.clearRetryTimer();
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
		this.setState('disconnected');
		this.emitEvent('info', 'Bot disconnected by user.');
		this.emitSystemChat('Bot has disconnected.');
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.disconnect();
		this.callbacks.onDestroy();
	}

	// ─── Actions ─────────────────────────────────────────────────────────────────

	sendChat(message: string): void {
		if (!this.bot || this.state === 'disconnected' || this.state === 'spawning')
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

	performAction(
		type: 'follow' | 'guard' | 'stop' | 'excavate' | 'attack',
		target?: string,
		region?: ExcavateRegion,
	): void {
		if (!this.bot) return;

		if (type === 'stop') {
			this.stopTask();
			this.emitEvent('info', 'Task stopped. Bot is idle.');
			this.resetIdleTimer();
			return;
		}

		if (this.state !== 'idle') {
			this.emitEvent(
				'warning',
				`Cannot start task: bot is currently in state "${this.state}".`,
			);
			return;
		}
		if (this.playerTaskCleanup || this.activeExcavateTask) {
			this.emitEvent('warning', 'The previous task is still stopping. Try again shortly.');
			return;
		}

		this.resetIdleTimer();

		if (type === 'excavate') {
			if (!region) {
				this.emitEvent('warning', 'Excavate task requires region coordinates.');
				return;
			}
			this.startExcavate(region);
			return;
		}

		if (!target) {
			this.emitEvent('warning', 'No target player specified for task.');
			return;
		}

		if (type === 'follow' || type === 'attack') {
			const result = this.startPlayerTask(type, target);
			if (!result.ok) this.emitEvent('warning', result.error);
		} else {
			this.startGuard(target);
		}
	}

	// ─── Abilities ───────────────────────────────────────────────────────────────

	/** Looks toward the nearest player or mob every physics tick. */
	private lookAtNearestEntity(bot: Bot): void {
		const target = bot.nearestEntity(
			// 'animal' is a valid runtime type; cast until mineflayer typings catch up
			(e) => e.type === 'player' || (e.type as string) === 'animal',
		);
		if (!target) return;
		bot.lookAt(target.position.offset(0, target.height * 0.9, 0));
	}

	/** Equips the highest-tier sword or axe found in the bot's inventory. */
	private equipBestWeapon(): void {
		if (!this.bot) return;

		const TIERS: Record<string, number> = {
			netherite: 6,
			diamond: 5,
			iron: 4,
			stone: 3,
			golden: 2,
			wooden: 1,
			wood: 1,
		};

		let bestItem = null;
		let bestScore = -1;

		for (const item of this.bot.inventory.items()) {
			const name = item.name; // e.g. "diamond_sword", "iron_axe"
			if (!name.endsWith('sword') && !name.endsWith('axe')) continue;
			const material = Object.keys(TIERS).find((m) => name.startsWith(m));
			if (!material) continue;
			const score = TIERS[material];
			if (score > bestScore) {
				bestScore = score;
				bestItem = item;
			}
		}

		if (!bestItem) return;

		this.bot
			.equip(bestItem, 'hand')
			.then(() => {
				this.emitEvent('info', `Equipped ${bestItem!.name} for combat.`);
			})
			.catch(() => {
				/* item may have moved */
			});
	}

	setPlayersSubscribed(enabled: boolean): PlayerCommandResult {
		if (enabled && (!this.bot || !['idle', 'task'].includes(this.state))) {
			return { ok: false, error: 'The bot must be connected to view players.' };
		}
		this.playersSubscribed = enabled;
		this.playerRoster?.setSubscribed(enabled);
		return { ok: true };
	}

	performPlayerCommand(command: PlayerCommand): PlayerCommandResult {
		if (!this.bot || this.destroyed || !['idle', 'task'].includes(this.state)) {
			return { ok: false, error: 'The bot is not active.' };
		}
		if (command.type !== 'whisper') return this.startPlayerTask(command.type, command.target);
		try {
			const result = whisperToPlayer(this.bot, command.target, command.message);
			if (result.ok) {
				this.callbacks.onChat({ username: this.config.botName, message: command.message.trim(), timestamp: Date.now(), isBot: true, channel: 'whisper', recipient: command.target });
				this.resetIdleTimer();
			}
			return result;
		} catch (error) {
			return { ok: false, error: `Could not send whisper: ${String(error)}` };
		}
	}

	private startPlayerTask(type: 'follow' | 'attack', playerName: string): PlayerCommandResult {
		const bot = this.bot;
		if (!bot || this.state !== 'idle' || this.destroyed) {
			return { ok: false, error: 'Stop the current task before starting another player task.' };
		}
		if (this.playerTaskCleanup || this.activeExcavateTask) return { ok: false, error: 'The previous task is still stopping. Try again shortly.' };
		const target = resolvePlayerTarget(bot, playerName);
		if (!target.ok) return target;
		if (type === 'attack' && target.player.gamemode === 1) {
			return { ok: false, error: 'Creative-mode players are invulnerable.' };
		}
		const onFinished = (outcome: PlayerTaskOutcome): void => {
			if (this.activePlayerTask !== task || this.bot !== bot || this.destroyed) return;
			this.activePlayerTask = null;
			this.currentTask = null;
			this.taskTarget = null;
			if (this.state === 'task') this.setState('idle');
			this.emitEvent(outcome.level, outcome.message);
			this.resetIdleTimer();
		};
		const task = type === 'follow'
			? new FollowTask(bot, target.player.username, onFinished)
			: new AttackTask(bot, target.player.username, onFinished);
		this.activePlayerTask = task;
		this.currentTask = type;
		this.taskTarget = target.player.username;
		this.setState('task');
		this.resetIdleTimer();
		try {
			void task.start().catch(() => { /* task reports its asynchronous failure */ });
		} catch (error) {
			this.stopTask();
			return { ok: false, error: `Could not start player task: ${String(error)}` };
		}
		this.emitEvent('info', `${type === 'follow' ? 'Following' : 'Attacking'} "${target.player.username}".`);
		this.emitSystemChat(`Bot acknowledged: ${type} "${target.player.username}".`);
		return { ok: true };
	}

	private startGuard(playerName: string): void {
		if (!this.bot) return;
		const player = this.bot.players[playerName];
		if (!player?.entity) {
			this.emitEvent(
				'warning',
				`Player "${playerName}" is not visible in-game.`,
			);
			return;
		}

		this.currentTask = 'guard';
		this.taskTarget = playerName;
		this.setState('task');
		this.emitEvent('info', `Now guarding "${playerName}".`);
		this.emitSystemChat(`Bot acknowledged: guarding "${playerName}".`);

		this.equipBestWeapon();

		// Re-equip whenever the bot picks up a new item in case it's a better weapon
		this.guardWeaponListener = (collector: any) => {
			if (!this.bot || collector !== this.bot.entity) return;
			this.equipBestWeapon();
		};
		this.bot.on('playerCollect', this.guardWeaponListener);

		const botPvp = (this.bot as any).pvp;

		this.guardInterval = setInterval(() => {
			if (!this.bot || this.destroyed || this.currentTask !== 'guard') return;

			const guardedPlayer = this.bot.players[playerName];
			if (!guardedPlayer?.entity) {
				this.emitEvent(
					'info',
					`"${playerName}" left the game. Stopping guard.`,
				);
				this.stopTask();
				return;
			}

			const playerPos = guardedPlayer.entity.position;
			let nearestMob = null;
			let minDist = GUARD_MOB_RANGE;

			for (const entity of Object.values(this.bot.entities)) {
				if (!entity || entity.type !== 'hostile') continue;
				const dist = entity.position.distanceTo(playerPos);
				if (dist < minDist) {
					minDist = dist;
					nearestMob = entity;
				}
			}

			if (nearestMob) {
				// pvp.attack handles pathfinding toward the target and attacking it
				botPvp.attack(nearestMob);
			} else {
				// No threat nearby — stop any active pvp chase and shadow the player
				botPvp.stop();
				this.bot.pathfinder.setGoal(
					new goals.GoalFollow(guardedPlayer.entity, GUARD_FOLLOW_RANGE),
					true,
				);
			}
		}, GUARD_TICK_MS);
	}

	private startExcavate(region: ExcavateRegion): void {
		if (!this.bot) return;

		this.currentTask = 'excavate';
		this.taskTarget = null;
		this.setState('task');

		const task = new ExcavateTask();
		this.activeExcavateTask = task;

		const { x1, y1, z1, x2, y2, z2 } = region;
		this.emitEvent(
			'info',
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
							'info',
							`Excavation progress: ${pct}% (${current}/${total})`,
						);
					}
				},
				onComplete: () => {
					this.emitEvent('success', 'Excavation complete!');
					if (this.bot) this.bot.chat('Excavation complete!');
					this.activeExcavateTask = null;
					this.currentTask = null;
					this.taskTarget = null;
					this.setState('idle');
					this.resetIdleTimer();
				},
				onAbort: () => {
					this.activeExcavateTask = null;
					this.currentTask = null;
					this.taskTarget = null;
					if (this.state === 'task') this.setState('idle');
					this.resetIdleTimer();
				},
			})
			.catch((err: Error) => {
				this.emitEvent('error', `Excavation error: ${err.message}`);
				this.activeExcavateTask = null;
				this.currentTask = null;
				this.taskTarget = null;
				if (this.state === 'task') this.setState('idle');
				this.resetIdleTimer();
			});
	}

	private stopTask(): void {
		this.clearGuardInterval();
		this.clearGuardWeaponListener();
		const playerTask = this.activePlayerTask;
		this.activePlayerTask = null;
		if (playerTask) {
			const cleanup = playerTask.stop().catch((error: unknown) => {
				this.emitEvent('warning', `Player task cleanup failed: ${String(error)}`);
			}).finally(() => {
				if (this.playerTaskCleanup === cleanup) this.playerTaskCleanup = null;
			});
			this.playerTaskCleanup = cleanup;
		}

		if (this.activeExcavateTask) {
			this.activeExcavateTask.abort();
			// activeExcavateTask is cleared in the onAbort callback of run().
		}

		if (this.bot && this.state === 'task' && !playerTask) {
			try {
				const cleanup = Promise.resolve(this.bot.pvp.stop()).catch((error: unknown) => {
					this.emitEvent('warning', `Combat cleanup failed: ${String(error)}`);
				}).finally(() => {
					if (this.playerTaskCleanup === cleanup) this.playerTaskCleanup = null;
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

		if (this.state === 'task') {
			this.setState('idle');
		}
	}

	// ─── Greeting & Chat Commands ─────────────────────────────────────────────────

	private handleGreeting(username: string, message: string): void {
		const lower = message.toLowerCase();
		if (lower.includes('hi bot') || lower.includes('hello bot')) {
			setTimeout(() => {
				if (!this.bot) return;
				this.bot.chat('Hi there!');
				this.callbacks.onChat({
					username: this.config.botName,
					message: 'Hi there!',
					timestamp: Date.now(),
					isBot: true,
				});
			}, 500);
		}
	}

	/** Optional in-game slash commands for players to control the bot directly. */
	private handleChatCommands(username: string, message: string): void {
		const lower = message.trim().toLowerCase();

		if (lower.startsWith('!follow')) {
			const parts = message.trim().split(/\s+/);
			const target = parts[1] ?? username;
			this.performAction('follow', target);
		} else if (lower.startsWith('!guard')) {
			const parts = message.trim().split(/\s+/);
			const target = parts[1] ?? username;
			this.performAction('guard', target);
		} else if (lower === '!stop') {
			this.performAction('stop');
		} else if (lower.startsWith('!dig')) {
			// Usage: !dig <x1> <y1> <z1> <x2> <y2> <z2>
			const parts = message.trim().split(/\s+/);
			if (parts.length !== 7) {
				if (this.bot) {
					this.bot.chat('Usage: !dig <x1> <y1> <z1> <x2> <y2> <z2>');
				}
				return;
			}
			const coords = parts.slice(1).map(Number);
			if (coords.some(isNaN)) {
				if (this.bot) {
					this.bot.chat('All coordinates must be numbers.');
				}
				return;
			}
			const [x1, y1, z1, x2, y2, z2] = coords as [
				number,
				number,
				number,
				number,
				number,
				number,
			];
			this.performAction('excavate', undefined, { x1, y1, z1, x2, y2, z2 });
		}
	}

	// ─── Timers ──────────────────────────────────────────────────────────────────

	resetIdleTimer(): void {
		this.clearIdleTimer();
		if (
			this.destroyed ||
			this.state === 'disconnected' ||
			this.state === 'spawning'
		)
			return;

		this.idleTimer = setTimeout(() => {
			if (this.state === 'idle' && this.currentTask === null) {
				this.emitEvent('warning', 'Idle for 10 minutes — auto-disconnecting.');
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

	private clearGuardInterval(): void {
		if (this.guardInterval !== null) {
			clearInterval(this.guardInterval);
			this.guardInterval = null;
		}
	}

	private clearGuardWeaponListener(): void {
		if (this.guardWeaponListener && this.bot) {
			this.bot.removeListener('playerCollect', this.guardWeaponListener);
		}
		this.guardWeaponListener = null;
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
		return (['head', 'torso', 'legs', 'feet'] as ArmorSlotId[]).map(
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

		const slotIndex = BotSession.ARMOR_SLOT_INDICES[slot];
		const item = bot.inventory.slots[slotIndex];
		if (!item) return;

		try {
			await bot.unequip(slot);
			const invItem = bot.inventory.items().find((i) => i.type === item.type);
			if (invItem) await bot.tossStack(invItem);
			this.emitEvent(
				'info',
				`Un-equipped and dropped ${item.displayName ?? item.name}.`,
			);
			this.emitArmorUpdate(bot);
		} catch (err) {
			this.emitEvent(
				'error',
				`Failed to drop armor: ${(err as Error).message}`,
			);
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────────

	private setState(state: BotState): void {
		this.state = state;
		this.callbacks.onStateChange();
	}

	private emitEvent(type: EventLogEntry['type'], message: string): void {
		this.callbacks.onEvent({ type, message, timestamp: Date.now() });
	}

	private emitSystemChat(message: string): void {
		this.callbacks.onChat({
			username: 'System',
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
		case 'ECONNRESET':
			return 'Connection was reset by the server (ECONNRESET). The server may be offline or unreachable.';
		case 'ECONNREFUSED':
			return 'Connection refused (ECONNREFUSED). Check the server IP and port.';
		case 'ENOTFOUND':
			return `Host not found (ENOTFOUND). Check the server address.`;
		case 'ETIMEDOUT':
			return 'Connection timed out (ETIMEDOUT). The server may be offline or behind a firewall.';
		default:
			return err.message;
	}
}
