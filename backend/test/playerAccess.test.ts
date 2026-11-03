import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerRoleStore } from '../src/access/playerRoleStore.js';
import { describeRoles, roleAllows } from '../src/access/roleCatalog.js';
import { BotCommandService } from '../src/commands/botCommandService.js';
import { parseMinecraftCommand } from '../src/commands/minecraftCommand.js';
import { registerAccessHandlers } from '../src/access/accessHandlers.js';
import { fakeBot, fakeSession, flush } from './playerFixtures.js';

test('fixed inheritance grants Crew excavation to Owner and denies it to Visitor; unknown IDs deny', () => {
  assert.equal(roleAllows('visitor', 'task.follow.start'), true);
  assert.equal(roleAllows('visitor', 'task.excavate.start'), false);
  assert.equal(roleAllows('crew', 'task.excavate.start'), true);
  assert.equal(roleAllows('owner', 'task.excavate.start'), true);
  assert.equal(roleAllows('crew', 'task.attack.start'), false);
  for (const role of ['visitor', 'crew', 'owner']) assert.equal(roleAllows(role, 'task.unknown.start'), false);
  assert.equal(roleAllows('__proto__', 'task.follow.start'), false);
  const descriptions = describeRoles(); descriptions[0].permissions.push('task.stop');
  assert.equal(roleAllows('visitor', 'task.stop'), false);
});

test('assignment store normalizes names, isolates bots, transfers Owner atomically and detects stale revisions', () => {
  const store = new PlayerRoleStore('bot-a'); const other = new PlayerRoleStore('bot-b');
  assert.equal(store.roleFor('OfflineSteve'), 'visitor');
  assert.equal(store.roleFor(''), null);
  assert.ok(store.update({ username: ' Steve123 ', role: 'crew', expectedRevision: 0 }).ok);
  assert.equal(store.roleFor('STEVE123'), 'crew'); assert.equal(other.roleFor('Steve123'), 'visitor');
  assert.equal(store.update({ username: 'Steve123', role: 'owner', expectedRevision: 0 }).ok, false);
  for (const role of ['admin', '__proto__', 999, undefined]) assert.equal(store.update({ username: 'Steve123', role, expectedRevision: 1 }).ok, false);
  assert.ok(store.update({ username: 'Steve123', role: 'owner', expectedRevision: 1 }).ok);
  assert.ok(store.update({ username: 'Alex', role: 'owner', expectedRevision: 2 }).ok);
  assert.equal(store.roleFor('Steve123'), 'visitor'); assert.equal(store.roleFor('alex'), 'owner');
  assert.equal(store.snapshot().assignments.filter((entry) => entry.role === 'owner').length, 1);
  assert.ok(store.update({ username: 'ALEX', role: null, expectedRevision: 3 }).ok);
  assert.equal(store.roleFor('Alex'), 'visitor');
  const copy = store.snapshot(); copy.assignments.push({ username: 'Steve123', role: 'owner' });
  assert.equal(store.roleFor('Steve123'), 'visitor');
});

test('command service checks new requests using current roles; old created work remains unchanged', () => {
  const store = new PlayerRoleStore('bot');
  const created: unknown[] = [];
  const service = new BotCommandService(store, (action) => { created.push(action); return { ok: true }; });
  const actor = { kind: 'minecraft' as const, username: 'Steve123' };
  const excavate = { type: 'excavate', region: { x1:0,y1:64,z1:0,x2:0,y2:64,z2:0 } };
  assert.equal(service.submit(actor, excavate).ok, false);
  assert.ok(store.update({ username: 'Steve123', role: 'crew', expectedRevision: 0 }).ok);
  assert.equal(service.submit(actor, excavate).ok, true);
  const existingTask = created[0];
  assert.ok(store.update({ username: 'Steve123', role: null, expectedRevision: 1 }).ok);
  assert.equal(service.submit(actor, excavate).ok, false);
  assert.equal(created.length, 1); assert.equal(created[0], existingTask);
  assert.equal(service.submit(actor, { type: 'stop' }).ok, false);
  assert.equal(service.submit({ kind: 'deployment' }, excavate).ok, true);
  assert.equal(service.submit({ kind: 'minecraft', username: 'bad name' }, { type: 'follow', target: 'Alex' }).ok, false);
  for (const command of [{type:'invented',target:'Alex'}, {type:'attack',target:'Alex /kill'}, {...excavate,region:{...excavate.region,x1:Infinity}}, {...excavate,region:{...excavate.region,y1:1.5}}]) {
    assert.equal(service.submit({ kind:'deployment' }, command).ok, false);
  }
});

