import type { TaskLifecycleStatus, TaskOutcome } from '../../../shared/taskContracts.js';
import type { TaskRuntime } from './taskRuntime.js';

interface Entry {
  task: TaskRuntime;
  phase: TaskLifecycleStatus['phase'];
  detail: string;
  deadline: ReturnType<typeof setTimeout> | null;
}

/** One local task lease. A deadline reports trouble; only confirmed cleanup releases it. */
export class TaskCoordinator {
  private entry: Entry | null = null;
  private disposed = false;
  constructor(private readonly changed: () => void, private readonly logFailure: (message: string) => void) {}

  get busy(): boolean { return this.entry !== null; }
  get current(): TaskRuntime | null { return this.entry?.task ?? null; }
  get owner(): TaskRuntime | null { return this.entry?.task.active ? this.entry.task : null; }
  get status(): TaskLifecycleStatus | undefined {
    return this.entry ? { phase: this.entry.phase, detail: this.entry.detail } : undefined;
  }
  start(task: TaskRuntime, finished: (outcome: TaskOutcome) => void): void {
    if (this.disposed) throw new Error('Task coordinator has been retired.');
    if (this.entry) throw new Error('The previous task is still stopping or active.');
    const entry: Entry = { task, phase: 'running', detail: 'Task owns its runtime resources.', deadline: null };
    this.entry = entry;
    void task.cleanupStarted.then(() => this.beginStopping(entry));
    void task.completion.then(outcome => {
      if (this.entry !== entry) return;
      if (entry.deadline) clearTimeout(entry.deadline);
      this.entry = null;
      if (!this.disposed) {
        try { finished(outcome); } finally { this.changed(); }
      }
    }, error => this.failed(entry, error)).catch(() => {
      this.logFailure('Task outcome observer failed.');
    });
    this.changed();
    try {
      // The task reports startup failure through completion. A late rejection
      // must never cancel a successor that already owns the coordinator.
      void task.start().catch(() => { if (this.entry === entry) this.stop(); });
    } catch {
      this.stop();
    }
  }
  stop(): void {
    const entry = this.entry;
    if (!entry || entry.phase !== 'running') return;
    this.beginStopping(entry);
    try { void entry.task.stop().catch(error => this.failed(entry, error)); }
    catch (error) { this.failed(entry, error); }
  }
  private beginStopping(entry: Entry): void {
    if (this.entry !== entry || entry.phase !== 'running') return;
    entry.phase = 'stopping';
    entry.detail = 'Waiting for owned work and cleanup to finish.';
    if (!this.disposed) entry.deadline = setTimeout(() => {
      entry.deadline = null;
      this.failed(entry, new Error('Task cleanup is still pending after 10 seconds.'));
    }, 10_000);
    this.changed();
  }
  dispose(): void {
    this.stop();
    this.disposed = true;
    if (this.entry?.deadline) clearTimeout(this.entry.deadline);
    if (this.entry) this.entry.deadline = null;
  }
  private failed(entry: Entry, error: unknown): void {
    if (this.entry !== entry) return;
    if (entry.deadline) clearTimeout(entry.deadline);
    entry.deadline = null;
    if (entry.phase === 'cleanup-failed') return;
    entry.phase = 'cleanup-failed';
    entry.detail = `Task cleanup is unconfirmed; retire this deployment before starting another task: ${String(error)}`;
    this.logFailure(entry.detail);
    this.changed();
  }
}
