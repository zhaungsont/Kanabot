import assert from 'node:assert/strict';
import test from 'node:test';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { EquipmentService } from '../src/runtime/equipment.js';
import { ExcavateTask } from '../src/tasks/excavateTask.js';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

const region = { x1: 0, y1: 64, z1: 0, x2: 0, y2: 64, z2: 0 };
function fixture() {
  const f = fakeBot();
  const { bot } = f;
  const chats: string[] = [];
  bot.chat = message => { chats.push(message); };
  bot.inventory.items = () => [];
  Object.assign(bot, { heldItem: null });
  const block = (name = 'dirt', x = 0): Block => ({ name, position: new Vec3(x, 64, 0), diggable: name !== 'bedrock', digTime: () => 500 } as Block);
  bot.blockAt = () => block();
  bot.pathfinder.goto = async () => {};
  bot.canDigBlock = () => true;
  let digs = 0;
  bot.dig = async () => { digs++; };
  return { ...f, block, chats, digs: () => digs };
}

test('empty inventory excavates hand-diggable blocks and publishes a structured completion', async t => {
  const f = fixture();
  const { session } = fakeSession(f.bot);
  t.after(() => session.destroy());
  assert.equal(session.performAction('excavate', undefined, region).ok, true);
  await flush();
  assert.equal(f.digs(), 1);
  assert.equal(session.state, 'idle');
  assert.equal(session.getInfo().lastTaskOutcome?.status, 'completed');
  assert.deepEqual(session.getInfo().lastTaskOutcome?.excavation, { total: 1, dug: 1, alreadyClear: 0, skipped: 0, failed: 0, unvisited: 0 });
  assert.equal(f.chats.filter(message => message === 'Excavation complete!').length, 1);
});

test('unloaded, non-diggable, unreachable and failed blocks produce a partial result, never full success', async t => {
  const f = fixture();
  const { bot, block } = f;
  const { session, events } = fakeSession(bot);
  t.after(() => session.destroy());
  bot.blockAt = position => position.x === 2 ? null : block(position.x === 1 ? 'air' : position.x === 3 ? 'bedrock' : 'dirt', position.x);
  bot.pathfinder.goto = async goal => { if (Reflect.get(goal, 'x') === 4) throw new Error('no route'); };
  bot.dig = async target => { if (target.position.x === 5) throw new Error('dig denied'); };
  session.performAction('excavate', undefined, { ...region, x2: 5 });
  await flush();
  assert.equal(session.state, 'idle');
  assert.equal(session.getInfo().lastTaskOutcome?.status, 'partial');
  assert.deepEqual(session.getInfo().lastTaskOutcome?.excavation, { total: 6, dug: 1, alreadyClear: 1, skipped: 2, failed: 2, unvisited: 0 });
  assert.ok(events.some(e => e.type === 'warning' && /Excavation partial/.test(e.message)));
  assert.equal(f.chats.includes('Excavation complete!'), false);
});

test('failed digging cancellation blocks successors even after the dig promise drains', async t => {
  const f = fixture();
  const { bot } = f;
  const { session } = fakeSession(bot);
  t.after(() => session.destroy());
  let release!: () => void;
  bot.dig = () => new Promise<void>(resolve => { release = resolve; });
  Object.assign(bot, { targetDigBlock: f.block() });
  bot.stopDigging = () => Promise.reject(new Error('dig cancellation failed'));
  session.performAction('excavate', undefined, region);
  await flush();
  session.performAction('stop');
  assert.equal(session.performAction('follow', 'Alex').ok, false);
  release();
  await flush();
  assert.equal(session.getInfo().taskLifecycle?.phase, 'cleanup-failed');
  assert.equal(session.performAction('follow', 'Alex').ok, false);
  assert.equal(bot.listenerCount('game'), 0);
});

test('stopping before excavation startup performs no game work and settles once', async () => {
  const f = fixture();
  const task = new ExcavateTask(f.bot, region, { onEvent() {}, onProgress() {} }, new EquipmentService(f.bot));
  await task.stop();
  await assert.rejects(task.start(), /already started or stopped/);
  assert.equal((await task.completion).status, 'stopped');
  assert.equal(f.digs(), 0);
});

test('invalid runtime regions fail with cleanup and no successful completion', async () => {
  const f = fixture();
  const task = new ExcavateTask(f.bot, { ...region, x2: 10_000 }, { onEvent() {}, onProgress() {} }, new EquipmentService(f.bot));
  await task.start();
  assert.equal((await task.completion).status, 'failed');
  assert.equal(f.bot.listenerCount('death'), 0);
  assert.equal(f.digs(), 0);
});

test('late Stop on completed excavation cannot clear a successor movement goal', async t => {
  const f = fixture();
  const task = new ExcavateTask(f.bot, region, { onEvent() {}, onProgress() {} }, new EquipmentService(f.bot));
  await task.start();
  const { session } = fakeSession(f.bot);
  t.after(() => session.destroy());
  session.performAction('follow', 'Alex');
  await flush();
  const goal = f.calls.goals.at(-1);
  await task.stop();
  assert.equal(f.calls.goals.at(-1), goal);
  assert.notEqual(goal, null);
});

test('Stop arriving at natural teardown cannot start untracked cancellation work', async () => {
  const f = fixture();
  Object.assign(f.bot, { targetDigBlock: f.block() });
  let cancellations = 0;
  f.bot.stopDigging = () => { cancellations++; return new Promise<void>(() => {}); };
  const task = new ExcavateTask(f.bot, region, { onEvent() {}, onProgress() {} }, new EquipmentService(f.bot));
  const lateStop = task.cleanupStarted.then(() => task.stop());
  await task.start();
  await lateStop;
  assert.equal(cancellations, 0);
  assert.equal((await task.completion).status, 'completed');
});
