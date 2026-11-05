import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test, { type TestContext } from 'node:test';
import type { Entity } from 'prismarine-entity';
import { Vec3 } from 'vec3';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';
import { ProtectTask } from '../src/tasks/protect/protectTask.js';
import { ProtectCombatAdapter } from '../src/tasks/protect/combatAdapter.js';
import { ThreatObserver } from '../src/tasks/protect/threatObserver.js';
import { distanceSquared, selectThreat, type ThreatCandidate } from '../src/tasks/protect/threatSelector.js';
import { PlayerRoleStore } from '../src/access/playerRoleStore.js';
import { BotCommandService } from '../src/commands/botCommandService.js';
import { parseMinecraftCommand } from '../src/commands/minecraftCommand.js';
import type { ProtectStatus } from '../../shared/botContracts.js';

const require = createRequire(import.meta.url);
// Exercise the installed plugin's actual attack, forceStop, target checks and stop dispatch.
const { PVP } = require('mineflayer-pvp/lib/PVP.js');
function fixture() {
  const fixture = fakeBot();
  const { bot, calls } = fixture;
  const pvp = Object.assign(Object.create(PVP.prototype), {
    bot, target: undefined, movements: bot.pvp.movements,
    followRange: 2, viewDistance: 128, attackRange: 3.5,
  }) as typeof bot.pvp;
  bot.pvp = pvp;
  const actualAttack = pvp.attack;
  pvp.attack = async (entity) => { calls.attacks.push(entity); await actualAttack.call(pvp, entity); };
  bot.pathfinder.stop = () => { bot.emit('path_stop'); };
  Object.assign(bot, { heldItem: { name: 'iron_sword' }, world: { getColumn: () => ({}), raycast: () => null } });
  bot.on('entityGone', entity => { if (pvp.target === entity) void pvp.stop(); });
  let writes = 0;
  bot.equip = async () => { writes++; };
  const mob = (id: number, x: number, y = 64, z = 0, name = 'zombie') => {
    const entity = { id, name, type: 'mob', kind: 'Hostile mobs', height: 1.8, isValid: true, position: new Vec3(x, y, z) } as Entity;
    bot.entities[id] = entity;
    return entity;
  };
  return { ...fixture, mob, writes: () => writes };
}
function clock(t: TestContext) {
  let now = 0;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  return { now: () => now, async advance(ms: number) { now += ms; t.mock.timers.tick(ms); await flush(); await flush(); } };
}
function candidate(entity: Entity, d: number, overrides: Partial<ThreatCandidate> = {}): ThreatCandidate {
  return { entity, distanceSquared: d * d, botDistanceSquared: 25, confirmed: false, approaching: false,
    arrival: Infinity, visibility: 'unknown', ...overrides };
}

test('Protect and legacy Guard share canonical Crew permission; old permission grants nothing', () => {
  const roles = new PlayerRoleStore('test'); const created: unknown[] = [];
  const service = new BotCommandService(roles, action => { created.push(action); return { ok: true }; });
  for (const type of ['guard', 'protect']) assert.equal(service.submit({ kind: 'minecraft', username: 'Steve' }, { type, target: 'Alex' }).ok, false);
  roles.update({ username: 'Steve', role: 'crew', expectedRevision: 0 });
  for (const type of ['guard', 'protect']) assert.equal(service.submit({ kind: 'minecraft', username: 'Steve' }, { type, target: 'Alex' }).ok, true);
  assert.deepEqual(created, [{ type: 'protect', target: 'Alex' }, { type: 'protect', target: 'Alex' }]);
  assert.deepEqual(parseMinecraftCommand('Steve', '!guard'), parseMinecraftCommand('Steve', '!protect'));
  assert.equal(roles.snapshot().catalogVersion, 2);
});

