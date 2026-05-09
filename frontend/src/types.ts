export type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
export type TaskType = 'follow' | 'guard' | 'excavate' | null;

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
}

export interface EventLogEntry {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export type BotAction =
  | { type: 'follow' | 'guard'; target: string }
  | { type: 'stop' }
  | { type: 'excavate'; region: ExcavateRegion };
