"use strict";

const CACHE_NAME = "mhsk-kbms-v35";
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
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
      }
      return response;
    }).catch(async () => (await caches.match("./index.html")) || Response.error()));
    return;
  }

  const isAppCode = /\.(?:html|css|js)$/.test(url.pathname);
  if (isAppCode) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(async (response) => {
      if (!response.ok || !url.pathname.endsWith("/styles.css")) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }

      // Source-folder/demo use may serve index.html without the build-time
      // stylesheet link. Preserve the old worker enhancement only in that case;
      // built Pages output links the stylesheet explicitly and must not duplicate it.
      const pageResponse = await fetch("./index.html", { cache: "no-store" }).catch(() => null);
      const pageHtml = pageResponse?.ok ? await pageResponse.text() : "";
      const explicitlyLinked = /<link\b[^>]*href=["']\.\/responsive\.css["']/i.test(pageHtml);
      let delivered = response;
      if (!explicitlyLinked) {
        const enhancement = await fetch("./responsive.css", { cache: "no-store" }).catch(() => null);
        if (enhancement?.ok) {
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          delivered = new Response(`${await response.text()}\n\n/* KBMS responsive.css */\n${await enhancement.text()}`, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
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
