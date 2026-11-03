import type { Socket } from 'socket.io';
import type { BotManager } from '../botManager.js';
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '../types.js';
import type { PlayerAccessResult } from '../../../shared/accessContracts.js';

/** Deployment-authorized management only; gameplay Owner is not a deployment credential. */
export function registerAccessHandlers(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>, manager: BotManager): void {
  const reply = (callback: unknown, result: PlayerAccessResult) => { if (typeof callback === 'function') callback(result); };
  socket.on('bot:access:get', (id, callback) => {
    const session = manager.getSessionForViewer(socket.id, id);
    reply(callback, session ? { ok: true, value: session.getPlayerAccess() } : { ok: false, code: 'FORBIDDEN', error: 'Attach to this bot before managing player roles.' });
  });
  socket.on('bot:access:update', (id, update, callback) => {
    if (typeof callback !== 'function') return;
    const session = manager.getSessionForViewer(socket.id, id);
    reply(callback, session ? session.updatePlayerRole(update) : { ok: false, code: 'FORBIDDEN', error: 'Attach to this bot before managing player roles.' });
  });
}
