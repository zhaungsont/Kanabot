import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import type { Entity } from 'prismarine-entity';
import { EatUtil } from 'mineflayer-auto-eat/dist/new.js';
import type { BehaviorStatus } from '../../shared/behaviorContracts.js';
import { IdleBehaviors } from '../src/behaviors/idleBehaviors.js';
import { defaultBehaviors, validBehaviorSettings } from '../src/behaviors/settings.js';
import { AutoEatAdapter } from '../src/behaviors/autoEat.js';
import { registerSessionHandlers } from '../src/sessions/sessionHandlers.js';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

const require = createRequire(import.meta.url);
const { PVP } = require('mineflayer-pvp/lib/PVP.js');
function fixture() {
  const fixture = fakeBot(); const { bot } = fixture;
  Object.assign(fixture.alex.entity!, { type: 'player' });
  const pvp = Object.assign(Object.create(PVP.prototype), { bot, target: undefined, movements: bot.pvp.movements, followRange: 2 });
  bot.pvp = pvp;
  bot.pathfinder.stop = () => { bot.emit('path_stop'); };
  const attacker = { id: 3, name: 'zombie', type: 'hostile', position: new Vec3(5, 64, 0), isValid: true } as Entity;
  bot.entities[3] = attacker;
  Object.assign(bot, { heldItem: { name: 'iron_sword' }, food: 10 });
  return { ...fixture, attacker };
}
function clock(t: TestContext) {
  let now = 0; t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  return { now: () => now, async advance(ms: number) { now += ms; t.mock.timers.tick(ms); await flush(); await flush(); } };
}

test('behavior settings validate finite bounded durations and strict booleans', () => {
  assert.ok(validBehaviorSettings(defaultBehaviors()));
  for (const durationSeconds of [0, 121, NaN, Infinity, 1.5, '10']) assert.equal(validBehaviorSettings({ ...defaultBehaviors(), selfDefense: { enabled: true, mode: 'fight', durationSeconds } }), false);
  assert.equal(validBehaviorSettings({ ...defaultBehaviors(), autoEat: 'true' }), false);
  assert.equal(validBehaviorSettings({ ...defaultBehaviors(), selfDefense: { enabled: true, mode: 'kill', durationSeconds: 10 } }), false);
  assert.equal(validBehaviorSettings({ ...defaultBehaviors(), extra: true }), false);
});

test('flight only triggers while idle with an identified attacker; repeated hits do not extend response', async t => {
  const timer = clock(t); const { bot, attacker, calls } = fixture(); let idle = false;
  const settings = defaultBehaviors(); settings.selfDefense.enabled = true;
  const statuses: BehaviorStatus[] = [];
  const runtime = new IdleBehaviors(bot, settings, () => idle, s => statuses.push(s), () => {}, null, timer.now);
  t.after(() => runtime.dispose());
  bot.emit('entityHurt', bot.entity, attacker); await flush(); assert.equal(calls.goals.length, 0);
  idle = true; bot.emit('entityHurt', bot.entity, undefined as never); await flush(); assert.equal(calls.goals.length, 0);
  bot.emit('entityHurt', bot.entity, attacker); await flush(); await flush();
  assert.equal(statuses.at(-1)?.activity, 'defending');
  assert.equal((calls.goals.at(-1) as { constructor: { name: string } }).constructor.name, 'GoalInvert');
  await timer.advance(5_000); bot.emit('entityHurt', bot.entity, attacker); await timer.advance(5_000);
  assert.equal(statuses.at(-1)?.activity, 'idle'); assert.equal(runtime.busy, false);
});

test('fight uses held weapon and identified player attacker without role checks, then falls back to flight on weapon loss', async t => {
  const timer = clock(t); const { bot, alex } = fixture();
  const settings = defaultBehaviors(); settings.selfDefense = { enabled: true, mode: 'fight', durationSeconds: 10 };
  const saved = bot.pathfinder.movements; const stop = bot.pvp.stop;
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, null, timer.now);
  t.after(() => runtime.dispose());
  bot.emit('entityHurt', bot.entity, alex.entity); await flush(); await flush(); assert.equal(bot.pvp.target, alex.entity);
  Object.assign(bot, { heldItem: null }); bot.emit('heldItemChanged', null);
  assert.equal(bot.pvp.target, undefined); await timer.advance(333);
  assert.equal(runtime.busy, true);
  assert.equal(runtime.prepareForTask(), false); await flush(); await flush();
  assert.equal(runtime.busy, false); assert.equal(bot.pathfinder.movements, saved); assert.equal(bot.pvp.stop, stop);
});

