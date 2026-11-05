import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { EquipmentService } from '../src/runtime/equipment.js';
import { ExcavateTask } from '../src/tasks/excavateTask.js';
import { ExternalWorld, DigEvidence } from '../src/excavation/world.js';
import { fromSizes, normalizeRegion } from '../src/excavation/region.js';
import { parseMinecraftCommand } from '../src/commands/minecraftCommand.js';
import { ExcavationService } from '../src/excavation/service.js';
import { excavationFixture } from './excavationFixtures.js';
import { fakeSession, flush } from './playerFixtures.js';

const region = { x1: 0, y1: 64, z1: 0, x2: 0, y2: 64, z2: 0 };
const pos = new Vec3(0, 64, 0);
const callbacks = { onEvent() {}, onProgress() {} };
const taskFor = (f: ReturnType<typeof excavationFixture>, r = region) => new ExcavateTask(f.bot, r, callbacks, new EquipmentService(f.bot));
function confirm(session: ReturnType<typeof fakeSession>['session']) {
  assert.equal(session.performAction('excavate', undefined, region).ok, true);
  const plan = session.getInfo().excavationPlan!;
  assert.ok(plan);
  return session.performExcavation({ type: 'confirm', planId: plan.planId });
}

test('all directions count the origin, omitted axes stay size one, and input is bounded before allocation', () => {
  const expected = { east: [127,64,-30], west: [113,64,-30], up: [120,71,-30], down: [120,57,-30], south: [120,64,-23], north: [120,64,-37] };
  for (const [direction, end] of Object.entries(expected)) {
    const r = fromSizes({ origin: { x:120,y:64,z:-30 }, sizes: [{direction,count:8}] });
    assert.deepEqual(r, normalizeRegion({x1:120,y1:64,z1:-30,x2:end[0],y2:end[1],z2:end[2]}));
  }
  assert.equal(fromSizes({origin:{x:0,y:64,z:0},sizes:[{direction:'east',count:1}]}).x2, 0);
  for (const sizes of [[{direction:'east',count:2},{direction:'west',count:2}], [{direction:'east',count:0}], [{direction:'east',count:1.5}], [{direction:'bad',count:1}], [{direction:'east',count:101},{direction:'south',count:100}]]) assert.throws(() => fromSizes({origin:{x:0,y:0,z:0},sizes}));
  assert.doesNotThrow(() => normalizeRegion({...region,x2:99,z2:99}));
  assert.throws(() => normalizeRegion({...region,x2:1_000_000}));
  for (const text of ['!dig from 0x10 64 0 east 1','!dig from 1e2 64 0 east 1','!dig from 0 64 0 east 1.5','!dig 0 64 0 1 64 1']) assert.equal(parseMinecraftCommand('Alex',text).kind,'invalid');
});

test('preview is read-only, confirmation is idempotent, and only verified digging produces completion', async t => {
  const f = excavationFixture(), {session} = fakeSession(f.bot); t.after(() => session.destroy());
  let digs = 0; const dig = f.bot.dig; f.bot.dig = async (...args) => { digs++; await dig(...args); };
  assert.equal(session.performAction('excavate',undefined,region).ok,true); assert.equal(digs,0); assert.equal(session.state,'idle');
  const id = session.getInfo().excavationPlan!.planId;
  assert.equal(session.performExcavation({type:'confirm',planId:id}).ok,true);
  assert.equal(session.performExcavation({type:'confirm',planId:id}).ok,true);
  await Reflect.get(session, 'tasks').current.completion; await flush();
  assert.equal(digs,1); assert.equal(session.state,'idle');
  assert.equal(session.getInfo().lastTaskOutcome?.status,'completed');
  assert.equal(session.getInfo().lastTaskOutcome?.excavation?.dug,1);
  assert.equal(session.getInfo().excavationStatus?.phase,'finished');
});

