import { useEffect, useRef } from 'react';

/**
 * Calls `fn` now and then every `ms`, while `enabled` and the browser tab is visible.
 * A slow call is never overlapped by the next one.
 */
export function usePolling(fn: () => Promise<void>, ms: number, enabled = true): void {
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (busy || stopped || document.hidden) return;
      busy = true;
      try {
        await latest.current();
      } catch {
        /* the caller shows its own errors */
      } finally {
        busy = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), ms);
    const onVisible = () => !document.hidden && void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms, enabled]);
}