test('flight requests additional separation even when a ranged attacker is already more than twelve blocks away', async t => {
  const timer = clock(t); const { bot, attacker, calls } = fixture(); attacker.position.x = 25;
  const settings = defaultBehaviors(); settings.selfDefense.enabled = true;
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, null, timer.now);
  t.after(() => runtime.dispose()); bot.emit('entityHurt', bot.entity, attacker); await flush(); await flush();
  const goal = calls.goals.at(-1) as { isEnd(node: { x: number; y: number; z: number }): boolean };
  assert.equal(goal.isEnd(bot.entity.position), false);
});

test('dead attackers are retired; nearby hostile mobs may be selected during the same bounded response', async t => {
  const timer = clock(t); const { bot, attacker } = fixture();
  const settings = defaultBehaviors(); settings.selfDefense = { enabled: true, mode: 'fight', durationSeconds: 10 };
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, null, timer.now);
  t.after(() => runtime.dispose());
  bot.emit('entityHurt', bot.entity, attacker); await flush(); await flush(); assert.equal(bot.pvp.target, attacker);
  bot.emit('entityDead', attacker); await timer.advance(333); assert.equal(bot.pvp.target, undefined);
  assert.equal(runtime.busy, true); // Watch for the rest of the original response window.
  const next = { ...attacker, id: 4 } as Entity; bot.entities[4] = next;
  await timer.advance(333); assert.equal(bot.pvp.target, next);
  await timer.advance(10_000); assert.equal(runtime.busy, false);
});

test('auto-eat serializes work, pauses for tasks and settings-off, and drains before defense starts', async t => {
  const timer = clock(t); const { bot, attacker } = fixture();
  let idle = false, meals = 0, release!: () => void;
  const settings = defaultBehaviors(); settings.autoEat = true; settings.selfDefense.enabled = true;
  const eating = { eat: async (_signal: AbortSignal) => { meals++; await new Promise<void>(resolve => { release = resolve; }); } };
  const runtime = new IdleBehaviors(bot, settings, () => idle, () => {}, () => {}, eating, timer.now);
  t.after(() => runtime.dispose());
  await timer.advance(1_000); assert.equal(meals, 0);
  idle = true; await timer.advance(1_000); assert.equal(meals, 1);
  await timer.advance(1_000); assert.equal(meals, 1);
  bot.emit('entityHurt', bot.entity, attacker); await flush(); assert.equal(bot.pvp.target, undefined);
  release(); await flush(); await flush(); assert.equal(runtime.busy, true);
  runtime.update(defaultBehaviors()); await flush(); await flush(); assert.equal(runtime.busy, false);
  await timer.advance(10_000); assert.equal(meals, 1);
});

test('task preemption blocks successors until an in-flight meal settles; disposal prevents late restarts', async t => {
  const timer = clock(t); const { bot } = fixture(); let release!: () => void; let meals = 0;
  const settings = defaultBehaviors(); settings.autoEat = true;
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, { eat: async () => { meals++; await new Promise<void>(resolve => { release = resolve; }); } }, timer.now);
  await timer.advance(1_000); assert.equal(runtime.prepareForTask(), false); assert.equal(runtime.busy, true);
  runtime.dispose(); release(); await flush(); await timer.advance(30_000);
  assert.equal(meals, 1); assert.equal(bot.listenerCount('entityHurt'), 0); assert.equal(bot.listenerCount('death'), 0);
});

function foodFixture() {
  const { bot } = fixture();
  const food = { name: 'apple', type: 10, slot: 10 };
  const weapon = { name: 'iron_sword', type: 11, slot: 36 };
  const inventory = Object.assign(new EventEmitter(), { items: () => [food, weapon], slots: [] });
  let restores = 0;
  Object.assign(bot, { inventory, heldItem: weapon, _client: new EventEmitter(), registry: { foodsByName: { apple: { foodPoints: 4 } } },
    util: { inv: { getAllItems: () => [food, weapon], getHandWithItem: () => bot.heldItem, getHand: () => 'hand',
      customEquip: async () => { Object.assign(bot, { heldItem: food }); return true; } } },
    activateItem: () => {}, deactivateItem: () => {},
    equip: async () => { restores++; Object.assign(bot, { heldItem: weapon }); },
  });
  bot.autoEat = new EatUtil(bot);
  return { bot, weapon, restores: () => restores };
}

