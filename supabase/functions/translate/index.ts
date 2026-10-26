// Mestario: перевод сообщения одной кнопкой. Бесплатно для пользователя: готовый перевод хранится в базе
// (private.msg_translations) и повторно ИИ не вызывается; новых переводов — до 100 в день (с премиумом 500).
// Переводит Google Gemini тем же ключом, что и ИИ-помощник (ключ только в базе, получаем через ai_server_config).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const GL = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
const LN: Record<string, string> = { ru: "русский", en: "английский", az: "азербайджанский", tr: "турецкий", uk: "украинский", de: "немецкий", fr: "французский", es: "испанский" };
const blocked = new Map<string, number>();
let apiKey = "";

async function key() {
  if (apiKey) return apiKey;
  const { data } = await sb.rpc("ai_server_config");
  apiKey = (data && data.api_key) || Deno.env.get("GEMINI_API_KEY") || "";
  return apiKey;
}
async function tfetch(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}
async function gemini(k: string, model: string, sys: string, text: string, think: boolean) {
  const gc: any = { maxOutputTokens: 2048, temperature: 0.2 };
  if (think && /gemini-2\.5/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
  const r = await tfetch(`${GL}/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text }] }], generationConfig: gc }),
  }, 25000);
  const j = await r.json().catch(() => ({}));
  const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  return { status: r.status, text: out, err: r.ok ? "" : JSON.stringify(j).slice(0, 200) };
}
async function translate(sys: string, text: string) {
  const k = await key();
  if (k) for (const m of MODELS) {
    if ((blocked.get(m) || 0) > Date.now()) continue;
    try {
      let r = await gemini(k, m, sys, text, true);
      if (r.status === 400 && /think/i.test(r.err)) r = await gemini(k, m, sys, text, false);
      if (r.status === 200 && r.text) return r.text;
      if (r.status === 429) blocked.set(m, Date.now() + 30 * 60_000);
      else if (r.status === 404 || r.status === 403) blocked.set(m, Date.now() + 10 * 60_000);
    } catch (_) { /* следующая модель */ }
  }
  // запасной бесплатный ИИ, если у Gemini кончились лимиты
  try {
    const r = await tfetch("https://text.pollinations.ai/openai", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai", messages: [{ role: "system", content: sys }, { role: "user", content: text }] }),
    }, 25000);
    const j = await r.json().catch(() => ({}));
    return String(j?.choices?.[0]?.message?.content || "").trim();
  } catch (_) { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return reply({ error: "auth" }, 401);
    const msg = Number(input.message_id), lang = String(input.lang || "ru").toLowerCase();
    if (!/^[a-z]{2}$/.test(lang) || !Number.isFinite(msg)) return reply({ error: "bad" }, 400);
    const { data: src } = await sb.rpc("tr_source", { p_user: uid, p_msg: msg });
    if (!src) return reply({ error: "not found" }, 404);
    const { data: hit } = await sb.rpc("tr_get", { p_msg: msg, p_lang: lang });
    if (hit) return reply({ text: hit, cached: true });
    const { data: ok } = await sb.rpc("tr_take", { p_user: uid });
    if (!ok) return reply({ error: "limit" }, 429);
    const target = LN[lang] || lang;
    const sys = `Ты переводчик. Переведи сообщение пользователя на ${target} язык. Сохрани смысл, тон, эмодзи, ссылки и переносы строк. ` +
      `Если сообщение уже на этом языке, переведи его на ${lang === "en" ? "русский" : "английский"}. Ответь только переводом, без пояснений и кавычек.`;
    const out = await translate(sys, String(src).slice(0, 4000));
    if (!out) return reply({ error: "ai" }, 502);
    await sb.rpc("tr_put", { p_msg: msg, p_lang: lang, p_body: out });
    return reply({ text: out });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
