/** Local execution outcomes; these do not imply durable command delivery. */
export interface ExcavationSummary {
  total: number;
  dug: number;
  alreadyClear: number;
  skipped: number;
  failed: number;
  unverified: number;
  unvisited: number;
  reasonCounts?: Record<string, number>;
  returnedToStaging?: boolean;
}
export interface TaskOutcome {
  status: 'completed' | 'partial' | 'stopped' | 'failed';
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  code?: 'PLAYER_UNREACHABLE';
  excavation?: ExcavationSummary;
}
export interface TaskLifecycleStatus {
  phase: 'running' | 'stopping' | 'cleanup-failed';
  detail: string;
}
