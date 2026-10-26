// Mestario: собирает открытые страницы документов (terms.html, privacy.html, support.html) из того же
// объекта DOCS, что показывается в приложении — тексты не расходятся. Запуск: node tools/gen-docs.js
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const grab = (re) => { const m = html.match(re); if (!m) throw new Error("not found: " + re); return m[1]; };
const DOCS = new Function("return " + grab(/const DOCS = (\{[\s\S]*?\n\});\nlet docsTab/))();
const DATE = new Function("return " + grab(/const DOCS_DATE = (\{[^\n]*\});/))();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// адреса вида mestario.lol/support.html делаем ссылками
const para = (t) => esc(t).split("\n").map((l) => l.replace(/mestario\.lol\/([a-z]+\.html)/g, '<a href="/$1">mestario.lol/$1</a>')).join("<br>");
const sections = (list) => list.map(([h, t]) => `<h2>${esc(h)}</h2>\n<p>${para(t)}</p>`).join("\n");

const NAV = {
  ru: [["terms.html", "Соглашение"], ["privacy.html", "Конфиденциальность"], ["support.html", "Поддержка"]],
  en: [["terms.html", "Terms"], ["privacy.html", "Privacy"], ["support.html", "Support"]],
};
function page(file, title, desc, body, bodyEn) {
  const nav = (lang) => NAV[lang].map(([f, t]) => `<a href="/${f}"${f === file ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Mestario</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="/favicon.png">
<style>
:root { color-scheme: light dark; --bg: #f3f5f6; --panel: #fff; --ink: #14202a; --muted: #5d6b75; --line: #dde3e7; --accent: #1f6fd1; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c1317; --panel: #131c22; --ink: #e6edf1; --muted: #93a3ad; --line: #26343d; --accent: #6aa8f0; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { position: sticky; top: 0; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); z-index: 1; }
.bar { max-width: 760px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 18px; color: var(--ink); text-decoration: none; margin-right: auto; }
.brand img { width: 28px; height: 28px; border-radius: 8px; }
nav { display: flex; gap: 4px; flex-wrap: wrap; }
nav a { padding: 6px 12px; border-radius: 999px; color: var(--muted); text-decoration: none; font-size: 14px; }
nav a[aria-current] { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: 0 0 0 1px var(--line); }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
article { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 24px 22px; }
h1 { font-size: 26px; line-height: 1.25; margin: 0 0 4px; }
.upd { color: var(--muted); font-size: 14px; margin-bottom: 18px; }
h2 { font-size: 17px; margin: 22px 0 6px; }
p { margin: 0; }
a { color: var(--accent); }
.card { border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; margin-top: 12px; }
.card b { display: block; margin-bottom: 2px; }
details { margin-top: 18px; }
summary { cursor: pointer; color: var(--muted); font-size: 14px; }
footer { max-width: 760px; margin: 0 auto; padding: 0 16px 32px; color: var(--muted); font-size: 13.5px; }
</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/"><img src="/icon-192.png" alt="">Mestario</a><nav>${nav("ru")}</nav></div></header>
<main>
<article>
${body}
</article>
${bodyEn ? `<details><summary>English version</summary><article style="margin-top:12px">\n${bodyEn}\n</article></details>` : ""}
</main>
<footer>Mestario — мессенджер · <a href="/">mestario.lol</a> · ${NAV.ru.map(([f, t]) => `<a href="/${f}">${t}</a>`).join(" · ")}</footer>
</body>
</html>
`;
}
const doc = (key, lang, extra) => `<h1>${esc(DOCS[key][lang][0])}</h1>\n<div class="upd">${esc(DATE[lang])}</div>\n${sections(DOCS[key][lang][1])}${extra || ""}`;

// соглашение вместе с правилами — правила его часть
const rules = (lang) => `\n<h2 style="font-size:20px;margin-top:30px">${esc(DOCS.rules[lang][0])}</h2>\n${sections(DOCS.rules[lang][1])}`;
fs.writeFileSync(path.join(root, "terms.html"), page("terms.html", "Пользовательское соглашение",
  "Пользовательское соглашение (публичная оферта) мессенджера Mestario: аккаунт, покупки, оплата и возврат, правила.",
  doc("terms", "ru", rules("ru")), doc("terms", "en", rules("en"))));
fs.writeFileSync(path.join(root, "privacy.html"), page("privacy.html", "Политика конфиденциальности",
  "Политика конфиденциальности мессенджера Mestario: какие данные хранятся, зачем, кто их видит и как их удалить.",
  doc("privacy", "ru"), doc("privacy", "en")));

// поддержка: способы связи
const S = {
  ru: [
    ["Поддержка в приложении", "Откройте Mestario → Настройки → Поддержка и опишите вопрос. Каждое обращение получает номер, ответ придёт туда же, и вы получите уведомление.\nЕсли аккаунт заблокирован, кнопка поддержки есть прямо на экране блокировки."],
    ["Вопросы о платежах", "Если оплата прошла, а Mest или премиум не зачислились, вас списали дважды или вы хотите вернуть деньги — напишите в поддержку и укажите способ оплаты, сумму, время платежа и, если есть, его номер. Условия возврата — в разделе «Возврат» <a href=\"/terms.html\">пользовательского соглашения</a>."],
    ["Сроки", "Отвечаем как можно быстрее, обычно в течение суток. Возврат денег после проверки — до 10 рабочих дней."],
  ],
  en: [
    ["Support in the app", "Open Mestario → Settings → Support and describe your question. Every request gets a number; the reply arrives in the same place and you get a notification.\nIf your account is blocked, the support button is right on the block screen."],
    ["Payment questions", "If a payment went through but Mest or premium was not credited, you were charged twice, or you want a refund — contact support with the payment method, amount, time and, if you have it, the payment number. Refund terms are in the Refunds section of the <a href=\"/terms.html\">Terms of Use</a>."],
    ["Response time", "We reply as soon as we can, usually within a day. Refunds take up to 10 business days after checking."],
  ],
};
const cards = (lang) => S[lang].map(([t, x]) => `<div class="card"><b>${esc(t)}</b>${x.replace(/\n/g, "<br>")}</div>`).join("\n");
fs.writeFileSync(path.join(root, "support.html"), page("support.html", "Поддержка",
  "Служба поддержки Mestario: как связаться по вопросам аккаунта, платежей и возврата.",
  `<h1>Служба поддержки</h1>\n<div class="upd">Вопросы об аккаунте, покупках, платежах и возврате, жалобы и предложения</div>\n${cards("ru")}`,
  `<h1>Support</h1>\n<div class="upd">Questions about your account, purchases, payments and refunds, complaints and suggestions</div>\n${cards("en")}`));
console.log("ok");
