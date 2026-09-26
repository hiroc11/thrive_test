const CACHE = 'futari-v6';
const ASSETS = ['./', 'index.html', 'style.css', 'icons.js', 'illustrations.js', 'logic.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 同期APIや別ドメインへの通信はキャッシュしない
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// ---------- プッシュ通知 ----------
// アプリのアイコンの数字（バッジ）。アプリを閉じていても通知が届くたびに更新する
function setBadge(n) {
  const nav = self.navigator;
  if (!nav || !('setAppBadge' in nav) || typeof n !== 'number') return Promise.resolve();
  return (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => {});
}

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(data.title || 'ふたりの暮らし', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { tab: data.tab || 'home' },
    }),
    setBadge(data.badge),
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || 'home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const client = list.find(c => new URL(c.url).origin === location.origin);
    if (client) { client.postMessage({ tab }); return client.focus(); }
    return self.clients.openWindow(`./#${tab}`);
  }));
});