test('preferred tools use version material data, harvest tier, durability, and never silently use bare hands', async () => {
  const f = excavationFixture(), equipment = new EquipmentService(f.bot);
  const shovel=f.item('iron_shovel'), axe=f.item('iron_axe',37), wooden=f.item('wooden_pickaxe',38), pick=f.item('iron_pickaxe',39);
  f.bot.inventory.items=()=>[shovel,axe,wooden,pick];
  for (const [block,expected] of [['dirt',shovel],['oak_log',axe],['diamond_ore',pick]] as const) {
    f.set(pos,block); assert.equal(equipment.resolve({kind:'best',policy:'excavation',context:{position:pos}}),expected);
  }
  Object.assign(pick,{durabilityUsed:250});
  assert.equal(equipment.resolve({kind:'best',policy:'excavation',context:{position:pos}}),null);
  f.set(pos,'dirt'); f.bot.inventory.items=()=>[];
  const task=taskFor(f); await task.start(); const result=await task.completion;
  assert.equal(result.status,'partial'); assert.equal(result.excavation?.reasonCounts?.TOOL_UNAVAILABLE,1);
});

test('unknown cells, fluids, falling neighbors, containers and deep inaccessible cells remain incomplete', async () => {
  for (const kind of ['unknown','fluid','falling','container','deep']) {
    const f=excavationFixture(); let r=region;
    if(kind==='unknown') f.set(pos,null);
    if(kind==='fluid') f.set(pos.offset(1,0,0),'water');
    if(kind==='falling') f.set(pos.offset(0,1,0),'gravel');
    if(kind==='container') f.set(pos,'chest');
    if(kind==='deep') { r={...region,y1:50,y2:50}; f.set(new Vec3(0,50,0),'dirt'); }
    let digs=0; f.bot.dig=async()=>{digs++;}; const task=taskFor(f,r); await task.start();
    assert.equal((await task.completion).status,'partial',kind); assert.equal(digs,0,kind);
  }
});

test('external movement cannot dig/place or enter the box and original settings restore', async () => {
  const f=excavationFixture(); const previous=f.bot.pathfinder.movements;
  Object.assign(f.bot.entity,{position:new Vec3(-8.5,64,.5)});
  const go=f.bot.pathfinder.goto; let checked=false;
  f.bot.pathfinder.goto=async goal=>{
    const m=f.bot.pathfinder.movements;
    assert.equal(m.canDig,false); assert.equal(m.allow1by1towers,false); assert.deepEqual(m.scafoldingBlocks,[]);
    assert.equal(m.exclusionAreasStep.at(-1)!({position:pos} as never),100);
    checked=true; await go(goal);
  };
  const task=taskFor(f); await task.start(); assert.equal((await task.completion).status,'completed');
  assert.equal(checked,true); assert.equal(f.bot.pathfinder.movements,previous);
  assert.equal(Reflect.get(f.bot.pathfinder,'searchRadius'),-1);
});

test('a resolved noPath goto cannot authorize digging from a false arrival', async () => {
  const f=excavationFixture(); Object.assign(f.bot.entity,{position:new Vec3(-8.5,64,.5)});
  f.bot.pathfinder.goto=async()=>{}; let digs=0; f.bot.dig=async()=>{digs++;};
  const task=taskFor(f); await task.start(); assert.equal((await task.completion).status,'partial'); assert.equal(digs,0);
});

test('optimistic local air without incoming server evidence remains unverified', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=excavationFixture(); f.bot.dig=async()=>{f.set(pos,'air');};
  const task=taskFor(f); const running=task.start(); await flush(); t.mock.timers.tick(1500);
  await running; const outcome=await task.completion;
  assert.equal(outcome.status,'partial'); assert.equal(outcome.excavation?.unverified,1); assert.equal(outcome.excavation?.dug,0);
});

test('world is rechecked after equip and server rollback cannot be counted clear', async () => {
  const f=excavationFixture(); Object.assign(f.bot,{heldItem:null}); let digs=0;
  f.bot.equip=async item=>{ Object.assign(f.bot,{heldItem:item}); f.set(pos.offset(1,0,0),'water'); };
  f.bot.dig=async()=>{digs++;}; const task=taskFor(f); await task.start(); assert.equal(digs,0); assert.equal((await task.completion).status,'partial');
  const g=excavationFixture(); g.bot.dig=async()=>{g.incoming(pos,'air'); g.incoming(pos,'dirt');};
  const second=taskFor(g); await second.start(); assert.equal((await second.completion).status,'partial');
});

