export type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
export type TaskType = 'follow' | 'guard' | null;

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

export interface BotAction {
  type: 'follow' | 'guard' | 'stop';
  target?: string;
}
