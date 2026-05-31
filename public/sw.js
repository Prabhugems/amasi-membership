// AMASI Membership service worker (Phase 1: installable shell only).
// Intentionally minimal — passes through every request. Offline caching and
// push notifications are scoped to later phases.
const SW_VERSION = "amasi-pwa-v1"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== SW_VERSION).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

// Fetch handler is required for the browser to consider the app installable.
// Pass-through; do not interpose between the app and /api/*.
self.addEventListener("fetch", () => {})
