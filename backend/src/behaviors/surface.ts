import type { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
import { EquipmentIntent, type EquipmentOwner } from '../runtime/equipment.js';
const { goals } = pkg;

/** Idle-only, bounded search for air directly above in already-loaded world data. */
export class SurfaceReaction implements EquipmentOwner {
  readonly equipmentIntent = new EquipmentIntent();
  private running = false;
  get active(): boolean { return this.running; }
  constructor(private readonly bot: Bot, private readonly log: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void) {}
  async pauseForUpkeep(_signal: AbortSignal): Promise<boolean> { return false; }
  async resumeAfterUpkeep(): Promise<void> {}
  async run(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const origin = this.bot.entity.position.floored();
    let target = null;
    for (let dy = 1; dy <= 8; dy++) {
      const position = origin.offset(0, dy, 0);
      const feet = this.bot.blockAt(position), head = this.bot.blockAt(position.offset(0, 1, 0));
      if (!feet || !head) break;
      if (['air', 'cave_air', 'void_air'].includes(feet.name) && ['air', 'cave_air', 'void_air'].includes(head.name)) { target = position; break; }
      if (feet.boundingBox === 'block') break;
    }
    if (!target) { this.log('Avoid drowning: no observed air route above; move the bot to safety.', 'warning'); return; }
    const original = this.bot.pathfinder.movements;
    const pathfinder = this.bot.pathfinder as typeof this.bot.pathfinder & { searchRadius: number };
    const settings = { thinkTimeout: this.bot.pathfinder.thinkTimeout, tickTimeout: this.bot.pathfinder.tickTimeout,
      searchRadius: pathfinder.searchRadius };
    const movement = Object.assign(Object.create(Object.getPrototypeOf(original)), original,
      { canDig: false, allow1by1towers: false, scafoldingBlocks: [], allowParkour: false });
    this.running = true;
    try {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(deadline); clearInterval(check); signal.removeEventListener('abort', done); this.bot.removeListener('path_update', path); resolve(); };
        const path = (update: { status: string }) => {
          if (update.status === 'noPath' || update.status === 'timeout') { this.log('Avoid drowning could not find a usable path to air.', 'warning'); done(); }
        };
        const deadline = setTimeout(done, 10_000);
        const check = setInterval(() => { if (this.bot.oxygenLevel >= 12) done(); }, 250);
        signal.addEventListener('abort', done, { once: true }); this.bot.on('path_update', path);
        try {
          Object.assign(this.bot.pathfinder, { thinkTimeout: 1_500, tickTimeout: 10, searchRadius: 12 });
          this.bot.pathfinder.setMovements(movement);
          this.bot.pathfinder.setGoal(new goals.GoalBlock(target!.x, target!.y, target!.z));
        } catch (error) { this.log(`Avoid drowning could not start: ${String(error)}`, 'warning'); done(); }
        if (signal.aborted) done();
      });
    } finally {
      this.running = false;
      try { this.bot.pathfinder.setGoal(null); }
      finally { Object.assign(this.bot.pathfinder, settings); this.bot.pathfinder.setMovements(original); }
    }
  }
}
