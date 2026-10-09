/* Сорока: сервис-воркер. Нужен, чтобы сайт открывался как приложение, работал без сети
   и показывал уведомления о новых сообщениях, даже когда вкладка или приложение закрыты.
   Страницу всегда сначала берём из сети, поэтому обновления приходят сразу;
   запросы к базе и библиотекам сюда не попадают. */
const CACHE = "soroka-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === "navigate" || /\.(png|webmanifest)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((hit) => hit || caches.match("/")))
  );
});

// новое сообщение: если Сорока сейчас открыта перед глазами, уведомление не нужно
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Сорока", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Сорока", {
      body: d.body || "Новое сообщение",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.chat_id || "soroka",
      renotify: true,
      data: { url: d.url || "/", chat_id: d.chat_id || null },
    });
  })());
});

// нажатие на уведомление: открываем нужный чат в уже открытой Сороке или в новом окне
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      win.postMessage({ type: "open-chat", chat_id: data.chat_id });
      return;
    }
    await self.clients.openWindow(data.url || "/");
  })());
});
