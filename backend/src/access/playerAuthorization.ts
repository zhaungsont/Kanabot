import type { PlayerRole } from '../../../shared/accessContracts.js';
import { roleAllows } from './roleCatalog.js';

/** Pure gameplay authorization: no queue, task owner, transport, or runtime dependency. */
export function authorizePlayer(role: PlayerRole | null, permission: unknown): { ok: true } | { ok: false; error: string } {
  return roleAllows(role, permission) ? { ok: true } : {
    ok: false, error: role ? `Your ${role} role does not allow this operation.` : 'Invalid Minecraft player name.',
  };
}
