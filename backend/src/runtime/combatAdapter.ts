import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Movements } from 'mineflayer-pathfinder';

/** Scoped compatibility with PvP 1.3.2; all plugin-internal stops use this lease too. */
export class ScopedCombatAdapter {
  private stopping: Promise<void> | null = null;
  private ended = false;
  private readonly invalid = new WeakSet<Entity>();
  private readonly originalStop;
  private readonly originalMovements;
  private readonly shieldPlugin;
  private readonly originalShield;
  private readonly originalLook;
  private readonly looks = new Set<Promise<void>>();
  private readonly look: Bot['lookAt'];
  constructor(private readonly bot: Bot, movements: Movements, private readonly fallbackMs = 1_500) {
    this.originalLook = bot.lookAt;
    this.look = (...args) => {
      const pending = this.originalLook.apply(bot, args);
      this.looks.add(pending);
      void pending.finally(() => this.looks.delete(pending)).catch(() => {});
      return pending;
    };
    bot.lookAt = this.look;
    this.originalStop = bot.pvp.stop;
    this.originalMovements = bot.pvp.movements;
    // Disables both fixed-index creeper handling and delayed shield inventory writes.
    this.shieldPlugin = bot.pvp as unknown as { hasShield: () => boolean };
    this.originalShield = this.shieldPlugin.hasShield;
    this.shieldPlugin.hasShield = () => false;
    bot.pvp.movements = movements;
    bot.pvp.stop = this.stop;
  }
  async attack(entity: Entity, signal: AbortSignal): Promise<void> {
    await this.stop();
    if (this.ended || signal.aborted || !this.tracked(entity)) return;
    await this.bot.pvp.attack(entity);
    // PvP also awaits internally. Death/despawn can occur during its startup.
    if (signal.aborted || !this.tracked(entity)) this.invalidate();
  }
  private tracked(entity: Entity): boolean {
    return !this.invalid.has(entity) && entity.isValid !== false && this.bot.entities[entity.id] === entity && !!entity.position &&
      [entity.position.x, entity.position.y, entity.position.z].every(Number.isFinite);
  }
  /** Invalid/dead targets and weapon loss require immediate safety interruption. */
  invalidate(entity?: Entity): void {
    if (entity) this.invalid.add(entity);
    this.bot.pvp.forceStop();
  }
  readonly stop = (): Promise<void> => {
    if (this.stopping) return this.stopping;
    if (!this.bot.pvp.target) return this.drainLooks();
    // Register before requesting stop, including synchronous path_stop implementations.
    this.stopping = new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (timer) clearTimeout(timer);
        this.bot.removeListener('path_stop', finish);
        try { this.bot.pvp.forceStop(); resolve(); } catch (error) { reject(error); }
      };
      this.bot.once('path_stop', finish);
      timer = setTimeout(() => {
        // Emergency fallback after graceful movement failed; no plugin timeout remains.
        finish();
      }, this.ended ? 0 : this.fallbackMs);
      try { this.bot.pathfinder.stop(); } catch (error) {
        clearTimeout(timer); this.bot.removeListener('path_stop', finish); reject(error);
      }
    }).then(() => this.drainLooks()).finally(() => { this.stopping = null; });
    // PvP's own entityGone listener calls stop without awaiting it. Keep that
    // fire-and-forget call handled; explicit lease owners still observe rejection.
    void this.stopping.catch(() => {});
    return this.stopping;
  };
  markEnded(): void { this.ended = true; }
  private async drainLooks(): Promise<void> { await Promise.allSettled([...this.looks]); }
  async release(): Promise<void> {
    await this.stop();
    this.bot.pvp.stop = this.originalStop;
    this.bot.pvp.movements = this.originalMovements;
    this.shieldPlugin.hasShield = this.originalShield;
    if (this.bot.lookAt === this.look) this.bot.lookAt = this.originalLook;
  }
}
