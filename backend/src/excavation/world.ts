import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { iterators } from 'prismarine-world';
import type { ExcavateRegion } from '../types.js';
import { contains, isAir, MAX_APPROACH_DISTANCE } from './region.js';

const neighbors = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
export const fullBlock = (b: Block | null): boolean => !!b && b.shapes?.length === 1 && b.shapes[0].every((v, i) => v === (i < 3 ? 0 : 1));
const hazardous = (b: Block) => b.isWaterlogged || /water|lava|fire|magma|cactus|campfire|powder_snow|portal/.test(b.name);
const falling = (b: Block) => /(?:^|_)(?:sand|gravel|anvil|concrete_powder|dragon_egg)(?:$|_)/.test(b.name);
// Optimistic local air must not become trusted "already clear" in a later job.
// Keep uncertainty with the captured connection, without background observers.
const uncertain = new WeakMap<Bot, Map<string, Vec3>>();
function uncertainty(bot: Bot): Map<string, Vec3> {
  let cells = uncertain.get(bot); if (!cells) { cells = new Map(); uncertain.set(bot, cells); } return cells;
}
export function cachedBlock(bot: Bot, p: Vec3): Block | null { return uncertainty(bot).has(p.toString()) ? null : bot.blockAt(p); }

/** Conservative full-block, flat external walkway model. Never models air from missing data. */
export class ExternalWorld {
  private graph: Vec3[] | null = null;
  constructor(private readonly bot: Bot, readonly region: ExcavateRegion, readonly staging: Vec3) {}
  invalidate(): void { this.graph = null; }
  /** Pathfinder tests both feet and head blocks through exclusionAreasStep. */
  walkingCell(p: Vec3): boolean {
    return p.y === this.staging.y ? this.stance(p) : p.y === this.staging.y + 1 && this.stance(p.offset(0, -1, 0));
  }
  stance(p: Vec3): boolean {
    if (p.y !== this.staging.y || p.distanceTo(this.staging) > MAX_APPROACH_DISTANCE) return false;
    const body = [p, p.offset(0, 1, 0)], support = p.offset(0, -1, 0);
    if ([...body, support].some(v => contains(this.region, v))) return false;
    if (!body.every(v => { const b = cachedBlock(this.bot, v); return b && isAir(b.name); })) return false;
    const floor = cachedBlock(this.bot, support);
    if (!fullBlock(floor) || hazardous(floor!) || falling(floor!)) return false;
    return body.every(v => neighbors.every(d => { const b = cachedBlock(this.bot, v.plus(d)); return !!b && !hazardous(b); }));
  }
  actualStance(): boolean {
    const p = this.bot.entity.position, r = this.region;
    // Include the player's collision width, not just its floored coordinate.
    const overlap = p.x + .3 > r.x1 && p.x - .3 < r.x2 + 1 && p.z + .3 > r.z1 && p.z - .3 < r.z2 + 1 && p.y + 1.8 > r.y1 && p.y < r.y2 + 1;
    return !overlap && Math.abs(p.y - this.staging.y) < .05 && this.stance(p.floored());
  }
  permitted(p: Vec3): string | null {
    const b = cachedBlock(this.bot, p);
    if (!b) return 'UNOBSERVED';
    if (isAir(b.name)) return null;
    if (!b.diggable || !fullBlock(b) || hazardous(b) || falling(b) || b.entity || b.blockEntity || /chest|barrel|shulker|furnace|hopper|dispenser|dropper|spawner|beehive|bee_nest|tnt|command_block/.test(b.name)) return 'BLOCK_POLICY';
    for (const d of neighbors) {
      const n = cachedBlock(this.bot, p.plus(d));
      if (!n) return 'UNOBSERVED_HALO';
      if (hazardous(n) || (d.y === 1 && falling(n))) return 'HAZARD';
    }
    if (Object.values(this.bot.entities).some(e => {
      if (e === this.bot.entity || !e.position) return false;
      const half = (e.width ?? .6) / 2 + .05;
      return e.position.x + half > p.x && e.position.x - half < p.x + 1 && e.position.z + half > p.z && e.position.z - half < p.z + 1 && e.position.y < p.y + 2 && e.position.y + (e.height ?? 1.8) > p.y;
    })) return 'OCCUPIED';
    return null;
  }
  /** Small BFS certifies a return path on terrain that the job never removes. */
  reachable(): Vec3[] {
    if (this.graph) return this.graph;
    const queue: Vec3[] = [this.staging], seen = new Set([this.staging.toString()]);
    if (!this.stance(this.staging)) return [];
    for (let i = 0; i < queue.length && queue.length < 4096; i++) for (const d of [neighbors[0], neighbors[1], neighbors[4], neighbors[5]]) {
      const next = queue[i].plus(d), key = next.toString();
      if (!seen.has(key)) { seen.add(key); if (this.stance(next)) queue.push(next); }
    }
    return this.graph = queue;
  }
  canRetreat(): boolean { const current = this.bot.entity.position.floored(); return this.reachable().some(p => p.equals(current)); }
  face(target: Vec3, feet = this.bot.entity.position): Vec3 | null {
    const eye = feet.offset(0, Reflect.get(this.bot.entity, 'eyeHeight') ?? 1.62, 0);
    // Select an exposed face facing the eye. Check loaded coverage before raycast:
    // prismarine-world's raycaster otherwise traverses missing blocks.
    for (let face = 0; face < neighbors.length; face++) {
      const normal = neighbors[face], point = target.offset(.5, .5, .5).plus(normal.scaled(.5));
      if (eye.minus(point).dot(normal) <= 0) continue;
      const adjacent = cachedBlock(this.bot, target.plus(normal));
      if (!adjacent || !isAir(adjacent.name)) continue;
      const delta = point.minus(eye), length = delta.norm();
      if (length > 4.5 || length === 0) continue;
      const direction = delta.scaled(1 / length);
      const iterator = new iterators.RaycastIterator(eye, direction, length + .02);
      let known = true;
      let cell: { x: number; y: number; z: number } | null = eye.floored();
      while (cell) {
        const p = new Vec3(cell.x, cell.y, cell.z);
        if (!cachedBlock(this.bot, p)) { known = false; break; }
        if (p.equals(target)) break;
        cell = iterator.next();
      }
      if (!known) continue;
      const hit = this.bot.world.raycast(eye, direction, length + .02);
      if (hit && (hit as unknown as Block).position?.equals(target)) return normal;
    }
    return null;
  }
}

