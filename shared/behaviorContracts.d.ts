export interface BehaviorSettings {
  /** Legacy request compatibility only; execution is owned exclusively by Upkeep. */
  autoEat?: boolean;
  avoidDrowning?: boolean;
  selfDefense: { enabled: boolean; mode: 'fight' | 'flight'; durationSeconds: number };
}
export interface BehaviorStatus {
  settings: BehaviorSettings;
  activity: 'idle' | 'defending' | 'surfacing' | 'stopping' | 'cleanup-failed';
  detail: string;
}
