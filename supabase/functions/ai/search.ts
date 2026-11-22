// Mestario AI: поиск в интернете без ключей — чтобы ИИ отвечал по свежим данным, а не по знаниям 2024 года.
// Два источника параллельно: обычный поиск DuckDuckGo (сайты с кратким описанием) и Google Новости (свежие
// новости с датами). Результат — короткий текстовый блок, который кладётся в вопрос модели, и список сайтов-источников.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function get(url: string, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "user-agent": UA, "accept-language": "ru,en;q=0.8" } });
    return r.ok ? await r.text() : "";
  } catch (_) { return ""; } finally { clearTimeout(t); }
}
function unescape(s: string) {
  return s.replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric" });

type Site = { title: string; url: string; snippet: string; host: string };
type News = { title: string; source: string; date: Date };

async function ddg(q: string): Promise<Site[]> {
  const html = await get("https://html.duckduckgo.com/html/?kl=ru-ru&q=" + encodeURIComponent(q), 4500);
  const out: Site[] = [];
  const re = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 6) {
    let url = unescape(m[1]);
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;   // реклама
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith("//")) url = "https:" + url;
    const h = host(url);
    if (!h) continue;
    out.push({ title: unescape(m[2]).slice(0, 160), url, snippet: unescape(m[3]).slice(0, 320), host: h });
  }
  return out;
}
async function gnews(q: string): Promise<News[]> {
  const xml = await get("https://news.google.com/rss/search?hl=ru&gl=AZ&ceid=AZ:ru&q=" + encodeURIComponent(q), 4500);
  const out: News[] = [];
  for (const it of xml.split("<item>").slice(1)) {
    const title = unescape((/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1] || "");
    const source = unescape((/<source[^>]*>([\s\S]*?)<\/source>/.exec(it) || [])[1] || "");
    const date = new Date((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it) || [])[1] || "");
    if (!title || isNaN(date.getTime())) continue;
    out.push({ title: source && title.endsWith(" - " + source) ? title.slice(0, -(source.length + 3)) : title, source, date });
  }
  // сначала самые свежие; старше года — не нужны
  return out.filter((n) => Date.now() - n.date.getTime() < 366 * 86400_000).sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 6);
}

export async function webSearch(q: string): Promise<{ context: string; sources: string[] }> {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!query) return { context: "", sources: [] };
  const [sites, news] = await Promise.all([ddg(query).catch(() => []), gnews(query).catch(() => [])]);
  if (!sites.length && !news.length) return { context: "", sources: [] };
  const lines = [`Результаты поиска в интернете (поиск выполнен ${day(new Date())}, запрос: «${query}»):`];
  if (news.length) {
    lines.push("Новости:");
    news.forEach((n, i) => lines.push(`${i + 1}. [${day(n.date)}] ${n.title}${n.source ? " — " + n.source : ""}`));
  }
  if (sites.length) {
    lines.push("Сайты:");
    sites.forEach((s, i) => lines.push(`${i + 1}. ${s.title} (${s.host}): ${s.snippet}`));
  }
  const seen = new Set<string>(), sources: string[] = [];
  for (const s of [...sites.map((x) => x.host), ...news.map((x) => x.source)]) {
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); sources.push(s); }
    if (sources.length >= 4) break;
  }
  return { context: lines.join("\n").slice(0, 4000), sources };
}

// нужно ли вообще искать: без модели — по словам (запасной путь, если модель-«диспетчер» не ответила)
const FRESH = /(сейчас|сегодня|вчера|завтра|на данный момент|последн|нов(ый|ая|ое|ые|ость|ости)|актуальн|текущ|курс|цен[аыу]|стоит|стоимость|погод|матч|сч[её]т|турнир|чемпионат|выбор|президент|премьер|министр|глав[аы] |ceo|вышел|вышла|выйдет|релиз|верси|обновлени|202[4-9]|203\d|news|latest|current|today|price|weather|score|release|version|who is)/i;
export function looksFresh(t: string) { return FRESH.test(t); }
// явно не нужно: приветствия, благодарности, код, картинки
export function skipSearch(t: string) {
  const s = t.trim();
  if (s.length < 4 || /```/.test(s)) return true;
  return /^(привет|здравствуй(те)?|хай|ку|салам|hi|hello|hey|спасибо|спс|благодарю|ок(ей)?|ага|понятно|ясно|да|нет|хорошо|круто|супер|👍|❤️)[\s!.,)]*$/i.test(s);
}
