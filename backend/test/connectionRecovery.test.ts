import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { BotSession } from '../src/botSession.js';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

test('early error retains the captured connection and blocks replacement until end confirms termination', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { bot } = fakeBot();
  const { session, events } = fakeSession(bot);
  t.after(() => session.destroy());
  let quits = 0, ends = 0, destroys = 0, replacements = 0;
  bot.quit = () => { quits++; };
  bot.end = () => { ends++; };
  Object.assign(bot, { _client: Object.assign(new EventEmitter(), { socket: { destroy: () => { destroys++; } } }) });
  Reflect.set(session, 'createBot', () => { replacements++; });
  session.state = 'spawning';
  Reflect.get(session, 'setupBotEvents').call(session);
  bot.emit('error', Object.assign(new Error('early network error'), { code: 'ECONNRESET' }));
  t.mock.timers.tick(500);
  assert.equal(quits, 1);
  assert.equal(Reflect.get(session, 'bot'), bot);
  assert.equal(session.state, 'disconnected');
  t.mock.timers.tick(30_000);
  assert.equal(ends, 0); // Destroy the existing socket without starting another protocol close timer.
  assert.equal(destroys, 1);
  assert.equal(replacements, 0);
  assert.ok(events.some(event => /termination is unconfirmed/.test(event.message)));
  bot.emit('end', 'confirmed closed');
  await flush();
  assert.equal(Reflect.get(session, 'bot'), null);
  t.mock.timers.tick(4_999);
  assert.equal(replacements, 0);
  t.mock.timers.tick(1);
  assert.equal(replacements, 1);
});

test('retirement during pending connection teardown prevents a late end from scheduling retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { bot, raw } = fakeBot();
  const { session } = fakeSession(bot);
  let quits = 0, lateEnds = 0, replacements = 0;
  bot.quit = () => { quits++; };
  bot.end = () => { lateEnds++; };
  Reflect.set(session, 'createBot', () => { replacements++; });
  session.state = 'spawning';
  Reflect.get(session, 'setupBotEvents').call(session);
  bot.emit('error', new Error('early error'));
  t.mock.timers.tick(500);
  session.destroy();
  raw.emit('connect'); // A late DNS/connect callback must still close the old connection.
  assert.equal(lateEnds, 1);
  assert.equal(quits, 1);
  bot.emit('end', 'late end');
  await flush();
  t.mock.timers.tick(60_000);
  assert.equal(replacements, 0);
  assert.equal(Reflect.get(session, 'bot'), null);
});

test('connection replacement cancels stale error and greeting timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { bot } = fakeBot();
  const { session } = fakeSession(bot);
  const replacement = fakeBot();
  let greetings = 0;
  replacement.bot.chat = () => { greetings++; };
  t.after(() => session.destroy());
  session.state = 'spawning';
  Reflect.get(session, 'setupBotEvents').call(session);
  bot.emit('chat', 'Alex', 'hi bot');
  bot.emit('error', new Error('old error'));
  session.disconnect();
  await flush();
  Reflect.set(session, 'bot', replacement.bot);
  session.state = 'spawning';
  Reflect.get(session, 'setupBotEvents').call(session);
  t.mock.timers.tick(500);
  assert.equal(session.state, 'spawning');
  assert.equal(Reflect.get(session, 'bot'), replacement.bot);
  assert.equal(greetings, 0);
});

test('partial plugin initialization failure closes the captured bot before dropping its reference', async () => {
  const { bot } = fakeBot();
  let quits = 0;
  Object.assign(bot, { loadPlugin: () => { throw new Error('plugin initialization failed'); } });
  bot.quit = () => { quits++; bot.emit('end', 'quit'); };
  const session = new BotSession('test-session', { serverHost: 'example.test', botName: 'mc_bot' }, {
    onChat() {}, onEvent() {}, onStateChange() {}, onDestroy() {}, onArmor() {}, onPlayers() {},
  }, () => bot);
  session.spawn();
  assert.equal(quits, 1);
  await flush();
  assert.equal(Reflect.get(session, 'bot'), null);
  assert.equal(session.state, 'disconnected');
  session.destroy();
});
