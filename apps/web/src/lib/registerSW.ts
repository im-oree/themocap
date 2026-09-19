/**
 * Service worker registration, disabled by default.
 *
 * The SW skeleton exists now (src/sw.ts, public/manifest.webmanifest) so the
 * structure is in place, but it is only registered when VITE_ENABLE_SW=1 —
 * stale caches during dev iteration cost more than they save. Document 3/6 turn
 * this on properly alongside the model cache.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (import.meta.env?.VITE_ENABLE_SW !== '1') return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' });
  } catch (error) {
    console.warn('[sw] registration failed', error);
    return null;
  }
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
}
