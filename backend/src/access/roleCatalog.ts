import type { GameplayPermission, PlayerRole, RoleDescription } from '../../../shared/accessContracts.js';

export const CATALOG_VERSION = 2;
// Fixed product policy. Users edit assignments, never these definitions.
const visitor: readonly GameplayPermission[] = ['task.follow.start'];
const crew: readonly GameplayPermission[] = [...visitor, 'task.protect.start', 'task.excavate.start'];
const owner: readonly GameplayPermission[] = [...crew, 'task.attack.start', 'task.stop'];
const catalog: Readonly<Record<PlayerRole, readonly GameplayPermission[]>> = { visitor, crew, owner };

export function isPlayerRole(value: unknown): value is PlayerRole {
  return value === 'visitor' || value === 'crew' || value === 'owner';
}
export function roleAllows(role: unknown, permission: unknown): boolean {
  return isPlayerRole(role) && catalog[role].some((allowed) => allowed === permission);
}
export function describeRoles(): RoleDescription[] {
  return (['visitor', 'crew', 'owner'] as const).map((id) => ({
    id, label: { visitor: 'Visitor', crew: 'Crew', owner: 'Owner' }[id], permissions: [...catalog[id]],
  }));
}
export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(value.trim())) return null;
  return value.trim().toLowerCase();
}
