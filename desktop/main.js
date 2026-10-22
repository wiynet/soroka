// Mestario для Windows: отдельное окно с мессенджером.
// Открывает сайт (так обновления приходят сразу); без интернета показывает встроенную копию интерфейса.
const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("path");

const SITE = "https://soroka.lol/";
const OWN = ["https://soroka.lol", "https://www.soroka.lol", "https://mestario.top", "https://www.mestario.top"];
const isOwn = (url) => OWN.some((o) => url === o || url.startsWith(o + "/")) || url.startsWith("file:");

app.setAppUserModelId("top.mestario.desktop");   // имя и иконка в уведомлениях Windows
if (!app.requestSingleInstanceLock()) app.quit();   // второе окно не запускаем — показываем первое

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 380, minHeight: 560,
    backgroundColor: "#05070d", title: "Mestario", icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  Menu.setApplicationMenu(null);
  // чужие ссылки открываются в обычном браузере, свои — в окне приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwn(url)) { win.loadURL(url); return { action: "deny" }; }
    if (/^https?:|^mailto:|^tel:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isOwn(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  // нет интернета — встроенная копия
  win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith("file:")) win.loadFile(path.join(__dirname, "www", "index.html"));
  });
  // если страница упала — перезагружаем, а не закрываем окно
  win.webContents.on("render-process-gone", () => { setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 500); });
  win.loadURL(SITE);
}

app.whenReady().then(() => {
  // камера и микрофон для звонков и голосовых, уведомления, буфер обмена, демонстрация экрана
  const allowed = ["media", "notifications", "geolocation", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "display-capture", "pointerLock"];
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed.includes(perm));
  createWindow();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
