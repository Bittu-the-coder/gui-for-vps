/**
 * Registers the service worker (public/sw.js) so GFV can be installed as an app and shows a friendly page
 * when it is not running. Production only: in dev the Vite server owns every request. A failure is
 * harmless (GFV works the same without it), so it is only logged.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
      console.warn('GFV: the service worker could not be registered', e);
    });
  });
}