test('3D distances, deterministic ties, damage priority, retention and release boundaries', () => {
  const { mob } = fixture(); const a = mob(3, 3, 64, 4), b = mob(4, 0, 70, 0);
  assert.equal(distanceSquared(a.position, new Vec3(0, 64, 0)), 25);
  assert.equal(distanceSquared(b.position, new Vec3(0, 64, 0)), 36);
  const ca = candidate(a, 5), cb = candidate(b, 6, { confirmed: true });
  assert.equal(selectThreat([ca, cb], a, 0, 1)?.entity, b);
  assert.equal(selectThreat([ca, candidate(b, 4)], a, 0, 2_000)?.entity, a);
  assert.equal(selectThreat([ca, candidate(b, 3.75)], a, 0, 2_000)?.entity, b);
  assert.equal(selectThreat([candidate(b, 5), ca], null, 0, 0)?.entity, a);
  assert.equal(selectThreat([candidate(a, 10)], null, 0, 0)?.entity, a);
  assert.equal(selectThreat([candidate(a, 16)], null, 0, 0), null);
  assert.equal(selectThreat([candidate(a, 16)], a, 0, 0)?.entity, a);
});

test('observer identifies hostile mobs by kind for acquisition, damage and revalidation', () => {
  const { bot, mob, alex } = fixture(); const observer = new ThreatObserver(bot);
  const zombie = mob(3, 11);
  const modern = mob(4, 12); modern.type = 'hostile';
  const passive = mob(5, 10); passive.kind = 'Passive mobs';
  const missing = mob(6, 10); missing.type = 'hostile'; delete missing.kind;
  const misleading = mob(7, 10); misleading.type = 'hostile'; misleading.kind = 'Passive mobs';
  for (const entity of [zombie, modern, passive, missing, misleading]) observer.hurt(alex.entity!, entity, alex.entity!, 0);
  const candidates = observer.observe(alex.entity!, null, 100);
  assert.deepEqual(candidates.map(c => c.entity), [zombie, modern]);
  assert.ok(candidates.every(c => c.confirmed));
  zombie.kind = 'Passive mobs';
  assert.equal(observer.eligible(zombie), false);
  assert.deepEqual(observer.observe(alex.entity!, zombie, 200).map(c => c.entity), [modern]);
});

test('observer bounds rays, preserves aggressors, excludes players/stale/dead entities, handles missing chunks', () => {
  const { bot, mob, alex } = fixture(); const observer = new ThreatObserver(bot);
  const mobs = Array.from({ length: 8 }, (_, i) => mob(3 + i, 11 + i));
  let rays = 0;
  bot.world.raycast = () => { rays++; return null; };
  observer.hurt(alex.entity!, mobs[7], alex.entity!, 0);
  observer.hurt(alex.entity!, undefined, alex.entity!, 0);
  const candidates = observer.observe(alex.entity!, mobs[0], 100);
  assert.equal(candidates.length, 8); assert.equal(rays, 4);
  assert.equal(candidates.find(c => c.entity === mobs[7])!.confirmed, true);
  assert.equal(candidates.find(c => c.entity === mobs[7])!.visibility, 'clear');
  observer.died(mobs[0]);
  const replacement = mob(mobs[1].id, 11);
  bot.world.getColumn = () => null as never;
  rays = 0;
  const second = observer.observe(alex.entity!, null, 4_000);
  assert.equal(rays, 0); assert.ok(second.every(c => c.visibility === 'unknown' && !c.confirmed));
  assert.equal(second.some(c => c.entity === mobs[0] || c.entity === mobs[1] || c.entity.type === 'player'), false);
  assert.ok(second.some(c => c.entity === replacement));
});

test('blocked rays earn no visibility priority; sustained approach needs successive timestamp samples', () => {
  const { bot, mob, alex } = fixture(); const observer = new ThreatObserver(bot); const zombie = mob(3, 18);
  bot.world.raycast = () => ({}) as never;
  assert.equal(observer.observe(alex.entity!, null, 0)[0].visibility, 'blocked');
  zombie.position.x = 17;
  assert.equal(observer.observe(alex.entity!, null, 1_000)[0].approaching, false);
  zombie.position.x = 16;
  assert.equal(observer.observe(alex.entity!, null, 2_000)[0].approaching, true);
  zombie.position.x = 15;
  assert.equal(observer.observe(alex.entity!, null, 8_000)[0].approaching, false);
});

