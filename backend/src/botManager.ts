import { createHash, timingSafeEqual } from 'node:crypto';
import { BotSession, type BotSessionCallbacks } from './botSession.js';
import type { ArmorSlot, BotConfig, BotSessionHandle, BotSessionSnapshot, ChatMessage, EventLogEntry, PlayerListSnapshot, PlayerCommandResult, SessionResult } from './types.js';

export type SessionObserver = Pick<BotSessionCallbacks, 'onChat' | 'onEvent' | 'onArmor' | 'onPlayers' | 'onAccess'> & {
  onState: (info: BotSessionSnapshot['info']) => void;
  onRemoved: (sessionId: string) => void;
};
type SessionFactory = (id: string, config: BotConfig, callbacks: BotSessionCallbacks) => BotSession;
interface Entry {
  session: BotSession;
  tokenHash: Buffer;
  observers: Map<string, SessionObserver>;
  playerViewers: Set<string>;
  armor: ArmorSlot[];
  chats: ChatMessage[];
  events: EventLogEntry[];
  players: PlayerListSnapshot | null;
}

export function validSessionHandle(value: unknown): value is BotSessionHandle {
  if (!value || typeof value !== 'object') return false;
  const handle = value as Record<string, unknown>;
  return typeof handle.sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handle.sessionId)
    && typeof handle.accessToken === 'string' && /^[0-9a-f]{64}$/.test(handle.accessToken);
}
const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Owns bot execution and bounded snapshots. Viewers have no lifecycle authority on detach. */
export class BotManager {
  private readonly sessions = new Map<string, Entry>();
  private readonly viewerSessions = new Map<string, string>();
  // Never replay a stopped create within this backend lifetime.
  private readonly retiredIds = new Set<string>();

  constructor(private readonly factory: SessionFactory = (id, config, callbacks) => new BotSession(id, config, callbacks)) {}

  get sessionCount(): number { return this.sessions.size; }

  createSession(config: BotConfig, handle: BotSessionHandle): SessionResult<{ session: BotSession; created: boolean }> {
    if (!validSessionHandle(handle)) return { ok: false, code: 'INVALID_REQUEST', error: 'Invalid session handle.' };
    const existing = this.sessions.get(handle.sessionId);
    if (existing) {
      const authorized = this.authorize(handle);
      if (!authorized.ok) return authorized;
      return { ok: true, value: { session: existing.session, created: false } };
    }
    if (this.retiredIds.has(handle.sessionId)) return { ok: false, code: 'NOT_FOUND', error: 'This bot session has ended. Deploy a new bot.' };
    const entry: Entry = {
      session: null as unknown as BotSession, tokenHash: hashToken(handle.accessToken),
      observers: new Map(), playerViewers: new Set(), armor: [], chats: [], events: [], players: null,
    };
    const broadcast = (deliver: (observer: SessionObserver, viewerId: string) => void) => {
      if (this.sessions.get(handle.sessionId) !== entry) return;
      for (const [viewerId, observer] of entry.observers) {
        try { deliver(observer, viewerId); } catch { console.warn('[BotManager] Viewer notification failed.'); }
      }
    };
    entry.session = this.factory(handle.sessionId, config, {
      onAccess: (snapshot) => broadcast((observer) => observer.onAccess?.(snapshot)),
      onChat: (message) => {
        entry.chats = [...entry.chats.slice(-199), message];
        broadcast((observer) => observer.onChat(message));
      },
      onEvent: (event) => {
        entry.events = [...entry.events.slice(-149), event];
        broadcast((observer) => observer.onEvent(event));
      },
      onArmor: (armor) => { entry.armor = armor; broadcast((observer) => observer.onArmor(armor)); },
      onPlayers: (players) => {
        entry.players = players;
        broadcast((observer, viewerId) => { if (entry.playerViewers.has(viewerId)) observer.onPlayers(players); });
      },
      onStateChange: () => broadcast((observer) => observer.onState(entry.session.getInfo())),
      onDestroy: () => {
        if (this.sessions.get(handle.sessionId) !== entry) return;
        this.sessions.delete(handle.sessionId);
        this.retiredIds.add(handle.sessionId);
        for (const [viewerId, observer] of entry.observers) {
          this.viewerSessions.delete(viewerId);
          try { observer.onRemoved(handle.sessionId); } catch { /* viewer already gone */ }
        }
        entry.observers.clear();
        entry.playerViewers.clear();
      },
    });
    this.sessions.set(handle.sessionId, entry);
    return { ok: true, value: { session: entry.session, created: true } };
  }

  attachViewer(handle: BotSessionHandle, viewerId: string, observer: SessionObserver): SessionResult<BotSessionSnapshot> {
    const authorized = this.authorize(handle);
    if (!authorized.ok) return authorized;
    this.detachViewer(viewerId);
    const entry = authorized.value;
    entry.observers.set(viewerId, observer);
    this.viewerSessions.set(viewerId, handle.sessionId);
    return { ok: true, value: {
      access: entry.session.getPlayerAccess(),
      info: entry.session.getInfo(), armor: entry.armor,
      chats: [...entry.chats], events: [...entry.events],
    } };
  }

  detachViewer(viewerId: string): void {
    const id = this.viewerSessions.get(viewerId);
    const entry = id ? this.sessions.get(id) : undefined;
    this.viewerSessions.delete(viewerId);
    if (!entry) return;
    entry.observers.delete(viewerId);
    if (entry.playerViewers.delete(viewerId) && entry.playerViewers.size === 0) entry.session.setPlayersSubscribed(false);
  }

  getSessionForViewer(viewerId: string, sessionId: unknown): BotSession | undefined {
    if (typeof sessionId !== 'string' || this.viewerSessions.get(viewerId) !== sessionId) return undefined;
    return this.sessions.get(sessionId)?.session;
  }

  setPlayersSubscribed(viewerId: string, sessionId: string, enabled: boolean): PlayerCommandResult {
    const session = this.getSessionForViewer(viewerId, sessionId);
    if (!session) return { ok: false, error: 'Session not found or not attached to this connection.' };
    const entry = this.sessions.get(sessionId)!;
    if (!enabled) {
      entry.playerViewers.delete(viewerId);
      if (entry.playerViewers.size === 0) session.setPlayersSubscribed(false);
      return { ok: true };
    }
    const alreadySampling = entry.playerViewers.size > 0;
    entry.playerViewers.add(viewerId);
    const result = session.setPlayersSubscribed(true);
    if (!result.ok) entry.playerViewers.delete(viewerId);
    else if (alreadySampling && entry.players) entry.observers.get(viewerId)?.onPlayers(entry.players);
    return result;
  }

  stopSession(viewerId: string, sessionId: unknown): SessionResult<null> {
    const session = this.getSessionForViewer(viewerId, sessionId);
    if (!session) return { ok: false, code: 'FORBIDDEN', error: 'Session not found or not attached to this connection.' };
    session.destroy();
    return { ok: true, value: null };
  }

  private authorize(handle: BotSessionHandle): SessionResult<Entry> {
    if (!validSessionHandle(handle)) return { ok: false, code: 'INVALID_REQUEST', error: 'Invalid session handle.' };
    const entry = this.sessions.get(handle.sessionId);
    if (!entry) return { ok: false, code: 'NOT_FOUND', error: 'Bot session no longer exists. The backend may have restarted or the bot expired.' };
    if (!timingSafeEqual(entry.tokenHash, hashToken(handle.accessToken))) return { ok: false, code: 'FORBIDDEN', error: 'Invalid bot access token.' };
    return { ok: true, value: entry };
  }
}
