import pkg from 'mineflayer-pathfinder';
import type { Entity } from 'prismarine-entity';
import { TrackedPlayerTask } from './trackedPlayerTask.js';

const { goals } = pkg;

export class FollowTask extends TrackedPlayerTask {
  protected begin(entity: Entity): void {
    // Dynamic goals track movement themselves; repeatedly resetting the goal discards searches.
    this.bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3), true);
  }
}
