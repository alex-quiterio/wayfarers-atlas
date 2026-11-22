(() => {
  // src/apps/web/sw.ts
  var sw = self;
  var CACHE = "atlas-shell-v1";
  var SHELL = [
    "./",
    "index.html",
    "main.js",
    "atlas-data.js",
    "manifest.webmanifest",
    "css/base.css",
    "css/map.css",
    "css/controls.css",
    "css/search.css",
    "css/panel.css",
    "css/icons.css",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png"
  ];
  var FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
  sw.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => sw.skipWaiting()));
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => sw.clients.claim()));
  });
  sw.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET")
      return;
    const url = new URL(request.url);
    if (url.origin !== location.origin && !FONT_HOSTS.includes(url.hostname))
      return;
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request).then((response) => {
        if (response.ok || response.type === "opaque")
          cache.put(request, response.clone());
        return response;
      }).catch(async () => cached ?? (request.mode === "navigate" ? await cache.match("index.html") : undefined) ?? Response.error());
      return cached ?? network;
    }));
  });
})();
