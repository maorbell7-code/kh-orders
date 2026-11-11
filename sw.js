// גרסה 828c3945f3. קוד האפליקציה מהמטמון כדי שתיפתח מהר; בכל פתיחה נבדקת גרסה חדשה ברשת.
const SHELL = 'shell-828c3945f3';
const FILES = ['./', 'index.html', 'remote.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', ev => ev.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', ev => ev.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', ev => {
  const req = ev.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // network first, so a new version shows up as soon as there is a connection
  ev.respondWith(fetch(req).then(res => { if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone())); return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
