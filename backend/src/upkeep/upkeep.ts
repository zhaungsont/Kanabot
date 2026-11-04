import type { Bot } from 'mineflayer';
import type { UpkeepSettings, UpkeepStatus } from '../../../shared/upkeepContracts.js';
import { AutoEatAdapter } from '../behaviors/autoEat.js';
import { EquipmentService, EquipmentUnavailable, type EquipmentOwner } from '../runtime/equipment.js';

export const defaultUpkeep = (): UpkeepSettings => ({ autoEat: false, autoArmor: false });
export function validUpkeep(value: unknown): value is UpkeepSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(k => k === 'autoEat' || k === 'autoArmor') && typeof v.autoEat === 'boolean' && typeof v.autoArmor === 'boolean';
}
export interface EatingPort { eat(signal: AbortSignal): Promise<void>; availability?(): string | null; }
type Log = (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
/** Two upkeep policies, one captured-bot inventory lane, no gameplay-task imports. */
export class Upkeep {
  private settings: UpkeepSettings;
  private operation: Promise<void> | null = null;
  private cancel: AbortController | null = null;
  private disposed = false;
  private failed = false;
  private retryAt = 0;
  private armorAt = 0;
  private lastWarning = -Infinity;
  private blocked: EquipmentOwner | null = null;
  private activity: UpkeepStatus['activity'] = 'monitoring';
  private detail = 'Opt-in food and armor upkeep runs during or outside tasks.';
  private signature = '';
  private eating: EatingPort | null;
  private readonly timer;
  constructor(private readonly bot: Bot, settings: UpkeepSettings, readonly equipment: EquipmentService,
    private readonly owner: () => EquipmentOwner | null, private readonly eligible: () => boolean,
    private readonly publish: (status: UpkeepStatus) => void, private readonly log: Log,
    eating?: EatingPort | null, private readonly now: () => number = () => performance.now()) {
    this.settings = { ...settings }; this.eating = eating ?? null;
    this.usePlugin = eating === undefined;
    this.timer = setInterval(() => this.tick(), 1_000);
    bot.on('death', this.interrupt); bot.on('game', this.interrupt); bot.on('end', this.interrupt);
    this.emit();
  }
  private readonly usePlugin;
  get busy(): boolean { return !!this.operation || this.failed; }
  update(settings: UpkeepSettings): void {
    if (settings.autoArmor && !this.settings.autoArmor) this.equipment.armorOverrides.clear();
    for (const feature of ['autoEat', 'autoArmor'] as const) if (settings[feature] !== this.settings[feature]) {
      this.log(`${feature === 'autoEat' ? 'Auto-eat' : 'Auto-armor'} ${settings[feature] ? 'enabled' : 'disabled'}.`, 'info');
    }
    if ((this.activity === 'eating' && !settings.autoEat) || (this.activity === 'armor' && !settings.autoArmor)) this.interrupt();
    this.settings = { ...settings };
    if (!this.busy) this.notice('monitoring', settings.autoEat || settings.autoArmor ? 'Food and armor upkeep ready.' : 'Upkeep is disabled.');
    else this.emit();
  }
  prepareForTask(): boolean {
    this.retryAt = this.now() + 3_000;
    if (this.busy) { this.interrupt(); return false; }
    return true;
  }
  readonly interrupt = (): void => { this.cancel?.abort(); };
  private notice(activity: UpkeepStatus['activity'], detail: string): void { this.activity = activity; this.detail = detail; this.emit(); }
  private tick(): void {
    if (this.disposed || this.busy || !this.eligible()) return;
    if (this.bot.currentWindow) { this.notice('waiting', 'Waiting for the open inventory window to close.'); return; }
    const owner = this.owner();
    if (this.blocked) {
      if (this.blocked !== owner || !this.blocked.active) this.blocked = null;
      else if (this.now() >= this.retryAt) { this.run('restoring', false, async signal => {
        await this.equipment.exclusive(() => this.equipment.reconcile(owner, null, signal));
      }); return; }
    }
    if (this.now() < this.retryAt) return;
    if (!this.eating && this.usePlugin && this.bot.autoEat) this.eating = new AutoEatAdapter(this.bot, false);
    if (this.settings.autoEat && !Number.isFinite(this.bot.food)) this.notice('waiting', 'Waiting for hunger data from the server.');
    if (this.settings.autoEat && Number.isFinite(this.bot.food) && this.bot.food < 20 && (this.bot.food <= 15 || this.bot.health < 14)) {
      let unavailable: string | null | undefined;
      try { unavailable = this.eating ? this.eating.availability?.() : 'Waiting for food plugin initialization.'; }
      catch (error) { unavailable = `Food availability check failed: ${String(error)}`; }
      if (unavailable) {
        this.notice('waiting', unavailable);
        if (this.now() - this.lastWarning >= 30_000) { this.lastWarning = this.now(); this.log(`Auto-eat: ${unavailable}`, 'warning'); }
      } else if (this.eating) {
        this.run('eating', true, signal => this.meal(signal)); return;
      }
    }
    if (this.settings.autoArmor && this.now() >= this.armorAt) {
      this.armorAt = this.now() + 3_000;
      this.run('armor', false, async signal => {
        await this.equipment.exclusive(async () => {
          if (signal.aborted || this.disposed || !this.eligible()) return;
          const count = await this.equipment.armor(this.owner(), signal);
          if (count) this.log(`Auto-armor equipped ${count} armor piece(s).`, 'success');
        });
      }); return;
    }
    if (this.settings.autoEat && this.bot.food >= 20) this.notice('monitoring', 'Hunger is full; ordinary food cannot be eaten. Healing depends on server regeneration.');
    else if (!this.settings.autoEat && !this.settings.autoArmor) this.notice('monitoring', 'Upkeep is disabled.');
  }
  private async meal(signal: AbortSignal): Promise<void> {
    await this.equipment.exclusive(async () => {
      if (signal.aborted || this.disposed || !this.eligible()) return;
      const fallback = this.bot.heldItem;
      let mealError: unknown;
      let attempted = false;
      try {
        if (this.bot.food < 20 && this.settings.autoEat) { attempted = true; await this.eating!.eat(signal); }
      } catch (error) { mealError = error; }
      // A canceled meal may have equipped food. Reconcile while retaining inventory
      // ownership even after cancellation, but never resume a canceled task/run.
      if (!this.disposed && this.eligible()) {
        this.notice('restoring', 'Restoring the current task item requirement.');
        await this.equipment.reconcile(this.owner(), fallback, new AbortController().signal);
      }
      if (mealError && !signal.aborted) this.log(`Auto-eat failed: ${String(mealError)}`, 'warning');
      else if (!attempted) this.log('Auto-eat skipped: hunger or settings changed before consumption.', 'info');
      else this.log(`Auto-eat ${signal.aborted ? 'canceled' : 'completed'}.`, signal.aborted ? 'info' : 'success');
    });
  }
  private run(activity: UpkeepStatus['activity'], yieldHand: boolean, work: (signal: AbortSignal) => Promise<void>): void {
    const cancel = new AbortController(); this.cancel = cancel;
    const owner = this.owner();
    let yielded = false;
    this.notice(activity, activity === 'eating' ? 'Waiting for a task safe point, then eating.' : 'Checking equipment.');
    if (activity === 'eating') this.log('Auto-eat requested.', 'info');
    const deadline = setTimeout(() => {
      cancel.abort(); this.failed = true;
      this.notice('cleanup-failed', 'Upkeep is still draining. Conflicting actions remain blocked; retire the bot if it cannot finish.');
      this.log(this.detail, 'error');
    }, 15_000);
    this.operation = Promise.resolve().then(async () => {
      if (yieldHand && owner?.active) {
        yielded = await owner.pauseForUpkeep(cancel.signal);
        if (!yielded) { this.failed = false; this.notice('waiting', 'Current action is waiting for a safe upkeep point.'); return; }
      }
      if (!cancel.signal.aborted && !this.disposed && this.eligible()) await work(cancel.signal);
      if (this.disposed) return;
      if (owner?.active && this.owner() === owner && (yielded || activity === 'restoring')) {
        // Includes cancellation at the safe-point boundary before food was used.
        await this.equipment.exclusive(() => this.equipment.reconcile(owner, null, new AbortController().signal));
        await owner.resumeAfterUpkeep();
      }
      this.blocked = null; this.failed = false;
      this.notice('monitoring', 'Food and armor upkeep ready.');
    }).catch(error => {
      if (error instanceof EquipmentUnavailable) {
        this.blocked = (yielded || activity === 'restoring') && owner?.active ? owner : null;
        this.failed = !this.blocked && activity === 'armor';
        this.notice(this.failed ? 'cleanup-failed' : 'blocked', error.message); this.log(`Upkeep blocked: ${error.message}`, 'warning');
      } else {
        this.failed = true; this.notice('cleanup-failed', `Upkeep handoff failed: ${String(error)}. Retire the bot to recover.`); this.log(this.detail, 'error');
      }
    }).finally(() => {
      clearTimeout(deadline); this.operation = null; this.cancel = null; this.retryAt = this.now() + 5_000;
    });
  }
  private emit(): void {
    if (this.disposed) return;
    const value = { settings: { ...this.settings }, activity: this.activity, detail: this.detail };
    const signature = JSON.stringify(value);
    if (signature !== this.signature) { this.signature = signature; this.publish(value); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; clearInterval(this.timer); this.interrupt();
    this.bot.removeListener('death', this.interrupt); this.bot.removeListener('game', this.interrupt); this.bot.removeListener('end', this.interrupt);
  }
}
