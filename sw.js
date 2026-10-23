/* Mestario: сервис-воркер. Нужен, чтобы сайт открывался как приложение, работал без сети
   и показывал уведомления о новых сообщениях, даже когда вкладка или приложение закрыты.
   Страницу всегда сначала берём из сети, поэтому обновления приходят сразу.
   Неизменяемое (библиотека с номером версии, шрифты, словарь с отпечатком, картинки) берём из кэша:
   повторный вход не скачивает их заново. Запросы к базе сюда не попадают. */
const CACHE = "mestario-v2";
const STATIC = "mestario-static-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/mest.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // неизменяемые файлы: сначала кэш, при промахе — сеть с сохранением
  const immutable = (url.hostname === "cdn.jsdelivr.net" && /@\d+\.\d+\.\d+\//.test(url.pathname))
    || url.hostname === "fonts.gstatic.com"
    || (url.origin === self.location.origin && /^\/en\.js$/.test(url.pathname) && url.searchParams.has("v"));
  if (immutable) {
    e.respondWith(caches.open(STATIC).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        c.put(req, res.clone());
        // старые версии словаря больше не нужны
        if (url.pathname === "/en.js") c.keys().then((ks) => ks.forEach((k) => { const u = new URL(k.url); if (u.pathname === "/en.js" && u.search !== url.search) c.delete(k); }));
      }
      return res;
    }))));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // страницу просим у сервера заново, минуя кэш браузера: иначе обновление доходило бы с задержкой до 10 минут
  const ask = req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req);
  e.respondWith(
    ask.then((res) => {
      if (res.ok && (req.mode === "navigate" || /\.(png|webmanifest)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((hit) => hit || caches.match("/")))
  );
});

// новое сообщение: если Mestario сейчас открыта перед глазами, уведомление не нужно
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Mestario", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // чаты, уже прочитанные на другом устройстве: их уведомления здесь убираем
    if (Array.isArray(d.close) && d.close.length) {
      for (const n of await self.registration.getNotifications()) if (d.close.includes(n.tag)) n.close();
    }
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Mestario", {
      body: d.body || "Новое сообщение",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.chat_id || "soroka",
      renotify: true,
      data: { url: d.url || "/", chat_id: d.chat_id || null },
    });
  })());
});

// нажатие на уведомление: открываем нужный чат в уже открытой Mestario или в новом окне
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
