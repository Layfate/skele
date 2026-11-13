// Skele service worker: makes the app open offline. All user data lives in IndexedDB; this only
// caches the application files. Strategy: static assets cache-first, pages network-first.
const VERSION = "skele-v1";
const ROUTES = ["/", "/welcome/", "/page/", "/notes/", "/tasks/", "/projects/", "/project/", "/databases/", "/graph/", "/calendar/", "/settings/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      for (const route of ROUTES) {
        try {
          const res = await fetch(route, { cache: "no-cache" });
          if (!res.ok) continue;
          const html = await res.clone().text();
          await cache.put(route, res);
          // Also cache every script/style the page shell references, so it works offline.
          const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
          await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
        } catch {
          // Offline during install: pages are cached on first visit instead.
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // never touch third-party requests
  if (url.pathname.startsWith("/_next/static/") || /\.(png|ico|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  if (req.mode === "navigate") {
    const key = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(key, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(key)) || (await caches.match("/")) || Response.error()),
    );
  }
});
