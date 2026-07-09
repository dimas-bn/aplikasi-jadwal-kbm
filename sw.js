// ============================================================
//  Service Worker — Aplikasi Jadwal KBM SMANSABA
//  Strategi: Cache First untuk aset statis,
//            Network First untuk data jadwal dari Apps Script
// ============================================================

const CACHE_NAME   = 'jadwal-smansaba-v1';
const CACHE_STATIC = 'jadwal-static-v1';

// Aset yang di-cache saat install (shell aplikasi)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.tailwindcss.com',
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        // Cache satu per satu agar tidak gagal semua jika satu error
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Skip:', url, e)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CACHE_STATIC)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Request ke Apps Script (data jadwal) → Network First
  //    Kalau offline, kembalikan respons offline
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    event.respondWith(
      fetch(event.request.clone())
        .catch(() => new Response(
          JSON.stringify({ ok: false, msg: 'Anda sedang offline. Data jadwal tidak tersedia.' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // 2. Tailwind CDN → Cache First (jarang berubah)
  if (url.hostname === 'cdn.tailwindcss.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Aset lokal (index.html, manifest, icons) → Cache First, update di background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached); // fallback ke cache jika network fail

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 4. Request lain → langsung ke network
  event.respondWith(fetch(event.request));
});

// ── BACKGROUND SYNC (opsional, untuk update notifikasi) ──────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
