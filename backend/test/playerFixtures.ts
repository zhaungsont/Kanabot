import { EventEmitter } from 'node:events';
import type { Bot, Player } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BotSession } from '../src/botSession.js';

export function fakeBot() {
  const weapon = { name: 'iron_sword', type: 1, slot: 36, metadata: 0, enchants: [], maxDurability: 250, durabilityUsed: 0 };
  const calls: { goals: unknown[]; whispers: unknown[][]; attacks: unknown[]; stops: number } = {
    goals: [], whispers: [], attacks: [], stops: 0,
  };
  const bot = Object.assign(new EventEmitter(), {
    username: 'mc_bot', health: 18, heldItem: weapon,
    entity: { id: 1, username: 'mc_bot', isValid: true, position: new Vec3(0, 64, 0), metadata: [] },
    game: { dimension: 'overworld' },
    registry: { entitiesByName: { player: { metadataKeys: ['flags', 'health'] } } },
    entities: {} as Record<number, unknown>, players: {} as Record<string, Player>,
    blockAt: (_position: Vec3) => ({ name: 'air' }) as unknown,
    inventory: { items: () => [weapon] as { name: string }[], slots: Array(46).fill(null) },
    equip: async (_item: unknown, _slot: string) => {},
    whisper: (...args: unknown[]) => { calls.whispers.push(args); },
    chat: (_message: string) => {}, quit: () => {},
    pathfinder: {
      thinkTimeout: 5_000, tickTimeout: 40, searchRadius: -1,
      movements: { canDig: true, allow1by1towers: true },
      setMovements(value: unknown) { this.movements = value as typeof this.movements; },
      setGoal(value: unknown) { calls.goals.push(value); },
      stop() { bot.emit('path_stop'); },
    },
    pvp: {
      target: undefined as unknown,
      movements: { canDig: true },
      attack: async (entity: unknown) => { calls.attacks.push(entity); bot.pvp.target = entity; },
      stop: async () => { calls.stops++; },
      forceStop: () => { if (bot.pvp.target) calls.stops++; bot.pvp.target = undefined; bot.pathfinder.setGoal(null); },
    },
  });
  bot.equip = async item => { Object.assign(bot, { heldItem: item }); };
  Object.assign(bot, { lookAt: async () => {}, getEquipmentDestSlot: (slot: string) => ({ head: 5, torso: 6, legs: 7, feet: 8, hand: 36, 'off-hand': 45 }[slot]) });
  bot.entities[1] = bot.entity;
  const self = { username: 'mc_bot', uuid: 'bot-uuid', gamemode: 0, ping: 0, entity: bot.entity } as unknown as Player;
  const alex = {
    username: 'Alex', uuid: 'alex-uuid', gamemode: 0, ping: 42,
    entity: { id: 2, username: 'Alex', isValid: true, position: new Vec3(10, 64, 0), metadata: [] },
    skinData: { url: 'http://textures.minecraft.net/texture/abcdef', model: null },
  } as unknown as Player;
  const far = { username: 'FarAway', uuid: 'far-uuid', gamemode: 0, ping: 100, entity: undefined } as unknown as Player;
  bot.players = { mc_bot: self, Alex: alex, FarAway: far };
  bot.entities[2] = alex.entity;
  return { bot: bot as unknown as Bot, raw: bot, calls, alex };
}

export function fakeSession(bot: Bot) {
  const events: { type: string; message: string }[] = [];
  const chats: unknown[] = [];
  const session = new BotSession('owner-session', { serverHost: 'example.test', botName: 'mc_bot' }, {
    onChat: (message) => chats.push(message), onEvent: (event) => events.push(event),
    onStateChange() {}, onDestroy() {}, onArmor() {}, onPlayers() {},
  });
  Object.assign(session, { bot, state: 'idle' });
  return { session, events, chats };
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
