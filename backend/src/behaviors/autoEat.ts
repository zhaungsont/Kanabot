import type { Bot } from 'mineflayer';
import type { Item } from 'prismarine-item';

/** Compatibility boundary for mineflayer-auto-eat 5.0.3's listener/cancellation defects. */
export class AutoEatAdapter {
  private signal: AbortSignal | null = null;
  constructor(private readonly bot: Bot) {
    bot.autoEat.disableAuto(); // Our scheduler owns cadence and inventory ownership.
    bot.autoEat.setOpts({ returnToLastItem: false, strictErrors: true, eatingTimeout: 3_000 });
    // Upstream's timeout does not remove its listeners. Replace only this instance's
    // internal wait, preserving the library's food selection, equip, and eating logic.
    const plugin = bot.autoEat as unknown as { buildEatingListener: (item: Item, timeout: number) => Promise<void> };
    plugin.buildEatingListener = (item, timeout) => this.waitForConsumption(item, timeout);
  }
  availability(): string | null {
    if (!this.bot.registry.foodsByName) return 'Waiting for the server food registry to initialize.';
    return this.bot.autoEat.findBestChoices(this.bot.inventory.items(), this.bot.autoEat.opts.priority).length
      ? null : 'No suitable food in inventory. Add food such as bread or cooked meat.';
  }
  async eat(signal: AbortSignal): Promise<void> {
    const previous = this.bot.heldItem;
    this.signal = signal;
    const cancel = () => this.bot.autoEat.cancelEat();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (!signal.aborted) await this.bot.autoEat.eat({ equipOldItem: false });
    } finally {
      signal.removeEventListener('abort', cancel);
      this.signal = null;
      // 5.0.3 also leaves this flag set if its pre-consumption equip rejects.
      (this.bot.autoEat as unknown as { _eating: boolean })._eating = false;
      this.bot.deactivateItem();
      // Await restoration ourselves: upstream's default restoration is fire-and-forget.
      if (previous && this.bot.inventory.items().includes(previous) && this.bot.heldItem !== previous) await this.bot.equip(previous, 'hand');
    }
  }
  private waitForConsumption(item: Item, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.signal;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.bot._client.removeListener('entity_status', status);
        this.bot.inventory.removeListener('updateSlot', slot);
        signal?.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const status = (packet: { entityId: number; entityStatus: number }) => {
        if (packet.entityId === this.bot.entity.id && packet.entityStatus === 9) finish();
      };
      const slot = (_slot: number, old: Item | null, next: Item | null) => {
        if (old?.slot === item.slot && next?.type !== item.type) finish(new Error('Food changed during eating.'));
      };
      const aborted = () => finish(new Error('Eating canceled.'));
      timer = setTimeout(() => finish(new Error('Eating timed out.')), timeout);
      this.bot._client.on('entity_status', status);
      this.bot.inventory.on('updateSlot', slot);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
  }
}
