import type { Bot } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { ServerPlayer } from '../../../shared/playerContracts.js';
import { resolvePlayerTarget, trackedPlayerEntity } from './playerTarget.js';

export const PLAYER_LIST_INTERVAL_MS = 3_000;

/** Only accept the skin supplied by the server, never an arbitrary image endpoint. */
export function minecraftSkinUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'textures.minecraft.net'
      || url.port || url.username || url.password || !/^\/texture\/[a-f0-9]+$/i.test(url.pathname)) return null;
    return `https://textures.minecraft.net${url.pathname}`;
  } catch {
    return null;
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function playerHealth(bot: Bot, entity: Entity | null): ServerPlayer['health'] {
  if (!entity) return null;
  let value: unknown;
  let source: NonNullable<ServerPlayer['health']>['source'] = 'entity';
  if (entity === bot.entity) {
    value = bot.health;
    source = 'self';
  } else if (finite(entity.health)) {
    value = entity.health;
  } else {
    // Use versioned metadata names; never assume a fixed protocol field index.
    const keys = bot.registry.entitiesByName.player?.metadataKeys;
    const healthIndex = keys?.indexOf('health') ?? -1;
    value = healthIndex >= 0 ? entity.metadata[healthIndex] : undefined;
    source = 'metadata';
  }
  if (!finite(value) || value < 0) return null;
  const attributes = (entity as Entity & {
    attributes?: Record<string, { value: number; modifiers?: unknown[] }>;
  }).attributes;
  const maximum = ['minecraft:max_health', 'minecraft:generic.max_health', 'generic.max_health', 'max_health']
    .map((key) => attributes?.[key])
    .find((attribute) => attribute && finite(attribute.value) && attribute.value > 0 && !attribute.modifiers?.length);
  return { value, maximum: maximum?.value ?? null, source };
}

export function collectPlayers(bot: Bot): ServerPlayer[] {
  return Object.values(bot.players).map((player): ServerPlayer => {
    const entity = trackedPlayerEntity(bot, player);
    const isBot = player.username === bot.username || entity === bot.entity;
    const target = resolvePlayerTarget(bot, player.username);
    const distance = entity ? bot.entity.position.distanceTo(entity.position) : null;
    const modes = ['survival', 'creative', 'adventure', 'spectator'] as const;
    return {
      uuid: player.uuid,
      username: player.username,
      displayName: player.displayName?.toString() || player.username,
      skinUrl: minecraftSkinUrl(player.skinData?.url),
      isBot,
      ping: finite(player.ping) && player.ping >= 0 ? player.ping : null,
      gameMode: modes[player.gamemode] ?? 'unknown',
      visible: entity !== null,
      position: entity ? {
        x: Math.round(entity.position.x * 10) / 10,
        y: Math.round(entity.position.y * 10) / 10,
        z: Math.round(entity.position.z * 10) / 10,
        dimension: bot.game.dimension,
      } : null,
      distance: distance !== null && finite(distance) ? Math.round(distance * 10) / 10 : null,
      health: playerHealth(bot, entity),
      hunger: isBot && finite(bot.food) && bot.food >= 0 && bot.food <= 20 ? {
        value: bot.food, maximum: 20,
        saturation: finite(bot.foodSaturation) && bot.foodSaturation >= 0 ? bot.foodSaturation : null,
        source: 'self',
      } : null,
      canTarget: target.ok,
      targetUnavailableReason: target.ok ? null : target.error,
    };
  }).sort((a, b) => a.username.localeCompare(b.username));
}

/** Transport-independent, on-demand projection of Mineflayer's already cached roster. */
export class PlayerRoster {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSignature = '';
  private lastReadAt = 0;
  private cached: { players: ServerPlayer[]; updatedAt: number } | null = null;

  constructor(
    private readonly bot: Bot,
    private readonly publish: (snapshot: { players: ServerPlayer[]; updatedAt: number }) => void,
  ) {}

  setSubscribed(enabled: boolean): void {
    if (!enabled) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer) return;
    if (this.cached && Date.now() - this.lastReadAt < PLAYER_LIST_INTERVAL_MS) {
      this.publish(this.cached);
    } else {
      this.refresh(true);
    }
    this.timer = setInterval(() => this.refresh(false), PLAYER_LIST_INTERVAL_MS);
  }

  private refresh(force: boolean): void {
    const players = collectPlayers(this.bot);
    this.lastReadAt = Date.now();
    const signature = JSON.stringify(players);
    this.cached = { players, updatedAt: this.lastReadAt };
    if (force || signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.publish(this.cached);
    }
  }

  dispose(): void {
    this.setSubscribed(false);
    this.cached = null;
    this.lastSignature = '';
  }
}
