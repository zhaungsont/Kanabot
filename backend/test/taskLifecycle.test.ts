import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

for (const trigger of ['stop', 'path failure'] as const) {
  test(`failed Attack cleanup after ${trigger} retains the lease and blocks every successor`, async t => {
    const { bot, raw } = fakeBot();
    const { session, events } = fakeSession(bot);
    t.after(() => session.destroy());
    const movements = bot.pathfinder.movements;
    const originalStop = bot.pvp.stop;
    assert.equal(session.performAction('attack', 'Alex').ok, true);
    await flush();
    raw.pvp.forceStop = () => { throw new Error('simulated stop failure'); };
    if (trigger === 'stop') session.performAction('stop');
    else bot.emit('path_update', { status: 'noPath' } as never);
    await flush();
    assert.equal(session.getInfo().taskLifecycle?.phase, 'cleanup-failed');
    assert.equal(session.state, 'task');
    assert.equal(session.currentTask, 'attack');
    assert.notEqual(bot.pvp.stop, originalStop); // The unresolved adapter cannot leak into a successor.
    assert.equal(bot.pathfinder.movements, movements); // Independent restorations still run.
    assert.equal(bot.listenerCount('path_update'), 0);
    for (const type of ['follow', 'attack', 'protect'] as const) assert.equal(session.performAction(type, 'Alex').ok, false);
    assert.equal(session.performAction('excavate', undefined, { x1: 0, y1: 64, z1: 0, x2: 0, y2: 64, z2: 0 }).ok, false);
    assert.equal(session.getInfo().lastTaskOutcome, undefined);
    assert.equal(events.filter(e => /cleanup is unconfirmed/.test(e.message)).length, 1);
  });
}

test('Follow restoration failure also retains ownership until retirement', async t => {
  const { bot } = fakeBot();
  const { session } = fakeSession(bot);
  t.after(() => session.destroy());
  session.performAction('follow', 'Alex');
  await flush();
  bot.pathfinder.setMovements = () => { throw new Error('movement restoration failed'); };
  session.performAction('stop');
  await flush();
  assert.equal(session.getInfo().taskLifecycle?.phase, 'cleanup-failed');
  assert.equal(session.performAction('attack', 'Alex').ok, false);
});

test('a pending cleanup deadline never releases the task; late confirmed cleanup permits a successor', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { bot, raw, calls } = fakeBot();
  const { session } = fakeSession(bot);
  t.after(() => session.destroy());
  let release!: () => void;
  raw.pvp.attack = async entity => {
    await new Promise<void>(resolve => { release = resolve; });
    bot.pvp.target = entity as never;
  };
  session.performAction('attack', 'Alex');
  await flush();
  session.performAction('stop');
  assert.equal(session.currentTask, 'attack');
  assert.equal(session.getInfo().taskLifecycle?.phase, 'stopping');
  t.mock.timers.tick(10_000);
  assert.equal(session.getInfo().taskLifecycle?.phase, 'cleanup-failed');
  assert.equal(session.performAction('follow', 'Alex').ok, false);
  release();
  await flush();
  assert.equal(bot.pvp.target, undefined);
  assert.ok(calls.stops > 0);
  assert.equal(session.getInfo().lastTaskOutcome?.status, 'stopped');
  assert.equal(session.getInfo().taskLifecycle, undefined);
  assert.equal(session.performAction('follow', 'Alex').ok, true);
});

test('partial synchronous startup failure drains and restores settings before returning idle', async t => {
  const { bot } = fakeBot();
  const { session } = fakeSession(bot);
  t.after(() => session.destroy());
  const original = bot.pathfinder.movements;
  const setMovements = bot.pathfinder.setMovements.bind(bot.pathfinder);
  let first = true;
  bot.pathfinder.setMovements = movements => {
    if (first) { first = false; throw new Error('startup movement failure'); }
    setMovements(movements);
  };
  session.performAction('follow', 'Alex');
  await flush();
  assert.equal(session.state, 'idle');
  assert.equal(session.getInfo().lastTaskOutcome?.status, 'failed');
  assert.equal(bot.pathfinder.movements, original);
  assert.equal(session.performAction('follow', 'Alex').ok, true);
});
