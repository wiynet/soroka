// Mestario AI: поиск в интернете без ключей — чтобы ИИ отвечал по свежим данным, а не по знаниям 2024 года.
// Источники (параллельно, берём то, что успело ответить):
//  • Bing Новости (RSS) — свежие новости с датами и кратким текстом; главный источник;
//  • Википедия — вступления статей (люди, компании, события, турниры);
//  • точные данные по теме вопроса: официальный курс ЦБ Азербайджана и кросс-курсы, криптовалюты, погода;
//  • Google Новости и DuckDuckGo — если доступны с сервера (часто блокируют — тогда пропускаются на 20 минут).
// Результат — короткий текстовый блок, который кладётся в вопрос модели, и список источников.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Diag = { src: string; status: number; ms: number; len: number; n: number; err?: string; skip?: boolean };
// источник, который не отвечает или блокирует сервер, на время пропускаем — чтобы не ждать его в каждом ответе:
// известные «блокировщики» (Google Новости, DuckDuckGo) — на 20 минут, остальные — на 2 минуты (случайный сбой)
const bad = new Map<string, number>();
const ban = (src: string) => bad.set(src, Date.now() + (/^(gnews|ddg|coingecko)$/.test(src) ? 20 : 2) * 60_000);
async function get(src: string, url: string, diag: Diag[], ms = 4500) {
  const d: Diag = { src, status: 0, ms: 0, len: 0, n: 0 };
  diag.push(d);
  if ((bad.get(src) || 0) > Date.now()) { d.skip = true; return ""; }
  const c = new AbortController(), t0 = Date.now();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal,
      headers: { "user-agent": UA, "accept-language": "ru,en;q=0.8", accept: "text/html,application/xml,application/rss+xml,application/json,*/*" } });
    d.status = r.status;
    const s = r.status === 200 ? await r.text() : "";
    d.len = s.length;
    if (!s) ban(src);
    return s;
  } catch (e) { d.err = String(e).slice(0, 80); ban(src); return ""; }
  finally { clearTimeout(t); d.ms = Date.now() - t0; }
}
const setN = (diag: Diag[], src: string, n: number) => { const d = diag.find((x) => x.src === src); if (d) d.n = n; };
function unescape(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric" });
const tag = (it: string, name: string) => unescape((new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(it) || [])[1] || "");
const cyr = (s: string) => /[а-яё]/i.test(s);

type Site = { title: string; url: string; snippet: string; host: string };
type News = { title: string; source: string; host: string; text: string; date: Date };

function rssNews(xml: string): News[] {
  const out: News[] = [];
  for (const it of xml.split("<item>").slice(1)) {
    const title = tag(it, "title");
    let link = tag(it, "link");
    const real = /[?&]url=([^&]+)/.exec(link);          // у Bing ссылка ведёт через его счётчик кликов
    if (real) try { link = decodeURIComponent(real[1]); } catch (_) { /* как есть */ }
    const h = host(link);
    const source = tag(it, "News:Source") || tag(it, "source") || h;
    const date = new Date(tag(it, "pubDate"));
    if (!title || isNaN(date.getTime())) continue;
    out.push({ title: source && title.endsWith(" - " + source) ? title.slice(0, -(source.length + 3)) : title,
      source, host: h, text: tag(it, "description").slice(0, 260), date });
  }
  return out;
}
// короткий запрос для новостей: без «сегодня», «какой», «последний» и т. п. (длинный запрос Bing Новости часто не находят)
const STOP = /^(сегодня|сейчас|текущ\S*|последн\S*|актуальн\S*|какой|какая|какое|какие|кто|что|где|когда|сколько|ли|на|в|во|по|за|и|о|об|про|у|the|what|who|is|are|of|in|on|today|now|current|latest)$/i;
const shortQ = (q: string) => q.split(/\s+/).filter((w) => w && !STOP.test(w)).slice(0, 4).join(" ");

async function bnews(q: string, diag: Diag[]): Promise<News[]> {
  const url = (s: string, src: string) => get(src, `https://www.bing.com/news/search?format=rss&mkt=${cyr(s) ? "ru-RU" : "en-US"}&q=` + encodeURIComponent(s), diag);
  let out = rssNews(await url(q, "bnews"));
  setN(diag, "bnews", out.length);
  const sq = shortQ(q);
  if (out.length < 3 && sq && sq !== q) {
    const more = rssNews(await url(sq, "bnews2"));
    setN(diag, "bnews2", more.length);
    out = [...out, ...more];
  }
  return out;
}
async function gnews(q: string, diag: Diag[]): Promise<News[]> {
  const out = rssNews(await get("gnews", "https://news.google.com/rss/search?hl=ru&gl=AZ&ceid=AZ:ru&q=" + encodeURIComponent(q), diag, 3500));
  setN(diag, "gnews", out.length);
  return out;
}
async function ddg(q: string, diag: Diag[]): Promise<Site[]> {
  const html = await get("ddg", "https://html.duckduckgo.com/html/?kl=ru-ru&q=" + encodeURIComponent(q), diag, 3500);
  const out: Site[] = [];
  const re = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 5) {
    let url = unescape(m[1]);
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;   // реклама
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = "https:" + url;
    const h = host(url);
    if (!h) continue;
    out.push({ title: unescape(m[2]).slice(0, 160), url, snippet: unescape(m[3]).slice(0, 300), host: h });
  }
  if (html && !out.length) ban("ddg");   // страница-проверка «вы не робот?»
  setN(diag, "ddg", out.length);
  return out;
}
// Википедия: вступления трёх подходящих статей
async function wiki(q: string, diag: Diag[]): Promise<Site[]> {
  const lang = cyr(q) ? "ru" : "en";
  const s = await get("wiki", `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&prop=extracts&exintro=1&explaintext=1&exchars=600&redirects=1&gsrsearch=` + encodeURIComponent(q), diag);
  let out: Site[] = [];
  try {
    const pages = Object.values(JSON.parse(s)?.query?.pages || {}) as any[];
    out = pages.sort((a, b) => (a.index || 0) - (b.index || 0)).map((x) => ({ title: String(x.title),
      url: `https://${lang}.wikipedia.org/wiki/` + encodeURIComponent(String(x.title).replace(/ /g, "_")),
      snippet: String(x.extract || "").replace(/\s+/g, " ").trim().slice(0, 600), host: lang + ".wikipedia.org" })).filter((x) => x.snippet);
  } catch (_) { /* пусто */ }
  setN(diag, "wiki", out.length);
  return out;
}

