import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import pathfinderPackage from 'mineflayer-pathfinder';
import type { Movements, Pathfinder } from 'mineflayer-pathfinder';
import { ScopedCombatAdapter } from '../runtime/combatAdapter.js';
import { HeldWeaponEquipment } from '../tasks/protect/equipment.js';
import { distanceSquared } from '../tasks/protect/threatSelector.js';

const { goals } = pathfinderPackage;
export function trackedAttacker(bot: Bot, entity: Entity | undefined): entity is Entity {
  const dimension = (entity as Entity & { dimension?: string } | undefined)?.dimension;
  return !!entity && !!entity.position && entity !== bot.entity && entity.isValid !== false && entity.health !== 0 && bot.entities[entity.id] === entity &&
    ['player', 'hostile', 'animal', 'mob', 'passive'].includes(entity.type) && (!dimension || dimension === bot.game.dimension) &&
    Number.isFinite(distanceSquared(entity.position, bot.entity.position)) && distanceSquared(entity.position, bot.entity.position) <= 32 ** 2 && !!bot.blockAt(entity.position);
}

/** One bounded automatic reaction. Never authorizes or submits gameplay tasks. */
export class SelfDefenseReaction {
  private readonly abort = new AbortController();
  private readonly saved;
  private readonly movements: Movements;
  private readonly combat: ScopedCombatAdapter;
  private operation: Promise<void> = Promise.resolve();
  private stopping: Promise<void> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private selected: Entity | null = null;
  private motion: 'fight' | 'flight' | null = null;
  private readonly dimension;
  private readonly equipment;
  private finished = false;
  private blocked = false;
  private readonly invalid = new Set<Entity>();

