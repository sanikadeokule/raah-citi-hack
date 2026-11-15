// Raah service worker: app shell + dataset cached for offline use.
const CACHE = "raah-v3";
const PAGES = ["/", "/discover/", "/careers/", "/plan/", "/compare/", "/eligibility/", "/learn/", "/opportunity/", "/profile/", "/teacher/", "/money/", "/data/", "/exams/", "/login/"];

// Cache every page plus every JS/CSS chunk those pages reference, so any screen opens offline.
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(["/api/data", "/manifest.webmanifest", "/icon.svg"]).catch(() => {});
  const assets = new Set();
  await Promise.all(PAGES.map(async (p) => {
    try {
      const r = await fetch(p, { cache: "no-store" });
      if (!r.ok) return;
      const html = await r.clone().text();
      await c.put(p, r);
      for (const m of html.matchAll(/\/_next\/static\/[^"'\s)]+/g)) assets.add(m[0]);
    } catch { /* offline during install */ }
  }));
  await Promise.all([...assets].map((a) => c.add(a).catch(() => {})));
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache());
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })));
    return;
  }
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/data") return; // live calls stay live
  // network first, fall back to cache (pages ignore ?query so /plan/?id=X works offline)
  e.respondWith(
    fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("/")))
  );
});
