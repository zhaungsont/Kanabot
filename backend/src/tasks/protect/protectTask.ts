import type { Bot, Player } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import pathfinderPackage from 'mineflayer-pathfinder';
import type { Movements, Pathfinder } from 'mineflayer-pathfinder';
import type { ProtectStatus } from '../../../../shared/botContracts.js';
import { resolvePlayerTarget } from '../../players/playerTarget.js';
import type { PlayerTaskOutcome } from '../trackedPlayerTask.js';
import { HeldWeaponEquipment, type EquipmentPort } from './equipment.js';
import { ProtectCombatAdapter } from './combatAdapter.js';
import { ThreatObserver } from './threatObserver.js';
import { distanceSquared, reason, selectThreat } from './threatSelector.js';
import { EquipmentIntent, EquipmentUnavailable, type EquipmentOwner, type EquipmentService } from '../../runtime/equipment.js';

const { goals } = pathfinderPackage;
let nextGeneration = 0;
/** One movement owner, one serialized decision operation, independent of viewers and RBAC. */
export class ProtectTask implements EquipmentOwner {
  readonly equipmentIntent = new EquipmentIntent();
  private paused = false;
  private pausing: Promise<boolean> | null = null;
  get active(): boolean { return !!this.player && !this.abort.signal.aborted; }
  private readonly abort = new AbortController();
  private readonly observer: ThreatObserver;
  private readonly disposers: (() => void)[] = [];
  private player: Entity | null = null;
  private dimension: string | undefined;
  private combat: ProtectCombatAdapter | null = null;
  private movements: Movements | null = null;
  private saved: { movements: Movements; thinkTimeout: number; tickTimeout: number; searchRadius: number } | null = null;
  private phase: ProtectStatus['phase'] = 'preparing';
  private selected: Entity | null = null;
  private selectedAt = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private urgent: ReturnType<typeof setTimeout> | null = null;
  private lastScan = -Infinity;
  private operation: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | null = null;
  private pending = false;
  private busy = false;
  private ended = false;
  private terminal = false;
  private outcome: PlayerTaskOutcome = { level: 'info', message: 'Protect stopped.' };
  private pathFailed = false;
  private progressAt = 0;
  private progressDistance = Infinity;
  private lastStatus = '';
  private closestDistance: number | null = null;
  private selectionReason = '';
  private readonly generation = ++nextGeneration;

  constructor(private readonly bot: Bot, readonly target: string,
    private readonly onFinished: (outcome: PlayerTaskOutcome) => void,
    private readonly onStatus: (status: ProtectStatus) => void,
    private readonly equipment: EquipmentPort = new HeldWeaponEquipment(bot),
    private readonly now: () => number = () => performance.now(),
    private readonly equipmentService?: EquipmentService) {
    this.observer = new ThreatObserver(bot);
    this.equipmentIntent.publish({ kind: 'best', policy: 'melee' });
  }

  start(): Promise<void> {
    if (this.player || this.stopping) return Promise.reject(new Error('Protect already started.'));
    this.operation = this.initialize().catch(error => this.fail(`Protect startup failed: ${String(error)}`));
    return this.operation;
  }
  private async initialize(): Promise<void> {
    const target = resolvePlayerTarget(this.bot, this.target);
    if (!target.ok) throw new Error(target.error);
    this.player = target.entity;
    this.dimension = this.bot.game.dimension;
    const pf = this.bot.pathfinder as Pathfinder & { searchRadius: number };
    this.saved = { movements: pf.movements, thinkTimeout: pf.thinkTimeout, tickTimeout: pf.tickTimeout, searchRadius: pf.searchRadius };
    this.movements = Object.assign(Object.create(Object.getPrototypeOf(pf.movements)), pf.movements, { canDig: false, allow1by1towers: false });
    Object.assign(pf, { thinkTimeout: 1_500, tickTimeout: 10, searchRadius: 64 });
    pf.setMovements(this.movements!);
    this.combat = new ProtectCombatAdapter(this.bot, this.movements!);
    this.listen('entityHurt', this.hurt);
    this.listen('entityDead', this.dead);
    this.listen('entityGone', this.gone);
    this.listen('playerLeft', this.left);
    this.listen('game', this.game);
    this.listen('death', this.death);
    this.listen('end', this.end);
    this.listen('path_update', this.pathUpdate);
    this.disposers.push(this.equipment.subscribeReadiness(() => {
      if (this.paused) return;
      if (this.equipment.readiness() !== 'ready') this.invalidateCombat();
      this.request();
    }));
    this.publish();
    await this.equipment.prepare({ generation: this.generation, purpose: 'melee-protection' }, this.abort.signal);
    if (this.equipmentService && !this.abort.signal.aborted) {
      try { await this.equipmentService.restore(this, this.abort.signal); }
      catch (error) { if (!(error instanceof EquipmentUnavailable)) throw error; }
    }
    if (this.abort.signal.aborted) return;
    this.progressAt = this.now();
    this.interval = setInterval(() => this.request(), 333);
    this.request();
  }
  private listen(event: string, listener: (...args: any[]) => void): void {
    // Mineflayer's overloads omit some plugin events; disposal always uses this exact reference.
    const emitter = this.bot as unknown as NodeJS.EventEmitter;
    emitter.on(event, listener);
    this.disposers.push(() => { emitter.removeListener(event, listener); });
  }
  private readonly hurt = (victim: Entity, source?: Entity): void => {
    if (this.player) this.observer.hurt(victim, source, this.player, this.now());
    // Damage is combat progress even while stationary. Proximity alone is not:
    // a mob on the other side of a wall must eventually enter unreachable cooldown.
    if (victim && victim === this.selected) this.progressAt = this.now();
    this.request();
  };
  private readonly dead = (entity: Entity): void => {
    this.observer.died(entity);
    if (entity === this.selected) this.invalidateCombat(entity);
    if (entity === this.player) this.fail('Protected player died.'); else this.request();
  };
  private readonly gone = (entity: Entity): void => {
    this.observer.gone(entity);
    if (entity === this.selected) this.invalidateCombat(entity);
    if (entity === this.player) this.fail('Protected player left tracking range or changed dimension.'); else this.request();
  };
  private readonly left = (player: Player): void => {
    if (player.username.toLowerCase() === this.target.toLowerCase()) this.fail('Protected player left the server.');
  };
  private readonly game = (): void => { if (this.bot.game.dimension !== this.dimension) this.fail('Bot changed dimension.'); };
  private readonly death = (): void => { this.fail('Bot died.'); };
  private readonly end = (): void => { this.ended = true; this.combat?.markEnded(); this.fail('Bot disconnected.'); };
  private readonly pathUpdate = (path: { status: string }): void => {
    if (this.paused) return;
    if (path.status === 'noPath' || path.status === 'timeout') { this.pathFailed = true; this.request(); }
  };

