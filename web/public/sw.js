/*
 * GFV service worker. It is deliberately tiny and does two things only:
 *   1. caches the built, content-hashed files under /assets/ (cache-first: a hashed name never changes);
 *   2. shows /offline.html when a page load fails because GFV is not running.
 * It NEVER touches /api (including the WebSockets), the HTML of the app, or anything cross-origin: the
 * API carries credentials and live server data, and none of it may be stored or replayed.
 */
const ASSETS = 'gfv-assets-v1';
const SHELL = 'gfv-shell-v1';
const OFFLINE = '/offline.html';

/** Every release has new hashed file names: keep the cache from growing for ever (oldest entries go first). */
async function trim(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - 150)).map((k) => cache.delete(k)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(OFFLINE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== ASSETS && k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await cache.put(req, res.clone());
          await trim(cache);
        }
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.open(SHELL).then((c) => c.match(OFFLINE))));
  }
  // Everything else (/api, WebSockets, icons, the manifest) goes straight to the network.
});
