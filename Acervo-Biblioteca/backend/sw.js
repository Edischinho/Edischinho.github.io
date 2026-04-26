// Service Worker — Omnisentis Media
// Mantém o processo vivo para reprodução em segundo plano

const CACHE_NAME = "omnisentis-media-v2"

self.addEventListener("install",  () => self.skipWaiting())
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  )
  self.clients.claim()
})

// Não interceptar fetch — apenas manter SW ativo
self.addEventListener("fetch", e => {
  e.respondWith(fetch(e.request).catch(() => new Response("", { status: 408 })))
})

// Keepalive: responder pings para manter SW (e o processo de áudio) vivo
self.addEventListener("message", e => {
  if (e.data === "keepalive") {
    e.source && e.source.postMessage({ type: "alive", ts: Date.now() })
  }
})

// Push de background: manter SW acordado
self.addEventListener("push", () => {})
