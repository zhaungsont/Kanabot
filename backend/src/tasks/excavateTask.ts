import type { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { ExternalWorld, DigEvidence, cachedBlock } from '../excavation/world.js';
import { isAir, normalizeRegion, positions, validateHeight, dimensionHeight, contains } from '../excavation/region.js';
export { MAX_EXCAVATE_BLOCKS } from '../excavation/region.js';
import type { ExcavateRegion } from '../types.js';
import type { ExcavationSummary, TaskOutcome } from '../../../shared/taskContracts.js';
import { EquipmentIntent, type EquipmentService } from '../runtime/equipment.js';
import { TaskCompletion, type TaskRuntime } from './taskRuntime.js';

const { goals, Movements } = pkg;
export interface ExcavateCallbacks {
  onEvent: (type: 'info' | 'warning' | 'error', message: string) => void;
  onProgress: (current: number, total: number) => void;
}

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
    if (requirement.kind !== 'best' || !['mining', 'excavation'].includes(requirement.policy) || !requirement.context) return;
    const p = requirement.context.position;
    const block = this.bot.blockAt(new Vec3(p.x, p.y, p.z));
    if (!block || !block.diggable || isAir(block.name)) this.equipmentIntent.publish({ kind: 'unrestricted' });
  }
  private async checkpoint(): Promise<boolean> {
    if (!this.active) return false;
    if (this.pauseRequested) { this.acknowledge?.(true); await this.resumeGate; }
    return this.active;
  }
  private readonly reasons = new Map<string, string>();
  private readonly attempted = new Set<string>();
  private readonly verified = new Set<string>();
  private readonly visited = new Set<string>();
  private world!: ExternalWorld;
  private evidence!: DigEvidence;
  private stopReason = 'USER_STOP';
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private reason(pos: Vec3, reason: string): void { this.reasons.set(pos.toString(), reason); }
  private toolReady(): boolean {
    const selection = this.equipment.resolve(this.equipmentIntent.requirement);
    return selection === 'empty' ? !this.bot.heldItem : !!selection && !!this.bot.heldItem && this.equipment.sameItem(this.bot.heldItem, selection);
  }
  private async bounded<T>(operation: () => Promise<T>, ms: number): Promise<T> {
    // A deadline requests cancellation; it never abandons owned work or frees
    // the coordinator while a library operation is still pending.
    const timer = setTimeout(() => { this.stopReason = 'OPERATION_DEADLINE'; void this.stop().catch(() => {}); }, ms);
    try { return await operation(); } finally { clearTimeout(timer); }
  }
  private async stabilize(): Promise<void> {
    const signal = this.cancellation.signal;
    if (signal.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 250); signal.addEventListener('abort', done, { once: true });
    });
  }
  private async navigate(stance: Vec3): Promise<boolean> {
    try {
      await this.bounded(() => this.bot.pathfinder.goto(new goals.GoalBlock(stance.x, stance.y, stance.z)), 15_000);
      if (!await this.checkpoint()) return false;
      // Installed goto can resolve an empty noPath result. Verify real arrival.
      return this.bot.entity.position.floored().equals(stance) && this.world.actualStance();
    } catch { return false; }
  }
  private async digPosition(pos: Vec3): Promise<void> {
    const bot = this.bot, key = pos.toString();
    let block = cachedBlock(bot, pos);
    if (!block || isAir(block.name)) { if (!block) this.reason(pos, 'UNOBSERVED'); return; }
    if (this.attempted.has(key)) return; // Never blindly retry an uncertain effect.
    const policy = this.world.permitted(pos);
    if (policy) { this.reason(pos, policy); return; }
    if (!this.world.actualStance() || !this.world.canRetreat()) throw new Error('NO_SAFE_STANCE: external terrain or retreat changed.');
    let face = this.world.face(pos);
    if (!face) {
      const candidates = this.world.reachable().filter(p => p.distanceTo(pos) <= 5 && this.world.face(pos, p.offset(.5, 0, .5)))
        .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, 4);
      for (const stance of candidates) {
        if (!this.active) return;
        if (await this.navigate(stance)) { face = this.world.face(pos); if (face) break; }
      }
    }
    if (!face) { this.reason(pos, 'NO_SAFE_SEQUENCE'); return; }
    this.equipmentIntent.publish({ kind: 'best', policy: 'excavation', context: { position: { x: pos.x, y: pos.y, z: pos.z } } });
    try {
      await this.equipment.restore(this, this.cancellation.signal);
      if (!await this.checkpoint()) return;
      // Upkeep may have eaten/reconciled while yielded. Reconcile live intent.
      await this.equipment.restore(this, this.cancellation.signal);
    } catch { this.reason(pos, 'TOOL_UNAVAILABLE'); return; }
    if (!this.active) return;
    block = cachedBlock(bot, pos);
    face = this.world.face(pos);
    if (!block || isAir(block.name)) return;
    if (!this.toolReady()) { this.reason(pos, 'TOOL_CHANGED'); return; }
    if (!this.world.actualStance() || !this.world.canRetreat() || this.world.permitted(pos) || !face || !bot.canDigBlock(block)) { this.reason(pos, 'ENVIRONMENT_CHANGED'); return; }
    this.evidence.begin(pos);
    const stateId = block.stateId;
    // dig performs its own look. Guard the existing internal await as well as
    // the call boundary, for plugins that defer even a forced look.
    const originalLook = bot.lookAt;
    let canceledBeforeStartup = false;
    const guardedLook: Bot['lookAt'] = async (...args) => {
      await originalLook.apply(bot, args);
      if (!this.active || !this.toolReady() || !this.world.actualStance() || !this.world.canRetreat() || this.world.permitted(pos) || bot.blockAt(pos)?.stateId !== stateId || !this.world.face(pos)) {
        canceledBeforeStartup = true; throw new Error('Dig canceled before startup.');
      }
    };
    bot.lookAt = guardedLook;
    this.attempted.add(key);
    try {
      await this.bounded(() => bot.dig(block!, true, face!), 30_000);
      if (!this.active) return;
      if (await this.evidence.wait(this.cancellation.signal)) this.verified.add(key);
      else this.reason(pos, 'UNVERIFIED_DIG');
    } catch { if (this.active) this.reason(pos, 'DIG_FAILED'); }
    finally {
      if (bot.lookAt === guardedLook) bot.lookAt = originalLook;
      // Evidence survives task boundaries. A failed/absent receipt cannot turn
      // optimistic cache air into a successful subsequent excavation.
      if (canceledBeforeStartup) this.attempted.delete(key); else this.evidence.quarantine();
    }
  }
  private async execute(): Promise<TaskOutcome> {
    const bot = this.bot;
    const dimension = bot.game.dimension;
    const abort = () => { this.stopReason = 'LIFECYCLE_CHANGE'; void this.stop().catch(() => {}); };
    const game = () => { if (bot.game.dimension !== dimension) abort(); };
    const movement = bot.pathfinder.movements;
    const settings = { thinkTimeout: bot.pathfinder.thinkTimeout, tickTimeout: bot.pathfinder.tickTimeout, searchRadius: Reflect.get(bot.pathfinder, 'searchRadius'), enablePathShortcut: Reflect.get(bot.pathfinder, 'enablePathShortcut') };
    let movementInstalled = false;
    let error: unknown, cells: Vec3[] = [], returned = false;
    const summary: ExcavationSummary = { total: 0, dug: 0, alreadyClear: 0, skipped: 0, failed: 0, unverified: 0, unvisited: 0 };
    const monitor = () => { if (this.active && !this.world.actualStance()) { this.stopReason = 'UNSAFE_STANCE'; void this.stop().catch(() => {}); } };
    const invalidate = () => { this.world?.invalidate(); };
    const blockChanged = (_old: unknown, block: ReturnType<Bot['blockAt']>) => {
      // Removing a permitted target cannot alter our external walkway. Keep
      // the bounded graph across those removals; other edits invalidate it.
      if (!block || !contains(this.region, block.position) || !isAir(block.name)) invalidate();
    };
    bot.on('death', abort); bot.on('end', abort); bot.on('game', game);
    try {
      const region = normalizeRegion(this.region);
      validateHeight(region, ...dimensionHeight(bot));
      cells = positions(region); summary.total = cells.length;
      if (!this.active) return { status: 'stopped', level: 'info', message: 'Excavation stopped before execution.', excavation: { ...summary, unvisited: cells.length } };
      this.world = new ExternalWorld(bot, region, bot.entity.position.floored());
      if (!this.world.actualStance()) throw new Error('NO_SAFE_STANCE: start on stable full-block terrain outside the removal region.');
      const movements = new Movements(bot);
      movements.canDig = false; movements.allow1by1towers = false;
      movements.allowParkour = false; movements.allowSprinting = false;
      movements.maxDropDown = 0; movements.infiniteLiquidDropdownDistance = false;
      movements.scafoldingBlocks = []; movements.canOpenDoors = false;
      movements.exclusionAreasBreak.push(() => 100);
      movements.exclusionAreasPlace.push(() => 100);
      movements.exclusionAreasStep.push(b => this.world.walkingCell(b.position) ? 0 : 100);
      bot.pathfinder.setMovements(movements); movementInstalled = true;
      Reflect.set(bot.pathfinder, 'enablePathShortcut', false);
      bot.pathfinder.thinkTimeout = 1_000; bot.pathfinder.tickTimeout = 10; Reflect.set(bot.pathfinder, 'searchRadius', 32);
      this.evidence = new DigEvidence(bot);
      bot.on('physicsTick', monitor);
      bot.on('blockUpdate', blockChanged); bot.on('chunkColumnLoad', invalidate); bot.on('chunkColumnUnload', invalidate);
      this.deadline = setTimeout(() => { this.stopReason = 'JOB_DEADLINE'; void this.stop().catch(() => {}); }, 15 * 60_000);
      this.callbacks.onEvent('info', `Starting bounded external-stance excavation of ${cells.length} positions.`);
      // Top-down snake is a tie-breaker, never permission to destroy access.
      for (let pass = 0; pass < 3 && this.active; pass++) {
        const before = this.verified.size;
        for (let i = 0; i < cells.length; i++) {
          if (!await this.checkpoint()) break;
          await this.digPosition(cells[i]);
          const key = cells[i].toString();
          if (!this.visited.has(key)) { this.visited.add(key); this.callbacks.onProgress(this.visited.size, cells.length); }
          if (i % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
        }
        if (this.verified.size === before) break;
      }
      if (this.active) returned = await this.navigate(this.world.staging);
      if (this.active && this.verified.size) await this.stabilize();
      await this.checkpoint();
    } catch (cause) { error = cause; }
    finally {
      this.running = false; this.terminal.beginCleanup();
      if (this.deadline) clearTimeout(this.deadline);
      this.evidence?.dispose();
      bot.removeListener('death', abort); bot.removeListener('end', abort); bot.removeListener('game', game); bot.removeListener('physicsTick', monitor);
      bot.removeListener('blockUpdate', blockChanged); bot.removeListener('chunkColumnLoad', invalidate); bot.removeListener('chunkColumnUnload', invalidate);
      await Promise.allSettled(this.cancelOperations);
      try {
        bot.pathfinder.setGoal(null);
        if (movementInstalled) { bot.pathfinder.setMovements(movement); Object.assign(bot.pathfinder, settings); }
      } catch (cause) { this.cleanupErrors.push(cause); }
      this.acknowledge?.(false); this.continueRun?.();
      if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, 'Excavation cleanup failed');
    }
    const reasonCounts: Record<string, number> = {};
    if (this.cancellation.signal.aborted) reasonCounts[this.stopReason] = 1;
    for (const pos of cells) {
      const key = pos.toString(), block = cachedBlock(bot, pos);
      let reason = this.reasons.get(key);
      if (!this.visited.has(key)) summary.unvisited++;
      else if (this.attempted.has(key) && !this.verified.has(key)) {
        if (reason === 'DIG_FAILED') summary.failed++; else { summary.unverified++; reason = 'UNVERIFIED_DIG'; }
      } else if (block && isAir(block.name)) { if (this.verified.has(key)) summary.dug++; else summary.alreadyClear++; reason = undefined; }
      else if (this.verified.has(key)) { summary.failed++; reason = 'SERVER_RESTORED_OR_UNLOADED'; }
      else { summary.skipped++; reason ??= 'NO_SAFE_SEQUENCE'; }
      if (reason) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    if (!returned && !this.cancellation.signal.aborted && !error) reasonCounts.RETURN_FAILED = 1;
    const status = error ? 'failed' : this.cancellation.signal.aborted ? 'stopped' : summary.failed || summary.skipped || summary.unverified || summary.unvisited || !returned ? 'partial' : 'completed';
    const counts = `${summary.dug} verified dug, ${summary.alreadyClear} already clear, ${summary.skipped} blocked/unknown, ${summary.failed} failed, ${summary.unverified} unverified, ${summary.unvisited} unvisited`;
    return { status, level: status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'partial' ? 'warning' : 'info',
      message: `Excavation ${status}: ${counts}. ${Object.entries(reasonCounts).map(([r, n]) => `${r}: ${n}`).join(', ')}${error ? ` ${String(error)}` : ''}`,
      excavation: { ...summary, reasonCounts, returnedToStaging: returned } };
  }
}
