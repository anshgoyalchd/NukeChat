// NukeChat Offline PWA Service Worker
const CACHE_NAME = "nukechat-v2-offline";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/robots.txt",
  "/sitemap.xml",
];

// Install: Cache critical static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching static assets for 100% offline access");
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("[SW] Pre-caching non-fatal asset error:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Smart network-first for HTML, stale-while-revalidate for JS/CSS
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Do not intercept non-GET, WebSocket, or API endpoints
  if (
    req.method !== "GET" ||
    url.protocol.startsWith("ws") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws/")
  ) {
    return;
  }

  // HTML / Navigation requests: Network-First with Cache Fallback
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(async () => {
          console.log("[SW] Offline: serving cached index.html for navigation");
          const cached = (await caches.match("/index.html")) || (await caches.match("/"));
          return (
            cached ||
            new Response("Offline - Please connect to Wi-Fi/Hotspot", {
              headers: { "Content-Type": "text/html" },
            })
          );
        })
    );
    return;
  }

  // Static Assets (JS, CSS, images, fonts): Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => cachedRes);

      return cachedRes || fetchPromise;
    })
  );
});
