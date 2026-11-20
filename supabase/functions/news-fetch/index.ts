// Mestario: сбор Новостей из RSS. Раз в 15 минут вызывается из базы (pg_cron 'news-fetch');
// доступ проверяется секретом в заголовке x-hook-secret.
// Из каждой ленты берём только заголовок, короткий анонс (до 300 знаков), картинку и ссылку на оригинал —
// полный текст читается на сайте источника. Зарубежные заголовки и анонсы переводятся на русский (Gemini).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { XMLParser } from "npm:fast-xml-parser@4.4.1";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PER_SOURCE = 15;
const UA = "Mozilla/5.0 (compatible; MestarioNews/1.0; +https://mestario.lol)";

let secret: string | null = null;
async function hookSecret() {
  if (secret) return secret;
  const { data, error } = await sb.rpc("push_server_config");
  if (error || !data?.hook_secret) throw new Error("no config");
  secret = data.hook_secret;
  return secret!;
}
// лента целиком (заголовки и тело) — за ms миллисекунд, не больше 3 МБ
async function feedText(url: string, ms: number): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }, redirect: "follow", signal: c.signal });
    if (!r.ok) { r.body?.cancel().catch(() => {}); throw new Error("HTTP " + r.status); }
    const rd = r.body!.getReader(), parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); n += value.length;
      if (n > 3_000_000) { rd.cancel().catch(() => {}); break; }
    }
    const all = new Uint8Array(n); let o = 0;
    for (const p of parts) { all.set(p.subarray(0, Math.min(p.length, n - o)), o); o += p.length; if (o >= n) break; }
    const ct = r.headers.get("content-type") || "";
    const head = new TextDecoder("latin1").decode(all.subarray(0, 200));
    const cs = (/charset=([\w-]+)/i.exec(ct) || /encoding=["']([\w-]+)/i.exec(head) || [])[1] || "utf-8";
    try { return new TextDecoder(cs.toLowerCase()).decode(all); } catch (_) { return new TextDecoder().decode(all); }
  } finally { clearTimeout(t); }
}
async function tfetch(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

/* ---------- разбор RSS / Atom ---------- */
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#t", cdataPropName: false, processEntities: true, htmlEntities: true });
const arr = (x: any) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: any): string => {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return txt(x[0]);
  if (typeof x === "object") return txt(x["#t"] ?? x["@href"] ?? "");
  return "";
};
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };
function plain(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ").trim();
}
function cut(s: string, n: number) {
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  const i = Math.max(t.lastIndexOf(". "), t.lastIndexOf(" "));
  return (i > n * 0.6 ? t.slice(0, i) : t).replace(/[\s,.;:–—-]+$/, "") + "…";
}
const goodUrl = (u: string) => /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length < 600;
function pickImage(it: any, html: string): string | null {
  const cands: string[] = [];
  for (const e of arr(it.enclosure)) if (e && e["@url"] && (!e["@type"] || /^image\//.test(e["@type"]))) cands.push(e["@url"]);
  for (const k of ["media:content", "media:thumbnail"]) for (const e of arr(it[k])) {
    if (e && e["@url"] && (!e["@medium"] || e["@medium"] === "image") && (!e["@type"] || /^image\//.test(e["@type"]))) cands.push(e["@url"]);
  }
  for (const g of arr(it["media:group"])) for (const e of arr(g && g["media:content"])) if (e && e["@url"]) cands.push(e["@url"]);
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (m) cands.push(m[1].replace(/&amp;/g, "&"));
  const u = cands.find((x) => goodUrl(x) && !/\.(mp4|mp3|webm|m3u8)(\?|$)/i.test(x));
  return u ? u.replace(/^http:\/\//i, "https://") : null;
}
type Item = { guid: string; title: string; summary: string | null; url: string | null; image: string | null; published_at: string };
// запасной разбор регулярными выражениями — если в ленте битый XML
function roughDoc(xml: string) {
  const one = (blk: string, tag: string) => {
    const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i").exec(blk);
    return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1") : undefined;
  };
  const attr = (blk: string, tag: string, a: string) => {
    const m = new RegExp("<" + tag + "\\s[^>]*" + a + "=[\"']([^\"']+)[\"']", "i").exec(blk);
    return m ? { ["@" + a]: m[1] } : undefined;
  };
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => {
    const b = m[0];
    return { title: one(b, "title"), link: one(b, "link") || attr(b, "link", "href"), guid: one(b, "guid") || one(b, "id"),
             description: one(b, "description") || one(b, "summary"), "content:encoded": one(b, "content:encoded"),
             pubDate: one(b, "pubDate") || one(b, "published") || one(b, "updated") || one(b, "dc:date"),
             enclosure: attr(b, "enclosure", "url"), "media:content": attr(b, "media:content", "url"), "media:thumbnail": attr(b, "media:thumbnail", "url") };
  });
  return { rss: { channel: { item: items } } };
}
function parseFeed(xml: string): Item[] {
  let doc: any;
  try { doc = parser.parse(xml); } catch (_) { doc = null; }
  if (!doc || !(doc.rss?.channel || doc["rdf:RDF"] || doc.feed)) doc = roughDoc(xml);
  const rss = doc.rss?.channel || doc["rdf:RDF"];
  const raw = rss ? arr(rss.item || doc["rdf:RDF"]?.item) : arr(doc.feed?.entry);
  const now = Date.now();
  const out: Item[] = [];
  for (const it of raw) {
    if (!it) continue;
    const title = cut(plain(txt(it.title)), 200);
    if (title.length < 3) continue;
    let link = "";
    if (it.link) {
      const ls = arr(it.link);
      const alt = ls.find((l: any) => typeof l === "object" && l["@href"] && (!l["@rel"] || l["@rel"] === "alternate"));
      link = alt ? alt["@href"] : txt(ls[0]);
    }
    link = link.trim();
    const html = txt(it["content:encoded"]) || txt(it.description) || txt(it.summary) || txt(it.content);
    const summary = cut(plain(html), 300);
    const d = Date.parse(txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it["dc:date"]));
    const at = Number.isFinite(d) ? Math.min(d, now) : now;
    const guid = (txt(it.guid) || txt(it.id) || link || title).slice(0, 500);
    out.push({ guid, title, summary: summary && summary !== title ? summary : null, url: goodUrl(link) ? link : null,
               image: pickImage(it, html), published_at: new Date(at).toISOString() });
  }
  return out.sort((a, b) => (a.published_at < b.published_at ? 1 : -1)).slice(0, PER_SOURCE);
}

/* ---------- перевод зарубежных новостей ---------- */
const GL = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash-lite"];
async function gkey() {
  const { data } = await sb.rpc("ai_server_config");
  return (data && data.api_key) || Deno.env.get("GEMINI_API_KEY") || "";
}
async function ask(sys: string, text: string): Promise<string> {
  const k = await gkey();
  if (k) for (const m of MODELS) {
    try {
      const gc: any = { maxOutputTokens: 8192, temperature: 0.2, responseMimeType: "application/json" };
      if (/gemini-2\.5/.test(m)) gc.thinkingConfig = { thinkingBudget: 0 };
      const r = await tfetch(`${GL}/models/${m}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text }] }], generationConfig: gc }),
      }, 30000);
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (out) return out;
    } catch (_) { /* следующая модель */ }
  }
  // запасной бесплатный ИИ, если Gemini занят (как в переводе сообщений)
  try {
    const r = await tfetch("https://text.pollinations.ai/openai", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai", messages: [{ role: "system", content: sys }, { role: "user", content: text }] }),
    }, 55000);
    const j = await r.json().catch(() => ({}));
    return String(j?.choices?.[0]?.message?.content || "").trim();
  } catch (_) { return ""; }
}
async function translatePending() {
  const { data: rows } = await sb.from("news_items").select("id,title,summary").neq("lang", "ru").is("title_ru", null)
    .gte("created_at", new Date(Date.now() - 2 * 86400_000).toISOString()).order("published_at", { ascending: false }).limit(8);
  if (!rows || !rows.length) return 0;
  const sys = "Ты переводчик новостей. Переведи на русский заголовки (t) и анонсы (s) новостей. Сохрани смысл, имена и числа, " +
    "пиши естественно, как в русских новостях, без эмодзи и без своих комментариев. Ответь только JSON-массивом объектов {\"id\":число,\"t\":\"...\",\"s\":\"...\"} в том же порядке.";
  const body = JSON.stringify(rows.map((r: any) => ({ id: r.id, t: r.title, s: r.summary || "" })));
  const out = await ask(sys, body);
  let list: any[] = [];
  try {
    const v = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    list = Array.isArray(v) ? v : (Object.values(v || {}).find((x) => Array.isArray(x)) as any[]) || [];
  } catch (_) { return 0; }
  let n = 0;
  for (const x of Array.isArray(list) ? list : []) {
    const id = Number(x && x.id), t = String((x && x.t) || "").trim();
    if (!rows.find((r: any) => r.id === id) || t.length < 3) continue;
    const s = String((x && x.s) || "").trim();
    const { error } = await sb.from("news_items").update({ title_ru: cut(t, 220), summary_ru: s ? cut(s, 340) : null }).eq("id", id);
    if (!error) n++;
  }
  return n;
}

/* ---------- один проход ---------- */
async function runOnce(only?: string[]) {
  const t0 = Date.now();
  const { data: sources, error } = await sb.rpc("news_server_sources");
  if (error) throw error;
  const list = (sources || []).filter((s: any) => !only || only.includes(s.id));
  const report: Record<string, unknown> = {};
  await Promise.all(list.map(async (s: any) => {
    try {
      const xml = await feedText(s.feed_url, 20000);
      const items = parseFeed(xml);
      if (!items.length) throw new Error("пустая лента");
      const rows = items.map((it) => ({ source_id: s.id, category: s.category, region: s.region, lang: s.lang, ...it }));
      const { error: e2 } = await sb.from("news_items").upsert(rows, { onConflict: "source_id,guid", ignoreDuplicates: true });
      if (e2) throw new Error(e2.message);
      await sb.from("news_sources").update({ last_fetch_at: new Date().toISOString(), last_count: items.length, last_error: null }).eq("id", s.id);
      report[s.id] = items.length;
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 200);
      await sb.from("news_sources").update({ last_fetch_at: new Date().toISOString(), last_error: msg }).eq("id", s.id);
      report[s.id] = "ошибка: " + msg;
    }
  }));
  let translated = 0;
  for (let i = 0; i < 6 && Date.now() - t0 < 70_000; i++) {   // по 8 новостей за запрос, пока есть время
    let n = 0;
    try { n = await translatePending(); } catch (_) { break; }   // переведём в следующий раз
    translated += n;
    if (!n) break;
  }
  return { report, translated };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.headers.get("x-hook-secret") !== await hookSecret()) return new Response("forbidden", { status: 403 });
    const input = await req.json().catch(() => ({}));
    if (Array.isArray(input.probe)) {   // проверка адресов лент без записи в базу
      const out: Record<string, unknown> = {};
      await Promise.all(input.probe.map(async (u: string) => {
        try {
          out[u] = parseFeed(await feedText(String(u), 20000)).length;
        } catch (e) { out[u] = String((e as Error)?.message || e).slice(0, 100); }
      }));
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
    }
    const only = Array.isArray(input.only) ? input.only.map(String) : undefined;
    const res = await runOnce(only);
    return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
