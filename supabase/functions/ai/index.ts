// Mestario: ИИ-помощник за ИИ-кредиты: один вопрос — один кредит. Кредиты выдают главные администраторы.
// Отвечает Google Gemini (бесплатная модель Flash). Ключ хранится только в базе (private.ai_config),
// функция получает его через ai_server_config() с правами service_role; в репозитории ключа нет.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Ты — ИИ-помощник мессенджера Mestario. Отвечай на языке вопроса (обычно по-русски), ясно и по делу,
без лишней воды; при необходимости используй короткие списки. Каждый вопрос стоит пользователю кредит, а переписки нет,
поэтому ответ должен быть полным и самодостаточным: уточнить ничего не получится. Не выдумывай фактов; если не уверен —
так и скажи. Не помогай с опасными, незаконными или вредными просьбами. Ответ — не длиннее 2500 символов.`;

const GL = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
let apiKey = "", models: string[] | null = null, useVertex = false;

async function key() {
  if (apiKey) return apiKey;
  const { data } = await sb.rpc("ai_server_config");
  apiKey = (data && data.api_key) || Deno.env.get("GEMINI_API_KEY") || "";
  return apiKey;
}
// подбираем самую новую обычную модель Flash из тех, что доступны ключу
async function pickModels(k: string) {
  if (models) return models;
  try {
    const r = await fetch(GL + "/models?pageSize=200", { headers: { "x-goog-api-key": k } });
    if (r.ok) {
      const j = await r.json();
      const ver = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
      const found = (j.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((n: string) => /^gemini-\d+(\.\d+)?-flash$/.test(n))
        .sort((a: string, b: string) => ver(b) - ver(a));
      if (found.length) { models = [...found, ...FALLBACK.filter((x) => !found.includes(x))]; return models; }
    }
  } catch (_) { /* ниже запасной список */ }
  models = FALLBACK;
  return models;
}
async function callModel(k: string, model: string, text: string, vertex: boolean) {
  const url = vertex
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(k)}`
    : `${GL}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: vertex ? { "content-type": "application/json" } : { "content-type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, err: JSON.stringify(j).slice(0, 300) };
  const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  return { ok: !!out, status: r.status, text: out, err: out ? "" : "empty " + JSON.stringify(j).slice(0, 200) };
}
// пробуем модели по очереди; если ключ не принимает обычный адрес — пробуем адрес Vertex AI
async function ask(text: string) {
  const k = await key();
  if (!k) return { ok: false, err: "no key", status: 503 } as any;
  const list = await pickModels(k);
  let last: any = null;
  for (const vertex of useVertex ? [true] : [false, true]) {
    for (const m of list.slice(0, 4)) {
      const res = await callModel(k, m, text, vertex);
      if (res.ok) { useVertex = vertex; return { ...res, model: m, vertex }; }
      last = { ...res, model: m, vertex };
      if (res.status === 429) return last;          // лимит бесплатного тарифа: дальше пробовать бессмысленно
    }
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    // самопроверка из базы: с секретом push-функции, без пользователя и без списания кредитов
    if (input.selftest) {
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      const r = await ask("Ответь одним словом: работает");
      return reply({ ok: r.ok, model: r.model, vertex: r.vertex, status: r.status, text: r.text, err: r.err, models: models?.slice(0, 5) });
    }

    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return reply({ error: "auth" }, 401);

    const { data: p } = await sb.from("profiles").select("banned_at,deleted_at").eq("id", uid).maybeSingle();
    if (!p || p.banned_at || p.deleted_at) return reply({ error: "not allowed" }, 403);

    const question = String(input.question ?? "").trim().slice(0, 1000);
    if (!question) return reply({ error: "empty" }, 400);
    if (!(await key())) return reply({ error: "not configured" }, 503);

    // списываем кредит заранее; если ответа не будет — вернём
    const { data: left, error: takeErr } = await sb.rpc("ai_take_credit", { p_user: uid });
    if (takeErr) return reply({ error: "db" }, 500);
    if (left === null) return reply({ error: "credits" }, 402);
    const { data: row, error: insErr } = await sb.from("ai_history").insert({ user_id: uid, question }).select("id").single();
    if (insErr) { await sb.rpc("ai_refund_credit", { p_user: uid }); return reply({ error: "db" }, 500); }

    const r = await ask(question);
    if (r && r.ok) {
      await sb.from("ai_history").update({ answer: r.text, status: "done" }).eq("id", row.id);
      return reply({ id: row.id, answer: r.text, credits: left });
    }
    console.error("ai failed", r?.model, r?.status, r?.err);
    // ответа нет — кредит возвращается
    await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id);
    await sb.rpc("ai_refund_credit", { p_user: uid });
    return reply({ error: r?.status === 429 ? "busy" : "ai" }, 502);
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
