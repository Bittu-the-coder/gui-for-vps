import type { RunMsg } from '@gfv/shared';

const MAX_REPLAY_BYTES = 1 << 20; // keep at most 1 MB of output for late joiners
export const TAIL_BYTES = 8 * 1024; // what history keeps

/**
 * One in-flight (or just finished) run. Keeps every message so a browser that connects
 * a moment after POST /api/runs still sees the whole output (replay), then live ones.
 */
export class Run {
  readonly messages: RunMsg[] = [];
  private bytes = 0;
  private truncated = false;
  private subs = new Set<(m: RunMsg) => void>();
  private tail = '';
  finished = false;
  exitCode: number | null = null;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(readonly id: string) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  get outputTail(): string {
    return this.tail;
  }

  emit(m: RunMsg): void {
    if (m.type === 'output') {
      this.tail = (this.tail + m.text).slice(-TAIL_BYTES);
      this.bytes += m.text.length;
      if (this.bytes > MAX_REPLAY_BYTES) {
        // Live viewers still get it; only the replay buffer stops growing.
        if (!this.truncated) {
          this.truncated = true;
          this.messages.push({ type: 'truncated' });
        }
      } else this.messages.push(m);
    } else this.messages.push(m);
    if (m.type === 'done' || m.type === 'error') {
      this.finished = true;
      if (m.type === 'done') this.exitCode = m.exitCode;
    }
    for (const s of this.subs) s(m);
    if (this.finished) this.resolveDone();
  }

  /** Replays history, then streams live. Returns an unsubscribe function. */
  subscribe(fn: (m: RunMsg) => void): () => void {
    for (const m of this.messages) fn(m);
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