  private request(): void {
    if (this.abort.signal.aborted || this.paused) return;
    this.pending = true;
    if (this.busy || this.urgent) return;
    this.urgent = setTimeout(() => {
      this.urgent = null;
      if (this.abort.signal.aborted) return;
      this.pending = false;
      this.busy = true;
      this.operation = this.operation.then(() => this.evaluate()).catch(error => this.fail(`Protect failed: ${String(error)}`)).finally(() => {
        this.busy = false;
        if (this.pending) this.request();
      });
    }, Math.max(0, 100 - (this.now() - this.lastScan)));
  }
  private async evaluate(): Promise<void> {
    if (this.abort.signal.aborted || this.paused || !this.player) return;
    this.lastScan = this.now();
    const player = resolvePlayerTarget(this.bot, this.target);
    if (!player.ok || player.entity !== this.player || this.bot.game.dimension !== this.dimension) {
      this.fail(player.ok ? 'Protected player entity or dimension changed.' : player.error); return;
    }
    const now = this.now();
    const separation = player.distance;
    const progressTarget = this.phase === 'engaging' && this.selected ? this.selected : this.player;
    const progressDistance = Math.sqrt(distanceSquared(this.bot.entity.position, progressTarget.position));
    if ((this.phase !== 'engaging' && progressDistance <= 3) || progressDistance < this.progressDistance - 0.5) {
      this.progressAt = now; this.progressDistance = progressDistance;
    }
    const stalled = now - this.progressAt >= 30_000;
    if (this.pathFailed || stalled) {
      this.pathFailed = false;
      if (this.phase === 'engaging' && this.selected) this.observer.exclude(this.selected, now);
      else { this.fail('Cannot return to protected player within the pathfinding/progress budget.', 'PLAYER_UNREACHABLE'); return; }
    }
    const candidates = this.observer.observe(this.player, this.selected, now);
    const closest = candidates.filter(c => c.distanceSquared <= 100).reduce((min, c) => Math.min(min, c.distanceSquared), Infinity);
    this.closestDistance = Number.isFinite(closest) ? Math.sqrt(closest) : null;
    const choice = selectThreat(candidates, this.selected, this.selectedAt, now);
    const returning = separation > 12 || (this.phase === 'returning' && separation > 5);
    const ready = this.equipment.readiness() === 'ready';
    if (!ready && this.bot.pvp.target) this.invalidateCombat();
    if (returning || !ready || !choice) {
      await this.escort(returning ? 'returning' : 'escorting');
    } else if (choice.entity !== this.selected || this.phase !== 'engaging' || this.bot.pvp.target !== choice.entity) {
      await this.combat!.stop();
      if (this.abort.signal.aborted || this.paused) return;
      if (!this.revalidatePlayer()) return;
      // Positions, world identity and equipment may change during graceful shutdown.
      if (!this.observer.eligible(choice.entity) || this.equipment.readiness() !== 'ready' ||
          distanceSquared(this.bot.entity.position, this.player.position) > 144 ||
          distanceSquared(choice.entity.position, this.player.position) > (choice.entity === this.selected ? 256 : 100)) {
        await this.escort('escorting'); return;
      }
      this.selected = choice.entity; this.selectedAt = now; this.selectionReason = reason(choice);
      this.phase = 'engaging'; this.resetProgress();
      await this.combat!.attack(choice.entity, this.abort.signal);
    }
    if (choice && this.selected === choice.entity) this.selectionReason = reason(choice);
    if (!this.abort.signal.aborted) this.publish();
  }
  private async escort(phase: 'escorting' | 'returning'): Promise<void> {
    const change = this.phase !== phase || !!this.selected;
    await this.combat!.stop();
    if (this.abort.signal.aborted || this.paused) return;
    if (!this.revalidatePlayer()) return;
    this.selected = null; this.selectionReason = '';
    if (change) {
      this.phase = phase; this.resetProgress();
      this.bot.pathfinder.setMovements(this.movements!);
      this.bot.pathfinder.setGoal(new goals.GoalFollow(this.player!, 3), true);
    }
  }
  private resetProgress(): void { this.progressAt = this.now(); this.progressDistance = Infinity; }
  pauseForUpkeep(_signal: AbortSignal): Promise<boolean> {
    if (this.pausing) return this.pausing;
    if (!this.active) return Promise.resolve(false);
    this.paused = true;
    this.pausing = (async () => {
      await this.operation;
      if (!this.active) return false;
      if (!this.bot.pvp.target) this.bot.pathfinder.setGoal(null);
      await this.combat?.stop();
      if (!this.active) return false;
      this.bot.pathfinder.setGoal(null);
      this.publish('Temporarily yielding equipment to upkeep; Protect remains active.');
      return true;
    })();
    return this.pausing;
  }
  async resumeAfterUpkeep(): Promise<void> {
    if (!this.active || !this.paused) return;
    this.paused = false; this.pausing = null; this.selected = null; this.phase = 'preparing';
    this.pathFailed = false; this.resetProgress(); this.request();
  }
  private revalidatePlayer(): boolean {
    const player = resolvePlayerTarget(this.bot, this.target);
    if (!player.ok || player.entity !== this.player || this.bot.game.dimension !== this.dimension) {
      this.fail(player.ok ? 'Protected player entity or dimension changed.' : player.error);
      return false;
    }
    return true;
  }
  private invalidateCombat(entity?: Entity): void {
    try { this.combat?.invalidate(entity); } catch (error) { this.fail(`Combat safety stop failed: ${String(error)}`); }
  }
  private publish(detail?: string): void {
    const status: ProtectStatus = { phase: this.phase, player: this.target,
      threat: this.selected ? { id: this.selected.id, name: this.selected.name ?? 'hostile mob', reason: this.selectionReason } : null,
      // Rounded diagnostics avoid emitting position noise every scan.
      closestDistance: this.closestDistance === null ? null : Math.round(this.closestDistance),
      equipment: this.equipment.readiness(), detail: detail ?? (this.equipment.readiness() === 'ready' ? 'Melee ready; explosion evasion and player defense unavailable.' : 'Escort only: hold a sword or axe. Automatic equipping is deferred.') };
    // Distance alone does not warrant a wire update.
    const key = JSON.stringify({ ...status, closestDistance: undefined });
    if (key !== this.lastStatus) { this.lastStatus = key; this.onStatus(status); }
  }
  private fail(message: string, code?: PlayerTaskOutcome['code']): void {
    if (this.terminal) return;
    this.terminal = true;
    this.outcome = { level: 'warning', message, ...(code ? { code } : {}) };
    // Never await teardown from the operation teardown itself needs to drain.
    queueMicrotask(() => { void this.stop().catch(() => { /* stopping status retains the lease */ }); });
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.abort.abort(); this.phase = 'stopping'; this.pending = false;
    if (this.interval) clearInterval(this.interval);
    if (this.urgent) clearTimeout(this.urgent);
    this.interval = null; this.urgent = null;
    const errors: unknown[] = [];
    for (const dispose of this.disposers.splice(0).reverse()) { try { dispose(); } catch (error) { errors.push(error); } }
    this.publish();
    const deadline = setTimeout(() => {
      this.phase = 'cleanup-failed';
      this.publish('Cleanup is still pending after 10 seconds. New tasks remain blocked; retire this deployment to recover.');
    }, 10_000);
    this.stopping = (async () => {
      await this.operation;
      await this.pausing?.catch(() => undefined);
      try { await this.combat?.release(); } catch (error) { errors.push(error); }
      try { await this.equipment.release(this.generation); } catch (error) { errors.push(error); }
      if (!this.ended) {
        try { this.bot.pathfinder.setGoal(null); } catch (error) { errors.push(error); }
      }
      if (this.saved) {
        const { movements, ...settings } = this.saved;
        Object.assign(this.bot.pathfinder, settings);
        try { this.bot.pathfinder.setMovements(movements); } catch (error) { errors.push(error); }
      }
      this.observer.clear(); this.player = null; this.selected = null; this.saved = null; this.movements = null;
      if (errors.length) {
        this.phase = 'cleanup-failed'; this.publish(`Cleanup failed; retire this deployment before starting another task: ${errors.map(String).join('; ')}`);
        throw new AggregateError(errors, 'Protect cleanup failed');
      }
      this.onFinished(this.outcome);
    })().finally(() => clearTimeout(deadline));
    return this.stopping;
  }
}
