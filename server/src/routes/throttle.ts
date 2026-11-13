/**
 * Slows down password guessing. The first few wrong attempts are free; after that every
 * further failure doubles the wait (1 s, 2 s, 4 s ... up to a minute). In memory only: a
 * restart resets it, which is fine for an app that only listens on this computer.
 */
export class AttemptThrottle {
  private failures = 0;
  private blockedUntil = 0;

  constructor(
    private readonly free = 3,
    private readonly maxDelayMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds to wait before another attempt is allowed (0 = go ahead). */
  retryAfterMs(): number {
    return Math.max(0, this.blockedUntil - this.now());
  }

  fail(): void {
    this.failures++;
    const over = this.failures - this.free;
    if (over > 0)
      this.blockedUntil = this.now() + Math.min(this.maxDelayMs, 1000 * 2 ** (over - 1));
  }

  succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}
