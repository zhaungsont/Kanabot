import type { Bot, Player } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Movements, Pathfinder } from 'mineflayer-pathfinder';
import { MAX_PLAYER_TASK_DISTANCE, resolvePlayerTarget } from '../players/playerTarget.js';
import { EquipmentIntent, type EquipmentService } from '../runtime/equipment.js';
import { TaskCompletion, type TaskRuntime } from './taskRuntime.js';
import type { TaskOutcome } from '../../../shared/taskContracts.js';

export type PlayerTaskOutcome = TaskOutcome;

/** Owns the complete task lifecycle; no sockets, browser state, or session registry. */
export abstract class TrackedPlayerTask implements TaskRuntime {
  readonly equipmentIntent = new EquipmentIntent();
  private readonly terminal = new TaskCompletion();
  readonly completion = this.terminal.promise;
  readonly cleanupStarted = this.terminal.cleanupStarted;
  private outcome: TaskOutcome = { status: 'stopped', level: 'info', message: 'Player task stopped.' };
  protected readonly cancellation = new AbortController();
  protected paused = false;
  private pausing: Promise<boolean> | null = null;
  get active(): boolean { return this.running && !this.cancellation.signal.aborted; }
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
    private readonly onFinished: (outcome: PlayerTaskOutcome) => void = () => {},
    protected readonly equipmentService?: EquipmentService,
  ) {}

  start(): Promise<void> {
    if (this.running || this.stopping) return Promise.reject(new Error('Task has already been started.'));
    this.running = true;
    this.beginning = Promise.resolve().then(() => { if (this.running) return this.initialize(); });
    void this.beginning.catch((error: unknown) => {
      this.finish({ level: 'error', message: `Player task failed: ${String(error)}` });
    });
    return this.beginning;
  }

  private async initialize(): Promise<void> {
    const target = resolvePlayerTarget(this.bot, this.target);
    if (!target.ok) throw new Error(target.error);
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
    if (this.running) await this.begin(target.entity);
  }

  protected abstract begin(entity: Entity): void | Promise<void>;

  pauseForUpkeep(_signal: AbortSignal): Promise<boolean> {
    if (this.pausing) return this.pausing;
    if (!this.active) return Promise.resolve(false);
    this.paused = true;
    this.pausing = (async () => {
      await this.beginning;
      if (!this.active) return false;
      await this.suspendMotion();
      return this.active;
    })();
    return this.pausing;
  }
  protected async suspendMotion(): Promise<void> { this.bot.pathfinder.setGoal(null); }
  async resumeAfterUpkeep(): Promise<void> {
    if (!this.active || !this.paused) return;
    const target = resolvePlayerTarget(this.bot, this.target);
    if (!target.ok || target.entity !== this.targetEntity) {
      this.finish({ level: 'warning', message: target.ok ? 'Target changed while yielding.' : target.error }); return;
    }
    this.paused = false; this.pausing = null; this.lastProgressAt = Date.now();
    this.beginning = Promise.resolve().then(() => { if (this.active && !this.paused) return this.begin(target.entity); });
    await this.beginning;
  }

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
    if (this.paused) return;
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
    if (this.paused) return;
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

  protected finish(outcome: Omit<TaskOutcome, 'status'>): void {
    if (!this.running) return;
    this.outcome = { ...outcome, status: outcome.level === 'info' ? 'stopped' : 'failed' };
    void this.stop().catch(() => { /* completion retains cleanup failure for the coordinator */ });
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.terminal.beginCleanup();
    this.running = false;
    this.cancellation.abort();
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
      // A failed cleanup does not skip independent restorations or release ownership.
      await this.beginning.catch(() => undefined);
      const errors: unknown[] = [];
      try { await this.pausing; } catch (error) { errors.push(error); }
      try { await this.endMotion(); } catch (error) { errors.push(error); }
      try { this.bot.pathfinder.setGoal(null); } catch (error) { errors.push(error); }
      if (this.previousPathSettings) {
        const { movements, ...settings } = this.previousPathSettings;
        Object.assign(this.bot.pathfinder, settings);
        try { this.bot.pathfinder.setMovements(movements); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Player task cleanup failed');
    })().then(() => {
      this.terminal.complete(this.outcome, this.onFinished);
    }, error => { this.terminal.fail(error); throw error; });
    return this.stopping;
  }
}
