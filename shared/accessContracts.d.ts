export type PlayerRole = 'visitor' | 'crew' | 'owner';
export type GameplayPermission = 'task.follow.start' | 'task.protect.start' | 'task.excavate.start' | 'task.attack.start' | 'task.stop';
export interface RoleDescription { id: PlayerRole; label: string; permissions: GameplayPermission[]; }
export interface PlayerRoleAssignment { username: string; role: PlayerRole; }
export interface PlayerAccessSnapshot {
  sessionId: string;
  revision: number;
  catalogVersion: number;
  roles: RoleDescription[];
  assignments: PlayerRoleAssignment[];
}
export interface PlayerRoleUpdate { username: string; role: PlayerRole | null; expectedRevision: number; }
export type PlayerAccessResult = { ok: true; value: PlayerAccessSnapshot } | {
  ok: false; code: 'FORBIDDEN' | 'INVALID_REQUEST' | 'CONFLICT'; error: string;
};
