import type { Bot } from 'mineflayer';

export type Readiness = 'ready' | 'unavailable';
export interface EquipmentPort {
  prepare(context: { generation: number; purpose: 'melee-protection' }, signal: AbortSignal): Promise<Readiness>;
  readiness(): Readiness;
  subscribeReadiness(listener: () => void): () => void;
  release(generation: number): Promise<void>;
}

/** Deliberately read-only: automatic equipment selection is a separate milestone. */
export class HeldWeaponEquipment implements EquipmentPort {
  private readonly subscribers = new Set<() => void>();
  private generation: number | null = null;
  constructor(private readonly bot: Bot) {}
  readiness(): Readiness {
    return /^(wooden|stone|iron|golden|diamond|netherite)_(sword|axe)$/.test(this.bot.heldItem?.name ?? '') ? 'ready' : 'unavailable';
  }
  async prepare(context: { generation: number }, signal: AbortSignal): Promise<Readiness> {
    if (signal.aborted) return 'unavailable';
    this.generation = context.generation;
    return this.readiness();
  }
  private readonly changed = (): void => { for (const listener of this.subscribers) listener(); };
  subscribeReadiness(listener: () => void): () => void {
    if (!this.subscribers.size) this.bot.on('heldItemChanged', this.changed);
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
      if (!this.subscribers.size) this.bot.removeListener('heldItemChanged', this.changed);
    };
  }
  async release(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.generation = null;
    this.subscribers.clear();
    this.bot.removeListener('heldItemChanged', this.changed);
  }
}
