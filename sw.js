/* 멸종위기종 전자야장 Service Worker */
const VER = 'v1.2.0';
const SHELL = 'es-shell-' + VER;
const TILES = 'es-tiles';
const SHELL_FILES = ['./', './index.html', './registry.json', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];
const MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all([
    c.addAll(SHELL_FILES),
    ...CDN.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {}))
  ])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('es-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

let puts = 0;
async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 날씨·주소·고도 API는 항상 네트워크
  if (/open-meteo\.com|nominatim\.openstreetmap\.org/.test(url.hostname)) return;

  // 지도 타일: 캐시 우선 (현장 오프라인 대비)
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); if (++puts % 100 === 0) trimTiles(); }
        return res;
      } catch (_) { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // 레지스트리: 네트워크 우선 (새 버전 즉시 반영), 오프라인이면 캐시
  if (url.origin === location.origin && url.pathname.endsWith('/registry.json')) {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const cp = res.clone(); caches.open(SHELL).then(c => c.put('./registry.json', cp)); } return res; })
      .catch(() => caches.match('./registry.json', { ignoreSearch: true })));
    return;
  }

  // 페이지 이동: 네트워크 우선, 실패 시 캐시
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const cp = res.clone(); caches.open(SHELL).then(c => c.put('./index.html', cp)); return res; })
      .catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }

  // 앱 파일·라이브러리: 캐시 후 백그라운드 갱신
  if (url.origin === location.origin || CDN.includes(req.url)) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
