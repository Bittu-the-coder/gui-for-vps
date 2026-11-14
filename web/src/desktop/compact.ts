import { useSyncExternalStore } from 'react';

/**
 * Compact (phone) layout switch. It is decided by the measured width of the browser, never by the
 * user agent, so a narrow desktop window gets the same layout. Tablets (>= 768 px) keep the desktop.
 */
export const COMPACT_QUERY = '(max-width: 767px)';

const query = () =>
  typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;

export function isCompact(): boolean {
  return query()?.matches ?? false;
}

function subscribe(cb: () => void): () => void {
  const q = query();
  q?.addEventListener('change', cb);
  return () => q?.removeEventListener('change', cb);
}

/** True while the browser is narrower than 768 px. Re-renders when it changes. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, isCompact, () => false);
}
