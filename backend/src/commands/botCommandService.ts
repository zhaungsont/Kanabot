import type { BotAction, PlayerCommandResult } from '../types.js';
import type { PlayerRoleStore } from '../access/playerRoleStore.js';
import { authorizePlayer } from '../access/playerAuthorization.js';
import { normalizePlayerName } from '../access/roleCatalog.js';
import { TASK_PERMISSIONS } from './taskPermissions.js';

export type CommandActor = { kind: 'deployment' } | { kind: 'minecraft'; username: string };

export function validBotAction(value: unknown): value is BotAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (action.type === 'stop') return true;
  if (action.type === 'follow' || action.type === 'protect' || action.type === 'guard' || action.type === 'attack') {
    return typeof action.target === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(action.target);
  }
  if (action.type !== 'excavate' || !action.region || typeof action.region !== 'object') return false;
  const region = action.region as Record<string, unknown>;
  return ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every((key) => Number.isSafeInteger(region[key]) && Math.abs(Number(region[key])) <= 30_000_000);
}

/** Authorization/creation boundary; scheduling and Mineflayer remain behind execute. */
export class BotCommandService {
  constructor(private readonly roles: PlayerRoleStore, private readonly execute: (action: BotAction) => PlayerCommandResult) {}

  submit(actor: CommandActor, input: unknown): PlayerCommandResult {
    if (!validBotAction(input)) return { ok: false, error: 'Invalid task command or parameters.' };
    if (actor.kind === 'minecraft') {
      // Do not trim inbound sender metadata into a different valid player.
      if (!normalizePlayerName(actor.username) || actor.username !== actor.username.trim()) return { ok: false, error: 'Invalid Minecraft player name.' };
      const decision = authorizePlayer(this.roles.roleFor(actor.username), TASK_PERMISSIONS[input.type]);
      if (!decision.ok) return decision;
    } else if (actor.kind !== 'deployment') return { ok: false, error: 'Unknown command actor.' };
    // Synchronous today: a committed role edit cannot interleave check and dispatch.
    // Execution does not reauthorize or cancel existing work on subsequent role edits.
    return this.execute(input.type === 'guard' ? { ...input, type: 'protect' } : input);
  }
}
