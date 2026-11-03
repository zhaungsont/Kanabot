import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { distanceSquared, type ThreatCandidate, type Visibility } from './threatSelector.js';

/** Only observed hostile mobs. A future player policy can be injected here without RBAC. */
export class ThreatObserver {
  private readonly damage = new Map<Entity, number>();
  private readonly dead = new Set<Entity>();
  private readonly excluded = new Map<Entity, number>();
  private samples = new Map<Entity, { at: number; distance: number; closing: boolean }>();
  constructor(private readonly bot: Bot) {}
  eligible(entity: Entity): boolean {
    const dimension = (entity as Entity & { dimension?: string } | undefined)?.dimension;
    return !!entity && entity !== this.bot.entity && entity.type === 'hostile' && entity.isValid !== false &&
      (!dimension || dimension === this.bot.game.dimension) &&
      !this.dead.has(entity) && this.bot.entities[entity.id] === entity &&
      [entity.position.x, entity.position.y, entity.position.z].every(Number.isFinite) && !!this.bot.blockAt(entity.position);
  }
  hurt(victim: Entity, source: Entity | undefined, player: Entity, now: number): void {
    if (victim === player && source && this.eligible(source)) this.damage.set(source, now + 3_000);
  }
  gone(entity: Entity): void { this.damage.delete(entity); this.samples.delete(entity); this.excluded.delete(entity); this.dead.add(entity); }
  died(entity: Entity): void { this.gone(entity); this.dead.add(entity); }
  exclude(entity: Entity, now: number): void { this.excluded.set(entity, now + 5_000); }
  observe(player: Entity, current: Entity | null, now: number): ThreatCandidate[] {
    for (const [e, until] of this.damage) if (until <= now || this.bot.entities[e.id] !== e) this.damage.delete(e);
    for (const [e, until] of this.excluded) if (until <= now || this.bot.entities[e.id] !== e) this.excluded.delete(e);
    for (const e of this.dead) if (this.bot.entities[e.id] !== e) this.dead.delete(e);
    const nextSamples = new Map<Entity, { at: number; distance: number; closing: boolean }>();
    const candidates: ThreatCandidate[] = [];
    for (const entity of Object.values(this.bot.entities)) {
      if (!this.eligible(entity) || this.excluded.has(entity)) continue;
      const d2 = distanceSquared(entity.position, player.position);
      if (d2 > (entity === current ? 256 : 100)) continue;
      const distance = Math.sqrt(d2), previous = this.samples.get(entity);
      const elapsed = previous ? (now - previous.at) / 1_000 : 0;
      const speed = previous && elapsed > 0 && elapsed <= 2 ? (previous.distance - distance) / elapsed : 0;
      const closing = speed > 0.5;
      nextSamples.set(entity, { at: now, distance, closing });
      candidates.push({ entity, distanceSquared: d2, botDistanceSquared: distanceSquared(entity.position, this.bot.entity.position),
        confirmed: this.damage.has(entity), approaching: closing && !!previous?.closing,
        arrival: closing ? Math.max(distance - 3, 0) / speed : Infinity, visibility: 'unknown' });
    }
    this.samples = nextSamples;
    // Reserve current target; prioritize known aggressors before proximity. Four rays maximum.
    const shortlist = candidates.filter(c => c.entity === current);
    const others: ThreatCandidate[] = [];
    const provisional = (a: ThreatCandidate, b: ThreatCandidate): number => Number(b.confirmed) - Number(a.confirmed) || Number(b.approaching) - Number(a.approaching) || a.distanceSquared - b.distanceSquared || a.entity.id - b.entity.id;
    for (const candidate of candidates) {
      if (candidate.entity === current) continue;
      const index = others.findIndex(other => provisional(candidate, other) < 0);
      others.splice(index < 0 ? others.length : index, 0, candidate);
      if (others.length > 4 - shortlist.length) others.pop();
    }
    shortlist.push(...others);
    for (const candidate of shortlist) candidate.visibility = this.visibility(candidate.entity, player);
    return candidates;
  }
  private visibility(entity: Entity, player: Entity): Visibility {
    const world = this.bot.world;
    if (!world?.getColumn || !world.raycast) return 'unknown';
    const from = entity.position.offset(0, (entity.height || 1.8) / 2, 0);
    const to = player.position.offset(0, (player.height || 1.8) / 2, 0);
    // Conservatively check all columns intersecting this short segment's bounding rectangle.
    for (let x = Math.floor(Math.min(from.x, to.x) / 16); x <= Math.floor(Math.max(from.x, to.x) / 16); x++) {
      for (let z = Math.floor(Math.min(from.z, to.z) / 16); z <= Math.floor(Math.max(from.z, to.z) / 16); z++) {
        if (!world.getColumn(x, z)) return 'unknown';
      }
    }
    const delta = to.minus(from), range = delta.norm();
    if (!range) return 'clear';
    try {
      // The default matcher intersects actual collision shapes (including partial blocks).
      return world.raycast(from, new Vec3(delta.x / range, delta.y / range, delta.z / range), range) ? 'blocked' : 'clear';
    } catch { return 'unknown'; }
  }
  clear(): void { this.damage.clear(); this.dead.clear(); this.excluded.clear(); this.samples.clear(); }
}
