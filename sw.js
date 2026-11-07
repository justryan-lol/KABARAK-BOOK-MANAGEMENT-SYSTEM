"use strict";

const CACHE_NAME = "mhsk-kbms-v33";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./responsive.css",
  "./app.js",
  "./xlsx-export.js",
  "./config.js",
  "./manifest.json",
  "./mhsk-crest.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("mhsk-kbms-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "mhsk-bookstore-sync") return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) client.postMessage({ type: "mhsk-bookstore-sync" });
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      return response;
    }).catch(async () => (await caches.match("./index.html")) || Response.error()));
    return;
  }
  const isAppCode = /\.(?:html|css|js)$/.test(url.pathname);
  if (isAppCode) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return response;
      let delivered = response;
      if (url.pathname.endsWith("/styles.css")) {
        // Keep the legacy stylesheet intact and layer responsive fixes on top.
        const enhancementUrl = new URL("./responsive.css", self.location.href);
        const enhancement = await fetch(enhancementUrl, { cache: "no-store" });
        if (enhancement.ok) {
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          const combined = `${await response.text()}\n\n/* KBMS responsive.css */\n${await enhancement.text()}`;
          delivered = new Response(combined, { status: response.status, statusText: response.statusText, headers });
        }
      }
      const copy = delivered.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return delivered;
    }).catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
