import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Movements } from 'mineflayer-pathfinder';

/** Scoped compatibility with PvP 1.3.2; all plugin-internal stops use this lease too. */
export class ProtectCombatAdapter {
  private stopping: Promise<void> | null = null;
  private ended = false;
  private readonly originalStop;
  private readonly originalMovements;
  private readonly shieldPlugin;
  private readonly originalShield;
  constructor(private readonly bot: Bot, movements: Movements, private readonly fallbackMs = 1_500) {
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
    if (this.ended || signal.aborted) return;
    await this.bot.pvp.attack(entity);
    if (signal.aborted) await this.stop();
  }
  /** Invalid/dead targets and weapon loss require immediate safety interruption. */
  invalidate(): void { this.bot.pvp.forceStop(); }
  readonly stop = (): Promise<void> => {
    if (this.stopping) return this.stopping;
    if (!this.bot.pvp.target) return Promise.resolve();
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
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  };
  markEnded(): void { this.ended = true; }
  async release(): Promise<void> {
    await this.stop();
    this.bot.pvp.stop = this.originalStop;
    this.bot.pvp.movements = this.originalMovements;
    this.shieldPlugin.hasShield = this.originalShield;
  }
}
