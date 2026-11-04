export interface UpkeepSettings { autoEat: boolean; autoArmor: boolean; }
export interface UpkeepStatus {
  settings: UpkeepSettings;
  activity: 'monitoring' | 'waiting' | 'eating' | 'armor' | 'restoring' | 'blocked' | 'cleanup-failed';
  detail: string;
}
