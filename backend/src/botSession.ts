import mineflayer, { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;
import pvpPkg from 'mineflayer-pvp';
const pvp = (pvpPkg as any).plugin;
import armorManager from 'mineflayer-armor-manager';
import {
	BotState,
	BotConfig,
	ChatMessage,
	EventLogEntry,
	TaskType,
	BotSessionInfo,
} from './types.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_BASE_MS = 5000;
const FOLLOW_RANGE = 3;
const GUARD_FOLLOW_RANGE = 3; // stay within 3 blocks when no threat
const GUARD_MOB_RANGE = 10; // threat detection radius around guarded player
const GUARD_TICK_MS = 333;
const FOLLOW_UPDATE_MS = 1000;

/** Entity type names treated as hostile in the guard ability. */

export interface BotSessionCallbacks {
	onChat: (msg: ChatMessage) => void;
	onEvent: (entry: EventLogEntry) => void;
	onStateChange: () => void;
	onDestroy: () => void;
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
	private guardInterval: ReturnType<typeof setInterval> | null = null;
	private guardWeaponListener: ((collector: any) => void) | null = null;
	private followInterval: ReturnType<typeof setInterval> | null = null;
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
			spawnedAt: this.spawnedAt,
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

		bot.once('spawn', () => {
			// Stale-event guard: skip if this bot has already been replaced or destroyed.
			if (this.bot !== bot || this.destroyed) return;

			this.spawnedAt = new Date();
			this.retryCount = 0;

			const defaultMove = new Movements(bot);
			bot.pathfinder.setMovements(defaultMove);

			(bot as any).armorManager.equipAll();

			this.setState('idle');
			this.emitEvent(
				'success',
				`Bot "${this.config.botName}" spawned successfully!`,
			);
			this.emitSystemChat(
				`Bot "${this.config.botName}" has joined the server.`,
			);
			this.resetIdleTimer();
		});

		bot.on('physicsTick', () => {
			if (this.bot !== bot) return;
			try {
				this.lookAtNearestEntity(bot);
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

		bot.on('death', () => {
			if (this.bot !== bot) return;
			this.stopTask();
			this.clearIdleTimer();
			this.setState('dead');
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

		bot.on('error', (err: Error) => {
			if (this.bot !== bot) return;
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
		this.bot = null;
		this.setState('disconnected');

		if (shouldRetry && this.retryCount < MAX_RETRY_ATTEMPTS) {
			this.retryCount++;
			const delay = RETRY_DELAY_BASE_MS * this.retryCount;
			this.emitEvent(
				'info',
				`Retry ${this.retryCount}/${MAX_RETRY_ATTEMPTS} in ${delay / 1000}s...`,
			);
			setTimeout(() => {
				if (!this.destroyed) this.createBot();
			}, delay);
		} else if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
			this.emitEvent('error', 'Max retry attempts reached. Session ended.');
			this.destroy();
		}
	}

	disconnect(): void {
		this.stopTask();
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

	performAction(type: 'follow' | 'guard' | 'stop', target?: string): void {
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

		if (!target) {
			this.emitEvent('warning', 'No target player specified for task.');
			return;
		}

		this.resetIdleTimer();

		if (type === 'follow') {
			this.startFollow(target);
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

	private startFollow(playerName: string): void {
		if (!this.bot) return;
		const player = this.bot.players[playerName];
		if (!player?.entity) {
			this.emitEvent(
				'warning',
				`Player "${playerName}" is not visible in-game.`,
			);
			return;
		}

		this.currentTask = 'follow';
		this.taskTarget = playerName;
		this.setState('task');
		this.emitEvent('info', `Now following "${playerName}".`);
		this.emitSystemChat(`Bot acknowledged: following "${playerName}".`);

		this.bot.pathfinder.setGoal(
			new goals.GoalFollow(player.entity, FOLLOW_RANGE),
			true,
		);

		this.followInterval = setInterval(() => {
			if (!this.bot || this.destroyed || this.currentTask !== 'follow') {
				this.clearFollowInterval();
				return;
			}
			const p = this.bot.players[playerName];
			if (!p?.entity) {
				this.emitEvent(
					'info',
					`"${playerName}" left the game. Stopping follow.`,
				);
				this.stopTask();
			} else {
				this.bot.pathfinder.setGoal(
					new goals.GoalFollow(p.entity, FOLLOW_RANGE),
					true,
				);
			}
		}, FOLLOW_UPDATE_MS);
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

	private stopTask(): void {
		this.clearGuardInterval();
		this.clearGuardWeaponListener();
		this.clearFollowInterval();

		if (this.bot && this.state === 'task') {
			try {
				(this.bot as any).pvp.stop();
			} catch (_) {
				/* ignore if pvp not active */
			}
			try {
				this.bot.pathfinder.stop();
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
				this.disconnect();
			}
		}, IDLE_TIMEOUT_MS);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
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

	private clearFollowInterval(): void {
		if (this.followInterval !== null) {
			clearInterval(this.followInterval);
			this.followInterval = null;
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
