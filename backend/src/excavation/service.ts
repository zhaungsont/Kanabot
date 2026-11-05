import { randomUUID } from 'node:crypto';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import type { ExcavationPlan, ExcavationResult, ExcavationStatus } from '../../../shared/excavationContracts.js';
import type { TaskOutcome, TaskLifecycleStatus } from '../../../shared/taskContracts.js';
import type { CommandActor } from '../commands/botCommandService.js';
import type { ExcavateRegion, PlayerCommandResult } from '../types.js';
import { cachedBlock } from './world.js';
import { EXCAVATION_HELP } from './commands.js';
import { fromSizes, normalizeRegion, positions, isAir, volume, validateHeight, dimensionHeight, MAX_APPROACH_DISTANCE } from './region.js';

interface Context { bot: Bot; available: boolean }
interface Draft { actor: string; bot: Bot; dimension: string; plan: ExcavationPlan; taskId?: string }
interface Job { actor: string; status: ExcavationStatus }
export const actorKey = (actor: CommandActor) => actor.kind === 'deployment' ? 'deployment' : `minecraft:${actor.username.toLowerCase()}`;

/** In-memory application boundary. Adapters supply authenticated actors, never payload identities. */
export class ExcavationService {
  private readonly drafts = new Map<string, Draft>();
  private readonly jobs = new Map<string, Job>();
  private currentTaskId: string | null = null;
  private lastProgressAt = 0;
  constructor(private readonly context: () => Context | null,
    private readonly authorize: (actor: CommandActor, stopOthers?: boolean) => PlayerCommandResult,
    private readonly start: (bounds: ExcavateRegion, taskId: string, actor: CommandActor) => PlayerCommandResult,
    private readonly stop: () => void,
    private readonly changed: () => void) {}