test('escort goal stays stable, weapon changes recover, mob loss returns, all settings/listeners restore', async t => {
  const timer = clock(t); const { bot, calls, mob, writes } = fixture();
  const saved = { movements: bot.pathfinder.movements, pvp: bot.pvp.movements, stop: bot.pvp.stop, think: bot.pathfinder.thinkTimeout };
  const emitter = bot as unknown as NodeJS.EventEmitter;
  const baseline = emitter.eventNames().map(event => [event, emitter.listenerCount(event)] as const);
  const statuses: ProtectStatus[] = []; let outcomes = 0;
  Object.assign(bot, { heldItem: null }); const zombie = mob(3, 12);
  const task = new ProtectTask(bot, 'Alex', () => { outcomes++; }, status => statuses.push(status), undefined, timer.now);
  t.after(() => task.stop());
  await task.start(); await timer.advance(0);
  assert.equal(statuses.at(-1)?.equipment, 'unavailable'); const goalCount = calls.goals.length;
  await timer.advance(333); await timer.advance(333);
  assert.equal(calls.goals.length, goalCount); assert.equal(calls.attacks.length, 0);
  Object.assign(bot, { heldItem: { name: 'iron_axe' } }); bot.emit('heldItemChanged', bot.heldItem!);
  await timer.advance(100); assert.equal(bot.pvp.target, zombie); assert.equal(calls.attacks.length, 1);
  await timer.advance(333); assert.equal(calls.attacks.length, 1);
  Object.assign(bot, { heldItem: null }); bot.emit('heldItemChanged', null);
  assert.equal(bot.pvp.target, undefined);
  await timer.advance(100); assert.equal(statuses.at(-1)?.phase, 'escorting');
  Object.assign(bot, { heldItem: { name: 'iron_sword' } }); bot.emit('heldItemChanged', bot.heldItem!);
  await timer.advance(100); assert.equal(bot.pvp.target, zombie);
  bot.emit('entityDead', zombie); await timer.advance(100);
  assert.equal(bot.pvp.target, undefined); assert.equal(statuses.at(-1)?.phase, 'escorting');
  const stop = task.stop(); assert.equal(task.stop(), stop); await stop;
  assert.equal(outcomes, 1); assert.equal(writes(), 0);
  assert.equal(bot.pathfinder.movements, saved.movements); assert.equal(bot.pvp.movements, saved.pvp);
  assert.equal(bot.pathfinder.thinkTimeout, saved.think); assert.equal(bot.pvp.stop, saved.stop);
  for (const [event, count] of baseline) assert.equal(emitter.listenerCount(event), count);
  for (const event of emitter.eventNames()) assert.equal(emitter.listenerCount(event), baseline.find(([name]) => name === event)?.[1] ?? 0);
});

test('leash returns, noPath excludes only the mob for five seconds, invalid player ends once', async t => {
  const timer = clock(t); const { bot, mob, alex } = fixture(); const zombie = mob(3, 12);
  const statuses: ProtectStatus[] = []; let outcomes = 0;
  const task = new ProtectTask(bot, 'Alex', () => { outcomes++; }, s => statuses.push(s), undefined, timer.now);
  t.after(() => task.stop());
  await task.start(); await timer.advance(0); assert.equal(bot.pvp.target, zombie);
  bot.emit('path_update', { status: 'noPath' } as never); await timer.advance(100);
  assert.equal(statuses.at(-1)?.phase, 'escorting'); assert.equal(outcomes, 0);
  await timer.advance(4_000); assert.equal(bot.pvp.target, undefined);
  await timer.advance(1_001); assert.equal(bot.pvp.target, zombie);
  bot.entity.position.x = -3; await timer.advance(333);
  assert.equal(statuses.at(-1)?.phase, 'returning'); assert.equal(bot.pvp.target, undefined);
  bot.entity.position.x = 4; await timer.advance(333); assert.equal(statuses.at(-1)?.phase, 'returning');
  bot.entity.position.x = 5; await timer.advance(333); assert.equal(statuses.at(-1)?.phase, 'engaging');
  bot.emit('entityGone', alex.entity!); bot.emit('entityDead', alex.entity!); await flush(); await flush();
  assert.equal(outcomes, 1); await task.stop(); assert.equal(outcomes, 1);
});

