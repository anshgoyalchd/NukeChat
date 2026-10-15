// NukeChat 100% Offline PWA Service Worker
const CACHE_NAME = "nukechat-v-offline-core";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/robots.txt",
  "/sitemap.xml",
];

// Install: Pre-cache all core static assets and dynamic bundle chunks
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      console.log("[SW] Pre-caching static assets for 100% offline access...");
      const cache = await caches.open(CACHE_NAME);

      // 1. Pre-cache defined static assets using allSettled to ensure no single failure halts installation
      await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) {
              await cache.put(url, res);
            }
          } catch (err) {
            console.warn("[SW] Pre-caching item skipped:", url, err);
          }
        })
      );

      // 2. Discover and cache dynamic build assets listed in /index.html (e.g., /assets/index-*.js and /assets/index-*.css)
      try {
        const indexRes = await fetch("/index.html", { cache: "reload" });
        if (indexRes.ok) {
          const html = await indexRes.clone().text();
          await cache.put("/index.html", indexRes.clone());
          await cache.put("/", indexRes.clone());

          const assetMatches = html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g);
          const bundleUrls = Array.from(new Set(Array.from(assetMatches, (m) => m[1])));
          if (bundleUrls.length > 0) {
            console.log("[SW] Discovered dynamic build bundles:", bundleUrls);
            await Promise.allSettled(
              bundleUrls.map(async (bundleUrl) => {
                try {
                  const bRes = await fetch(bundleUrl, { cache: "reload" });
                  if (bRes.ok) {
                    await cache.put(bundleUrl, bRes);
                  }
                } catch (e) {
                  console.warn("[SW] Dynamic bundle fetch skipped:", bundleUrl, e);
                }
              })
            );
          }
        }
      } catch (err) {
        console.warn("[SW] Dynamic asset parsing skipped:", err);
      }
    })()
  );
  self.skipWaiting();
});

// Activate: Purge old outdated caches and claim clients immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Purging outdated cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Smart offline routing
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET, WebSocket protocols, and backend API routes
  if (
    req.method !== "GET" ||
    url.protocol.startsWith("ws") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws/")
  ) {
    return;
  }

  // 1. Navigation / HTML Requests (Opening site or reloading offline):
  // Network-first with fast timeout, falling back directly to cached index.html
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1500);
          const networkRes = await fetch(req, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put("/index.html", copy.clone());
              cache.put("/", copy);
            });
            return networkRes;
          }
        } catch (e) {
          // Zero internet or network timeout - proceed to cache fallback
        }

        console.log("[SW] Zero internet detected: serving cached index.html for navigation:", url.pathname);
        const cached = (await caches.match("/index.html")) || (await caches.match("/"));
        if (cached) {
          return cached;
        }

        return new Response(
          "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Offline | Nuke Chat</title></head><body style='background:#0B0B0C;color:#fff;font-family:sans-serif;text-align:center;padding:50px;'><h1>Nuke Chat is Offline</h1><p>Please connect to local Wi-Fi or hotspot.</p></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      })()
    );
    return;
  }

  // 2. Static Hashed Assets (/assets/*): Cache-First Strategy
  // Content-hashed JS and CSS bundles never change per hash, so serving from cache gives instant 0ms offline loads
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(async (cachedRes) => {
        if (cachedRes) {
          return cachedRes;
        }
        try {
          const networkRes = await fetch(req);
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        } catch (err) {
          // In case asset was requested with query params
          const matchNoQuery = await caches.match(url.pathname);
          if (matchNoQuery) return matchNoQuery;
          throw err;
        }
      })
    );
    return;
  }

  // 3. Other static files (icons, manifest, fonts): Stale-While-Revalidate
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
