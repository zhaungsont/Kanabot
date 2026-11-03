import type { BotAction } from '../types.js';
import type { GameplayPermission } from '../../../shared/accessContracts.js';

/** Maps task/control operations to permissions. Role grants live in access/roleCatalog.ts. */
export const TASK_PERMISSIONS: Readonly<Record<BotAction['type'], GameplayPermission>> = Object.freeze({
  follow: 'task.follow.start', protect: 'task.protect.start', guard: 'task.protect.start', excavate: 'task.excavate.start',
  attack: 'task.attack.start', stop: 'task.stop',
});
