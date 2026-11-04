import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { BehaviorSettings, BehaviorStatus } from '../../../shared/behaviorContracts.js';
import { copySettings } from './settings.js';
import type { EquipmentOwner } from '../runtime/equipment.js';
import { SurfaceReaction } from './surface.js';
import { SelfDefenseReaction, trackedAttacker } from './selfDefense.js';

/** Per-connection idle resource owner. No transport, player roles, or task scheduling. */
export class IdleBehaviors {
  private settings: BehaviorSettings;
  private activity: BehaviorStatus['activity'] = 'idle';
  private detail = 'Enabled behaviors run only while idle.';
  private operation: Promise<void> | null = null;
  private cancel: AbortController | null = null;
  private disposed = false;
  private retryAt = 0;
  private unknownAt = -Infinity;
  private lastStatus = '';
  private readonly interval;
  runtimeOwner: EquipmentOwner | null = null;
  constructor(private readonly bot: Bot, settings: BehaviorSettings,
    private readonly canRun: () => boolean, private readonly onStatus: (status: BehaviorStatus) => void,
    private readonly log: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void,
    private readonly now: () => number = () => performance.now()) {
    this.settings = copySettings(settings);

    bot.on('entityHurt', this.hurt);
    bot.on('death', this.interrupt);
    bot.on('game', this.interrupt);
    bot.on('end', this.interrupt);
    this.interval = setInterval(() => this.tick(), 1_000);
    this.publish();
  }
  get busy(): boolean { return !!this.operation || this.activity === 'cleanup-failed'; }
  update(settings: BehaviorSettings): void {
    const defenseChanged = JSON.stringify(settings.selfDefense) !== JSON.stringify(this.settings.selfDefense);
    if (settings.avoidDrowning !== this.settings.avoidDrowning) this.log(`Avoid drowning ${settings.avoidDrowning ? 'enabled' : 'disabled'}.`, 'info');
    if (defenseChanged) this.log(`Self-defense ${settings.selfDefense.enabled ? `enabled: ${settings.selfDefense.mode} for ${settings.selfDefense.durationSeconds} seconds` : 'disabled'}.`, 'info');
    this.settings = copySettings(settings);
    if ((this.activity === 'surfacing' && !settings.avoidDrowning) || (this.activity === 'defending' && defenseChanged)) this.interrupt();
    this.publish();
  }
  /** A synchronous task boundary must reject while asynchronous cleanup is draining. */
  prepareForTask(): boolean {
    this.retryAt = this.now() + 5_000;
    if (this.busy) { this.interrupt(); return false; }
    return true;
  }
  private tick(): void {
    if (this.disposed || this.busy || !this.canRun() || !this.settings.avoidDrowning || this.now() < this.retryAt) return;
    if (!Number.isFinite(this.bot.oxygenLevel) || this.bot.oxygenLevel > 6) return;
    this.launch('surfacing', 'Looking for nearby air.', async signal => {
      const reaction = new SurfaceReaction(this.bot, this.log);
      this.runtimeOwner = reaction;
      await reaction.run(signal);
    });
  }
  private readonly hurt = (victim: Entity, source?: Entity): void => {
    if (victim !== this.bot.entity || this.disposed || !this.settings.selfDefense.enabled || !this.canRun()) return;
    if (this.activity === 'defending' || this.activity === 'stopping' || this.activity === 'cleanup-failed') return;
    if (!trackedAttacker(this.bot, source)) {
      if (this.now() - this.unknownAt >= 10_000) {
        this.unknownAt = this.now();
        this.log('Self-defense did not react: damage source is unknown or no longer tracked.');
      }
      return;
    }
    const deadline = this.now() + this.settings.selfDefense.durationSeconds * 1_000;
    const settings = { ...this.settings.selfDefense };
    if (this.busy) return;
    this.log(`Self-defense triggered by ${source.username ?? source.name ?? 'an identified attacker'}: ${settings.mode} for ${settings.durationSeconds} seconds.`, 'info');
    this.launch('defending', 'Preparing self-defense.', async signal => {
      if (signal.aborted || !this.canRun() || !trackedAttacker(this.bot, source)) return;
      const remaining = deadline - this.now();
      if (remaining <= 0) return;
      await new Promise<void>((resolve, reject) => {
        const reaction = new SelfDefenseReaction(this.bot, source, settings.mode, remaining,
          detail => {
            if (detail !== this.detail) {
              this.detail = detail;
              this.log(`Self-defense: ${detail}`, /failed|unavailable/.test(detail) ? 'warning' : 'info');
              this.publish();
            }
          }, resolve, reject);
        this.runtimeOwner = reaction;
        const stop = () => { void reaction.stop().then(resolve, reject); };
        signal.addEventListener('abort', stop, { once: true });
        const cleanup = () => signal.removeEventListener('abort', stop);
        try { reaction.start(); } catch (error) { void reaction.stop().then(() => reject(error), reject); }
        this.reactionDisposer = cleanup;
        if (signal.aborted) stop();
      });
    });
  };
  private reactionDisposer: (() => void) | null = null;
  private launch(activity: 'surfacing' | 'defending', detail: string, work: (signal: AbortSignal) => Promise<void | 'failed'>): void {
    const cancel = new AbortController();
    this.cancel = cancel; this.activity = activity; this.detail = detail;
    if (activity === 'surfacing') this.log('Avoid drowning started.', 'info');
    const deadline = setTimeout(() => {
      if (this.operation !== operation) return;
      cancel.abort(); this.activity = 'cleanup-failed';
      this.detail = 'Idle behavior cleanup is still pending. Tasks remain blocked; retire this deployment to recover.';
      this.log(this.detail, 'error'); this.publish();
    }, activity === 'surfacing' ? 15_000 : this.settings.selfDefense.durationSeconds * 1_000 + 10_000);
    const operation = Promise.resolve().then(() => work(cancel.signal)).then(result => {
      if (this.operation !== operation) return;
      this.reactionDisposer?.(); this.reactionDisposer = null;
      this.operation = null; this.cancel = null; this.activity = 'idle';
      this.runtimeOwner = null;
      this.detail = 'Enabled behaviors run only while idle.';
      if (result !== 'failed') this.log(`${activity === 'surfacing' ? 'Avoid drowning' : 'Self-defense'} ${cancel.signal.aborted ? 'canceled' : 'completed'}.`, cancel.signal.aborted ? 'info' : 'success');
      this.retryAt = this.now() + 5_000;
      this.publish();
    }, error => {
      if (this.operation !== operation) return;
      this.reactionDisposer?.(); this.reactionDisposer = null;
      this.activity = 'cleanup-failed'; this.detail = `Idle behavior cleanup failed; retire this deployment: ${String(error)}`;
      this.log(this.detail, 'error'); this.publish();
    }).finally(() => clearTimeout(deadline));
    this.operation = operation;
    this.publish();
  }
  readonly interrupt = (): void => {
    if (!this.operation) return;
    if (this.activity !== 'cleanup-failed') {
      this.activity = 'stopping'; this.detail = 'Finishing idle behavior cleanup.';
    }
    this.cancel?.abort(); this.publish();
  };
  private publish(): void {
    if (this.disposed) return;
    const status = { settings: copySettings(this.settings), activity: this.activity, detail: this.detail };
    const key = JSON.stringify(status);
    if (key !== this.lastStatus) { this.lastStatus = key; this.onStatus(status); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.interval);
    this.bot.removeListener('entityHurt', this.hurt);
    this.bot.removeListener('death', this.interrupt);
    this.bot.removeListener('game', this.interrupt);
    this.bot.removeListener('end', this.interrupt);
    this.interrupt();
  }
}
