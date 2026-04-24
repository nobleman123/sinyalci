/* NEXUS v7 — Service Worker */
const CACHE_NAME = 'nexus-v7-cache';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── PUSH NOTIFICATION ── */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }

  const options = {
    body:          payload.body   || '',
    icon:          payload.icon   || '/icons/icon-192.png',
    badge:         payload.badge  || '/icons/badge-72.png',
    tag:           payload.tag    || 'nexus-signal',
    data:          payload.data   || {},
    vibrate:       [200, 100, 200],
    requireInteraction: false,
    actions: [
      { action: 'open',    title: '📊 Grafiği Aç' },
      { action: 'dismiss', title: '✕ Kapat' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'NEXUS Sinyal', options)
  );
});

/* ── NOTIFICATION CLICK ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const data = event.notification.data || {};
  const url  = data.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'SIGNAL_CLICK', ...data });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ── FETCH (network first, fallback to cache) ── */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return; // never cache API
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
