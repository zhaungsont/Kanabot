import type { Bot } from 'mineflayer';

/** Retains a captured connection until its end event confirms termination. */
export class BotConnection {
  readonly closed: Promise<void>;
  private resolve!: () => void;
  private ended = false;
  private closing = false;
  private deadline: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly bot: Bot, private readonly report: (message: string) => void) {
    this.closed = new Promise(resolve => { this.resolve = resolve; });
    bot.once('end', () => {
      this.ended = true;
      if (this.deadline) clearTimeout(this.deadline);
      this.deadline = null;
      // Mineflayer emits connect at runtime but omits it from BotEvents typings.
      (bot as NodeJS.EventEmitter).removeListener('connect', this.closeLateConnection);
      this.resolve();
    });
  }
  close(): Promise<void> {
    if (this.ended || this.closing) return this.closed;
    this.closing = true;
    // A DNS/version lookup can finish after cancellation, creating a late socket.
    (this.bot as NodeJS.EventEmitter).on('connect', this.closeLateConnection);
    this.deadline = setTimeout(() => {
      this.deadline = null;
      this.closeLateConnection();
      if (!this.ended) this.report('Connection termination is unconfirmed; automatic replacement remains blocked. Retire the deployment if it cannot finish.');
    }, 1_500);
    this.deadline.unref();
    try {
      if (typeof this.bot.quit === 'function') this.bot.quit();
      else this.bot.end('Kanabot connection canceled');
    } catch {
      this.closeLateConnection();
    }
    return this.closed;
  }
  private readonly closeLateConnection = (): void => {
    if (this.ended) return;
    const socket = this.bot._client?.socket;
    try {
      if (socket) { socket.destroy(); return; }
    } catch { /* still attempt protocol termination */ }
    try { this.bot.end('Kanabot connection canceled'); } catch { /* end remains unconfirmed */ }
  };
}
