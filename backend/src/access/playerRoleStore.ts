import type { PlayerAccessResult, PlayerAccessSnapshot, PlayerRole } from '../../../shared/accessContracts.js';
import { CATALOG_VERSION, describeRoles, isPlayerRole, normalizePlayerName } from './roleCatalog.js';

/** One bot/server context, lifetime independent of viewers. Replace storage at the persistence milestone. */
export class PlayerRoleStore {
  private revision = 0;
  private readonly assignments = new Map<string, { username: string; role: PlayerRole }>();
  constructor(private readonly sessionId: string) {}

  roleFor(username: string): PlayerRole | null {
    const key = normalizePlayerName(username);
    return key ? this.assignments.get(key)?.role ?? 'visitor' : null;
  }
  snapshot(): PlayerAccessSnapshot {
    return {
      sessionId: this.sessionId, revision: this.revision, catalogVersion: CATALOG_VERSION, roles: describeRoles(),
      assignments: [...this.assignments.values()].map((entry) => ({ ...entry })).sort((a, b) => a.username.localeCompare(b.username)),
    };
  }
  update(value: unknown): PlayerAccessResult {
    if (!value || typeof value !== 'object') return this.invalid();
    const input = value as Record<string, unknown>;
    const key = normalizePlayerName(input.username);
    if (!key || (input.role !== null && !isPlayerRole(input.role)) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) return this.invalid();
    if (input.expectedRevision !== this.revision) return { ok: false, code: 'CONFLICT', error: 'Roles changed in another viewer. Review the refreshed assignments and try again.' };
    if (input.role !== null && !this.assignments.has(key) && this.assignments.size >= 1000) return this.invalid('This bot has reached its 1,000-assignment limit.');
    if (input.role === 'owner') {
      // Explicit Owner assignment is an atomic transfer; previous Owner falls back to Visitor.
      for (const [name, assignment] of this.assignments) if (assignment.role === 'owner') this.assignments.delete(name);
    }
    if (input.role === null) this.assignments.delete(key);
    else this.assignments.set(key, { username: (input.username as string).trim(), role: input.role as PlayerRole });
    this.revision++;
    return { ok: true, value: this.snapshot() };
  }
  private invalid(error = 'Provide a valid Minecraft username, fixed role, and assignment revision.'): PlayerAccessResult {
    return { ok: false, code: 'INVALID_REQUEST', error };
  }
}
