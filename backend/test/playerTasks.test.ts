import assert from 'node:assert/strict';
import test from 'node:test';
import { FollowTask } from '../src/tasks/followTask.js';
import { AttackTask } from '../src/tasks/attackTask.js';
import type { PlayerTaskOutcome } from '../src/tasks/trackedPlayerTask.js';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

test('follow uses one dynamic goal, bounded searches, and restores settings on stop', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { bot, calls, raw, alex } = fakeBot();
  const original = bot.pathfinder.movements;
  const task = new FollowTask(bot, 'Alex', () => {});
  await task.start();
  alex.entity.position.x++;
  context.mock.timers.tick(3_000);
  assert.equal(calls.goals.length, 1);
  assert.equal(raw.pathfinder.searchRadius, 64);
  assert.equal(raw.pathfinder.movements.canDig, false);
  await task.stop();
  assert.equal(raw.pathfinder.searchRadius, -1);
  assert.equal(bot.pathfinder.movements, original);
  assert.equal(bot.listenerCount('path_update'), 0);
  assert.equal(bot.listenerCount('playerLeft'), 0);
});

for (const scenario of ['logout', 'entityGone', 'entityDead', 'dimension', 'noPath', 'timeout', 'unloaded', 'distance'] as const) {
  test(`follow stops cleanly on ${scenario}`, async (context) => {
    context.mock.timers.enable({ apis: ['setInterval', 'Date'] });
    const { bot, raw, alex } = fakeBot();
    const outcomes: PlayerTaskOutcome[] = [];
    const task = new FollowTask(bot, 'Alex', (outcome) => outcomes.push(outcome));
    await task.start();
    if (scenario === 'logout') bot.emit('playerLeft', alex);
    if (scenario === 'entityGone') bot.emit('entityGone', alex.entity);
    if (scenario === 'entityDead') bot.emit('entityDead', alex.entity);
    if (scenario === 'dimension') { raw.game.dimension = 'the_nether'; bot.emit('game'); }
    if (scenario === 'noPath' || scenario === 'timeout') {
      bot.emit('path_update', { status: scenario, cost: 0, time: 0, visitedNodes: 0, generatedNodes: 0, path: [] });
    }
    if (scenario === 'unloaded') { raw.blockAt = () => null; context.mock.timers.tick(1_000); }
    if (scenario === 'distance') { alex.entity.position.x = 100; context.mock.timers.tick(1_000); }
    await flush();
    assert.equal(outcomes.length, 1);
    assert.match(outcomes[0].message, /stopped/i);
    assert.equal(bot.listenerCount('entityGone'), 0);
    await task.stop();
  });
}

test('follow stops after 30 seconds without progress; nearby stationary follow remains active', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000 });
  const { bot, alex } = fakeBot();
  const outcomes: PlayerTaskOutcome[] = [];
  const stalled = new FollowTask(bot, 'Alex', (outcome) => outcomes.push(outcome));
  await stalled.start();
  context.mock.timers.tick(30_000);
  await flush();
  assert.equal(outcomes.length, 1);
  assert.match(outcomes[0].message, /progress/);
  alex.entity.position.x = 2;
  const nearby = new FollowTask(bot, 'Alex', (outcome) => outcomes.push(outcome));
  await nearby.start();
  context.mock.timers.tick(60_000);
  await flush();
  assert.equal(outcomes.length, 1);
  await nearby.stop();
});

test('attack canceled during equipment startup never attacks after cancellation', async () => {
  const { bot, raw, calls } = fakeBot();
  raw.inventory.items = () => [{ name: 'diamond_sword' }];
  let release!: () => void;
  raw.equip = () => new Promise<void>((resolve) => { release = resolve; });
  const originalMovements = bot.pvp.movements;
  const task = new AttackTask(bot, 'Alex', () => {});
  const beginning = task.start();
  await flush();
  const ending = task.stop();
  release();
  await Promise.all([beginning, ending]);
  assert.equal(calls.attacks.length, 0);
  assert.equal(bot.pvp.movements, originalMovements);
});

test('immediate cancellation before attack startup preserves combat settings', async () => {
  const { bot, calls } = fakeBot();
  const originalMovements = bot.pvp.movements;
  const task = new AttackTask(bot, 'Alex', () => {});
  const beginning = task.start();
  await task.stop();
  await beginning;
  assert.equal(bot.pvp.movements, originalMovements);
  assert.equal(calls.attacks.length, 0);
});

test('session blocks every new task until pending attack startup and cleanup complete', async () => {
  const { bot, raw, calls } = fakeBot();
  const { session, events } = fakeSession(bot);
  let release!: () => void;
  raw.pvp.attack = async (entity) => {
    await new Promise<void>((resolve) => { release = resolve; });
    calls.attacks.push(entity);
  };
  assert.deepEqual(session.performPlayerCommand({ type: 'attack', target: 'Alex' }), { ok: true });
  await flush();
  session.performAction('stop');
  assert.equal(session.performPlayerCommand({ type: 'follow', target: 'Alex' }).ok, false);
  session.performAction('guard', 'Alex');
  assert.equal(session.currentTask, null);
  assert.match(events.at(-1)!.message, /still stopping/);
  release();
  await flush();
  assert.equal(calls.stops, 1);
  assert.deepEqual(session.performPlayerCommand({ type: 'follow', target: 'Alex' }), { ok: true });
  session.disconnect();
  await flush();
});

test('session rejects creative-mode attack and unavailable targets before claiming task state', () => {
  const { bot, alex } = fakeBot();
  const { session } = fakeSession(bot);
  alex.gamemode = 1;
  assert.equal(session.performPlayerCommand({ type: 'attack', target: 'Alex' }).ok, false);
  assert.equal(session.performPlayerCommand({ type: 'follow', target: 'FarAway' }).ok, false);
  assert.equal(session.state, 'idle');
  session.disconnect();
});

test('asynchronous attack failure reports error and releases session task state', async () => {
  const { bot, raw } = fakeBot();
  const { session, events } = fakeSession(bot);
  raw.pvp.attack = async () => { throw new Error('combat plugin failed'); };
  session.performPlayerCommand({ type: 'attack', target: 'Alex' });
  await flush();
  assert.equal(session.state, 'idle');
  assert.equal(session.currentTask, null);
  assert.ok(events.some((event) => event.type === 'error' && /combat plugin failed/.test(event.message)));
  session.disconnect();
});
