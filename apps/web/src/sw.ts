/// <reference lib="webworker" />
/**
 * Service worker skeleton — structurally present, disabled by default.
 *
 * Document 1 scope: precache the app shell only. Model files are explicitly NOT
 * cached here; that is the model manager's job in Document 3, which will use OPFS
 * (not the Cache API) so downloads can be resumable and checksummed.
 *
 * Registered only when VITE_ENABLE_SW=1 (see src/lib/registerSW.ts).
 */
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'wms-shell-v1';

const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never serve cross-origin requests, and never cache model payloads.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/models/')) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && request.mode === 'navigate') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

export {};
