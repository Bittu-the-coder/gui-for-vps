import { describe, expect, it } from 'vitest';
import { AttemptThrottle } from './throttle.js';

describe('AttemptThrottle', () => {
  it('allows a few free attempts, then doubles the wait up to the cap', () => {
    let t = 0;
    const th = new AttemptThrottle(3, 8000, () => t);
    for (let i = 0; i < 3; i++) {
      expect(th.retryAfterMs()).toBe(0);
      th.fail();
    }
    expect(th.retryAfterMs()).toBe(0); // third failure was still free
    th.fail(); // 4th: 1 s
    expect(th.retryAfterMs()).toBe(1000);
    t += 1000;
    th.fail(); // 5th: 2 s
    expect(th.retryAfterMs()).toBe(2000);
    t += 2000;
    th.fail(); // 6th: 4 s
    t += 4000;
    th.fail(); // 7th: 8 s
    expect(th.retryAfterMs()).toBe(8000);
    t += 8000;
    th.fail(); // 8th: capped at 8 s
    expect(th.retryAfterMs()).toBe(8000);
  });
  it('the wait counts down, and success resets everything', () => {
    let t = 0;
    const th = new AttemptThrottle(1, 60_000, () => t);
    th.fail();
    th.fail(); // 1 s
    t += 400;
    expect(th.retryAfterMs()).toBe(600);
    th.succeed();
    expect(th.retryAfterMs()).toBe(0);
    th.fail();
    expect(th.retryAfterMs()).toBe(0);
  });
});
