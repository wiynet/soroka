/* Сервис-воркер нужен только для того, чтобы «Сороку» можно было установить как приложение.
   Он НЕ кэширует страницу и запросы к серверу: всё берётся из сети, чтобы обновления
   приходили сразу и не повторилась проблема со «старой версией». Кэшируются лишь иконки. */
const ICONS = "soroka-icons-v1";
const ASSETS = ["./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(ICONS).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== ICONS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // только свои иконки отдаём из кэша; всё остальное — всегда из сети
  if (e.request.method === "GET" && url.origin === location.origin && /\/(icon-\d|icon-512-maskable|apple-touch-icon)/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