test('stop during active digging retains the coordinator gate when cancellation fails', async t => {
  const f=excavationFixture(),{session}=fakeSession(f.bot); t.after(()=>session.destroy());
  let release!:()=>void; f.bot.dig=()=>new Promise<void>(r=>{release=r; Object.assign(f.bot,{targetDigBlock:f.bot.blockAt(pos)});});
  f.bot.stopDigging=()=>Promise.reject(new Error('cancel failed')); confirm(session); await flush();
  session.performAction('stop'); assert.equal(session.performAction('follow','Alex').ok,false); release(); await flush(); await flush();
  assert.equal(session.getInfo().taskLifecycle?.phase,'cleanup-failed'); assert.equal(session.performAction('follow','Alex').ok,false);
  assert.equal(session.getInfo().excavationStatus?.phase,'cleanup-failed');
});

test('stop before startup and late stop at teardown cannot start new game work', async () => {
  const f=excavationFixture(); let digs=0; const dig=f.bot.dig; f.bot.dig=async(...args)=>{digs++;await dig(...args);};
  const task=taskFor(f); await task.stop(); await assert.rejects(task.start()); assert.equal(digs,0);
  const second=taskFor(f); const late=second.cleanupStarted.then(()=>second.stop()); await second.start(); await late;
  assert.equal((await second.completion).status,'completed'); assert.equal(f.bot.listenerCount('game'),0); assert.equal(f.bot._client.listenerCount('block_change'),0);
});

test('invalid height, oversized jobs and a bot inside the box are rejected before digging', async () => {
  const f=excavationFixture();
  for(const r of [{...region,y1:-65},{...region,x2:10000},{...region,x1:-3,x2:0}]) { const task=taskFor(f,r); await task.start(); assert.equal((await task.completion).status,'failed'); }
});

test('plans enforce actor, role at confirmation, expiry, busy admission, world identity and own stop after demotion', () => {
  const f=excavationFixture(); let available=true, permitted=true, starts=0, stops=0, now=Date.now();
  const original=Date.now; Date.now=()=>now;
  try {
    const service=new ExcavationService(()=>({bot:f.bot,available}),(_actor,others)=>permitted && !others ? {ok:true}:{ok:false,error:'denied'},()=>{starts++;return {ok:true};},()=>{stops++;},()=>{});
    const actor={kind:'minecraft' as const,username:'Alex'}, other={kind:'minecraft' as const,username:'Steve'};
    const prepare=()=>{const r=service.prepare(actor,{origin:pos,sizes:[{direction:'east',count:1}]}); assert.ok(r.ok&&r.plan); return r.plan.planId;};
    let planId=prepare(); assert.equal(service.submit(other,{type:'confirm',planId}).ok,false);
    permitted=false; assert.equal(service.submit(actor,{type:'confirm',planId}).ok,false); permitted=true;
    available=false; assert.equal(service.submit(actor,{type:'confirm',planId}).ok,false); available=true;
    const accepted=service.submit(actor,{type:'confirm',planId}); assert.ok(accepted.ok&&accepted.task); assert.equal(starts,1);
    service.submit(actor,{type:'confirm',planId}); assert.equal(starts,1);
    permitted=false; assert.equal(service.submit(other,{type:'stop',taskId:accepted.task.taskId}).ok,false);
    assert.equal(service.submit(actor,{type:'stop',taskId:accepted.task.taskId}).ok,true); assert.equal(stops,1);
    permitted=true; planId=prepare(); now+=120001; assert.equal(service.submit(actor,{type:'confirm',planId}).ok,false);
    planId=prepare(); Object.assign(f.bot.game,{dimension:'the_nether'}); assert.equal(service.submit(actor,{type:'confirm',planId}).ok,false);
    assert.equal(service.prepare(actor,{origin:{x:10000,y:64,z:0},sizes:[{direction:'east',count:1}]}).ok,false);
    assert.equal(service.prepare(actor,{origin:pos,sizes:[{direction:'east',count:100},{direction:'south',count:100},{direction:'up',count:100}]}).ok,false);
  } finally {Date.now=original;}
});

