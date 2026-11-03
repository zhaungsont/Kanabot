export interface BehaviorSettings {
  autoEat: boolean;
  selfDefense: { enabled: boolean; mode: 'fight' | 'flight'; durationSeconds: number };
}
export interface BehaviorStatus {
  settings: BehaviorSettings;
  activity: 'idle' | 'eating' | 'defending' | 'stopping' | 'cleanup-failed';
  detail: string;
}
