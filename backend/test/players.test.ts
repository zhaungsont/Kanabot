import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { collectPlayers, minecraftSkinUrl, PlayerRoster } from '../src/players/playerRoster.js';
import { resolvePlayerTarget } from '../src/players/playerTarget.js';
import { registerPlayerHandlers, validPlayerCommand } from '../src/players/playerHandlers.js';
import { whisperToPlayer } from '../src/players/whisper.js';
import type { BotManager } from '../src/botManager.js';
import { fakeBot, fakeSession } from './playerFixtures.js';

test('roster includes untracked players without inventing position or health', () => {
  const { bot } = fakeBot();
  const players = collectPlayers(bot);
  assert.equal(players.length, 3);
  const far = players.find((player) => player.username === 'FarAway')!;
  assert.equal(far.visible, false);
  assert.equal(far.position, null);
  assert.equal(far.health, null);
  assert.equal(far.canTarget, false);
  assert.match(far.targetUnavailableReason!, /dimension/);
  const alex = players.find((player) => player.username === 'Alex')!;
  assert.equal(alex.health, null);
  assert.deepEqual(alex.position, { x: 10, y: 64, z: 0, dimension: 'overworld' });
  assert.equal(alex.skinUrl, 'https://textures.minecraft.net/texture/abcdef');
  assert.equal(JSON.parse(JSON.stringify(players))[0].username, 'Alex');
});

test('health uses named metadata only when actually supplied, including zero', () => {
  const { bot, alex } = fakeBot();
  alex.entity.metadata[1] = 0 as unknown as object;
  const player = collectPlayers(bot).find((entry) => entry.username === 'Alex')!;
  assert.deepEqual(player.health, { value: 0, maximum: null, source: 'metadata' });
  alex.entity.metadata[1] = NaN as unknown as object;
  assert.equal(collectPlayers(bot).find((entry) => entry.username === 'Alex')!.health, null);
});

test('hunger and saturation project only the bot self state, preserving zero and unknown values', () => {
  const { bot, alex } = fakeBot();
  Object.assign(bot, { food: 7, foodSaturation: 2.5 });
  Object.assign(alex.entity!, { food: 20, foodSaturation: 10 }); // Not a standard remote-player contract.
  const players = collectPlayers(bot);
  assert.deepEqual(players.find(p => p.isBot)?.hunger, { value: 7, maximum: 20, saturation: 2.5, source: 'self' });
  assert.ok(players.filter(p => !p.isBot).every(p => p.hunger === null));
  Object.assign(bot, { food: 0, foodSaturation: 0 });
  assert.equal(collectPlayers(bot).find(p => p.isBot)?.hunger?.saturation, 0);
  Object.assign(bot, { foodSaturation: NaN });
  assert.equal(collectPlayers(bot).find(p => p.isBot)?.hunger?.saturation, null);
  Object.assign(bot, { food: undefined });
  assert.equal(collectPlayers(bot).find(p => p.isBot)?.hunger, null);
});

test('hunger updates reuse lazy roster sampling and stop when collapsed', context => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const { bot } = fakeBot(); Object.assign(bot, { food: 20, foodSaturation: 5 });
  let published = 0; const roster = new PlayerRoster(bot, () => { published++; });
  roster.setSubscribed(true); bot.food = 19;
  context.mock.timers.tick(2_999); assert.equal(published, 1);
  context.mock.timers.tick(1); assert.equal(published, 2);
  roster.setSubscribed(false); bot.food = 10; context.mock.timers.tick(9_000);
  assert.equal(published, 2); roster.dispose();
});

test('stale entity references do not leak old coordinates after leaving tracking range', () => {
  const { bot } = fakeBot();
  delete bot.entities[2];
  assert.equal(collectPlayers(bot).find((player) => player.username === 'Alex')!.position, null);
});

test('skin URL accepts only Minecraft textures and upgrades HTTP', () => {
  for (const url of ['https://example.com/skin', 'javascript:alert(1)', 'https://textures.minecraft.net.evil.test/texture/abc', 'https://user:pass@textures.minecraft.net/texture/abc']) {
    assert.equal(minecraftSkinUrl(url), null);
  }
  assert.equal(minecraftSkinUrl('http://textures.minecraft.net/texture/abc'), 'https://textures.minecraft.net/texture/abc');
});

