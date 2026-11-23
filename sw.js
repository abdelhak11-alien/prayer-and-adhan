/* Service worker — makes the site work offline and installable */
const VER = 'v2';
const CORE = 'core-' + VER, RUNTIME = 'runtime-' + VER;
const FILES = ['./', 'index.html', 'manifest.json', 'quran.json', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CORE);
    await c.addAll(FILES);
    for (const f of ['adhan.mp3', 'adhan-fajr.mp3']) { try { await c.add(f); } catch (err) { /* optional until you add the file */ } }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CORE && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Audio needs Range responses; rebuild them from the cached full file.
async function rangeFrom(req, res) {
  const h = req.headers.get('range');
  if (!h || !res || res.status !== 200) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(h) || [];
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1)
    }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.aladhan.com') return;               // prayer API: always live

  if (req.mode === 'navigate') {                                // pages: network first, cache fallback
    e.respondWith(fetch(req).then(r => { caches.open(CORE).then(c => c.put('index.html', r.clone())); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }

  if (url.origin === location.origin) {                         // own files: cache first, refresh in background
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const net = fetch(req).then(async r => {
        if (r && r.status === 200) { const c = await caches.open(CORE); c.put(url.pathname.split('/').pop() || 'index.html', r.clone()).catch(() => {}); }
        return r;
      }).catch(() => null);
      if (cached) { net.catch(() => {}); return rangeFrom(req, cached); }
      const r = await net;
      return r || new Response('', { status: 504 });
    })());
    return;
  }

  e.respondWith((async () => {                                  // fonts & CDN: cache as you go
    const c = await caches.open(RUNTIME);
    const cached = await c.match(req);
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
    return cached || (await net) || new Response('', { status: 504 });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return clients.openWindow('./');
  })());
});
