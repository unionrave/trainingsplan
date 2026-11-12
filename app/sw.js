/* Service Worker: macht die App offline nutzbar.
   - Programmdateien: zuerst Netz (damit Updates nach einem git pull sofort ankommen), sonst Zwischenspeicher
   - Schriften, Symbole, Übungsbilder: aus dem Zwischenspeicher, beim ersten Mal geladen
   - /api/ wird nie abgefangen; Speichern und Synchronisieren macht die App selbst */
const VERSION = 'v1';
const SHELL = 'tp-shell-' + VERSION, RUN = 'tp-run-' + VERSION;
const PRECACHE = ['/', '/library.json', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/fonts/big-shoulders-display-latin-700-normal.woff2', '/fonts/big-shoulders-display-latin-800-normal.woff2',
  '/fonts/barlow-latin-400-normal.woff2', '/fonts/barlow-latin-500-normal.woff2', '/fonts/barlow-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, RUN].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const networkFirst = async (req, key, ms) => {
  const cache = await caches.open(SHELL);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(req, { cache: 'no-cache', signal: ctl.signal }); clearTimeout(t);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
};
const cacheFirst = async (req) => {
  const hit = await caches.match(req); if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(RUN)).put(req, res.clone());
  return res;
};
const revalidate = async (req) => {
  const cache = await caches.open(SHELL), hit = await cache.match(req);
  const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || new Response('[]', { status: 503 });
};

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') return e.respondWith(networkFirst(req, '/', 4000));
  if (url.pathname === '/library.json') return e.respondWith(revalidate(req));
  if (/^\/(fonts|icons|img)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') return e.respondWith(cacheFirst(req).catch(() => new Response('', { status: 504 })));
});
