/** JSON-only contracts shared by the dashboard, transport adapters, and bot runtime. */
export interface ServerPlayer {
  uuid: string;
  username: string;
  displayName: string;
  skinUrl: string | null;
  isBot: boolean;
  ping: number | null;
  gameMode: 'survival' | 'creative' | 'adventure' | 'spectator' | 'unknown';
  visible: boolean;
  position: { x: number; y: number; z: number; dimension: string } | null;
  distance: number | null;
  health: { value: number; maximum: number | null; source: 'self' | 'entity' | 'metadata' } | null;
  /** Vanilla exposes hunger/saturation only for this bot, not other players. */
  hunger: { value: number; maximum: 20; saturation: number | null; source: 'self' } | null;
  canTarget: boolean;
  targetUnavailableReason: string | null;
}

export interface PlayerListSnapshot {
  sessionId: string;
  players: ServerPlayer[];
  updatedAt: number;
}

export type PlayerCommand =
  | { type: 'whisper'; target: string; message: string }
  | { type: 'follow' | 'attack'; target: string };

export type PlayerCommandResult = { ok: true } | { ok: false; error: string };
