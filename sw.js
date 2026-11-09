// Service worker: offline app shell + bounded image cache.
// Bump VERSION whenever app files change so clients pick up the new shell.
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const IMG = 'img-v1';
const MAX_IMAGES = 400; // ~20 KB each → roughly 8 MB ceiling for cached card thumbnails/logos

const SHELL_FILES = ['./', './index.html', './css/styles.css', './js/app.js', './js/api.js', './js/db.js',
  './js/views-sets.js', './js/views-dex.js', './js/views-more.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) { e.respondWith(shellFirst(e.request)); return; }
  if (url.hostname === 'assets.tcgdex.net' || url.hostname === 'raw.githubusercontent.com') { e.respondWith(imageCache(e.request)); return; }
  // API JSON is cached in IndexedDB by the app; let it go straight to the network.
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

// Images: cache-first with a simple FIFO cap so storage stays small.
async function imageCache(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req, { mode: 'cors' });
    if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trim(cache); }
    return res;
  } catch { return new Response('', { status: 504 }); }
}
let trimming = false;
async function trim(cache) {
  if (trimming) return; trimming = true;
  try { const keys = await cache.keys(); if (keys.length > MAX_IMAGES) await Promise.all(keys.slice(0, keys.length - MAX_IMAGES).map(k => cache.delete(k))); }
  finally { trimming = false; }
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
