import type { Entity } from 'prismarine-entity';
import type { Movements } from 'mineflayer-pathfinder';
import { TrackedPlayerTask } from './trackedPlayerTask.js';

/** A single explicit PvP target, canceled on loss/death/unreachable path or Stop. */
export class AttackTask extends TrackedPlayerTask {
  private previousPvpMovements: Movements | undefined;
  private configured = false;

  protected async begin(entity: Entity): Promise<void> {
    this.previousPvpMovements = this.bot.pvp.movements;
    this.configured = true;
    this.bot.pvp.movements = this.movements ?? undefined;
    const tiers = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'];
    const weapon = this.bot.inventory.items()
      .filter((item) => /_(sword|axe)$/.test(item.name))
      .sort((a, b) => tiers.indexOf(b.name.split('_')[0]) - tiers.indexOf(a.name.split('_')[0]))[0];
    if (weapon) await this.bot.equip(weapon, 'hand');
    if (this.running) await this.bot.pvp.attack(entity);
  }

  protected async endMotion(): Promise<void> {
    if (!this.configured) return;
    try {
      await this.bot.pvp.stop();
    } finally {
      this.bot.pvp.movements = this.previousPvpMovements;
    }
  }
}
