/* NEXUS v7.1 — Service Worker
   FIX: cache version güncellendi (eski SW'yi temizler),
        push payload normalizasyonu düzeltildi,
        fetch handler backend URL'ini de bypass ediyor */

const CACHE_VERSION = 'nexus-v7.1-cache';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(() => {})
    )
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── PUSH NOTIFICATION ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) {
    event.waitUntil(
      self.registration.showNotification('NEXUS Sinyal', {
        body: 'Yeni sinyal var! Uygulamayı açın.',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: 'nexus-fallback',
      })
    );
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch {
    const text = event.data.text();
    payload = { title: 'NEXUS Sinyal', body: text || 'Yeni sinyal!' };
  }

  // FIX: vibrate payload.data içinde veya direkt payload'da olabilir
  const vibrate = payload.data?.vibrate || payload.vibrate || [200, 100, 200];

  const options = {
    body:               payload.body  || '',
    icon:               payload.icon  || '/icons/icon-192.png',
    badge:              payload.badge || '/icons/badge-72.png',
    tag:                payload.tag   || 'nexus-signal',
    data:               payload.data  || {},
    vibrate,
    renotify:           true,
    requireInteraction: false,
    silent:             false,
    actions: [
      { action: 'open',    title: '📊 Grafiği Aç' },
      { action: 'dismiss', title: '✕ Kapat'       },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'NEXUS Sinyal', options)
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
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

// ── FETCH (network-first, API & harici servis bypass) ────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Harici / dinamik kaynakları kesinlikle cache'leme
  if (
    url.includes('/api/') ||
    url.includes('onrender.com') ||
    url.includes('binance.com') ||
    url.includes('alternative.me') ||
    url.includes('coingecko.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('cdn.jsdelivr.net')
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
