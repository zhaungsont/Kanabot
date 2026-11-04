import type { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { ExcavateRegion } from '../types.js';
import { EquipmentIntent, EquipmentUnavailable, type EquipmentOwner, type EquipmentService } from '../runtime/equipment.js';
const { goals } = pkg;
export const MAX_EXCAVATE_BLOCKS = 10_000;
export interface ExcavateCallbacks {
  onEvent: (type: 'info' | 'warning' | 'error', message: string) => void;
  onProgress: (current: number, total: number) => void;
  onComplete: () => void;
  onAbort: () => void;
}
/** Checkpointed excavation: every hand-dependent step is behind the same item intent. */
export class ExcavateTask implements EquipmentOwner {
  readonly equipmentIntent = new EquipmentIntent();
  private readonly cancellation = new AbortController();
  private running = false;
  private bot: Bot | null = null;
  private pauseRequested = false;
  private acknowledge: ((value: boolean) => void) | null = null;
  private continueRun: (() => void) | null = null;
  private resumeGate: Promise<void> = Promise.resolve();
  get active(): boolean { return this.running && !this.cancellation.signal.aborted; }
  constructor(private readonly equipment?: EquipmentService) {}
  abort(): void {
    this.cancellation.abort(); this.acknowledge?.(false); this.continueRun?.();
    try { this.bot?.pathfinder.setGoal(null); } catch { /* connection may have ended */ }
    try { if (this.bot?.targetDigBlock) void Promise.resolve(this.bot.stopDigging()).catch(() => {}); } catch { /* connection may have ended */ }
  }
  pauseForUpkeep(signal: AbortSignal): Promise<boolean> {
    if (!this.active || signal.aborted) return Promise.resolve(false);
    this.pauseRequested = true;
    this.resumeGate = new Promise(resolve => { this.continueRun = resolve; });
    return new Promise(resolve => {
      const canceled = () => {
        this.pauseRequested = false; this.continueRun?.(); this.acknowledge?.(false);
      };
      this.acknowledge = value => { signal.removeEventListener('abort', canceled); this.acknowledge = null; resolve(value); };
      signal.addEventListener('abort', canceled, { once: true });
    });
  }
  async resumeAfterUpkeep(): Promise<void> { this.pauseRequested = false; this.continueRun?.(); this.continueRun = null; }
  refreshEquipmentIntent(): void {
    const requirement = this.equipmentIntent.requirement;
    if (requirement.kind !== 'best' || requirement.policy !== 'mining' || !requirement.context || !this.bot) return;
    const p = requirement.context.position;
    const block = this.bot.blockAt(new Vec3(p.x, p.y, p.z));
    if (!block || !block.diggable || block.name === 'air') this.equipmentIntent.publish({ kind: 'unrestricted' });
  }
  private async checkpoint(): Promise<boolean> {
    if (!this.active) return false;
    if (this.pauseRequested) { this.acknowledge?.(true); await this.resumeGate; }
    return this.active;
  }
  async run(bot: Bot, region: ExcavateRegion, callbacks: ExcavateCallbacks): Promise<void> {
    this.running = true;
    this.bot = bot;
    const dimension = bot.game.dimension;
    const abort = () => this.abort();
    const game = () => { if (bot.game.dimension !== dimension) this.abort(); };
    bot.on('death', abort); bot.on('end', abort); bot.on('game', game);
    let completed = false;
    try {
      const coordinates = Object.values(region);
      const volume = (Math.abs(region.x2 - region.x1) + 1) * (Math.abs(region.y2 - region.y1) + 1) * (Math.abs(region.z2 - region.z1) + 1);
      if (coordinates.length !== 6 || !coordinates.every(Number.isSafeInteger) || volume > MAX_EXCAVATE_BLOCKS) throw new Error('Invalid or oversized excavation region.');
      const positions = buildDigOrder(Math.min(region.x1, region.x2), Math.max(region.x1, region.x2),
        Math.min(region.y1, region.y2), Math.max(region.y1, region.y2), Math.min(region.z1, region.z2), Math.max(region.z1, region.z2));
      callbacks.onEvent('info', `Starting excavation of ${positions.length} blocks.`);
      for (let index = 0; index < positions.length; index++) {
        if (!await this.checkpoint()) return;
        const pos = positions[index];
        let block = bot.blockAt(pos);
        if (!block || block.name === 'air' || !block.diggable) { callbacks.onProgress(index + 1, positions.length); continue; }
        this.equipmentIntent.publish({ kind: 'best', policy: 'mining', context: { position: { x: pos.x, y: pos.y, z: pos.z } } });
        try { await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)); }
        catch { if (!this.active) return; callbacks.onEvent('warning', `Cannot reach block at ${pos}; skipping.`); continue; }
        if (!await this.checkpoint()) return;
        block = bot.blockAt(pos);
        if (!block || block.name === 'air' || !block.diggable) continue;
        try {
          if (this.equipment) await this.equipment.restore(this, this.cancellation.signal);
          else await bot.tool.equipForBlock(block, { requireHarvest: false });
        } catch (error) {
          if (!this.active) return;
          callbacks.onEvent('warning', `Required mining tool unavailable: ${String(error)}`);
          if (this.equipment && error instanceof EquipmentUnavailable) continue;
          throw error;
        }
        if (!await this.checkpoint()) return;
        block = bot.blockAt(pos);
        if (!block || !block.diggable || !bot.canDigBlock(block)) continue;
        // Readiness is reconciled again if the block changed while a meal ran.
        if (this.equipment) await this.equipment.restore(this, this.cancellation.signal);
        if (!this.active) return;
        try { await bot.dig(block, true); }
        catch (error) { if (this.active) callbacks.onEvent('warning', `Failed to dig ${pos}: ${String(error)}`); }
        if (!this.active) return;
        callbacks.onProgress(index + 1, positions.length);
      }
      if (!await this.checkpoint()) return;
      completed = true;
    } finally {
      bot.removeListener('death', abort); bot.removeListener('end', abort); bot.removeListener('game', game);
      this.running = false;
      this.bot = null;
      this.acknowledge?.(false); this.continueRun?.();
      if (completed) callbacks.onComplete(); else callbacks.onAbort();
    }
  }
}

/**
 * Generates the list of positions to dig in optimal order:
 *   - Y layers from top (maxY) down to bottom (minY) — prevents the bot from
 *     being buried by blocks falling from above.
 *   - Within each Y layer, rows are iterated in a snake/zigzag pattern along X
 *     to minimise travel distance.
 */
function buildDigOrder(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): Vec3[] {
	const positions: Vec3[] = [];

	for (let y = maxY; y >= minY; y--) {
		for (let x = minX; x <= maxX; x++) {
			// Even X-offset rows go Z low→high; odd rows go Z high→low.
			const xOffset = x - minX;
			if (xOffset % 2 === 0) {
				for (let z = minZ; z <= maxZ; z++) {
					positions.push(new Vec3(x, y, z));
				}
			} else {
				for (let z = maxZ; z >= minZ; z--) {
					positions.push(new Vec3(x, y, z));
				}
			}
		}
	}

	return positions;
}
