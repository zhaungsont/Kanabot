import type { Bot, Player } from 'mineflayer';
import type { Entity } from 'prismarine-entity';

export const MAX_PLAYER_TASK_DISTANCE = 64;
export const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

export function findPlayer(bot: Bot, name: string): Player | undefined {
  return bot.players[name] ?? Object.values(bot.players).find(
    (player) => player.username.toLowerCase() === name.toLowerCase(),
  );
}

/** Roster presence does not imply that a player's entity/chunks are observable. */
export function trackedPlayerEntity(bot: Bot, player: Player): Entity | null {
  const entity = player.entity;
  if (!entity || entity.isValid === false || bot.entities[entity.id] !== entity) return null;
  const dimension = (entity as Entity & { dimension?: string }).dimension;
  if (dimension && dimension !== bot.game.dimension) return null;
  if (![entity.position.x, entity.position.y, entity.position.z].every(Number.isFinite)) return null;
  return entity;
}

export type PlayerTarget =
  | { ok: true; player: Player; entity: Entity; distance: number }
  | { ok: false; error: string };

export function resolvePlayerTarget(bot: Bot, name: string): PlayerTarget {
  if (typeof name !== 'string' || !PLAYER_NAME_PATTERN.test(name)) return { ok: false, error: 'Invalid Minecraft player name.' };
  const player = findPlayer(bot, name);
  if (!player) return { ok: false, error: `Player "${name}" is no longer on the server.` };
  if (player.username === bot.username || player.entity === bot.entity) {
    return { ok: false, error: 'The bot cannot target itself.' };
  }
  const entity = trackedPlayerEntity(bot, player);
  if (!entity) {
    return { ok: false, error: `"${player.username}" is not tracked: they may be too far away or in another dimension.` };
  }
  const distance = bot.entity.position.distanceTo(entity.position);
  if (!Number.isFinite(distance) || distance > MAX_PLAYER_TASK_DISTANCE) {
    return { ok: false, error: `"${player.username}" is beyond the ${MAX_PLAYER_TASK_DISTANCE}-block task limit.` };
  }
  if (!bot.blockAt(entity.position)) {
    return { ok: false, error: `The chunk around "${player.username}" is not loaded. Move closer first.` };
  }
  if (player.gamemode === 3) return { ok: false, error: 'Spectator players cannot be followed or attacked.' };
  return { ok: true, player, entity, distance };
}