test('installed auto-eat selection/consume restores equipment and cleans listeners on success, timeout, and cancellation', async t => {
  const timer = clock(t); const { bot, weapon, restores } = foodFixture(); const adapter = new AutoEatAdapter(bot);
  const first = adapter.eat(new AbortController().signal); await flush();
  bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 9 }); await first;
  assert.equal(bot.heldItem, weapon); assert.equal(restores(), 1);
  assert.equal(bot._client.listenerCount('entity_status'), 0); assert.equal(bot.inventory.listenerCount('updateSlot'), 0);
  const second = adapter.eat(new AbortController().signal); const rejected = assert.rejects(second, /timed out/);
  await flush(); await timer.advance(3_000); await rejected;
  assert.equal(bot._client.listenerCount('entity_status'), 0); assert.equal(bot.inventory.listenerCount('updateSlot'), 0);
  const cancel = new AbortController(); const third = adapter.eat(cancel.signal); const canceled = assert.rejects(third, /canceled/);
  await flush(); cancel.abort(); await canceled;
  assert.equal(bot.autoEat.isEating, false); assert.equal(bot._client.listenerCount('entity_status'), 0);
});

test('cancel during library food equip drains it and awaited restoration before releasing the operation', async () => {
  const { bot, weapon } = foodFixture(); let release!: () => void;
  (bot as unknown as { util: { inv: { customEquip: () => Promise<boolean> } } }).util.inv.customEquip = async () => { await new Promise<void>(resolve => { release = resolve; }); return true; };
  const adapter = new AutoEatAdapter(bot); const cancel = new AbortController(); let done = false;
  const eating = adapter.eat(cancel.signal).finally(() => { done = true; }); const rejected = assert.rejects(eating, /canceled/);
  await flush(); cancel.abort(); assert.equal(done, false); release(); await rejected;
  assert.equal(bot.heldItem, weapon); assert.equal(bot.autoEat.isEating, false); assert.equal(bot.inventory.listenerCount('updateSlot'), 0);
});

test('unreachable Protect sends one private notification, preserves event log, and never sends public chat', async t => {
  const timer = clock(t);
  const { bot, calls } = fixture(); const { session, chats, events } = fakeSession(bot);
  delete bot.entities[3];
  t.after(() => session.disconnect());
  let publicMessages = 0; bot.chat = () => { publicMessages++; };
  assert.ok(session.performAction('protect', 'Alex').ok); await flush(); await timer.advance(0);
  bot.emit('path_update', { status: 'noPath' } as never); await timer.advance(120);
  assert.equal(session.currentTask, null); assert.equal(calls.whispers.length, 1); assert.equal(calls.whispers[0][0], 'Alex');
  assert.match(String(calls.whispers[0][1]), /can't reach you/); assert.equal(publicMessages, 0);
  assert.ok(events.some(e => /Cannot return/.test(e.message)));
  assert.ok(chats.some((c: any) => c.channel === 'whisper' && c.recipient === 'Alex'));
  session.disconnect();
});

test('session task requests preempt idle defense and cannot overlap its cleanup; tasks suppress new reactions', async t => {
  const timer = clock(t); const { bot, attacker } = fixture(); const { session } = fakeSession(bot);
  (session as unknown as { setupBotEvents(): void }).setupBotEvents();
  const settings = defaultBehaviors(); settings.selfDefense = { enabled: true, mode: 'fight', durationSeconds: 10 };
  session.updateBehaviors(settings);
  assert.ok(session.performAction('follow', 'Alex').ok); await flush();
  bot.emit('entityHurt', bot.entity, attacker); await flush(); assert.equal(bot.pvp.target, undefined);
  session.performAction('stop'); await flush();
  bot.emit('entityHurt', bot.entity, attacker); await flush(); await flush(); assert.equal(bot.pvp.target, attacker);
  assert.equal(session.performAction('follow', 'Alex').ok, false); await flush(); await flush();
  assert.equal(bot.pvp.target, undefined); assert.ok(session.performAction('follow', 'Alex').ok);
  session.disconnect(); await timer.advance(15_000); assert.equal(session.state, 'disconnected');
});

test('unreachable self-defense waits out its original response rather than starting a search on every hit', async t => {
  const timer = clock(t); const { bot, attacker, calls } = fixture();
  const settings = defaultBehaviors(); settings.selfDefense.enabled = true;
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, null, timer.now);
  t.after(() => runtime.dispose());
  bot.emit('entityHurt', bot.entity, attacker); await flush(); await flush();
  bot.emit('path_update', { status: 'noPath' } as never); await timer.advance(333);
  const count = calls.goals.length;
  for (let i = 0; i < 10; i++) bot.emit('entityHurt', bot.entity, attacker);
  await timer.advance(5_000); assert.equal(calls.goals.length, count); assert.equal(runtime.busy, true);
  await timer.advance(5_000); assert.equal(runtime.busy, false);
});

