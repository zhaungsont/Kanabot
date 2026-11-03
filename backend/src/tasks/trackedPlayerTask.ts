import type { Bot, Player } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Movements, Pathfinder } from 'mineflayer-pathfinder';
import { MAX_PLAYER_TASK_DISTANCE, resolvePlayerTarget } from '../players/playerTarget.js';

export interface PlayerTaskOutcome {
  level: 'info' | 'warning' | 'error';
  message: string;
  code?: 'PLAYER_UNREACHABLE';
}

/** Owns the complete task lifecycle; no sockets, browser state, or session registry. */
export abstract class TrackedPlayerTask {
  protected running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private beginning: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | null = null;
  private targetEntity: Entity | null = null;
  private dimension: string | undefined;
  private previousPathSettings: { thinkTimeout: number; tickTimeout: number; searchRadius: number; movements: Movements } | null = null;
  protected movements: Movements | null = null;
  private lastProgressAt = 0;
  private lastPosition: { x: number; y: number; z: number } | null = null;

  constructor(
    protected readonly bot: Bot,
    readonly target: string,
    private readonly onFinished: (outcome: PlayerTaskOutcome) => void,
  ) {}

  start(): Promise<void> {
    if (this.running || this.stopping) return Promise.reject(new Error('Task has already been started.'));
    const target = resolvePlayerTarget(this.bot, this.target);
    if (!target.ok) return Promise.reject(new Error(target.error));
    this.running = true;
    this.targetEntity = target.entity;
    this.dimension = this.bot.game.dimension;
    this.lastProgressAt = Date.now();
    this.lastPosition = { ...this.bot.entity.position };

    const pathfinder = this.bot.pathfinder as Pathfinder & { searchRadius: number };
    this.previousPathSettings = {
      thinkTimeout: pathfinder.thinkTimeout, tickTimeout: pathfinder.tickTimeout,
      searchRadius: pathfinder.searchRadius, movements: pathfinder.movements,
    };
    // Clone settings without mutating guard/excavation's movement policy.
    this.movements = Object.assign(
      Object.create(Object.getPrototypeOf(pathfinder.movements)), pathfinder.movements,
      { canDig: false, allow1by1towers: false },
    ) as Movements;
    pathfinder.thinkTimeout = 1_500;
    pathfinder.tickTimeout = 10;
    pathfinder.searchRadius = MAX_PLAYER_TASK_DISTANCE;
    pathfinder.setMovements(this.movements);

    this.bot.on('playerLeft', this.onPlayerLeft);
    this.bot.on('entityGone', this.onEntityGone);
    this.bot.on('entityDead', this.onEntityDead);
    this.bot.on('game', this.onGame);
    this.bot.on('death', this.onDeath);
    this.bot.on('end', this.onEnd);
    this.bot.on('path_update', this.onPathUpdate);
    this.timer = setInterval(() => this.checkTarget(), 1_000);
    this.beginning = Promise.resolve().then(async () => {
      if (this.running) await this.begin(target.entity);
    });
    this.beginning.catch((error: unknown) => {
      this.finish({ level: 'error', message: `Player task failed: ${String(error)}` });
    });
    return this.beginning;
  }

  protected abstract begin(entity: Entity): void | Promise<void>;

  protected async endMotion(): Promise<void> {
    this.bot.pathfinder.setGoal(null);
  }

  private readonly onPlayerLeft = (player: Player): void => {
    if (player.username.toLowerCase() === this.target.toLowerCase()) {
      this.finish({ level: 'info', message: `"${player.username}" left the server. Task stopped.` });
    }
  };
  private readonly onEntityGone = (entity: Entity): void => {
    if (entity === this.targetEntity) this.finish({ level: 'warning', message: `"${this.target}" left tracking range or changed dimension. Task stopped.` });
  };
  private readonly onEntityDead = (entity: Entity): void => {
    if (entity === this.targetEntity) this.finish({ level: 'info', message: `"${this.target}" died. Task stopped.` });
  };
  private readonly onGame = (): void => {
    if (this.bot.game.dimension !== this.dimension) {
      this.finish({ level: 'warning', message: 'Bot changed dimension. Player task stopped; cross-dimension navigation is unavailable.' });
    }
  };
  private readonly onDeath = (): void => { this.finish({ level: 'info', message: 'Bot died. Player task stopped.' }); };
  private readonly onEnd = (): void => { this.finish({ level: 'info', message: 'Bot disconnected. Player task stopped.' }); };
  private readonly onPathUpdate = (path: { status: string }): void => {
    if (path.status === 'noPath' || path.status === 'timeout') {
      this.finish({ level: 'warning', message: `Cannot reach "${this.target}" within the pathfinding budget (${path.status}). Task stopped.` });
    }
  };

  private checkTarget(): void {
    if (!this.running) return;
    const target = resolvePlayerTarget(this.bot, this.target);
    if (!target.ok) {
      this.finish({ level: 'warning', message: `${target.error} Task stopped.` });
      return;
    }
    if (target.entity !== this.targetEntity) {
      this.finish({ level: 'warning', message: 'Target entity changed. Start a new task for the current player entity.' });
      return;
    }
    const position = this.bot.entity.position;
    const previous = this.lastPosition;
    const moved = previous && Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z) >= 0.5;
    if (target.distance <= 3 || moved) {
      this.lastProgressAt = Date.now();
      this.lastPosition = { ...position };
    } else if (Date.now() - this.lastProgressAt >= 30_000) {
      this.finish({ level: 'warning', message: `No movement progress toward "${this.target}" for 30 seconds. Task stopped.` });
    }
  }

  protected finish(outcome: PlayerTaskOutcome): void {
    if (!this.running) return;
    void this.stop().then(() => this.onFinished(outcome), (error: unknown) => {
      this.onFinished({ level: 'error', message: `${outcome.message} Cleanup failed: ${String(error)}` });
    });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.bot.removeListener('playerLeft', this.onPlayerLeft);
    this.bot.removeListener('entityGone', this.onEntityGone);
    this.bot.removeListener('entityDead', this.onEntityDead);
    this.bot.removeListener('game', this.onGame);
    this.bot.removeListener('death', this.onDeath);
    this.bot.removeListener('end', this.onEnd);
    this.bot.removeListener('path_update', this.onPathUpdate);
    this.stopping = (async () => {
      try {
        // Finish pending plugin startup before cleanup; it must not restart motion later.
        await this.beginning.catch(() => undefined);
        await this.endMotion();
      } finally {
        this.bot.pathfinder.setGoal(null);
        if (this.previousPathSettings) {
          const { movements, ...settings } = this.previousPathSettings;
          Object.assign(this.bot.pathfinder, settings);
          this.bot.pathfinder.setMovements(movements);
        }
      }
    })();
    return this.stopping;
  }
}
