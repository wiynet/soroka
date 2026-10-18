// Mestario: ИИ-помощник. Работает как собеседник @ai в личном чате (вызывается триггером базы на каждое
// сообщение боту) и в старом окне «один вопрос». Кредиты списываются за время работы модели:
// 1 ИИ-кредит за каждую начатую секунду. Админам сайта — без ограничений.
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
без лишней воды; при необходимости используй короткие списки. Время твоей работы стоит пользователю кредитов,
поэтому отвечай сразу по существу, полно, но без лишнего. Не выдумывай фактов; если не уверен —
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
type Turn = { role: "user" | "model"; text: string };
async function callModel(k: string, model: string, text: string | Turn[], vertex: boolean) {
  const turns: Turn[] = typeof text === "string" ? [{ role: "user", text }] : text;
  const url = vertex
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(k)}`
    : `${GL}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: vertex ? { "content-type": "application/json" } : { "content-type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, err: JSON.stringify(j).slice(0, 300) };
  const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  return { ok: !!out, status: r.status, text: out, err: out ? "" : "empty " + JSON.stringify(j).slice(0, 200) };
}
// пробуем модели по очереди; если ключ не принимает обычный адрес — пробуем адрес Vertex AI
async function ask(text: string | Turn[]) {
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

// ответ модели в чате: без разметки Markdown (сайт показывает обычный текст)
function plain(t: string) {
  return t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "• ").trim();
}
const CHAT_NOTE = "\nСейчас ты отвечаешь в чате мессенджера: ниже — последние сообщения переписки с пользователем, отвечай на последнее. " +
  "Пиши обычным текстом без Markdown (без ** и #), списки — с символом •. Любой код всегда оформляй блоком ```язык ... ``` — " +
  "каждый блок автоматически сохранится отдельным файлом, а в тексте останется ссылка на него. Код целиком пиши только в блоке.";

// блоки кода из ответа превращаем в файлы
const EXT: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  html: "html", css: "css", json: "json", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", sql: "sql", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", php: "php", kotlin: "kt", swift: "swift",
  lua: "lua", ruby: "rb", yaml: "yml", yml: "yml", xml: "xml", markdown: "md", md: "md", dart: "dart", r: "r", luau: "lua", vb: "vb", toml: "toml" };
function splitCode(t: string) {
  const files: { name: string; code: string }[] = [];
  const text = t.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g, (_all, lang: string, code: string) => {
    if (files.length >= 5 || !code.trim()) return code;
    const ext = EXT[String(lang || "").toLowerCase()] || "txt";
    const name = `code_${files.length + 1}.${ext}`;
    files.push({ name, code: code.replace(/\s+$/, "") + "\n" });
    return `📄 Код в файле ${name} (ниже)`;
  });
  return { text, files };
}

