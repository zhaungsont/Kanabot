import type { Socket } from 'socket.io';
import type { BotManager } from '../botManager.js';
import type { ClientToServerEvents, InterServerEvents, PlayerCommand, PlayerCommandResult, ServerToClientEvents, SocketData } from '../types.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Socket adapter only. Runtime behavior remains in roster/task/whisper modules. */
export function registerPlayerHandlers(socket: AppSocket, manager: BotManager): void {
  const ownedSession = (sessionId: unknown) => {
    const session = manager.getSessionBySocketId(socket.id);
    return typeof sessionId === 'string' && session?.sessionId === sessionId ? session : undefined;
  };
  const reply = (callback: unknown, result: PlayerCommandResult): void => {
    if (typeof callback === 'function') callback(result);
  };

  socket.on('bot:players:subscribe', (sessionId, enabled, callback) => {
    const session = ownedSession(sessionId);
    if (!session) return reply(callback, { ok: false, error: 'Session not found or not owned by this connection.' });
    if (typeof enabled !== 'boolean') return reply(callback, { ok: false, error: 'Invalid player-list subscription.' });
    reply(callback, session.setPlayersSubscribed(enabled));
  });

  socket.on('bot:playerAction', (sessionId, command, callback) => {
    const session = ownedSession(sessionId);
    if (!session) return reply(callback, { ok: false, error: 'Session not found or not owned by this connection.' });
    if (!validPlayerCommand(command)) return reply(callback, { ok: false, error: 'Invalid player command.' });
    try {
      reply(callback, session.performPlayerCommand(command));
    } catch (error) {
      reply(callback, { ok: false, error: `Player command failed: ${String(error)}` });
    }
  });
}

export function validPlayerCommand(value: unknown): value is PlayerCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  if (typeof command.target !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(command.target)) return false;
  if (command.type === 'follow' || command.type === 'attack') return true;
  return command.type === 'whisper' && typeof command.message === 'string'
    && command.message.trim().length > 0 && command.message.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(command.message);
}