test('inbound whispers dispatch excavation and feedback stays private', async t => {
  const f=excavationFixture(),{session}=fakeSession(f.bot); t.after(()=>session.destroy());
  Reflect.get(session,'setupBotEvents').call(session);
  session.updatePlayerRole({username:'Alex',role:'crew',expectedRevision:0});
  f.bot.emit('whisper','Alex','!dig from 0 64 0 east 1',{},[] as never);
  assert.equal(session.state,'idle'); const whispers=f.calls.whispers.flat().join(' '); assert.match(whispers,/Plan [a-f0-9]{8}/);
  const id=whispers.match(/Plan ([a-f0-9]{8})/)![1];
  f.bot.emit('whisper','Alex',`!dig confirm ${id}`,{},[] as never); await Reflect.get(session, 'tasks').current.completion; await flush();
  assert.equal(session.getInfo().lastTaskOutcome?.status,'completed');
});

test('installed digging honors the guarded internal look cancellation and the supplied face vector', async () => {
  const require=createRequire(import.meta.url), inject=require('mineflayer/lib/plugins/digging.js');
  const f=excavationFixture(); const packets:unknown[]=[];
  Object.assign(f.bot._client,{write:(name:string,data:unknown)=>packets.push({name,data})});
  Object.assign(f.bot,{supportFeature:()=>false,swingArm(){},_updateBlockState:(p:Vec3)=>f.incoming(p,'air')});
  inject(f.bot); let release!:()=>void;
  f.bot.lookAt=()=>new Promise<void>(r=>{release=r;});
  const task=taskFor(f), running=task.start(); await flush(); assert.equal(typeof release,'function');
  const stopping=task.stop(); release(); await Promise.all([running,stopping]);
  assert.equal(packets.length,0); assert.equal((await task.completion).status,'stopped');
  f.bot.lookAt=async()=>{}; Reflect.set(f.bot,'digTime',()=>0);
  const next=taskFor(f); await next.start(); assert.equal((await next.completion).status,'completed');
  const start=packets.find((p:any)=>p.data.status===0) as any; assert.equal(start.data.face,4);
});

test('unverified optimistic air remains unknown in subsequent plans and tasks', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const f=excavationFixture();
  f.bot.dig=async()=>{f.set(pos,'air');}; const first=taskFor(f), running=first.start(); await flush(); t.mock.timers.tick(1500); await running;
  const {session}=fakeSession(f.bot); t.after(()=>session.destroy()); session.performAction('excavate',undefined,region);
  assert.equal(session.getInfo().excavationPlan?.known.unknown,1);
  const next=taskFor(f); await next.start(); assert.equal((await next.completion).status,'partial');
  assert.equal((await next.completion).excavation?.alreadyClear,0);
});

test('unknown ray coverage and lost retreat reject the next destructive action', async () => {
  const f=excavationFixture(); const world=new ExternalWorld(f.bot,region,f.bot.entity.position.floored());
  f.set(new Vec3(-1,65,0),null); f.set(new Vec3(-1,64,0),null); assert.equal(world.face(pos),null);
  const g=excavationFixture(); Object.assign(g.bot.entity,{position:new Vec3(-8.5,64,.5)}); Object.assign(g.bot,{heldItem:null});
  g.bot.equip=async item=>{ Object.assign(g.bot,{heldItem:item}); for(let z=-32;z<=32;z++)g.incoming(new Vec3(-5,64,z),'stone'); };
  let digs=0; g.bot.dig=async()=>{digs++;}; const task=taskFor(g); await task.start(); assert.equal(digs,0); assert.equal((await task.completion).status,'partial');
});

test('maximum mostly-air region is bounded and accounting sums exactly to its volume', async () => {
  const f=excavationFixture(); f.set(pos,'air'); const task=taskFor(f,{...region,x2:99,z2:99});
  await task.start(); const result=await task.completion;
  assert.equal(result.status,'completed'); const s=result.excavation!;
  assert.equal(s.total,10000); assert.equal(s.dug+s.alreadyClear+s.skipped+s.failed+s.unverified+s.unvisited,s.total);
});

test('death and world transitions invalidate drafts, and immediate scoped Stop performs no digging', async t => {
  const f=excavationFixture(), {session}=fakeSession(f.bot); t.after(()=>session.destroy()); Reflect.get(session,'setupBotEvents').call(session);
  session.performAction('excavate',undefined,region); const old=session.getInfo().excavationPlan!.planId; f.bot.emit('game');
  assert.equal(session.performExcavation({type:'confirm',planId:old}).ok,false);
  const accepted=confirm(session); assert.ok(accepted.ok&&accepted.task); let digs=0; f.bot.dig=async()=>{digs++;};
  session.performExcavation({type:'stop',taskId:accepted.task.taskId}); await Reflect.get(session,'tasks').current.completion; await flush(); assert.equal(digs,0);
  session.performAction('excavate',undefined,region); const pending=session.getInfo().excavationPlan!.planId; f.bot.emit('death');
  assert.equal(session.performExcavation({type:'confirm',planId:pending}).ok,false); assert.equal(session.state,'dead');
});