test('pending eating cleanup reports a deadline and keeps ownership until the operation actually settles', async t => {
  const timer = clock(t); const { bot } = fixture(); let release!: () => void;
  const settings = defaultBehaviors(); settings.autoEat = true;
  const statuses: BehaviorStatus[] = [];
  const runtime = new IdleBehaviors(bot, settings, () => true, s => statuses.push(s), () => {},
    { eat: async () => { await new Promise<void>(resolve => { release = resolve; }); } }, timer.now);
  t.after(() => runtime.dispose());
  await timer.advance(1_000); runtime.prepareForTask(); await timer.advance(10_000);
  assert.equal(statuses.at(-1)?.activity, 'cleanup-failed'); assert.equal(runtime.prepareForTask(), false);
  assert.equal(statuses.at(-1)?.activity, 'cleanup-failed');
  release(); await flush(); await flush(); assert.equal(runtime.busy, false);
});

test('installed auto-eat awaits old-item restoration and a failed equip does not poison future meals', async () => {
  const { bot } = foodFixture(); const adapter = new AutoEatAdapter(bot); let release!: () => void; let done = false;
  const equip = bot.equip;
  bot.equip = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); await equip(...args); };
  const meal = adapter.eat(new AbortController().signal).then(() => { done = true; }); await flush();
  bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 9 }); await flush();
  assert.equal(done, false); release(); await meal;
  bot.equip = equip;
  (bot as unknown as { util: { inv: { customEquip: () => Promise<boolean> } } }).util.inv.customEquip = async () => false;
  await assert.rejects(adapter.eat(new AbortController().signal), /Failed to equip/);
  assert.equal(bot.autoEat.isEating, false);
});

test('behavior updates require an attached viewer and remain session-scoped across connection replacement', () => {
  const { bot } = fixture(); const { session } = fakeSession(bot);
  const handlers = new Map<string, (...args: any[]) => void>(); let allowed = false;
  const socket = { id: 'viewer', on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler) };
  registerSessionHandlers(socket as never, { getSessionForViewer: () => allowed ? session : undefined } as never);
  let result: any; const next = defaultBehaviors(); next.autoEat = true;
  handlers.get('bot:behaviors:update')!('owner-session', next, (r: unknown) => { result = r; });
  assert.equal(result.ok, false); assert.equal(session.getInfo().behaviors?.settings.autoEat, false);
  allowed = true; handlers.get('bot:behaviors:update')!('owner-session', next, (r: unknown) => { result = r; });
  assert.equal(result.ok, true); next.autoEat = false;
  assert.equal(session.getInfo().behaviors?.settings.autoEat, true);
  session.disconnect(); assert.equal(session.getInfo().behaviors?.settings.autoEat, true);
});

test('auto-eat initializes after delayed plugin injection and logs an actual meal outcome', async t => {
  const timer = clock(t); const { bot } = foodFixture(); const plugin = bot.autoEat;
  Reflect.deleteProperty(bot, 'autoEat'); // Match createBot before inject_allowed.
  const settings = defaultBehaviors(); settings.autoEat = true;
  const statuses: BehaviorStatus[] = [], logs: string[] = [];
  const runtime = new IdleBehaviors(bot, settings, () => true, s => statuses.push(s), message => logs.push(message), undefined, timer.now);
  t.after(() => runtime.dispose());
  await timer.advance(1_000); assert.match(statuses.at(-1)!.detail, /initialize/);
  bot.autoEat = plugin; await timer.advance(1_000);
  assert.equal(plugin.isEating, true); assert.ok(logs.includes('Auto-eat started.'));
  bot._client.emit('entity_status', { entityId: bot.entity.id, entityStatus: 9 }); await flush(); await flush();
  assert.equal(runtime.busy, false); assert.ok(logs.includes('Auto-eat completed.'));
});

