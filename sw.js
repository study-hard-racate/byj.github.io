/* =========================================================
   sw.js —— Service Worker（PWA 离线缓存）
   缓存优先：首次联网打开后，断网也能正常使用。
   ========================================================= */
const CACHE = "byj-dashboard-v1";
const CORE = [
  "./",
  "./index.html",
  "./finance.html",
  "./health.html",
  "./import.html",
  "./report.html",
  "./settings.html",
  "./css/style.css",
  "./js/config.js",
  "./js/categories.js",
  "./js/parsers.js",
  "./js/charts.js",
  "./js/app.js",
  "./js/db.js",
  "./js/seed.js",
  "./js/layout.js",
  "./js/page-index.js",
  "./js/page-finance.js",
  "./js/page-health.js",
  "./js/page-import.js",
  "./js/page-report.js",
  "./js/page-settings.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // 个别资源失败不阻塞激活
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