test('installed pathfinder produces only external routes without break or place actions', async () => {
  const require=createRequire(import.meta.url), pathfinder=require('mineflayer-pathfinder');
  const f=excavationFixture(); Object.assign(f.bot.entity,{position:new Vec3(-8.5,64,.5)});
  Object.assign(f.bot,{clearControlStates(){},setControlState(){}}); pathfinder.pathfinder(f.bot);
  let searches=0; const errors: unknown[] = [];
  f.bot.pathfinder.goto=async goal=>{
    try {
    searches++;
    const iterator=f.bot.pathfinder.getPathFromTo(f.bot.pathfinder.movements,f.bot.entity.position,goal,{optimizePath:false,timeout:1000,tickTimeout:1000});
    const result=iterator.next().value.result;
    assert.equal(result.status,'success');
    for(const node of result.path) {
      assert.equal(node.toBreak.length,0); assert.equal(node.toPlace.length,0);
      assert.equal(node.y,64); assert.ok(node.x<0 || node.x>0 || node.z<0 || node.z>0);
    }
    Object.assign(f.bot.entity,{position:new Vec3(Reflect.get(goal,'x')+.5,Reflect.get(goal,'y'),Reflect.get(goal,'z')+.5)});
    } catch(error) { errors.push(error); throw error; }
  };
  const task=taskFor(f); await task.start(); assert.deepEqual(errors,[]); assert.equal((await task.completion).status,'completed'); assert.ok(searches>=2);
});

test('server multi-block packets supply evidence and optimistic local events do not', async () => {
  const f=excavationFixture(); Object.assign(f.bot,{supportFeature:(name:string)=>['usesMultiblockSingleLong','usesMultiblock3DChunkCoords'].includes(name)});
  const evidence=new DigEvidence(f.bot); evidence.begin(pos);
  f.set(pos,'air'); f.bot.emit('blockUpdate',null,f.bot.blockAt(pos)); assert.equal(evidence.clear(),false);
  f.bot._client.emit('multi_block_change',{chunkCoordinates:{x:0,y:4,z:0},records:[f.bot.registry.blocksByName.air.defaultState<<12]});
  assert.equal(evidence.clear(),true); evidence.dispose(); assert.equal(f.bot._client.listenerCount('multi_block_change'),0);
});

test('occupied target support and changed preview staging are rejected conservatively', async () => {
  const f=excavationFixture();
  f.bot.entities[99]={id:99,position:new Vec3(.5,65,.5),width:2,height:3} as never;
  const task=taskFor(f); await task.start(); assert.equal((await task.completion).excavation?.reasonCounts?.OCCUPIED,1);
  const {session}=fakeSession(f.bot);
  try {
    session.performAction('excavate',undefined,region); const plan=session.getInfo().excavationPlan!;
    Object.assign(f.bot.entity,{position:new Vec3(-4.5,64,.5)});
    const result=session.performExcavation({type:'confirm',planId:plan.planId});
    assert.equal(result.ok,false); if(!result.ok)assert.match(result.error,/moved/);
  } finally {session.destroy();}
});

test('a block changed during the final equip cannot be dug with a stale preferred tool', async () => {
  const f=excavationFixture(), axe=f.item('iron_axe',37), pick=f.item('iron_pickaxe',38);
  f.bot.inventory.items=()=>[f.shovel,axe,pick]; Object.assign(f.bot,{heldItem:null});
  let equips=0,digs=0;
  f.bot.equip=async item=>{ Object.assign(f.bot,{heldItem:item}); f.set(pos,++equips===1?'oak_log':'diamond_ore'); };
  f.bot.dig=async()=>{digs++;}; const task=taskFor(f); await task.start();
  assert.equal(digs,0); assert.equal((await task.completion).excavation?.reasonCounts?.TOOL_CHANGED,1);
});
