// Service worker: offline app shell.
// Bump VERSION whenever app files change so clients pick up the new shell.
// Card images are NOT cached here on purpose: the image CDN serves them with a one-year
// immutable cache header, so the browser's own HTTP cache handles them efficiently. (It also
// sends a duplicated CORS header, which makes a CORS-mode fetch from a worker fail.)
const VERSION = 'v1.2.0';
const SHELL = `shell-${VERSION}`;

const SHELL_FILES = ['./', './index.html', './css/styles.css', './js/app.js', './js/api.js', './js/db.js',
  './js/views-sets.js', './js/views-dex.js', './js/views-more.js', './js/views-lookup.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('shell-') && k !== SHELL) || k.startsWith('img-')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) { e.respondWith(shellFirst(e.request)); return; }
  // Everything else (card images, API JSON) goes straight to the network. JSON is cached in
  // IndexedDB by the app; images are cached by the browser's HTTP cache.
});

// App shell: cache, then refresh in the background so updates land on the next open.
async function shellFirst(req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  const res = await network;
  return res || (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
}

// Periodic background sync (Chrome on Android, installed PWAs only): poke the sets endpoint and tell open clients.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-sets') e.waitUntil(fetch('https://api.tcgdex.net/v2/en/sets').then(() => notifyClients()).catch(() => {}));
});
async function notifyClients() {
  const all = await self.clients.matchAll({ includeUncontrolled: true });
  all.forEach(c => c.postMessage({ type: 'sets-updated' }));
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => { if (list.length) return list[0].focus(); return self.clients.openWindow('./#/sets'); }));
});
