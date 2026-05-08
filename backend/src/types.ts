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

export interface ServerToClientEvents {
  'bot:state': (info: BotSessionInfo) => void;
  'bot:chat': (message: ChatMessage) => void;
  'bot:event': (entry: EventLogEntry) => void;
  'bot:error': (message: string) => void;
}

export interface ClientToServerEvents {
  'bot:create': (
    config: BotConfig,
    callback: (sessionId: string | null, error?: string) => void
  ) => void;
  'bot:disconnect': (sessionId: string) => void;
  'bot:chat': (sessionId: string, message: string) => void;
  'bot:action': (sessionId: string, action: BotAction) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  sessionId?: string;
}
