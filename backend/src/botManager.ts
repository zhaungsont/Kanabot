import { Socket } from 'socket.io';
import { BotSession, BotSessionCallbacks } from './botSession.js';
import { BotConfig, ChatMessage, EventLogEntry, ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from './types.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * BotManager maintains a registry of all active BotSession instances.
 * It enforces one session per socket connection.
 */
export class BotManager {
  private readonly sessions = new Map<string, BotSession>();
  private readonly socketToSession = new Map<string, string>();

  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Creates (or replaces) a BotSession for the given socket.
   * Returns the sessionId (= socket.id) and the new session.
   */
  createSession(socket: AppSocket, config: BotConfig): { sessionId: string; session: BotSession } {
    // Destroy any existing session for this socket
    this.destroyBySocketId(socket.id);

    const sessionId = socket.id;

    const callbacks: BotSessionCallbacks = {
      onChat: (msg: ChatMessage) => socket.emit('bot:chat', msg),
      onEvent: (entry: EventLogEntry) => socket.emit('bot:event', entry),
      onStateChange: () => socket.emit('bot:state', session.getInfo()),
      onDestroy: () => {
        this.sessions.delete(sessionId);
        this.socketToSession.delete(socket.id);
      },
    };

    const session = new BotSession(sessionId, config, callbacks);
    this.sessions.set(sessionId, session);
    this.socketToSession.set(socket.id, sessionId);

    return { sessionId, session };
  }

  getSession(sessionId: string): BotSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionBySocketId(socketId: string): BotSession | undefined {
    const id = this.socketToSession.get(socketId);
    return id ? this.sessions.get(id) : undefined;
  }

  destroyBySocketId(socketId: string): void {
    const session = this.getSessionBySocketId(socketId);
    if (session) session.destroy();
    this.socketToSession.delete(socketId);
  }

  getAllSessions(): BotSession[] {
    return Array.from(this.sessions.values());
  }
}
