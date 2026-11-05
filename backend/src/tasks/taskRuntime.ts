import type { EquipmentOwner } from '../runtime/equipment.js';
import type { TaskOutcome } from '../../../shared/taskContracts.js';

/** Completion settles only after owned asynchronous work and cleanup have drained.
 * A rejected completion/stop means resource ownership cannot be released.
 */
export interface TaskRuntime extends EquipmentOwner {
  readonly completion: Promise<TaskOutcome>;
  readonly cleanupStarted: Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** One terminal result, including for tasks used without a session coordinator. */
export class TaskCompletion {
  readonly promise: Promise<TaskOutcome>;
  readonly cleanupStarted: Promise<void>;
  private markCleanup!: () => void;
  private resolve!: (outcome: TaskOutcome) => void;
  private reject!: (error: unknown) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.cleanupStarted = new Promise(resolve => { this.markCleanup = resolve; });
    // Explicit consumers still observe rejection; standalone tasks cannot leak it.
    void this.promise.catch(() => {});
  }
  beginCleanup(): void { this.markCleanup(); }
  complete(outcome: TaskOutcome, observer?: (outcome: TaskOutcome) => void): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(outcome);
    try { observer?.(outcome); } catch { console.warn('[Task] Completion observer failed.'); }
  }
  fail(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(error);
  }
}
