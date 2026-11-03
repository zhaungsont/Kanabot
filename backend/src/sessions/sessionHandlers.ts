import type { Socket } from 'socket.io';
import type { BotManager, SessionObserver } from '../botManager.js';
import type { BotConfig, ClientToServerEvents, InterServerEvents, ServerToClientEvents, SessionResult, SocketData } from '../types.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
const reply = <T>(callback: unknown, result: SessionResult<T>) => { if (typeof callback === 'function') callback(result); };

function normalizeConfig(value: unknown): BotConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Record<string, unknown>;
  if (typeof config.serverHost !== 'string' || !config.serverHost.trim()) return null;
  if (config.botName !== undefined && (typeof config.botName !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(config.botName.trim()))) return null;
  if (config.version !== undefined && typeof config.version !== 'string') return null;
  if (config.serverPort !== undefined && (!Number.isInteger(config.serverPort) || Number(config.serverPort) < 1 || Number(config.serverPort) > 65535)) return null;
  return {
    serverHost: config.serverHost.trim(), botName: typeof config.botName === 'string' ? config.botName.trim() : 'mc_bot',
    serverPort: config.serverPort as number | undefined, version: (config.version as string | undefined)?.trim() || undefined,
  };
}

/** Transport boundary: a socket observes an independently owned runtime. */
export function registerSessionHandlers(socket: AppSocket, manager: BotManager): void {
  const observer: SessionObserver = {
    onAccess: (value) => socket.emit('bot:access', value),
    onChat: (value) => socket.emit('bot:chat', value),
    onEvent: (value) => socket.emit('bot:event', value),
    onState: (value) => socket.emit('bot:state', value),
    onArmor: (value) => socket.emit('bot:armor', value),
    onPlayers: (value) => socket.emit('bot:players', value),
    onRemoved: (id) => socket.emit('bot:removed', id),
  };
  socket.on('bot:create', (rawConfig, handle, callback) => {
    if (typeof callback !== 'function') return;
    const config = normalizeConfig(rawConfig);
    if (!config) return reply(callback, { ok: false, code: 'INVALID_REQUEST', error: 'Invalid bot configuration.' });
    const result = manager.createSession(config, handle);
    if (!result.ok) return reply(callback, result);
    // Replaying a create after a lost acknowledgement must not spawn another bot.
    if (result.value.created) result.value.session.spawn();
    reply(callback, manager.attachViewer(handle, socket.id, observer));
  });
  socket.on('bot:resume', (handle, callback) => {
    if (typeof callback === 'function') reply(callback, manager.attachViewer(handle, socket.id, observer));
  });
  socket.on('bot:disconnect', (id, callback) => reply(callback, manager.stopSession(socket.id, id)));
  socket.on('bot:chat', (id, message) => {
    const session = manager.getSessionForViewer(socket.id, id);
    if (!session || typeof message !== 'string') return;
    session.sendChat(message);
  });
  socket.on('bot:action', (id, action) => {
    const session = manager.getSessionForViewer(socket.id, id);
    if (!session || !action || typeof action !== 'object') return;
    if (action.type === 'excavate') session.performAction('excavate', undefined, action.region);
    else if (action.type === 'stop') session.performAction('stop');
    else session.performAction(action.type, action.target);
  });
  socket.on('bot:unequip', (id, slot) => {
    const session = manager.getSessionForViewer(socket.id, id);
    if (!session) return;
    void session.unequipAndDropArmor(slot);
    session.resetIdleTimer();
  });
  socket.on('bot:behaviors:update', (id, settings, callback) => {
    const session = manager.getSessionForViewer(socket.id, id);
    if (!session) return reply(callback, { ok: false, code: 'FORBIDDEN', error: 'Attach to this bot before changing behaviors.' });
    reply(callback, session.updateBehaviors(settings));
  });
  socket.on('disconnect', () => manager.detachViewer(socket.id));
}