test('auto-eat explains full hunger and missing food without repeatedly starting meals', async t => {
  const timer = clock(t); const { bot } = foodFixture(); Object.assign(bot, { food: 20, health: 1 });
  const settings = defaultBehaviors(); settings.autoEat = true;
  const statuses: BehaviorStatus[] = [], logs: string[] = [];
  const runtime = new IdleBehaviors(bot, settings, () => true, s => statuses.push(s), message => logs.push(message), undefined, timer.now);
  t.after(() => runtime.dispose());
  await timer.advance(1_000); assert.equal(runtime.busy, false); assert.match(statuses.at(-1)!.detail, /Hunger is full/);
  bot.food = 19; bot.inventory.items = () => [];
  await timer.advance(1_000); assert.match(statuses.at(-1)!.detail, /No suitable food/);
  await timer.advance(5_000); assert.equal(logs.filter(message => /No suitable food/.test(message)).length, 1);
  assert.equal(logs.includes('Auto-eat started.'), false);
});

test('self-defense player death/despawn while looking cannot attack a removed or respawned player', async t => {
  const timer = clock(t); const { bot, alex, calls } = fixture(); delete bot.entities[3];
  const player = alex.entity!; Object.assign(player, { height: 1.8 });
  const settings = defaultBehaviors(); settings.selfDefense = { enabled: true, mode: 'fight', durationSeconds: 10 };
  const logs: string[] = [];
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, message => logs.push(message), null, timer.now);
  t.after(() => runtime.dispose());
  bot.emit('entityHurt', bot.entity, player); await flush(); await flush();
  let finishLook!: () => void;
  bot.lookAt = async () => { await new Promise<void>(resolve => { finishLook = resolve; }); };
  bot.attack = (target) => { calls.attacks.push(target); };
  Object.assign(bot.pvp, { wasInRange: true, meleeAttackRate: { getTicks: () => 10 } });
  Reflect.get(bot.pvp, 'attemptAttack').call(bot.pvp);
  assert.equal(typeof finishLook, 'function');
  bot.emit('entityDead', player); bot.emit('entityGone', player);
  player.isValid = false; delete bot.entities[player.id]; Reflect.set(alex, 'entity', null);
  finishLook(); await flush(); await timer.advance(333);
  assert.equal(bot.pvp.target, undefined); assert.equal(calls.attacks.length, 0);
  const respawn = { ...player, isValid: true, position: new Vec3(2, 64, 0) } as Entity;
  bot.entities[player.id] = respawn; alex.entity = respawn;
  await timer.advance(333); assert.equal(bot.pvp.target, undefined);
  await timer.advance(10_000); assert.equal(runtime.busy, false);
  assert.ok(logs.some(message => /died or left tracking/.test(message)));
  assert.ok(logs.includes('Self-defense completed.'));
});

test('death while PvP startup is pending invalidates the entity even before despawn arrives', async t => {
  const timer = clock(t); const { bot, alex } = fixture(); delete bot.entities[3];
  const player = alex.entity!; const attack = bot.pvp.attack;
  let release!: () => void;
  bot.pvp.attack = async target => { await new Promise<void>(resolve => { release = resolve; }); await attack.call(bot.pvp, target); };
  const settings = defaultBehaviors(); settings.selfDefense = { enabled: true, mode: 'fight', durationSeconds: 10 };
  const runtime = new IdleBehaviors(bot, settings, () => true, () => {}, () => {}, null, timer.now);
  t.after(() => runtime.dispose()); bot.emit('entityHurt', bot.entity, player); await flush(); await flush();
  assert.equal(typeof release, 'function'); bot.emit('entityDead', player);
  // entityDead does not necessarily remove the entity or flip isValid yet.
  release(); await flush(); await flush(); assert.equal(bot.pvp.target, undefined);
  await timer.advance(333); assert.equal(bot.pvp.target, undefined);
});

test('failed meals log failure without a misleading completed event; settings changes are logged', async t => {
  const timer = clock(t); const { bot } = fixture(); const logs: string[] = [];
  const runtime = new IdleBehaviors(bot, defaultBehaviors(), () => true, () => {}, message => logs.push(message),
    { eat: async () => { throw new Error('no food'); } }, timer.now);
  t.after(() => runtime.dispose()); const settings = defaultBehaviors(); settings.autoEat = true;
  runtime.update(settings); await timer.advance(1_000);
  assert.ok(logs.includes('Auto-eat enabled.')); assert.ok(logs.some(m => /could not finish/.test(m)));
  assert.equal(logs.includes('Auto-eat completed.'), false);
});
