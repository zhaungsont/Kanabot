import type { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { ExcavateRegion } from '../types.js';
import type { ExcavationSummary, TaskOutcome } from '../../../shared/taskContracts.js';
import { EquipmentIntent, type EquipmentService } from '../runtime/equipment.js';
import { TaskCompletion, type TaskRuntime } from './taskRuntime.js';

const { goals } = pkg;
export const MAX_EXCAVATE_BLOCKS = 10_000;
export interface ExcavateCallbacks {
  onEvent: (type: 'info' | 'warning' | 'error', message: string) => void;
  onProgress: (current: number, total: number) => void;
}
type BlockResult = 'dug' | 'alreadyClear' | 'skipped' | 'failed';
const isAir = (name: string) => ['air', 'cave_air', 'void_air'].includes(name);

/** Checkpointed excavation with the same confirmed-cleanup contract as player tasks. */
export class ExcavateTask implements TaskRuntime {
  readonly equipmentIntent = new EquipmentIntent();
  private readonly terminal = new TaskCompletion();
  readonly completion = this.terminal.promise;
  readonly cleanupStarted = this.terminal.cleanupStarted;
  private readonly cancellation = new AbortController();
  private running = false;
  private operation: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private readonly cleanupErrors: unknown[] = [];
  private readonly cancelOperations: Promise<unknown>[] = [];
  private pauseRequested = false;
  private acknowledge: ((value: boolean) => void) | null = null;
  private continueRun: (() => void) | null = null;
  private resumeGate: Promise<void> = Promise.resolve();
  get active(): boolean { return this.running && !this.cancellation.signal.aborted; }

  constructor(private readonly bot: Bot, private readonly region: ExcavateRegion,
    private readonly callbacks: ExcavateCallbacks, private readonly equipment: EquipmentService) {}

  start(): Promise<void> {
    if (this.operation || this.stopping) return Promise.reject(new Error('Excavation already started or stopped.'));
    this.running = true;
    this.operation = Promise.resolve().then(() => this.execute()).then(outcome => {
      this.terminal.complete(outcome);
    }, error => { this.terminal.fail(error); throw error; });
    return this.operation;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.operation && !this.running) return this.operation;
    this.terminal.beginCleanup();
    this.cancellation.abort(); this.acknowledge?.(false); this.continueRun?.();
    try { this.bot.pathfinder.setGoal(null); } catch (error) { this.cleanupErrors.push(error); }
    try {
      if (this.bot.targetDigBlock) this.cancelOperations.push(Promise.resolve(this.bot.stopDigging()).catch(error => { this.cleanupErrors.push(error); }));
    } catch (error) { this.cleanupErrors.push(error); }
    this.stopping = (this.operation ?? Promise.resolve().then(() => {
      if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, 'Excavation cleanup failed');
      this.terminal.complete({ status: 'stopped', level: 'info', message: 'Excavation stopped before startup.' });
    })).catch(error => { this.terminal.fail(error); throw error; });
    return this.stopping;
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
    if (requirement.kind !== 'best' || requirement.policy !== 'mining' || !requirement.context) return;
    const p = requirement.context.position;
    const block = this.bot.blockAt(new Vec3(p.x, p.y, p.z));
    if (!block || !block.diggable || isAir(block.name)) this.equipmentIntent.publish({ kind: 'unrestricted' });
  }
  private async checkpoint(): Promise<boolean> {
    if (!this.active) return false;
    if (this.pauseRequested) { this.acknowledge?.(true); await this.resumeGate; }
    return this.active;
  }
  private async digPosition(pos: Vec3): Promise<BlockResult | null> {
    const bot = this.bot;
    const inspect = (): BlockResult | null => {
      const block = bot.blockAt(pos);
      return !block ? 'skipped' : isAir(block.name) ? 'alreadyClear' : !block.diggable ? 'skipped' : null;
    };
    const initial = inspect();
    if (initial) return initial;
    this.equipmentIntent.publish({ kind: 'best', policy: 'mining', context: { position: { x: pos.x, y: pos.y, z: pos.z } } });
    try { await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3)); }
    catch (error) {
      if (!this.active) return null;
      this.callbacks.onEvent('warning', `Cannot reach block at ${pos}: ${String(error)}`);
      return 'failed';
    }
    if (!await this.checkpoint()) return null;
    const afterNavigation = inspect();
    if (afterNavigation) return afterNavigation;
    try { await this.equipment.restore(this, this.cancellation.signal); }
    catch (error) {
      if (!this.active) return null;
      this.callbacks.onEvent('warning', `Mining equipment unavailable at ${pos}: ${String(error)}`);
      return 'failed';
    }
    if (!await this.checkpoint()) return null;
    const afterYield = inspect();
    if (afterYield) return afterYield;
    // A meal can change the block or hand requirement while the task is yielded.
    try { await this.equipment.restore(this, this.cancellation.signal); }
    catch (error) {
      if (!this.active) return null;
      this.callbacks.onEvent('warning', `Mining equipment unavailable at ${pos}: ${String(error)}`);
      return 'failed';
    }
    if (!this.active) return null;
    const block = bot.blockAt(pos);
    if (!block) return 'skipped';
    if (isAir(block.name)) return 'alreadyClear';
    if (!block.diggable) return 'skipped';
    if (!bot.canDigBlock(block)) return 'failed';
    try { await bot.dig(block, true); return 'dug'; }
    catch (error) {
      if (!this.active) return null;
      this.callbacks.onEvent('warning', `Failed to dig ${pos}: ${String(error)}`);
      return 'failed';
    }
  }
  private async execute(): Promise<TaskOutcome> {
    const bot = this.bot, region = this.region;
    const dimension = bot.game.dimension;
    const abort = () => { void this.stop().catch(() => {}); };
    const game = () => { if (bot.game.dimension !== dimension) abort(); };
    bot.on('death', abort); bot.on('end', abort); bot.on('game', game);
    const summary: ExcavationSummary = { total: 0, dug: 0, alreadyClear: 0, skipped: 0, failed: 0, unvisited: 0 };
    let error: unknown;
    try {
      const coordinates = Object.values(region);
      const volume = (Math.abs(region.x2 - region.x1) + 1) * (Math.abs(region.y2 - region.y1) + 1) * (Math.abs(region.z2 - region.z1) + 1);
      if (coordinates.length !== 6 || !coordinates.every(Number.isSafeInteger) || volume > MAX_EXCAVATE_BLOCKS) throw new Error('Invalid or oversized excavation region.');
      const positions = buildDigOrder(Math.min(region.x1, region.x2), Math.max(region.x1, region.x2),
        Math.min(region.y1, region.y2), Math.max(region.y1, region.y2), Math.min(region.z1, region.z2), Math.max(region.z1, region.z2));
      summary.total = summary.unvisited = positions.length;
      this.callbacks.onEvent('info', `Starting excavation of ${positions.length} blocks.`);
      for (const pos of positions) {
        if (!await this.checkpoint()) break;
        const result = await this.digPosition(pos);
        if (!result) break;
        summary[result]++; summary.unvisited--;
        this.callbacks.onProgress(summary.total - summary.unvisited, summary.total);
      }
      await this.checkpoint();
    } catch (cause) { error = cause; }
    finally {
      this.running = false;
      this.terminal.beginCleanup();
      bot.removeListener('death', abort); bot.removeListener('end', abort); bot.removeListener('game', game);
      await Promise.allSettled(this.cancelOperations);
      try { bot.pathfinder.setGoal(null); } catch (cause) { this.cleanupErrors.push(cause); }
      this.acknowledge?.(false); this.continueRun?.();
      if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, 'Excavation cleanup failed');
    }
    const status = error ? 'failed' : this.cancellation.signal.aborted ? 'stopped' : summary.failed || summary.skipped ? 'partial' : 'completed';
    const counts = `${summary.dug} dug, ${summary.alreadyClear} already clear, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.unvisited} unvisited`;
    return { status, level: status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'partial' ? 'warning' : 'info',
      message: `Excavation ${status}: ${counts}.${error ? ` ${String(error)}` : ''}`, excavation: summary };
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
