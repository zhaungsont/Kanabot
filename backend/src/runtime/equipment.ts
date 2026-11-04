import type { Bot } from 'mineflayer';
import type { Item } from 'prismarine-item';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { isDeepStrictEqual } from 'node:util';

export type HandRequirement =
  | { kind: 'unrestricted' } | { kind: 'empty' }
  | { kind: 'specific'; item: Item }
  | { kind: 'best'; policy: string; context?: { position: { x: number; y: number; z: number } } };
export class EquipmentIntent {
  revision = 0;
  requirement: HandRequirement = { kind: 'unrestricted' };
  publish(requirement: HandRequirement): void { this.requirement = requirement; this.revision++; }
}
export interface EquipmentOwner {
  readonly equipmentIntent: EquipmentIntent;
  readonly active: boolean;
  pauseForUpkeep(signal: AbortSignal): Promise<boolean>;
  resumeAfterUpkeep(): Promise<void>;
  refreshEquipmentIntent?(): void;
}
export class EquipmentUnavailable extends Error {}
type Resolver = (requirement: Extract<HandRequirement, { kind: 'best' }>, items: Item[]) => Item | null;

/** One inventory transaction channel per captured bot. No task/UI/RBAC imports. */
export class EquipmentService {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private readonly resolvers = new Map<string, Resolver>();
  readonly armorOverrides = new Set<string>();
  constructor(readonly bot: Bot) {
    this.resolvers.set('melee', (_requirement, items) => items.filter(i => /_(sword|axe)$/.test(i.name) && this.usable(i))
      .sort((a, b) => this.meleeScore(b) - this.meleeScore(a) || a.slot - b.slot)[0] ?? null);
    this.resolvers.set('mining', (requirement, items) => {
      const p = requirement.context?.position;
      const block = p && bot.blockAt(new Vec3(p.x, p.y, p.z));
      if (!block || !block.diggable) return null;
      return items.filter(i => this.usable(i)).map(item => ({ item, time: this.digTime(block, item) }))
        .filter(v => Number.isFinite(v.time)).sort((a, b) => a.time - b.time || a.item.slot - b.item.slot)[0]?.item ?? null;
    });
  }
  get busy(): boolean { return this.pending > 0; }
  registerPolicy(id: string, resolver: Resolver): void {
    if (this.resolvers.has(id)) throw new Error(`Equipment policy already registered: ${id}`);
    this.resolvers.set(id, resolver);
  }
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined).finally(() => { this.pending--; });
    return result;
  }
  private usable(item: Item): boolean { return !item.maxDurability || item.durabilityUsed < item.maxDurability; }
  private meleeScore(item: Item): number {
    const material = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'].indexOf(item.name.split('_')[0]);
    return material * 100 + (item.name.endsWith('_sword') ? 10 : 0) + (item.enchants?.find(e => e.name === 'sharpness')?.lvl ?? 0);
  }
  private digTime(block: Block, item: Item): number {
    return block.digTime(item.type, false, false, false, item.enchants ?? [], this.bot.entity.effects ?? []);
  }
  resolve(requirement: HandRequirement): Item | null {
    const items = this.bot.inventory.items();
    if (requirement.kind === 'specific') return items.find(i => i === requirement.item) ?? items
      .filter(i => this.sameItem(i, requirement.item)).sort((a, b) => Number(b.slot === requirement.item.slot) - Number(a.slot === requirement.item.slot) || a.slot - b.slot)[0] ?? null;
    if (requirement.kind !== 'best') return null;
    const resolver = this.resolvers.get(requirement.policy);
    if (!resolver) throw new EquipmentUnavailable(`Unknown equipment policy: ${requirement.policy}`);
    return resolver(requirement, items);
  }
  /** Called only while the inventory channel is held, through the full readback. */
  async reconcile(owner: EquipmentOwner | null, fallback: Item | null, signal: AbortSignal): Promise<void> {
    for (let attempts = 0; attempts < 3; attempts++) {
      if (signal.aborted || (owner && !owner.active)) return;
      owner?.refreshEquipmentIntent?.();
      const revision = owner?.equipmentIntent.revision;
      const requirement = owner?.equipmentIntent.requirement ?? { kind: 'unrestricted' as const };
      if (requirement.kind === 'empty') {
        if (this.bot.heldItem) {
          const slots = this.bot.inventory.slots;
          const start = (this.bot as Bot & { QUICK_BAR_START?: number }).QUICK_BAR_START ?? 36;
          const empty = Array.from({ length: 9 }, (_, i) => i).find(i => !slots[start + i]);
          if (empty === undefined) throw new EquipmentUnavailable('No empty hotbar slot; refusing to drop an item.');
          this.bot.setQuickBarSlot(empty);
        }
        if (this.bot.heldItem) throw new EquipmentUnavailable('Empty hand could not be verified.');
      } else {
        const item = requirement.kind === 'unrestricted'
          ? (fallback ? this.resolve({ kind: 'specific', item: fallback }) : null) : this.resolve(requirement);
        if (!item && requirement.kind !== 'unrestricted') throw new EquipmentUnavailable('Required task item is unavailable.');
        if (item && this.bot.heldItem !== item) await this.bot.equip(item, 'hand');
        if (signal.aborted || (owner && !owner.active)) return;
        if (revision !== owner?.equipmentIntent.revision) continue;
        if (item && this.bot.heldItem !== item && (!this.bot.heldItem || !this.sameItem(this.bot.heldItem, item))) {
          throw new EquipmentUnavailable('Held task item could not be verified after equip.');
        }
      }
      if (revision === owner?.equipmentIntent.revision) return;
    }
    throw new EquipmentUnavailable('Task item requirement kept changing; waiting for a stable requirement.');
  }
  sameItem(a: Item, b: Item): boolean {
    return a.type === b.type && a.metadata === b.metadata && isDeepStrictEqual(a.nbt, b.nbt) &&
      isDeepStrictEqual(Reflect.get(a, 'components'), Reflect.get(b, 'components'));
  }
  async restore(owner: EquipmentOwner, signal: AbortSignal): Promise<void> {
    await this.exclusive(() => this.reconcile(owner, null, signal));
  }
  /** Armor never consumes a task-reserved item or changes the held hand. */
  async armor(owner: EquipmentOwner | null, signal: AbortSignal): Promise<number> {
    let count = 0;
    for (const [slot, suffix] of [['head', 'helmet'], ['torso', 'chestplate'], ['legs', 'leggings'], ['feet', 'boots']] as const) {
      if (signal.aborted) return count;
      if (this.armorOverrides.has(slot)) continue;
      const equippedSlot = this.bot.getEquipmentDestSlot(slot);
      const current = this.bot.inventory.slots[equippedSlot];
      const reserved = owner && owner.equipmentIntent.requirement.kind !== 'unrestricted' ? this.resolve(owner.equipmentIntent.requirement) : null;
      const best = this.bot.inventory.items().filter(i => i.name.endsWith(`_${suffix}`) && this.usable(i) &&
        i !== this.bot.heldItem && i !== reserved).sort((a, b) => this.armorScore(b) - this.armorScore(a) || a.slot - b.slot)[0];
      if (!best || (current && this.armorScore(current) >= this.armorScore(best))) continue;
      await this.bot.equip(best, slot);
      const equipped = this.bot.inventory.slots[equippedSlot];
      if (!equipped || !this.sameItem(equipped, best)) throw new EquipmentUnavailable(`Armor slot ${slot} could not be verified.`);
      count++;
    }
    return count;
  }
  private armorScore(item: Item): number {
    const material = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite'].indexOf(item.name.split('_')[0]);
    return material * 100 + (item.enchants?.find(e => e.name === 'protection')?.lvl ?? 0) * 5;
  }
}