// ---------- точные данные ----------
type Fact = { text: string; source: string };
const RATES = /(курс|валют|доллар|евро|рубл|манат|лир[аыу]|юан|фунт|тенге|гривн|лари|сом\b|дирхам|dollar|euro|exchange|currenc|\b(azn|usd|eur|rub|try|gbp|cny|kzt|uah|gel)\b)/i;
const CRYPTO = /(биткоин|биткойн|bitcoin|\bbtc\b|эфир|ethereum|\beth\b|крипт|crypto|toncoin|\bton\b|тонкоин|usdt|tether|солан|solana|\bbnb\b|ripple|\bxrp\b|доге|doge)/i;
async function rates(diag: Diag[]): Promise<Fact[]> {
  const out: Fact[] = [];
  const d = new Date(Date.now() + 4 * 3600_000);   // дата по Баку
  const ds = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  const [xml, er] = await Promise.all([get("cbar", `https://www.cbar.az/currencies/${ds}.xml`, diag), get("erapi", "https://open.er-api.com/v6/latest/USD", diag)]);
  const when = (/<ValCurs[^>]*Date="([^"]+)"/.exec(xml) || [])[1];
  const list: string[] = [];
  for (const code of ["USD", "EUR", "RUB", "TRY", "GBP", "CNY", "GEL", "KZT", "UAH", "AED"]) {
    const m = new RegExp(`Code="${code}"[\\s\\S]*?<Nominal>([^<]+)<\\/Nominal>[\\s\\S]*?<Value>([^<]+)<\\/Value>`).exec(xml);
    if (m) list.push(`${m[1].trim()} ${code} = ${m[2].trim()} AZN`);
  }
  if (list.length) out.push({ text: `Официальный курс Центрального банка Азербайджана на ${when || ds}: ${list.join("; ")}.`, source: "cbar.az" });
  setN(diag, "cbar", list.length);
  try {
    const j = JSON.parse(er);
    if (j && j.rates) {
      const r = j.rates, cs = ["EUR", "RUB", "AZN", "TRY", "GBP", "CNY", "JPY", "KZT", "UAH", "GEL", "AED", "INR"].filter((c) => r[c]);
      out.push({ text: `Рыночные кросс-курсы (обновлено ${day(new Date(j.time_last_update_unix * 1000))}): 1 USD = ` + cs.map((c) => `${+Number(r[c]).toFixed(4)} ${c}`).join(", ") + ".", source: "exchangerate-api.com" });
      setN(diag, "erapi", cs.length);
    }
  } catch (_) { /* нет данных */ }
  return out;
}
async function crypto(diag: Diag[]): Promise<Fact[]> {
  const ids: Record<string, string> = { bitcoin: "Bitcoin (BTC)", ethereum: "Ethereum (ETH)", "the-open-network": "Toncoin (TON)", tether: "Tether (USDT)",
    solana: "Solana (SOL)", binancecoin: "BNB", ripple: "XRP", dogecoin: "Dogecoin (DOGE)" };
  const s = await get("coingecko", "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=" + Object.keys(ids).join(","), diag);
  try {
    const j = JSON.parse(s);
    const list = Object.keys(ids).filter((k) => j[k] && j[k].usd != null)
      .map((k) => `${ids[k]} = $${j[k].usd}${j[k].usd_24h_change != null ? ` (${j[k].usd_24h_change >= 0 ? "+" : ""}${Number(j[k].usd_24h_change).toFixed(1)}% за сутки)` : ""}`);
    setN(diag, "coingecko", list.length);
    return list.length ? [{ text: `Цены криптовалют сейчас (${day(new Date())}): ${list.join("; ")}.`, source: "coingecko.com" }] : [];
  } catch (_) { return []; }
}
const WMO: [number, string][] = [[0, "ясно"], [1, "преимущественно ясно"], [2, "переменная облачность"], [3, "пасмурно"], [48, "туман"], [57, "морось"],
  [67, "дождь"], [77, "снег"], [82, "ливень"], [86, "снегопад"], [99, "гроза"]];