test('installed PvP stop fallback preserves unrelated listeners and cannot erase a successor goal', async t => {
  const timer = clock(t); const { bot, mob, calls } = fixture(); const zombie = mob(3, 12);
  const unrelated = () => {}; bot.on('path_stop', unrelated);
  bot.pathfinder.stop = () => {}; // Paused/unresponsive physics, exercise bounded fallback.
  const adapter = new ProtectCombatAdapter(bot, bot.pathfinder.movements, 50);
  await adapter.attack(zombie, new AbortController().signal);
  const stop = adapter.stop(); assert.equal(adapter.stop(), stop);
  await timer.advance(50); await stop; await adapter.release();
  assert.ok(bot.listeners('path_stop').includes(unrelated));
  bot.pathfinder.setGoal({ successor: true } as never);
  const count = calls.goals.length; await timer.advance(10_000); assert.equal(calls.goals.length, count);
  bot.removeListener('path_stop', unrelated);
});

test('pending combat startup drains before Stop releases session ownership', async t => {
  const timer = clock(t); const { bot, mob } = fixture(); mob(3, 12);
  let release!: () => void; let entered = false;
  const attack = bot.pvp.attack;
  bot.pvp.attack = async entity => { entered = true; await new Promise<void>(resolve => { release = resolve; }); await attack(entity); };
  const { session } = fakeSession(bot);
  assert.ok(session.performAction('guard', 'Alex').ok); await flush(); await timer.advance(0);
  assert.equal(entered, true); assert.equal(session.currentTask, 'protect');
  session.performAction('stop'); assert.equal(session.performAction('follow', 'Alex').ok, false);
  release(); await flush(); await flush();
  assert.equal(bot.pvp.target, undefined); assert.equal(session.currentTask, null);
  assert.ok(session.performAction('follow', 'Alex').ok); session.disconnect(); await flush();
});

test('unconfirmed cleanup keeps session blocked and publishes failure while other disposers run', async t => {
  const timer = clock(t); const { bot } = fixture(); const { session } = fakeSession(bot);
  session.performAction('protect', 'Alex'); await flush(); await timer.advance(0);
  const setGoal = bot.pathfinder.setGoal;
  bot.pathfinder.setGoal = () => { throw new Error('broken pathfinder'); };
  session.performAction('stop'); await flush(); await flush();
  assert.equal(session.getInfo().protect?.phase, 'cleanup-failed');
  assert.equal(session.performAction('follow', 'Alex').ok, false);
  assert.equal(bot.listenerCount('heldItemChanged'), 0); assert.equal(bot.listenerCount('path_update'), 0);
  bot.pathfinder.setGoal = setGoal; session.disconnect(); await flush();
});

test('partial preparation failure tears down listeners/settings; canceled preparation starts no goals', async t => {
  const timer = clock(t); const { bot, calls } = fixture();
  const saved = bot.pathfinder.movements; let releases = 0; let outcomes = 0;
  const equipment = { readiness: () => 'unavailable' as const, subscribeReadiness: () => () => {},
    prepare: async () => { throw new Error('prepare failed'); }, release: async () => { releases++; } };
  const task = new ProtectTask(bot, 'Alex', () => { outcomes++; }, () => {}, equipment, timer.now);
  await task.start(); await flush(); await task.stop();
  assert.equal(outcomes, 1); assert.equal(releases, 1); assert.equal(bot.pathfinder.movements, saved);
  assert.equal(bot.listenerCount('path_update'), 0);
  const second = new ProtectTask(bot, 'Alex', () => {}, () => {}, undefined, timer.now);
  const starting = second.start(); const stopping = second.stop(); await Promise.all([starting, stopping]);
  const count = calls.goals.length; await timer.advance(10_000); assert.equal(calls.goals.length, count);
});

