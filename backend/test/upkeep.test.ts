import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import type { Item } from 'prismarine-item';
import { EatUtil } from 'mineflayer-auto-eat/dist/new.js';
import { EquipmentService, EquipmentIntent, type EquipmentOwner, type HandRequirement } from '../src/runtime/equipment.js';
import { Upkeep, validUpkeep } from '../src/upkeep/upkeep.js';
import { FollowTask } from '../src/tasks/followTask.js';
import { AttackTask } from '../src/tasks/attackTask.js';
import { ProtectTask } from '../src/tasks/protect/protectTask.js';
import { ExcavateTask } from '../src/tasks/excavateTask.js';
import { IdleBehaviors } from '../src/behaviors/idleBehaviors.js';
import { defaultBehaviors } from '../src/behaviors/settings.js';
import { registerSessionHandlers } from '../src/sessions/sessionHandlers.js';
import { excavationWorld } from './excavationFixtures.js';
import { Vec3 } from 'vec3';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

function clock(t: TestContext) {
  let now = 0; t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  return { now: () => now, async step(ms: number) { now += ms; t.mock.timers.tick(ms); for (let i = 0; i < 5; i++) await flush(); } };
}
function fixture() {
  const f = fakeBot(); const { bot } = f;
  const weapon = { name: 'iron_sword', type: 1, metadata: 0, slot: 36, enchants: [], maxDurability: 250, durabilityUsed: 0 } as unknown as Item;
  const food = { name: 'apple', type: 2, metadata: 0, slot: 12 } as Item;
  const slots: (Item | null)[] = Array(46).fill(null); slots[36] = weapon; slots[12] = food;
  const inventory = Object.assign(new EventEmitter(), { slots, items: () => slots.filter((i, slot) => slot >= 9 && !!i) as Item[] });
  Object.assign(bot, { inventory, heldItem: weapon, food: 7, foodSaturation: 2, _client: new EventEmitter(),
    util: { inv: { getAllItems: () => inventory.items(), getHandWithItem: () => bot.heldItem, getHand: () => 'hand',
      customEquip: async (item: Item) => { Object.assign(bot, { heldItem: item }); return true; } } },
    activateItem: () => {}, deactivateItem: () => {},
  });
  Object.assign(bot.registry, { foodsByName: { apple: { foodPoints: 4 } } });
  bot.equip = async (item, slot) => {
    if (typeof item === 'number' || !slot) throw new Error('Fixture requires a concrete item and slot.');
    if (slot === 'hand') Object.assign(bot, { heldItem: item });
    else { const index = bot.getEquipmentDestSlot(slot); inventory.slots[item.slot] = null; inventory.slots[index] = item; item.slot = index; }
  };
  const equipment = new EquipmentService(bot);
  return { ...f, food, weapon, slots, equipment };
}
function owner(requirement: HandRequirement) {
  let pauses = 0, resumes = 0, paused = false;
  const intent = new EquipmentIntent(); intent.publish(requirement);
  const value: EquipmentOwner = { equipmentIntent: intent, active: true,
    pauseForUpkeep: async () => { pauses++; paused = true; return true; },
    resumeAfterUpkeep: async () => { resumes++; paused = false; } };
  return { value, intent, pauses: () => pauses, resumes: () => resumes, paused: () => paused };
}