  constructor(private readonly bot: Bot, private readonly attacker: Entity,
    private readonly mode: 'fight' | 'flight', private readonly durationMs: number,
    private readonly onDetail: (message: string) => void,
    private readonly onDone: () => void, private readonly onFailure: (error: unknown) => void) {
    const pf = bot.pathfinder as Pathfinder & { searchRadius: number };
    this.saved = { movements: pf.movements, thinkTimeout: pf.thinkTimeout, tickTimeout: pf.tickTimeout, searchRadius: pf.searchRadius };
    this.movements = Object.assign(Object.create(Object.getPrototypeOf(pf.movements)), pf.movements,
      { canDig: false, allow1by1towers: false, scafoldingBlocks: [] });
    this.dimension = bot.game.dimension;
    this.equipment = new HeldWeaponEquipment(bot);
    this.combat = new ScopedCombatAdapter(bot, this.movements);
  }
  start(): void {
    Object.assign(this.bot.pathfinder, { thinkTimeout: 1_500, tickTimeout: 10, searchRadius: 32 });
    this.bot.pathfinder.setMovements(this.movements);
    this.bot.on('path_update', this.pathUpdate);
    this.bot.on('heldItemChanged', this.weaponChanged);
    this.bot.on('entityGone', this.lost);
    this.bot.on('entityDead', this.lost);
    this.deadline = setTimeout(() => this.finish(), this.durationMs);
    this.interval = setInterval(() => this.tick(), 333);
    this.tick();
  }
  private readonly pathUpdate = (path: { status: string }): void => {
    if (path.status === 'noPath' || path.status === 'timeout') {
      this.blocked = true;
      this.onDetail('Self-defense navigation unavailable; waiting until this response ends.');
    }
  };
  private readonly weaponChanged = (): void => {
    if (this.motion === 'fight' && this.equipment.readiness() !== 'ready') {
      try { this.combat.invalidate(); } catch (error) { this.onDetail(`Self-defense safety stop failed: ${String(error)}`); this.finish(); }
    }
  };
  private readonly lost = (entity: Entity): void => {
    if (!entity) return;
    this.invalid.add(entity);
    if (entity === this.selected) {
      this.onDetail(`Target ${entity.username ?? entity.name ?? 'attacker'} died or left tracking range; looking for nearby threats.`);
      try { this.combat.invalidate(entity); } catch (error) { this.onDetail(`Self-defense safety stop failed: ${String(error)}`); this.finish(); }
    }
  };
  private tick(): void {
    if (this.abort.signal.aborted) return;
    // Previous reconciliation must settle; timers never queue a backlog.
    if (this.busy) return;
    this.busy = true;
    this.operation = this.operation.then(() => this.reconcile()).catch(error => {
      this.onDetail(`Self-defense failed: ${String(error)}`); this.finish();
    }).finally(() => { this.busy = false; });
  }
  private busy = false;
  private async reconcile(): Promise<void> {
    if (this.abort.signal.aborted) return;
    if (this.bot.game.dimension !== this.dimension) { this.finish(); return; }
    if (this.blocked) {
      if (this.selected) {
        await this.combat.stop();
        if (this.abort.signal.aborted) return;
        this.bot.pathfinder.setGoal(null); this.selected = null; this.motion = null;
      }
      return;
    }
    for (const entity of this.invalid) if (this.bot.entities[entity.id] !== entity) this.invalid.delete(entity);
    let target = !this.invalid.has(this.attacker) && trackedAttacker(this.bot, this.attacker) ? this.attacker : null;
    if (!target) {
      for (const entity of Object.values(this.bot.entities)) {
        if (entity.type !== 'hostile' || this.invalid.has(entity) || !trackedAttacker(this.bot, entity) || distanceSquared(entity.position, this.bot.entity.position) > 12 ** 2) continue;
        if (!target || distanceSquared(entity.position, this.bot.entity.position) < distanceSquared(target.position, this.bot.entity.position)) target = entity;
      }
    }
    if (!target) {
      if (this.selected) {
        await this.combat.stop();
        if (this.abort.signal.aborted) return;
        this.bot.pathfinder.setGoal(null); this.selected = null; this.motion = null;
        this.onDetail('No nearby threats; watching until the response ends.');
      }
      return;
    }
    const player = Object.values(this.bot.players).find(p => p.entity === target);
    const canFight = this.mode === 'fight' && this.equipment.readiness() === 'ready' && player?.gamemode !== 1 && player?.gamemode !== 3;
    let motion: 'fight' | 'flight' = canFight ? 'fight' : 'flight';
    if (this.selected === target && this.motion === motion && (motion === 'flight' || this.bot.pvp.target === target)) return;
    await this.combat.stop();
    if (this.abort.signal.aborted || this.invalid.has(target) || !trackedAttacker(this.bot, target)) return;
    if (this.bot.game.dimension !== this.dimension) { this.finish(); return; }
    if (this.equipment.readiness() !== 'ready' || player?.gamemode === 1 || player?.gamemode === 3) motion = 'flight';
    this.selected = target; this.motion = motion;
    this.onDetail(motion === 'fight' ? `Fighting ${target.username ?? target.name ?? 'attacker'}.` :
      this.mode === 'fight' ? 'Fleeing: no usable held weapon or attacker is invulnerable.' : `Fleeing from ${target.username ?? target.name ?? 'attacker'}.`);
    if (motion === 'fight') await this.combat.attack(target, this.abort.signal);
    else {
      this.bot.pathfinder.setMovements(this.movements);
      // A ranged attacker may already be farther than 12 blocks away. Always
      // request additional separation instead of installing an already-satisfied goal.
      const fleeRange = Math.max(12, Math.ceil(Math.sqrt(distanceSquared(target.position, this.bot.entity.position))) + 8);
      this.bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(target, fleeRange)), true);
    }
  }
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    void this.stop().then(this.onDone, this.onFailure);
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.abort.abort();
    if (this.interval) clearInterval(this.interval);
    if (this.deadline) clearTimeout(this.deadline);
    this.bot.removeListener('path_update', this.pathUpdate);
    this.bot.removeListener('heldItemChanged', this.weaponChanged);
    this.bot.removeListener('entityGone', this.lost);
    this.bot.removeListener('entityDead', this.lost);
    this.stopping = (async () => {
      await this.operation;
      const errors: unknown[] = [];
      try { await this.combat.release(); } catch (error) { errors.push(error); }
      try { this.bot.pathfinder.setGoal(null); } catch (error) { errors.push(error); }
      const { movements, ...settings } = this.saved;
      Object.assign(this.bot.pathfinder, settings);
      try { this.bot.pathfinder.setMovements(movements); } catch (error) { errors.push(error); }
      this.selected = null;
      this.invalid.clear();
      if (errors.length) throw new AggregateError(errors, 'Self-defense cleanup failed');
    })();
    return this.stopping;
  }
}
