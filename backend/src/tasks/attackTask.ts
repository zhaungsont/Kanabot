import type { Entity } from 'prismarine-entity';
import { TrackedPlayerTask } from './trackedPlayerTask.js';
import { ScopedCombatAdapter } from '../runtime/combatAdapter.js';

/** Explicit player combat with a generic equipment intent and cooperative item-use yield. */
export class AttackTask extends TrackedPlayerTask {
  private combat: ScopedCombatAdapter | null = null;
  protected async begin(entity: Entity): Promise<void> {
    this.equipmentIntent.publish({ kind: 'best', policy: 'melee' });
    if (!this.combat) this.combat = new ScopedCombatAdapter(this.bot, this.movements!);
    if (this.equipmentService) await this.equipmentService.restore(this, this.cancellation.signal);
    else {
      const tiers = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'];
      const weapon = this.bot.inventory.items().filter(i => /_(sword|axe)$/.test(i.name))
        .sort((a, b) => tiers.indexOf(b.name.split('_')[0]) - tiers.indexOf(a.name.split('_')[0]))[0];
      if (weapon) await this.bot.equip(weapon, 'hand');
    }
    if (this.active && !this.paused) await this.combat.attack(entity, this.cancellation.signal);
  }
  protected async suspendMotion(): Promise<void> { await this.combat?.stop(); this.bot.pathfinder.setGoal(null); }
  protected async endMotion(): Promise<void> { await this.combat?.release(); }
}
