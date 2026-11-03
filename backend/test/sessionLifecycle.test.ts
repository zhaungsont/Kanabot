import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { BotManager, type SessionObserver } from '../src/botManager.js';
import { BotSession, type BotSessionCallbacks } from '../src/botSession.js';
import { registerSessionHandlers } from '../src/sessions/sessionHandlers.js';
import { registerPlayerHandlers } from '../src/players/playerHandlers.js';
import type { BotSessionSnapshot, BotSessionHandle, SessionResult } from '../src/types.js';
import { fakeBot, flush } from './playerFixtures.js';

const config = { serverHost: 'example.test', botName: 'mc_bot' };
const handle = (): BotSessionHandle => ({ sessionId: randomUUID(), accessToken: randomBytes(32).toString('hex') });
function observer() {
  const received: unknown[] = [];
  const value: SessionObserver = {
    onChat: (message) => received.push(message), onEvent: (event) => received.push(event),
    onState: (state) => received.push(state), onArmor: (armor) => received.push(armor),
    onPlayers: (players) => received.push(players), onRemoved: (id) => received.push({ removed: id }),
  };
  return { value, received };
}
function fixture() {
  let spawns = 0;
  let quits = 0;
  let callbacks!: BotSessionCallbacks;
  const { bot } = fakeBot();
  bot.quit = () => { quits++; };
  const manager = new BotManager((id, configuration, cb) => {
    callbacks = cb;
    const session = new BotSession(id, configuration, cb);
    Object.assign(session, { bot, spawn: () => { spawns++; session.state = 'idle'; session.spawnedAt = new Date(); cb.onStateChange(); } });
    return session;
  });
  return { manager, bot, callbacks: () => callbacks, spawns: () => spawns, quits: () => quits };
}
function socket(id: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const outbound: unknown[] = [];
  const value = { id, on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler), emit: (...args: unknown[]) => outbound.push(args) };
  return { value, handlers, outbound };
}

test('viewer disconnect preserves the bot/task and a new viewer receives a bounded current snapshot', async () => {
  const f = fixture();
  const saved = handle();
  const created = f.manager.createSession(config, saved);
  assert.ok(created.ok);
  const session = created.value.session;
  session.spawn();
  session.state = 'task'; session.currentTask = 'follow'; session.taskTarget = 'Alex';
  const first = observer();
  assert.ok(f.manager.attachViewer(saved, 'old-socket', first.value).ok);
  f.manager.detachViewer('old-socket');
  assert.equal(f.manager.sessionCount, 1);
  assert.equal(f.quits(), 0);
  assert.equal(session.currentTask, 'follow');
  for (let i = 0; i < 250; i++) f.callbacks().onChat({ username: 'Alex', message: String(i), timestamp: i });
  for (let i = 0; i < 200; i++) f.callbacks().onEvent({ type: 'info', message: String(i), timestamp: i });
  f.callbacks().onArmor([{ slot: 'head', name: 'iron_helmet', displayName: 'Iron Helmet' }]);
  const resumed = f.manager.attachViewer(saved, 'new-socket', observer().value);
  assert.ok(resumed.ok);
  assert.equal(resumed.value.info.sessionId, saved.sessionId);
  assert.equal(resumed.value.info.currentTask, 'follow');
  assert.equal(typeof resumed.value.info.spawnedAt, 'string');
  assert.equal(resumed.value.chats.length, 200);
  assert.equal(resumed.value.chats[0].message, '50');
  assert.equal(resumed.value.events.length, 150);
  assert.equal(resumed.value.armor[0].name, 'iron_helmet');
  assert.equal(first.received.length, 0);
  assert.equal(f.spawns(), 1);
  f.manager.stopSession('new-socket', saved.sessionId);
  await flush();
});

test('public bot ID alone cannot attach, issue commands, or stop another bot', () => {
  const f = fixture(); const saved = handle();
  f.manager.createSession(config, saved);
  assert.equal(f.manager.attachViewer({ ...saved, accessToken: '0'.repeat(64) }, 'attacker', observer().value).ok, false);
  assert.equal(f.manager.attachViewer(saved.sessionId as never, 'attacker', observer().value).ok, false);
  assert.equal(f.manager.getSessionForViewer('attacker', saved.sessionId), undefined);
  assert.equal(f.manager.stopSession('attacker', saved.sessionId).ok, false);
  assert.equal(f.manager.setPlayersSubscribed('attacker', saved.sessionId, true).ok, false);
  f.manager.attachViewer(saved, 'owner', observer().value);
  f.manager.stopSession('owner', saved.sessionId);
});

test('role edits broadcast to attached viewers and survive detach/resume without changing task state', () => {
  const f = fixture(); const saved = handle();
  const created = f.manager.createSession(config, saved); assert.ok(created.ok);
  const a = observer(); const b = observer();
  a.value.onAccess = (snapshot) => a.received.push(snapshot);
  b.value.onAccess = (snapshot) => b.received.push(snapshot);
  f.manager.attachViewer(saved, 'a', a.value); f.manager.attachViewer(saved, 'b', b.value);
  assert.ok(created.value.session.updatePlayerRole({ username:'Steve123', role:'crew', expectedRevision:0 }).ok);
  assert.ok(a.received.some((value: any) => value.revision === 1));
  assert.ok(b.received.some((value: any) => value.revision === 1));
  f.manager.detachViewer('a'); f.manager.detachViewer('b');
  const resumed = f.manager.attachViewer(saved, 'c', observer().value); assert.ok(resumed.ok);
  assert.equal(resumed.value.access.revision, 1);
  assert.deepEqual(resumed.value.access.assignments, [{ username:'Steve123', role:'crew' }]);
  f.manager.stopSession('c', saved.sessionId);
});

