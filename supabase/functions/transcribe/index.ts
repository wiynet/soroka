// Mestario: расшифровка голосовых и видеосообщений в текст (Google Gemini, ключ — в private.ai_config).
// Вызывает участник чата со своим токеном. Готовая расшифровка сохраняется в message_transcripts и дальше
// отдаётся всем участникам без повторного распознавания. Лимит — 60 новых расшифровок в сутки на человека.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const GL = "https://generativelanguage.googleapis.com/v1beta";
const FALLBACK = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
let apiKey = "", models: string[] | null = null;
const blocked = new Map<string, number>();

async function key() {
  if (apiKey) return apiKey;
  const { data } = await sb.rpc("ai_server_config");
  apiKey = (data && data.api_key) || "";
  return apiKey;
}
async function pickModels(k: string) {
  if (models) return models;
  try {
    const r = await fetch(GL + "/models?pageSize=200", { headers: { "x-goog-api-key": k } });
    const j = await r.json();
    const ver = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
    const found = (j.models || []).filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, "")).filter((n: string) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n))
      .sort((a: string, b: string) => (a.endsWith("-lite") ? 1 : 0) - (b.endsWith("-lite") ? 1 : 0) || ver(b) - ver(a));
    models = found.length ? [...found, ...FALLBACK.filter((x) => !found.includes(x))] : FALLBACK;
  } catch (_) { models = FALLBACK; }
  return models!;
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const PROMPT = "Это голосовое сообщение из мессенджера. Запиши дословно, что сказано, на языке оригинала, с обычной пунктуацией. " +
  "Без пояснений, кавычек и меток времени. Если речи нет или ничего не разобрать — ответь ровно: [без слов]";

async function recognize(mime: string, data: string) {
  const k = await key();
  if (!k) return { ok: false, status: 503 };
  let last: any = { ok: false, status: 503 };
  for (const m of (await pickModels(k)).filter((x) => (blocked.get(x) || 0) < Date.now()).slice(0, 6)) {
    const r = await fetch(`${GL}/models/${m}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
      if (out) return { ok: true, text: out };
      last = { ok: false, status: 502 };
      continue;
    }
    last = { ok: false, status: r.status, err: JSON.stringify(j).slice(0, 200) };
    if (r.status === 429) blocked.set(m, Date.now() + 30 * 60_000);
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    // самопроверка из базы (с секретом push-функции): распознать сообщение, ничего не сохраняя
    if (input.selftest) {
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      const { data: m } = await sb.from("messages").select("file_path,file_type,video_secs").eq("id", Number(input.message_id)).maybeSingle();
      if (!m?.file_path) return reply({ error: "no file" });
      const f = await sb.storage.from("attachments").download(m.file_path);
      const t = String(m.file_type || "");
      const mime = /webm/.test(t) ? "video/webm" : /ogg/.test(t) ? "audio/ogg" : /mp4|m4a|aac/.test(t) ? (m.video_secs != null ? "video/mp4" : "audio/aac") : (t || "audio/ogg");
      const r = await recognize(mime, b64(new Uint8Array(await f.data!.arrayBuffer())));
      return reply({ ok: r.ok, status: r.status, mime, len: r.text ? r.text.length : 0, err: r.err });
    }
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: au } = await sb.auth.getUser(jwt);
    const uid = au?.user?.id;
    if (!uid) return reply({ error: "auth" }, 401);
    const id = Number(input.message_id);
    if (!Number.isFinite(id) || id <= 0) return reply({ error: "bad id" }, 400);

    const { data: m } = await sb.from("messages").select("id,chat_id,file_path,file_type,voice_secs,video_secs,deleted_at").eq("id", id).maybeSingle();
    if (!m || m.deleted_at || !m.file_path || (m.voice_secs == null && m.video_secs == null)) return reply({ error: "not voice" }, 404);
    const { data: mem } = await sb.from("chat_members").select("user_id").eq("chat_id", m.chat_id).eq("user_id", uid).maybeSingle();
    if (!mem) return reply({ error: "not member" }, 403);

    const { data: done } = await sb.from("message_transcripts").select("body").eq("message_id", id).maybeSingle();
    if (done) return reply({ text: done.body, cached: true });

    if (Number(m.voice_secs ?? m.video_secs) > 600) return reply({ error: "too long" }, 413);
    const since = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await sb.from("message_transcripts").select("message_id", { count: "exact", head: true }).eq("by_user", uid).gte("created_at", since);
    if ((count || 0) >= 60) return reply({ error: "limit" }, 429);

    const file = await sb.storage.from("attachments").download(m.file_path);
    if (file.error || !file.data) return reply({ error: "file" }, 404);
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    if (bytes.length > 15 * 1024 * 1024) return reply({ error: "too big" }, 413);
    const t = String(m.file_type || "");
    // голосовые пишутся в webm/opus или mp4/aac; Gemini принимает их как видео- или аудиоконтейнер
    const mime = /webm/.test(t) ? "video/webm" : /ogg/.test(t) ? "audio/ogg" : /mp4|m4a|aac/.test(t) ? (m.video_secs != null ? "video/mp4" : "audio/aac") : /mpeg|mp3/.test(t) ? "audio/mp3" : /wav/.test(t) ? "audio/wav" : (t || "audio/ogg");
    const r = await recognize(mime, b64(bytes));
    if (!r.ok) { console.error("transcribe failed", r.status, r.err); return reply({ error: r.status === 429 ? "busy" : "failed" }, 502); }
    const text = String(r.text).replace(/^["«]|["»]$/g, "").slice(0, 8000);
    await sb.from("message_transcripts").upsert({ message_id: id, chat_id: m.chat_id, body: text, by_user: uid });
    return reply({ text });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
