import { useEffect, useState } from 'react';

/** Browser full screen for the whole GUI (the Fullscreen API; F11 does the same for the browser window). */
export const fullscreenSupported = () =>
  typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

export const isFullscreen = () => typeof document !== 'undefined' && !!document.fullscreenElement;

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* refused (no user gesture, or blocked by the browser): nothing to do */
  }
}

/** True while the page is in full screen (also changes when the user presses Esc or F11). */
export function useFullscreen(): boolean {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const h = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  return on;
}