async function botReply(messageId: number) {
  const bot = (await sb.from("profiles").select("id").eq("username", "ai").maybeSingle()).data?.id;
  const { data: m } = await sb.from("messages").select("id,chat_id,sender_id,body,file_path,sticker_id,deleted_at").eq("id", messageId).maybeSingle();
  if (!bot || !m || m.deleted_at || m.sender_id === bot) return "skip";
  const { data: chat } = await sb.from("chats").select("id,is_group").eq("id", m.chat_id).maybeSingle();
  if (!chat || chat.is_group) return "skip";
  const say = (body: string) => sb.from("messages").insert({ chat_id: m.chat_id, sender_id: bot, body: body.slice(0, 4000) });

  const { data: u } = await sb.from("profiles").select("is_admin,banned_at,deleted_at").eq("id", m.sender_id).maybeSingle();
  if (!u || u.banned_at || u.deleted_at) return "skip";
  const unlimited = !!u.is_admin;
  if (!m.body || !String(m.body).trim()) { await say("Я пока понимаю только текст. Напишите вопрос словами."); return "no text"; }
  let balance = 0;
  if (!unlimited) {
    balance = Number((await sb.rpc("ai_balance", { p_user: m.sender_id })).data) || 0;
    if (balance < 1) {
      await say("У вас нет ИИ-кредитов. Я списываю 1 кредит за каждую секунду работы над ответом.\nКупить кредиты можно у @boss.");
      return "no credits";
    }
  }
  // последние сообщения переписки — чтобы можно было уточнять
  const { data: hist } = await sb.from("messages").select("sender_id,body").eq("chat_id", m.chat_id).is("deleted_at", null)
    .lte("id", m.id).order("id", { ascending: false }).limit(14);
  const turns: Turn[] = [];
  for (const x of (hist || []).reverse()) {
    if (!x.body) continue;
    const role = x.sender_id === bot ? "model" : "user";
    const text = role === "model" ? String(x.body).replace(/\n*⏱[^\n]*$/, "") : String(x.body);
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].text += "\n" + text;
    else turns.push({ role, text });
  }
  while (turns.length && turns[0].role === "model") turns.shift();
  if (!turns.length) turns.push({ role: "user", text: m.body });

  const { data: row } = await sb.from("ai_history").insert({ user_id: m.sender_id, question: String(m.body).slice(0, 1000) }).select("id").single();
  const t0 = Date.now();
  const r = await ask(turns.map((t, i) => i === 0 ? { ...t, text: CHAT_NOTE + "\n\n" + t.text } : t));
  const secs = Math.max(1, Math.ceil((Date.now() - t0) / 1000));
  if (!r || !r.ok) {
    if (row) await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id);
    await say(r?.status === 429 ? "Я сейчас перегружен — попробуйте через минуту. Кредиты не списаны." : "Не получилось ответить. Кредиты не списаны — попробуйте ещё раз.");
    return "failed";
  }
  let tail: string;
  if (unlimited) tail = `⏱ ${secs} с · без ограничений (админ)`;
  else {
    const c = (await sb.rpc("ai_charge", { p_user: m.sender_id, p_cost: secs })).data || { charged: secs, left: balance - secs };
    tail = `⏱ ${secs} с · −${c.charged} ${plural(c.charged)} · осталось ${c.left}`;
  }
  const { text: prose, files } = splitCode(r.text);
  const answer = plain(prose);
  if (row) await sb.from("ai_history").update({ answer: r.text.slice(0, 20000), status: "done" }).eq("id", row.id);
  await say(answer.slice(0, 3900) + "\n\n" + tail);
  // каждый блок кода — отдельным файлом в тот же чат
  for (const f of files) {
    const bytes = new TextEncoder().encode(f.code);
    const path = `${m.chat_id}/ai-${crypto.randomUUID()}-${f.name}`;
    const up = await sb.storage.from("attachments").upload(path, bytes, { contentType: "text/plain; charset=utf-8" });
    if (up.error) { console.error("code upload", up.error.message); continue; }
    await sb.from("messages").insert({ chat_id: m.chat_id, sender_id: bot, body: "", file_path: path, file_name: f.name,
      file_type: "text/plain", file_size: bytes.length });
  }
  return "ok";
}
function plural(n: number) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? "кредит" : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? "кредита" : "кредитов";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    // сообщение боту @ai: вызывает только база, с секретом
    if (input.message_id) {
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      return reply({ result: await botReply(Number(input.message_id)) });
    }
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

    const { data: p } = await sb.from("profiles").select("banned_at,deleted_at,is_admin").eq("id", uid).maybeSingle();
    if (!p || p.banned_at || p.deleted_at) return reply({ error: "not allowed" }, 403);

    const question = String(input.question ?? "").trim().slice(0, 1000);
    if (!question) return reply({ error: "empty" }, 400);
    if (!(await key())) return reply({ error: "not configured" }, 503);

    // списываем кредит заранее; если ответа не будет — вернём
    const free = !!p.is_admin;
    const { data: left, error: takeErr } = free ? { data: -1, error: null } : await sb.rpc("ai_take_credit", { p_user: uid });
    if (takeErr) return reply({ error: "db" }, 500);
    if (left === null) return reply({ error: "credits" }, 402);
    const { data: row, error: insErr } = await sb.from("ai_history").insert({ user_id: uid, question }).select("id").single();
    if (insErr) { if (!free) await sb.rpc("ai_refund_credit", { p_user: uid }); return reply({ error: "db" }, 500); }

    const r = await ask(question);
    if (r && r.ok) {
      await sb.from("ai_history").update({ answer: r.text, status: "done" }).eq("id", row.id);
      return reply({ id: row.id, answer: r.text, credits: left });
    }
    console.error("ai failed", r?.model, r?.status, r?.err);
    // ответа нет — кредит возвращается
    await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id);
    if (!free) await sb.rpc("ai_refund_credit", { p_user: uid });
    return reply({ error: r?.status === 429 ? "busy" : "ai" }, 502);
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