/** Incoming packets only: local optimistic dig updates cannot acknowledge an attempt.
 * Packet layouts mirror the installed Mineflayer 4.37.1 blocks plugin. Unknown
 * layouts produce no receipt (partial), rather than a guessed acknowledgement.
 */
export class DigEvidence {
  private target: Vec3 | null = null;
  private state: number | null = null;
  private wake: (() => void) | null = null;
  private readonly single = (packet: { location: { x: number; y: number; z: number }; type: number }) => {
    if (!packet.location) return;
    const p = new Vec3(packet.location.x, packet.location.y, packet.location.z);
    if (Number.isSafeInteger(packet.type) && this.bot.registry.blocksByStateId[packet.type]) uncertainty(this.bot).delete(p.toString());
    if (this.target?.equals(p)) this.observe(packet.type);
  };
  private readonly multiple = (packet: { records: (number | { horizontalPos: number; y: number; blockId: number })[]; chunkCoordinates?: { x: number; y: number; z: number }; chunkX?: number; chunkZ?: number }) => {
    if (!Array.isArray(packet.records) || !this.target) return;
    for (const r of packet.records) {
      const packed = this.bot.supportFeature('usesMultiblockSingleLong');
      if (packed && typeof r !== 'number' || !packed && typeof r === 'number') continue;
      const record = r as { horizontalPos: number; y: number; blockId: number };
      const x = packed ? (Number(r) >> 8) & 15 : (record.horizontalPos >> 4) & 15;
      const y = packed ? Number(r) & 15 : record.y;
      const z = packed ? (Number(r) >> 4) & 15 : record.horizontalPos & 15;
      const chunk = this.bot.supportFeature('usesMultiblock3DChunkCoords') ? packet.chunkCoordinates : { x: packet.chunkX, y: 0, z: packet.chunkZ };
      if (chunk && typeof chunk.x === 'number' && typeof chunk.z === 'number') {
        const p = new Vec3(chunk.x * 16 + x, chunk.y * 16 + y, chunk.z * 16 + z), state = packed ? Number(r) >> 12 : record.blockId;
        if (Number.isSafeInteger(state) && this.bot.registry.blocksByStateId[state]) uncertainty(this.bot).delete(p.toString());
        if (this.target.equals(p)) this.observe(state);
      }
    }
  };
  constructor(private readonly bot: Bot) { bot._client.on('block_change', this.single); bot._client.on('multi_block_change', this.multiple); }
  begin(p: Vec3): void {
    const cells = uncertainty(this.bot);
    if (cells.size >= 10_000 && !cells.has(p.toString())) throw new Error('Unverified world-data budget exhausted; reconnect the bot.');
    this.target = p; this.state = null;
  }
  quarantine(): void {
    if (!this.target || this.clear()) return;
    const cells = uncertainty(this.bot);
    if (cells.size >= 10_000 && !cells.has(this.target.toString())) throw new Error('Unverified world-data budget exhausted; reconnect the bot.');
    cells.set(this.target.toString(), this.target);
  }
  private observe(state: number): void { if (Number.isSafeInteger(state)) { this.state = state; this.wake?.(); } }
  clear(): boolean { const b = this.state === null ? null : this.bot.registry.blocksByStateId[this.state]; return !!b && isAir(b.name); }
  async wait(signal: AbortSignal, ms = 1500): Promise<boolean> {
    if (this.clear() || signal.aborted) return this.clear();
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); this.wake = null; resolve(); };
      const timer = setTimeout(done, ms); this.wake = done; signal.addEventListener('abort', done, { once: true });
    });
    return this.clear();
  }
  dispose(): void { this.bot._client.removeListener('block_change', this.single); this.bot._client.removeListener('multi_block_change', this.multiple); this.wake?.(); }
}
