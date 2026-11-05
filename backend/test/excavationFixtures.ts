import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Item } from 'prismarine-item';
import { Vec3 } from 'vec3';
import { fakeBot } from './playerFixtures.js';

const require = createRequire(import.meta.url);
export function excavationWorld(bot: Bot) {
  const registry = require('prismarine-registry')('1.21.4');
  const Block = require('prismarine-block')(registry);
  const World = require('prismarine-world')(registry);
  const world = new World().sync;
  const overrides = new Map<string, string | null>();
  const block = (pos: Vec3, name: string): Block => {
    const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0);
    b.position = pos.floored(); return b;
  };
  Object.assign(bot, { registry, world, _client: new EventEmitter() });
  Object.assign(bot.game, { minY: -64, height: 384 });
  Object.assign(bot.entity, { position: new Vec3(-2.5, 64, .5), height: 1.8, eyeHeight: 1.62 });
  bot.blockAt = pos => {
    const p = pos.floored(), key = p.toString();
    const name = overrides.has(key) ? overrides.get(key)! : p.y < 64 ? 'stone' : 'air';
    return name === null ? null : block(p, name);
  };
  world.getBlock = (pos: Vec3) => bot.blockAt(pos);
  const set = (pos: Vec3, name: string | null) => overrides.set(pos.floored().toString(), name);
  const incoming = (pos: Vec3, name: string) => {
    const old = bot.blockAt(pos); set(pos, name); const next = bot.blockAt(pos)!;
    bot._client.emit('block_change', { location: pos, type: next.stateId });
    bot.emit(`blockUpdate:${pos}`, old, next);
    bot.emit('blockUpdate', old, next);
  };
  bot.pathfinder.goto = async goal => { Object.assign(bot.entity, { position: new Vec3(Reflect.get(goal, 'x') + .5, Reflect.get(goal, 'y'), Reflect.get(goal, 'z') + .5) }); };
  bot.canDigBlock = () => true;
  bot.dig = async target => { incoming(target.position, 'air'); };
  const item = (name: string, slot = 36): Item => ({ ...registry.itemsByName[name], type: registry.itemsByName[name].id, name, metadata: 0, slot, enchants: [], durabilityUsed: 0, maxDurability: 250 } as unknown as Item);
  return { set, incoming, block, item };
}
export function excavationFixture() {
  const f = fakeBot(), w = excavationWorld(f.bot);
  const shovel = w.item('iron_shovel');
  f.bot.inventory.items = () => [shovel]; Object.assign(f.bot, { heldItem: shovel });
  w.set(new Vec3(0, 64, 0), 'dirt');
  return { ...f, ...w, shovel };
}