test('player sampling follows viewer interest and stops only after the final subscriber detaches', () => {
  const f = fixture(); const saved = handle();
  const created = f.manager.createSession(config, saved); assert.ok(created.ok);
  const toggles: boolean[] = [];
  created.value.session.setPlayersSubscribed = (enabled) => { toggles.push(enabled); return { ok: true }; };
  const a = observer(); const b = observer();
  f.manager.attachViewer(saved, 'a', a.value); f.manager.attachViewer(saved, 'b', b.value);
  f.manager.setPlayersSubscribed('a', saved.sessionId, true);
  f.callbacks().onPlayers({ sessionId: saved.sessionId, players: [], updatedAt: 1 });
  assert.equal(a.received.length, 1); assert.equal(b.received.length, 0);
  f.manager.setPlayersSubscribed('b', saved.sessionId, true);
  assert.equal(b.received.length, 1);
  f.manager.detachViewer('a');
  assert.deepEqual(toggles, [true, true]);
  f.manager.detachViewer('b');
  assert.deepEqual(toggles, [true, true, false]);
  assert.equal(f.quits(), 0);
  f.manager.attachViewer(saved, 'owner', observer().value); f.manager.stopSession('owner', saved.sessionId);
});

test('explicit stop invalidates all viewers and retired create retries cannot resurrect the bot', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture(); const saved = handle();
  const created = f.manager.createSession(config, saved); assert.ok(created.ok);
  const session = created.value.session;
  session.spawn();
  let retries = 0;
  Object.assign(session, { createBot: () => { retries++; } });
  (session as unknown as { handleDisconnect(retry: boolean): void }).handleDisconnect(true);
  const a = observer(); const b = observer();
  f.manager.attachViewer(saved, 'a', a.value); f.manager.attachViewer(saved, 'b', b.value);
  assert.ok(f.manager.stopSession('a', saved.sessionId).ok);
  context.mock.timers.tick(60_000);
  assert.equal(retries, 0);
  assert.equal(f.manager.sessionCount, 0);
  assert.deepEqual(b.received.at(-1), { removed: saved.sessionId });
  assert.equal(f.manager.getSessionForViewer('b', saved.sessionId), undefined);
  assert.equal(f.manager.createSession(config, saved).ok, false);
  assert.equal(f.manager.attachViewer(saved, 'c', observer().value).ok, false);
  await flush();
});

test('idle expiry still retires a bot with no attached dashboard', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const saved = handle();
  const created = f.manager.createSession(config, saved); assert.ok(created.ok);
  created.value.session.spawn(); created.value.session.resetIdleTimer();
  context.mock.timers.tick(10 * 60 * 1000);
  assert.equal(f.manager.sessionCount, 0); assert.equal(f.quits(), 1);
});

test('socket adapter handles replayed creation, resume and detach without running a second bot', () => {
  const f = fixture(); const saved = handle(); const a = socket('a');
  registerSessionHandlers(a.value as never, f.manager);
  let result!: SessionResult<BotSessionSnapshot>;
  const reply = (value: SessionResult<BotSessionSnapshot>) => { result = value; };
  a.handlers.get('bot:create')!(config, saved, reply);
  assert.ok(result.ok); assert.equal(f.spawns(), 1);
  a.handlers.get('bot:create')!(config, saved, reply);
  assert.equal(f.spawns(), 1);
  a.handlers.get('disconnect')!();
  assert.equal(f.quits(), 0);
  const b = socket('b'); registerSessionHandlers(b.value as never, f.manager);
  b.handlers.get('bot:resume')!(saved, reply);
  assert.ok(result.ok); assert.equal(result.value.info.sessionId, saved.sessionId);
  b.handlers.get('bot:disconnect')!(saved.sessionId, () => {});
  assert.equal(f.quits(), 1); assert.equal(f.manager.sessionCount, 0);
  assert.ok(b.outbound.some((value) => Array.isArray(value) && value[0] === 'bot:removed'));
});

test('all socket command adapters require an authorized attached viewer', () => {
  const f = fixture(); const saved = handle();
  const created = f.manager.createSession(config, saved); assert.ok(created.ok);
  const session = created.value.session;
  let commands = 0;
  session.sendChat = () => { commands++; }; session.performAction = () => { commands++; return { ok: true }; };
  session.unequipAndDropArmor = async () => { commands++; };
  session.performPlayerCommand = () => { commands++; return { ok: true }; };
  const attacker = socket('attacker');
  registerSessionHandlers(attacker.value as never, f.manager); registerPlayerHandlers(attacker.value as never, f.manager);
  attacker.handlers.get('bot:chat')!(saved.sessionId, 'hello');
  attacker.handlers.get('bot:action')!(saved.sessionId, { type: 'stop' });
  attacker.handlers.get('bot:unequip')!(saved.sessionId, 'head');
  attacker.handlers.get('bot:playerAction')!(saved.sessionId, { type: 'follow', target: 'Alex' }, () => {});
  attacker.handlers.get('bot:disconnect')!(saved.sessionId, () => {});
  assert.equal(commands, 0); assert.equal(f.quits(), 0);
  f.manager.attachViewer(saved, 'owner', observer().value); f.manager.stopSession('owner', saved.sessionId);
});