  invalidate(): void { this.drafts.clear(); }
  private prune(): void {
    for (const [id, draft] of this.drafts) if (Date.parse(draft.plan.expiresAt) <= Date.now()) this.drafts.delete(id);
  }
  preview(actor: CommandActor): ExcavationPlan | undefined {
    this.prune();
    return structuredClone([...this.drafts.values()].reverse().find(d => d.actor === actorKey(actor) && !d.taskId)?.plan);
  }
  latest(): ExcavationStatus | undefined { return structuredClone([...this.jobs.values()].at(-1)?.status); }
  lifecycle(status?: TaskLifecycleStatus): void {
    const job = this.currentTaskId && this.jobs.get(this.currentTaskId);
    if (job && status && status.phase !== 'running') job.status.phase = status.phase;
  }
  progress(id: string, checked: number): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status.checked = checked;
      if (Date.now() - this.lastProgressAt >= 5_000) { this.lastProgressAt = Date.now(); this.changed(); }
    }
  }
  finish(id: string, outcome: TaskOutcome): void {
    const job = this.jobs.get(id);
    if (job) { job.status.phase = 'finished'; job.status.outcome = outcome; }
    if (this.currentTaskId === id) this.currentTaskId = null;
  }
  prepare(actor: CommandActor, input: unknown, legacy = false): ExcavationResult {
    const allowed = this.authorize(actor); if (!allowed.ok) return allowed;
    try {
      const context = this.context(); if (!context) throw new Error('The bot is not active.');
      const r = legacy ? normalizeRegion(input) : fromSizes(input);
      validateHeight(r, ...dimensionHeight(context.bot));
      const p = context.bot.entity.position;
      const distance = Math.hypot(Math.max(r.x1 - p.x, 0, p.x - r.x2), Math.max(r.y1 - p.y, 0, p.y - r.y2), Math.max(r.z1 - p.z, 0, p.z - r.z2));
      if (distance > MAX_APPROACH_DISTANCE) throw new Error(`First release supports nearby jobs within ${MAX_APPROACH_DISTANCE} blocks. Move the bot closer and prepare again.`);
      const known = { solid: 0, clear: 0, unknown: 0 };
      for (const pos of positions(r)) { const b = cachedBlock(context.bot, pos); known[!b ? 'unknown' : isAir(b.name) ? 'clear' : 'solid']++; }
      this.prune();
      for (const [id, d] of this.drafts) if (d.actor === actorKey(actor) && !d.taskId) this.drafts.delete(id);
      while (this.drafts.size >= 16) this.drafts.delete(this.drafts.keys().next().value!);
      const plan: ExcavationPlan = { planId: randomUUID().slice(0, 8), bounds: r, volume: volume(r), dimension: String(context.bot.game.dimension), known,
        staging: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
        policy: 'external-stance-v1', observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString() };
      this.drafts.set(plan.planId, { actor: actorKey(actor), bot: context.bot, dimension: plan.dimension, plan });
      this.changed(); return { ok: true, plan: structuredClone(plan), message: describe(plan) };
    } catch (error) { return { ok: false, error: (error as Error).message }; }
  }
  submit(actor: CommandActor, value: unknown): ExcavationResult {
    if (actor.kind !== 'deployment' && (actor.kind !== 'minecraft' || !/^[A-Za-z0-9_]{1,16}$/.test(actor.username))) return { ok: false, error: 'Invalid command actor.' };
    if (!value || typeof value !== 'object') return { ok: false, error: 'Invalid excavation request.' };
    const request = value as Record<string, unknown>;
    if (request.type === 'help') return { ok: true, message: EXCAVATION_HELP };
    if (request.type === 'prepare') return this.prepare(actor, request.input);
    this.prune();
    if (request.type === 'cancel') {
      for (const [id, d] of this.drafts) if (d.actor === actorKey(actor) && !d.taskId) this.drafts.delete(id);
      this.changed(); return { ok: true, message: 'Pending excavation plan discarded.' };
    }
    if (request.type === 'preview') { const plan = this.preview(actor); return plan ? { ok: true, plan, message: describe(plan) } : { ok: false, error: 'No pending excavation plan.' }; }
    if (request.type === 'confirm' && typeof request.planId === 'string') {
      const draft = this.drafts.get(request.planId);
      if (!draft || draft.actor !== actorKey(actor)) return { ok: false, error: 'Plan not found, expired, or belongs to another issuer.' };
      if (draft.taskId) { const job = this.jobs.get(draft.taskId); return job ? { ok: true, task: structuredClone(job.status), message: `Task ${draft.taskId} already accepted.` } : { ok: false, error: 'Task history expired.' }; }
      const allowed = this.authorize(actor); if (!allowed.ok) return allowed;
      const ctx = this.context();
      if (!ctx || ctx.bot !== draft.bot || String(ctx.bot.game.dimension) !== draft.dimension) return { ok: false, error: 'World changed; prepare a new plan.' };
      const staging = draft.plan.staging;
      if (!ctx.bot.entity.position.floored().equals(new Vec3(staging.x, staging.y, staging.z))) return { ok: false, error: 'Bot moved since preview; prepare a new plan.' };
      if (!ctx.available) return { ok: false, error: 'Bot is busy or stopping; retry confirmation after cleanup.' };
      const taskId = randomUUID().slice(0, 8);
      // Publish before synchronous admission; no async gap between check and claim.
      this.jobs.set(taskId, { actor: actorKey(actor), status: { taskId, phase: 'running', checked: 0, total: draft.plan.volume } });
      const result = this.start({ ...draft.plan.bounds }, taskId, actor);
      if (!result.ok) { this.jobs.delete(taskId); return result; }
      draft.taskId = taskId;
      this.currentTaskId = taskId;
      while (this.jobs.size > 16) this.jobs.delete(this.jobs.keys().next().value!);
      this.changed(); return { ok: true, task: structuredClone(this.jobs.get(taskId)!.status), message: `Task ${taskId} accepted. Movement stays outside the region; unsupported or unknown cells remain incomplete.` };
    }
    if ((request.type === 'status' || request.type === 'stop') && typeof request.taskId === 'string') {
      const job = this.jobs.get(request.taskId);
      if (!job) return { ok: false, error: 'Excavation task not found.' };
      if (job.actor !== actorKey(actor)) { const allowed = this.authorize(actor, true); if (!allowed.ok) return allowed; }
      if (job.status.phase === 'cleanup-failed') return { ok: true, task: structuredClone(job.status), message: `Task ${request.taskId}: cleanup is unconfirmed. Retire this deployment before starting another task.` };
      if (request.type === 'stop' && job.status.phase !== 'finished') {
        if (this.currentTaskId !== request.taskId) return { ok: false, error: 'This task is no longer active.' };
        job.status.phase = 'stopping'; this.stop(); this.changed();
      }
      return { ok: true, task: structuredClone(job.status), message: job.status.outcome?.message ?? `Task ${request.taskId}: ${job.status.phase}, ${job.status.checked}/${job.status.total} checked.` };
    }
    return { ok: false, error: 'Invalid excavation request.' };
  }
}
function describe(p: ExcavationPlan): string {
  const r = p.bounds;
  return `Plan ${p.planId}: X ${r.x1}..${r.x2}, Y ${r.y1}..${r.y2}, Z ${r.z1}..${r.z2}; ${p.volume} positions (${p.known.solid} solid, ${p.known.clear} clear, ${p.known.unknown} unknown), ${p.dimension}. External flat terrain only, within 32 blocks of staging (${p.staging.x},${p.staging.y},${p.staging.z}); no pit entry or construction. Expires ${p.expiresAt}. !dig confirm ${p.planId}`;
}