const wmo = (c: number) => (WMO.find(([k]) => c <= k) || [0, ""])[1];
async function weather(city: string, diag: Diag[]): Promise<Fact[]> {
  const g = await get("geo", `https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=` + encodeURIComponent(city), diag, 3000);
  let p: any;
  try { p = (JSON.parse(g).results || [])[0]; } catch (_) { /* нет */ }
  if (!p) return [];
  const f = await get("meteo", `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&timezone=auto&forecast_days=4` +
    "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max", diag, 3000);
  try {
    const j = JSON.parse(f), c = j.current, dd = j.daily;
    const days = (dd.time || []).map((t: string, i: number) => `${t.split("-").reverse().join(".")}: ${Math.round(dd.temperature_2m_min[i])}…${Math.round(dd.temperature_2m_max[i])}°C, ${wmo(dd.weather_code[i])}, осадки ${dd.precipitation_probability_max[i] ?? 0}%`);
    setN(diag, "meteo", days.length);
    return [{ text: `Погода: ${p.name}${p.country ? ", " + p.country : ""}. Сейчас (${String(c.time).replace("T", " ")} по местному времени): ${Math.round(c.temperature_2m)}°C, ощущается как ${Math.round(c.apparent_temperature)}°C, ${wmo(c.weather_code)}, ветер ${Math.round(c.wind_speed_10m)} км/ч, влажность ${c.relative_humidity_2m}%. Прогноз: ${days.join("; ")}.`, source: "open-meteo.com" }];
  } catch (_) { return []; }
}

