/** Data exchanged with clients; no runtime, transport, or React dependencies. */
export type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
export type TaskType = 'follow' | 'protect' | 'excavate' | 'attack' | null;
export interface ProtectStatus {
  phase: 'preparing' | 'escorting' | 'engaging' | 'returning' | 'stopping' | 'cleanup-failed';
  player: string;
  threat: { id: number; name: string; reason: string } | null;
  closestDistance: number | null;
  equipment: 'ready' | 'unavailable';
  detail: string;
}
export type ArmorSlotId = 'head' | 'torso' | 'legs' | 'feet';
export interface ArmorSlot { slot: ArmorSlotId; name: string | null; displayName: string | null; }
export interface ExcavateRegion { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; }
export interface BotConfig { serverHost: string; serverPort?: number; botName: string; version?: string; }
export interface BotSessionInfo {
  sessionId: string;
  config: BotConfig;
  state: BotState;
  currentTask: TaskType;
  taskTarget: string | null;
  /** ISO timestamp on the wire, milliseconds only for durations. */
  spawnedAt: string | null;
  uptime: number;
  protect?: ProtectStatus;
  behaviors?: import('./behaviorContracts.js').BehaviorStatus;
  upkeep?: import('./upkeepContracts.js').UpkeepStatus;
  taskLifecycle?: import('./taskContracts.js').TaskLifecycleStatus;
  lastTaskOutcome?: import('./taskContracts.js').TaskOutcome;
}
export interface ChatMessage {
  username: string; message: string; timestamp: number; isBot?: boolean;
  channel?: 'whisper'; recipient?: string;
}
export interface EventLogEntry { type: 'info' | 'success' | 'warning' | 'error'; message: string; timestamp: number; }
export type BotAction =
  | { type: 'follow' | 'protect' | 'guard' | 'attack'; target: string }
  | { type: 'stop' }
  | { type: 'excavate'; region: ExcavateRegion };
