export type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
export type { PlayerCommand, PlayerCommandResult, PlayerListSnapshot, ServerPlayer } from '../../shared/playerContracts.js';

export type TaskType = 'follow' | 'guard' | 'excavate' | 'attack' | null;
export type ArmorSlotId = 'head' | 'torso' | 'legs' | 'feet';

export interface ArmorSlot {
  slot: ArmorSlotId;
  name: string | null;
  displayName: string | null;
}

export interface ExcavateRegion {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

export interface BotConfig {
  serverHost: string;
  serverPort?: number;
  botName: string;
  version?: string;
}

export interface BotSessionInfo {
  sessionId: string;
  config: BotConfig;
  state: BotState;
  currentTask: TaskType;
  taskTarget: string | null;
  spawnedAt: Date | null;
  uptime: number;
}

export interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
  isBot?: boolean;
  channel?: 'whisper';
  recipient?: string;
}

export interface EventLogEntry {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export type BotAction =
  | { type: 'follow' | 'guard' | 'attack'; target: string }
  | { type: 'stop' }
  | { type: 'excavate'; region: ExcavateRegion };