test('urgent bursts are coalesced, no scans overlap, and all player damage remains excluded', async t => {
  const timer = clock(t); const { bot, mob, alex } = fixture();
  for (let i = 0; i < 8; i++) mob(3 + i, 11 + i);
  let rays = 0; bot.world.raycast = () => { rays++; return null; };
  const task = new ProtectTask(bot, 'Alex', () => {}, () => {}, undefined, timer.now);
  t.after(() => task.stop()); await task.start(); await timer.advance(0);
  assert.equal(rays, 4);
  for (let i = 0; i < 100; i++) bot.emit('entityHurt', alex.entity!, bot.entity);
  await timer.advance(99); assert.equal(rays, 4);
  await timer.advance(1); assert.equal(rays, 8);
  assert.notEqual(bot.pvp.target, bot.entity); assert.notEqual(bot.pvp.target, alex.entity);
});

test('stalled return has a bounded outcome; world changes terminate without late idle state', async t => {
  const timer = clock(t); const { bot } = fixture(); let outcomes = 0;
  Object.assign(bot, { heldItem: null });
  const task = new ProtectTask(bot, 'Alex', () => { outcomes++; }, () => {}, undefined, timer.now);
  await task.start(); await timer.advance(0); await timer.advance(333); await timer.advance(30_001);
  await task.stop(); assert.equal(outcomes, 1);
  const { session } = fakeSession(bot);
  session.performAction('protect', 'Alex'); await flush(); await timer.advance(0);
  session.disconnect(); await flush(); await flush();
  assert.equal(session.state, 'disconnected'); assert.equal(session.currentTask, null);
  // Reusing the coordinator with a replacement connection must not retain the old lease.
  const replacement = fixture(); Object.assign(session, { bot: replacement.bot, state: 'idle' });
  assert.ok(session.performAction('follow', 'Alex').ok);
  session.disconnect(); await flush();
});

test('repeated Protect cycles preserve baseline listeners and unrelated stop handlers', async t => {
  const timer = clock(t); const { bot, mob } = fixture(); mob(3, 12);
  const unrelated = () => {}; bot.on('path_stop', unrelated);
  const emitter = bot as unknown as NodeJS.EventEmitter;
  const baseline = emitter.eventNames().reduce((n, name) => n + emitter.listenerCount(name), 0);
  for (let cycle = 0; cycle < 5; cycle++) {
    const task = new ProtectTask(bot, 'Alex', () => {}, () => {}, undefined, timer.now);
    await task.start(); await timer.advance(333); await task.stop();
    assert.equal(emitter.eventNames().reduce((n, name) => n + emitter.listenerCount(name), 0), baseline);
    assert.ok(bot.listeners('path_stop').includes(unrelated));
  }
});

test('a cleanup deadline reports trouble without releasing a pending startup lease', async t => {
  const timer = clock(t); const { bot } = fixture();
  let release!: () => void;
  const equipment = { readiness: () => 'unavailable' as const, subscribeReadiness: () => () => {},
    prepare: async () => { await new Promise<void>(resolve => { release = resolve; }); return 'unavailable' as const; }, release: async () => {} };
  const statuses: ProtectStatus[] = []; let completed = false;
  const task = new ProtectTask(bot, 'Alex', () => { completed = true; }, s => statuses.push(s), equipment, timer.now);
  const start = task.start(); const stop = task.stop();
  await timer.advance(10_000); assert.equal(completed, false); assert.equal(statuses.at(-1)?.phase, 'cleanup-failed');
  release(); await Promise.all([start, stop]); assert.equal(completed, true);
});

test('a nearby obstructed mob cannot stall combat forever; actual damage counts as progress', async t => {
  const timer = clock(t); const { bot, mob } = fixture(); bot.entity.position.x = 9;
  const zombie = mob(3, 11); bot.world.raycast = () => ({}) as never;
  const task = new ProtectTask(bot, 'Alex', () => {}, () => {}, undefined, timer.now);
  t.after(() => task.stop()); await task.start(); await timer.advance(0); await timer.advance(333);
  await timer.advance(20_000); bot.emit('entityHurt', zombie, bot.entity); await timer.advance(100);
  await timer.advance(20_000); assert.equal(bot.pvp.target, zombie);
  await timer.advance(10_001); assert.equal(bot.pvp.target, undefined);
});
