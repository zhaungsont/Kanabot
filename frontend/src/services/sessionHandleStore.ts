import type { BotSessionHandle } from '../types.js';

export function createSessionHandle(): BotSessionHandle {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { sessionId: crypto.randomUUID(), accessToken: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

/** Storage is injected so this module needs neither React nor a network connection. */
export class SessionHandleStore {
  private readonly key: string;
  constructor(private readonly storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, backendUrl: string) {
    this.key = `kanabot:session:v1:${backendUrl}`;
  }
  read(): BotSessionHandle | null {
    try {
      const raw = this.storage().getItem(this.key);
      if (!raw) return null;
      const handle = JSON.parse(raw) as BotSessionHandle;
      return typeof handle?.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(handle.sessionId)
        && typeof handle.accessToken === 'string' && /^[0-9a-f]{64}$/.test(handle.accessToken) ? handle : null;
    } catch { return null; }
  }
  save(handle: BotSessionHandle): void {
    // Persist before sending create so a lost acknowledgement remains recoverable.
    this.storage().setItem(this.key, JSON.stringify(handle));
  }
  clear(sessionId: string): void {
    try {
      // An old tab must not erase a newer bot's handle saved by another tab.
      if (this.read()?.sessionId === sessionId) this.storage().removeItem(this.key);
    } catch { /* A stale saved handle will be rejected on the next resume. */ }
  }
}