export async function webSearch(q: string, city?: string): Promise<{ context: string; sources: string[]; diag: Diag[] }> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 200);
  const diag: Diag[] = [];
  if (!query) return { context: "", sources: [], diag };
  const none = () => [] as any[];
  const [bn, gn, dd, wk, rt, cr, wt] = await Promise.all([
    bnews(query, diag).catch(none), gnews(query, diag).catch(none), ddg(query, diag).catch(none), wiki(query, diag).catch(none),
    RATES.test(query) ? rates(diag).catch(none) : [], CRYPTO.test(query) ? crypto(diag).catch(none) : [],
    city ? weather(city, diag).catch(none) : []]);
  const facts: Fact[] = [...wt, ...rt, ...cr];
  // новости: без повторов, свежие сначала, старше года — не нужны
  const seenT = new Set<string>();
  const news: News[] = [...bn, ...gn].filter((n) => Date.now() - n.date.getTime() < 366 * 86400_000)
    .filter((n) => { const k = n.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 50); if (seenT.has(k)) return false; seenT.add(k); return true; })
    .sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 7);
  const seenU = new Set<string>();
  const sites: Site[] = [...dd, ...wk].filter((s) => { const k = s.url.replace(/[#?].*$/, ""); if (seenU.has(k)) return false; seenU.add(k); return true; }).slice(0, 5);
  if (!facts.length && !news.length && !sites.length) return { context: "", sources: [], diag };
  const lines = [`Результаты поиска в интернете (поиск выполнен ${day(new Date())}, запрос: «${query}»):`];
  if (facts.length) { lines.push("Точные данные:"); facts.forEach((f) => lines.push("• " + f.text)); }
  if (news.length) {
    lines.push("Новости (сначала свежие):");
    news.forEach((n, i) => lines.push(`${i + 1}. [${day(n.date)}] ${n.title}${n.source ? " — " + n.source : ""}${n.text ? ". " + n.text : ""}`));
  }
  if (sites.length) {
    lines.push("Справка:");
    sites.forEach((s, i) => lines.push(`${i + 1}. ${s.title} (${s.host}): ${s.snippet}`));
  }
  const seen = new Set<string>(), sources: string[] = [];
  for (const s of [...facts.map((x) => x.source), ...news.map((x) => x.host || x.source), ...sites.map((x) => x.host)]) {
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); sources.push(s); }
    if (sources.length >= 4) break;
  }
  return { context: lines.join("\n").slice(0, 5000), sources, diag };
}

// нужно ли вообще искать: без модели — по словам (запасной путь, если модель-«диспетчер» не ответила)
const FRESH = /(сейчас|сегодня|вчера|завтра|на данный момент|последн|нов(ый|ая|ое|ые|ость|ости)|актуальн|текущ|курс|цен[аыу]|стоит|стоимость|погод|матч|сч[её]т|турнир|чемпионат|выбор|президент|премьер|министр|глав[аы] |ceo|вышел|вышла|выйдет|релиз|верси|обновлени|биткоин|крипт|202[4-9]|203\d|news|latest|current|today|price|weather|score|release|version|who is)/i;
export function looksFresh(t: string) { return FRESH.test(t); }
// явно не нужно: приветствия, благодарности, код, картинки
export function skipSearch(t: string) {
  const s = t.trim();
  if (s.length < 4 || /```/.test(s)) return true;
  return /^(привет|здравствуй(те)?|хай|ку|салам|hi|hello|hey|спасибо|спс|благодарю|ок(ей)?|ага|понятно|ясно|да|нет|хорошо|круто|супер|👍|❤️)[\s!.,)]*$/i.test(s);
}
