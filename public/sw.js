/* ANICORE Service Worker — App Mode v10 */
const CACHE = "anicore-v36";
const ASSETS = [
  "/",
  "/assets/style.css?v=36",
  "/assets/app.js?v=36",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Network-first for HTML shell (keeps app updated)
  if (url.pathname === "/" || url.pathname === "/index.html" || event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() =>
          caches.match("/").then((cached) =>
            cached ||
            new Response(
              "<!DOCTYPE html><html><head><meta charset=UTF-8><meta name=viewport content='width=device-width,initial-scale=1'><title>ANICORE Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090f;color:#f7f4ff;font-family:system-ui;text-align:center;padding:24px}h1{color:#ff3f82}p{opacity:.7}</style></head><body><div><h1>ANICORE</h1><p>You are offline. Reconnect to continue.</p></div></body></html>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } }
            )
          )
        )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.json")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      });
    })
  );
});

// Allow page to ask SW to skip waiting
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