test('Minecraft parser uses exact commands and rejects malformed arity', () => {
  assert.equal(parseMinecraftCommand('Steve', '!followExtra Alex').kind, 'ignore');
  assert.equal(parseMinecraftCommand('Steve', '!stop now').kind, 'invalid');
  assert.equal(parseMinecraftCommand('Steve', '!guard Alex Steve').kind, 'invalid');
  assert.deepEqual(parseMinecraftCommand('Steve', '!FOLLOW Alex'), { kind: 'action', action: {type:'follow',target:'Alex'} });
  assert.deepEqual(parseMinecraftCommand('Steve', '!attack Alex'), { kind: 'action', action: {type:'attack',target:'Alex'} });
});

test('real session chat boundary enforces Visitor/Crew/Owner and role changes do not interrupt current follow', async () => {
  const { bot, calls } = fakeBot(); const { session } = fakeSession(bot);
  (session as unknown as { setupBotEvents(): void }).setupBotEvents();
  const chat = (username: string, message: string) => bot.emit('chat', username, message, '', {} as never, [] as never);
  chat( 'Steve123', '!attack Alex');
  assert.equal(session.currentTask, null); assert.equal(calls.attacks.length, 0);
  chat( 'Steve123', '!guard Alex');
  assert.equal(session.currentTask, null);
  chat( 'Steve123', '!dig 0 64 0 0 64 0');
  assert.equal(session.currentTask, null);
  chat( 'Steve123', '!follow Alex');
  await flush(); assert.equal(session.currentTask, 'follow');
  chat( 'Steve123', '!stop');
  assert.equal(session.currentTask, 'follow');
  assert.ok(session.updatePlayerRole({ username:'Steve123', role:'owner', expectedRevision:0 }).ok);
  assert.equal(session.currentTask, 'follow');
  chat( 'sTEVE123', '!stop');
  await flush(); assert.equal(session.currentTask, null);
  chat( 'Steve123', '!attack Alex');
  await flush(); assert.equal(session.currentTask, 'attack');
  assert.ok(session.updatePlayerRole({ username:'Steve123', role:null, expectedRevision:1 }).ok);
  assert.equal(session.currentTask, 'attack');
  chat( 'Steve123', '!stop'); assert.equal(session.currentTask, 'attack');
  session.performAction('stop'); await flush(); assert.equal(session.currentTask, null);
  chat( 'Steve123', '!attack Alex'); assert.equal(session.currentTask, null);
  session.disconnect(); await flush();
});

test('deployment access alone manages assignments; payload cannot add roles or change permissions', () => {
  const { bot } = fakeBot(); const { session } = fakeSession(bot);
  const handlers = new Map<string, (...args:any[])=>void>();
  const socket = { id:'attacker', on:(name:string, handler:(...args:any[])=>void)=>handlers.set(name,handler) };
  const manager = { getSessionForViewer:(viewer:string,id:unknown)=> viewer === 'owner-viewer' && id === 'owner-session' ? session : undefined };
  registerAccessHandlers(socket as never, manager as never);
  let outcome: any;
  handlers.get('bot:access:update')!('owner-session', { username:'Steve',role:'owner',expectedRevision:0 }, (result:unknown)=>{outcome=result;});
  assert.equal(outcome.ok, false); assert.equal(session.getPlayerAccess().revision, 0);
  socket.id = 'owner-viewer';
  handlers.get('bot:access:update')!('owner-session', { username:'Steve',role:'admin',expectedRevision:0 }, (result:unknown)=>{outcome=result;});
  assert.equal(outcome.ok, false);
  handlers.get('bot:access:update')!('owner-session', { username:'Steve',role:'crew',expectedRevision:0 }, (result:unknown)=>{outcome=result;});
  assert.equal(outcome.ok, true);
  session.disconnect();
});