test('upkeep validates only the two opt-in booleans', () => {
  assert.ok(validUpkeep({ autoEat: false, autoArmor: true }));
  for (const input of [{ autoEat: true }, { autoEat: 'yes', autoArmor: false }, { autoEat: true, autoArmor: false, extra: true }]) assert.equal(validUpkeep(input), false);
});
test('generic task yields, eats, and restores its updated specific-item requirement before resuming', async t => {
  const c = clock(t); const { bot, food, weapon, slots, equipment } = fixture();
  const required = { ...weapon, name: 'diamond_pickaxe', type: 3, slot: 37 } as Item; slots[37] = required;
  const task = owner({ kind: 'best', policy: 'melee' }); let meals = 0;
  task.value.resumeAfterUpkeep = async () => { assert.equal(bot.heldItem, required); };
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, () => {}, () => {},
    { eat: async () => { meals++; assert.equal(task.paused(), true); Object.assign(bot, { heldItem: food }); task.intent.publish({ kind: 'specific', item: required }); bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000);
  assert.equal(meals, 1); assert.equal(bot.heldItem, required); assert.equal(task.pauses(), 1); assert.equal(runtime.busy, false);
});
test('newly registered tool policy works without a task-name branch in food upkeep', async t => {
  const c = clock(t); const { bot, food, weapon, slots, equipment } = fixture();
  const required = { ...weapon, name: 'custom_tool', type: 4, slot: 37 } as Item; slots[37] = required;
  equipment.registerPolicy('new-task-policy', () => required);
  const task = owner({ kind: 'best', policy: 'new-task-policy' });
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, () => {}, () => {},
    { eat: async () => { Object.assign(bot, { heldItem: food }); bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000);
  assert.equal(bot.heldItem, required); assert.equal(task.resumes(), 1);
});
test('empty hand restoration is non-destructive and unknown required items block task resumption', async t => {
  const c = clock(t); const { bot, equipment } = fixture();
  const task = owner({ kind: 'empty' });
  bot.setQuickBarSlot = () => { Object.assign(bot, { heldItem: null }); };
  await equipment.restore(task.value, new AbortController().signal); assert.equal(bot.heldItem, null);
  task.intent.publish({ kind: 'best', policy: 'unregistered' });
  await assert.rejects(equipment.restore(task.value, new AbortController().signal), /Unknown equipment/);
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, () => {}, () => {},
    { eat: async () => { bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(task.resumes(), 0);
});
test('Follow and armor can run concurrently without clearing its goal; manual slot override is respected', async t => {
  const c = clock(t); const { bot, slots, equipment, calls } = fixture();
  const helmet = { name: 'diamond_helmet', type: 5, slot: 10, enchants: [] } as unknown as Item; slots[10] = helmet;
  const task = new FollowTask(bot, 'Alex', () => {}, equipment); await task.start();
  const goals = calls.goals.length;
  const runtime = new Upkeep(bot, { autoEat: false, autoArmor: true }, equipment, () => task, () => true, () => {}, () => {}, null, c.now);
  t.after(async () => { runtime.dispose(); await task.stop(); }); await c.step(1_000);
  assert.equal(slots[5], helmet); assert.equal(calls.goals.length, goals);
  equipment.armorOverrides.add('feet'); slots[11] = { name: 'diamond_boots', type: 6, slot: 11 } as Item;
  await c.step(6_000); assert.equal(slots[8], null);
});
test('Follow pauses for food and resumes its dynamic goal with the original valid held item', async t => {
  const c = clock(t); const { bot, food, weapon, equipment, calls } = fixture();
  const task = new FollowTask(bot, 'Alex', () => {}, equipment); await task.start();
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task, () => true, () => {}, () => {},
    { eat: async () => { Object.assign(bot, { heldItem: food }); bot.food = 20; } }, c.now);
  t.after(async () => { runtime.dispose(); await task.stop(); }); await c.step(1_000);
  assert.equal(bot.heldItem, weapon); assert.equal(task.active, true); assert.notEqual(calls.goals.at(-1), null);
});
for (const type of ['attack', 'protect'] as const) test(`${type} yields combat and restores the best current weapon before re-engaging`, async t => {
  const c = clock(t); const { bot, food, weapon, slots, equipment } = fixture();
  const task = type === 'attack' ? new AttackTask(bot, 'Alex', () => {}, equipment) : new ProtectTask(bot, 'Alex', () => {}, () => {}, undefined, c.now, equipment);
  await task.start(); await c.step(0);
  const better = { ...weapon, name: 'diamond_sword', type: 7, slot: 37 } as Item;
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task, () => true, () => {}, () => {},
    { eat: async () => { assert.equal(bot.pvp.target, undefined); Object.assign(bot, { heldItem: food }); slots[37] = better; bot.food = 20; } }, c.now);
  t.after(async () => { runtime.dispose(); await task.stop(); }); await c.step(1_000); await c.step(100);
  assert.equal(bot.heldItem, better); assert.equal(task.active, true); assert.equal(runtime.busy, false);
});
test('cancellation during a pending meal retains ownership and cannot restart a stopped task', async t => {
  const c = clock(t); const { bot, food, equipment } = fixture(); const task = owner({ kind: 'best', policy: 'melee' });
  let release!: () => void;
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value.active ? task.value : null, () => true, () => {}, () => {},
    { eat: async () => { Object.assign(bot, { heldItem: food }); await new Promise<void>(r => { release = r; }); } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(runtime.prepareForTask(), false);
  Reflect.set(task.value, 'active', false); release(); await c.step(0);
  assert.equal(task.resumes(), 0); assert.equal(runtime.busy, false);
});
test('missing weapon after food blocks the task and recovers after a supply appears', async t => {
  const c = clock(t); const { bot, slots, food, equipment, weapon } = fixture(); const task = owner({ kind: 'best', policy: 'melee' });
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, () => {}, () => {},
    { eat: async () => { slots[36] = null; Object.assign(bot, { heldItem: food }); bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(task.resumes(), 0);
  slots[36] = weapon; await c.step(6_000); assert.equal(task.resumes(), 1); assert.equal(bot.heldItem, weapon);
});
test('late food plugin injection initializes in upkeep and logs a confirmed meal outcome', async t => {
  const c = clock(t); const { bot, equipment } = fixture(); const logs: string[] = [];
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => null, () => true, () => {}, message => logs.push(message), undefined, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(runtime.busy, false);
  bot.autoEat = new EatUtil(bot); await c.step(1_000); assert.equal(bot.autoEat.isEating, true);
  bot.food = 20; bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 9 }); await c.step(0);
  assert.ok(logs.includes('Auto-eat completed.')); assert.equal(runtime.busy, false);
});
test('Idle Behaviors never schedules legacy auto-eat and drowning remains strictly idle-only', async t => {
  const c = clock(t); const { bot, calls } = fixture(); let idle = false;
  const settings = defaultBehaviors(); settings.autoEat = true; settings.avoidDrowning = true;
  Object.assign(bot, { oxygenLevel: 0 });
  const runtime = new IdleBehaviors(bot, settings, () => idle, () => {}, () => {}, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(calls.goals.length, 0);
  idle = true; await c.step(1_000); assert.equal(runtime.busy, true);
  runtime.prepareForTask(); await c.step(0); assert.equal(runtime.busy, false);
});
test('upkeep update endpoint requires attachment and legacy auto-eat settings migrate to upkeep only', () => {
  const { bot } = fixture(); const { session } = fakeSession(bot); let authorized = false;
  const handlers = new Map<string, (...args: any[]) => void>();
  registerSessionHandlers({ id: 'viewer', on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler) } as never,
    { getSessionForViewer: () => authorized ? session : undefined } as never);
  let result: any;
  handlers.get('bot:upkeep:update')!('owner-session', { autoEat: true, autoArmor: true }, (r: unknown) => { result = r; });
  assert.equal(result.ok, false); authorized = true;
  handlers.get('bot:upkeep:update')!('owner-session', { autoEat: true, autoArmor: true }, (r: unknown) => { result = r; });
  assert.equal(result.ok, true); assert.equal(session.getInfo().behaviors?.settings.autoEat, undefined);
  session.updateBehaviors({ ...defaultBehaviors(), autoEat: false });
  assert.equal(session.getInfo().upkeep?.settings.autoEat, false); session.disconnect();
});

test('a pending combat look drains before food may take the hand', async t => {
  const c = clock(t); const { bot, food, equipment } = fixture(); let finish!: () => void, meals = 0;
  bot.lookAt = () => new Promise<void>(r => { finish = r; });
  const task = new AttackTask(bot, 'Alex', () => {}, equipment); await task.start(); void bot.lookAt(bot.entity.position);
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task, () => true, () => {}, () => {},
    { eat: async () => { meals++; Object.assign(bot, { heldItem: food }); bot.food = 20; } }, c.now);
  t.after(async () => { runtime.dispose(); await task.stop(); });
  await c.step(1_000); assert.equal(meals, 0); assert.equal(runtime.busy, true);
  finish(); await c.step(0); assert.equal(meals, 1); assert.equal(runtime.busy, false);
});
test('timed-out food retains the gate until actual completion and then verifies before resume', async t => {
  const c = clock(t); const { bot, food, weapon, equipment } = fixture(); const task = owner({ kind: 'best', policy: 'melee' });
  let finish!: () => void; const statuses: string[] = [];
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, s => statuses.push(s.activity), () => {},
    { eat: async () => { Object.assign(bot, { heldItem: food }); await new Promise<void>(r => { finish = r; }); } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); await c.step(15_000);
  assert.ok(statuses.includes('cleanup-failed')); assert.equal(runtime.prepareForTask(), false); assert.equal(task.resumes(), 0);
  finish(); await c.step(0); assert.equal(bot.heldItem, weapon); assert.equal(task.resumes(), 1); assert.equal(runtime.busy, false);
});
test('failed meals restore the hand without a success event; food availability failures stay contained', async t => {
  const c = clock(t); const { bot, food, weapon, equipment } = fixture(); const logs: string[] = []; let failProbe = false, meals = 0;
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => null, () => true, () => {}, m => logs.push(m),
    { availability: () => { if (failProbe) throw Error('registry unavailable'); return null; },
      eat: async () => { meals++; Object.assign(bot, { heldItem: food }); throw Error('consume rejected'); } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000);
  assert.equal(bot.heldItem, weapon); assert.ok(logs.some(m => m.includes('Auto-eat failed'))); assert.ok(!logs.includes('Auto-eat completed.'));
  failProbe = true; await c.step(6_000); assert.equal(meals, 1); assert.equal(runtime.busy, false);
  bot.food = 20; failProbe = false; await c.step(6_000); assert.equal(meals, 1);
});
test('a requirement revised during equip wins; empty hand refuses to drop an item', async () => {
  const { bot, slots, weapon, equipment } = fixture();
  const next = { ...weapon, type: 9, slot: 37, name: 'diamond_pickaxe' } as Item; slots[37] = next;
  const task = owner({ kind: 'specific', item: weapon }); Object.assign(bot, { heldItem: null }); const equip = bot.equip;
  bot.equip = async (item, slot) => { await equip(item, slot); if (item === weapon) task.intent.publish({ kind: 'specific', item: next }); };
  await equipment.restore(task.value, new AbortController().signal); assert.equal(bot.heldItem, next);
  for (let i = 36; i < 45; i++) slots[i] = { ...weapon, slot: i } as Item;
  task.intent.publish({ kind: 'empty' }); await assert.rejects(equipment.restore(task.value, new AbortController().signal), /refusing to drop/);
});
test('both toggles off prevent mutation, open windows defer upkeep, and inventory writes serialize', async t => {
  const c = clock(t); const { bot, equipment, slots } = fixture(); let meals = 0, finish!: () => void, second = false;
  slots[10] = { name: 'diamond_helmet', type: 6, slot: 10 } as Item;
  const runtime = new Upkeep(bot, { autoEat: false, autoArmor: false }, equipment, () => null, () => true, () => {}, () => {},
    { eat: async () => { meals++; bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(4_000); assert.equal(meals, 0); assert.equal(slots[5], null);
  runtime.update({ autoEat: true, autoArmor: true }); Object.assign(bot, { currentWindow: {} });
  await c.step(1_000); assert.equal(meals, 0); assert.equal(slots[5], null); Object.assign(bot, { currentWindow: null });
  const one = equipment.exclusive(() => new Promise<void>(r => { finish = r; }));
  const two = equipment.exclusive(async () => { second = true; }); await flush(); assert.equal(second, false);
  finish(); await Promise.all([one, two]); assert.equal(second, true);
});
function excavationFixture() {
  const f = fixture(); const { bot } = f; const w = excavationWorld(bot);
  const pick = w.item('iron_pickaxe'); f.slots[36] = pick; Object.assign(bot, { heldItem: pick });
  const target = new Vec3(0, 64, 0); w.set(target, 'stone');
  let digs = 0, completed = 0, aborted = 0;
  bot.dig = async () => { digs++; w.incoming(target, 'air'); };
  const callbacks = { onEvent() {}, onProgress() {} };
  return { ...f, weapon: pick, callbacks, record: (status: string) => { if (status === 'completed') completed++; else aborted++; }, remove: () => w.set(target, 'air'), digs: () => digs, completed: () => completed, aborted: () => aborted };
}
const region = { x1: 0, y1: 64, z1: 0, x2: 0, y2: 64, z2: 0 };
for (const boundary of ['navigation', 'equipment', 'digging'] as const) test(`excavation Stop during final ${boundary} drains with one terminal callback`, async () => {
  const f = excavationFixture(); let finish!: () => void, lateDigs = 0; const task = new ExcavateTask(f.bot, region, f.callbacks, f.equipment);
  if (boundary === 'navigation') { Object.assign(f.bot.entity, { position: new Vec3(-8.5, 64, .5) }); f.bot.pathfinder.goto = () => new Promise<void>(r => { finish = r; }); }
  if (boundary === 'equipment') { f.bot.equip = () => new Promise<void>(r => { finish = r; }); Object.assign(f.bot, { heldItem: null }); }
  if (boundary === 'digging') f.bot.dig = () => new Promise<void>(r => { finish = r; }); else f.bot.dig = async () => { lateDigs++; };
  const running = task.start();
  void task.completion.then(outcome => f.record(outcome.status)); await flush(); assert.equal(typeof finish, 'function'); const stopping = task.stop(); finish(); await Promise.all([running, stopping]);
  assert.equal(lateDigs, 0); assert.equal(f.aborted(), 1); assert.equal(f.completed(), 0); assert.equal(task.active, false);
});
test('excavation yields before digging and refreshes a removed block requirement after eating', async t => {
  const c = clock(t); const f = excavationFixture(); let arrive!: () => void;
  Object.assign(f.bot.entity, { position: new Vec3(-8.5, 64, .5) }); const go = f.bot.pathfinder.goto; let first = true;
  f.bot.pathfinder.goto = async goal => { if (first) { first = false; await new Promise<void>(r => { arrive = r; }); } await go(goal); }; const task = new ExcavateTask(f.bot, region, f.callbacks, f.equipment);
  const running = task.start();
  void task.completion.then(outcome => f.record(outcome.status)); await flush();
  const runtime = new Upkeep(f.bot, { autoEat: true, autoArmor: false }, f.equipment, () => task.active ? task : null, () => true, () => {}, () => {},
    { eat: async () => { assert.equal(f.digs(), 0); Object.assign(f.bot, { heldItem: f.food }); f.remove(); f.bot.food = 20; } }, c.now);
  t.after(() => runtime.dispose()); await c.step(1_000); assert.equal(f.bot.heldItem, f.weapon);
  arrive(); await c.step(0); await running; assert.equal(f.digs(), 0); assert.equal(f.completed(), 1); assert.equal(f.aborted(), 0);
});
test('yielding Follow retains its session task slot and cannot enable idle movement', async t => {
  const c = clock(t); const f = fixture(); const { session } = fakeSession(f.bot);
  Reflect.get(session, 'setupBotEvents').call(session);
  session.updateBehaviors({ avoidDrowning: true, selfDefense: { enabled: true, mode: 'flight', durationSeconds: 10 } });
  session.updateUpkeep({ autoEat: true, autoArmor: false }); const idle = Reflect.get(session, 'idleBehaviors') as IdleBehaviors;
  const upkeep = Reflect.get(session, 'upkeep') as Upkeep; let finish!: () => void;
  t.after(() => session.disconnect()); Reflect.set(upkeep, 'now', c.now);
  Reflect.set(upkeep, 'eating', { eat: () => new Promise<void>(r => { finish = r; }) });
  assert.equal(session.performAction('follow', 'Alex').ok, true); await flush();
  Object.assign(f.bot, { oxygenLevel: 0 }); await c.step(4_000);
  assert.equal(session.getInfo().state, 'task'); assert.equal(session.getInfo().currentTask, 'follow'); assert.equal(idle.busy, false); assert.equal(typeof finish, 'function');
  finish(); await c.step(0); session.disconnect();
});

test('manual armor drop matches metadata instead of tossing a different spare', async () => {
  const { bot, slots } = fixture();
  const equipped = { name: 'diamond_helmet', type: 20, slot: 5, metadata: 0, nbt: { value: 'enchanted' } } as unknown as Item;
  const spare = { ...equipped, slot: 9, nbt: { value: 'plain' } } as unknown as Item;
  slots[5] = equipped; slots[9] = spare;
  bot.unequip = async () => { slots[5] = null; equipped.slot = 11; slots[11] = equipped; };
  let dropped: Item | undefined; bot.tossStack = async item => { dropped = item; };
  const { session } = fakeSession(bot); await session.unequipAndDropArmor('head');
  assert.equal(dropped, equipped); session.disconnect();
});
test('old upkeep completion after disposal cannot resume a task or mutate the replacement bot', async t => {
  const c = clock(t); const { bot, equipment } = fixture(); const task = owner({ kind: 'best', policy: 'melee' });
  let finish!: () => void; const replacement = fixture(); const original = replacement.bot.heldItem;
  const runtime = new Upkeep(bot, { autoEat: true, autoArmor: false }, equipment, () => task.value, () => true, () => {}, () => {},
    { eat: () => new Promise<void>(r => { finish = r; }) }, c.now);
  await c.step(1_000); runtime.dispose(); finish(); await c.step(0);
  assert.equal(task.resumes(), 0); assert.equal(replacement.bot.heldItem, original); assert.equal(bot.listenerCount('death'), 0);
});