test('targets reject self, other dimensions, missing chunks, distance, and logout', () => {
  const { bot, alex, raw } = fakeBot();
  assert.equal(resolvePlayerTarget(bot, 'alex').ok, true);
  assert.equal(resolvePlayerTarget(bot, 'mc_bot').ok, false);
  alex.entity.position.x = 65;
  assert.equal(resolvePlayerTarget(bot, 'Alex').ok, false);
  alex.entity.position.x = 10;
  raw.blockAt = () => null;
  assert.match((resolvePlayerTarget(bot, 'Alex') as { error: string }).error, /chunk/);
  raw.blockAt = () => ({ name: 'air' });
  Object.assign(alex.entity, { dimension: 'the_nether' });
  assert.equal(resolvePlayerTarget(bot, 'Alex').ok, false);
  delete bot.players.Alex;
  assert.equal(resolvePlayerTarget(bot, 'Alex').ok, false);
});

test('roster does no background work when disabled and suppresses unchanged snapshots', (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const { bot, alex } = fakeBot();
  const snapshots: unknown[] = [];
  let reads = 0;
  const original = bot.players;
  Object.defineProperty(bot, 'players', { get: () => { reads++; return original; } });
  const roster = new PlayerRoster(bot, (snapshot) => snapshots.push(snapshot));
  context.mock.timers.tick(9_000);
  assert.equal(reads, 0);
  roster.setSubscribed(true);
  roster.setSubscribed(true);
  assert.equal(snapshots.length, 1);
  context.mock.timers.tick(3_000);
  assert.equal(snapshots.length, 1);
  alex.entity.position.x++;
  context.mock.timers.tick(3_000);
  assert.equal(snapshots.length, 2);
  roster.setSubscribed(false);
  const stoppedReads = reads;
  context.mock.timers.tick(30_000);
  assert.equal(reads, stoppedReads);
  roster.dispose();
});

test('rapid subscription toggles reuse the cached snapshot within the sampling budget', (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const { bot, alex } = fakeBot();
  const snapshots: { players: unknown[]; updatedAt: number }[] = [];
  const roster = new PlayerRoster(bot, (snapshot) => snapshots.push(snapshot));
  roster.setSubscribed(true);
  roster.setSubscribed(false);
  alex.entity.position.x++;
  roster.setSubscribed(true);
  assert.equal(snapshots[0], snapshots[1]);
  roster.dispose();
});

test('whisper uses private /tell even when target is not tracked', () => {
  const { bot, calls } = fakeBot();
  assert.deepEqual(whisperToPlayer(bot, 'FarAway', ' hello '), { ok: true });
  assert.deepEqual(calls.whispers, [['FarAway', 'hello']]);
  for (const message of ['\n/kill', 'hello\r/kill', ' ', 'x'.repeat(201)]) {
    assert.equal(whisperToPlayer(bot, 'Alex', message).ok, false);
  }
  assert.equal(whisperToPlayer(bot, 'Alex /kill', 'hi').ok, false);
  assert.equal(calls.whispers.length, 1);
});

test('player transport rejects cross-session access and malformed commands', () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = Object.assign(new EventEmitter(), { id: 'attacker' });
  socket.on = ((event: string, callback: (...args: unknown[]) => void) => {
    handlers.set(event, callback); return socket;
  }) as typeof socket.on;
  let calls = 0;
  const manager = { getSessionForViewer: (_viewer: string, id: unknown) => id === 'attacker' ? { sessionId: 'attacker', performPlayerCommand: () => { calls++; return { ok: true }; } } : undefined };
  registerPlayerHandlers(socket as never, manager as unknown as BotManager);
  let outcome: unknown;
  handlers.get('bot:playerAction')!('victim', { type: 'attack', target: 'Alex' }, (result: unknown) => { outcome = result; });
  assert.deepEqual(outcome, { ok: false, error: 'Session not found or not owned by this connection.' });
  handlers.get('bot:players:subscribe')!('victim', true, () => {});
  handlers.get('bot:playerAction')!('attacker', { type: 'attack', target: 123 }, () => {});
  assert.equal(calls, 0);
  assert.equal(validPlayerCommand({ type: 'whisper', target: 'Alex', message: 'hello\n/kill' }), false);
});

test('whispers stay labeled private in the dashboard and do not replace active tasks', () => {
  const { bot } = fakeBot();
  const { session, chats } = fakeSession(bot);
  session.state = 'task';
  session.currentTask = 'protect';
  assert.deepEqual(session.performPlayerCommand({ type: 'whisper', target: 'Alex', message: 'hello' }), { ok: true });
  assert.equal(session.currentTask, 'protect');
  assert.equal((chats[0] as { channel: string }).channel, 'whisper');
  session.disconnect();
});
