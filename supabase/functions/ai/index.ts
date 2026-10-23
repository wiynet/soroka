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
    const r = await tfetch(GL + "/models?pageSize=200", { headers: { "x-goog-api-key": k } }, 4000);
    if (r.ok) {
      const j = await r.json();
      const ver = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
      const found = (j.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((n: string) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n))
        // сначала обычные Flash (умнее), потом Lite; внутри — от новой версии к старой
        .sort((a: string, b: string) => (a.endsWith("-lite") ? 1 : 0) - (b.endsWith("-lite") ? 1 : 0) || ver(b) - ver(a));
      if (found.length) { models = [...found, ...FALLBACK.filter((x) => !found.includes(x))]; return models; }
    }
  } catch (_) { /* ниже запасной список */ }
  models = FALLBACK;
  return models;
}
type Turn = { role: "user" | "model"; text: string };
// любой запрос наружу — с ограничением по времени: зависший ответ не должен держать ИИ минутами
async function tfetch(url: string, init: RequestInit, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}
// «размышление» модели перед ответом — главная задержка (5–20 с); для чата выключаем его или ставим минимальным
const noThink = new Set<string>();
function thinkCfg(model: string) {
  if (noThink.has(model)) return undefined;
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-[3-9]/.test(model)) return { thinkingLevel: "minimal" };
  return undefined;
}
function genCfg(model: string, extra: Record<string, unknown> = {}) {
  const tc = thinkCfg(model);
  return tc ? { ...extra, thinkingConfig: tc } : extra;
}
const thinkRejected = (status: number, err: string) => status === 400 && /think/i.test(err);
// потоковый ответ: текст приходит кусками, onText получает всё накопленное
async function streamModel(k: string, model: string, turns: Turn[], onText: (t: string) => void, sys = SYSTEM) {
  const body = (gc: any) => JSON.stringify({
    systemInstruction: { parts: [{ text: sys }] },
    contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: gc,
  });
  const c = new AbortController();
  let tm = setTimeout(() => c.abort(), 12000);   // первые слова — не дольше 12 с, иначе к следующей модели
  let full = "";
  try {
    let r = await fetch(`${GL}/models/${model}:streamGenerateContent?alt=sse`, { method: "POST", signal: c.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": k }, body: body(genCfg(model, { maxOutputTokens: 4096, temperature: 0.7 })) });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      if (!thinkRejected(r.status, err)) return { ok: false, status: r.status, err: err.slice(0, 300) };
      noThink.add(model);
      r = await fetch(`${GL}/models/${model}:streamGenerateContent?alt=sse`, { method: "POST", signal: c.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": k }, body: body({ maxOutputTokens: 4096, temperature: 0.7 }) });
      if (!r.ok) return { ok: false, status: r.status, err: (await r.text().catch(() => "")).slice(0, 300) };
    }
    const rd = r.body!.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const piece = ((j.candidates || [])[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("");
          if (piece) {
            if (!full) { clearTimeout(tm); tm = setTimeout(() => c.abort(), 60000); }   // ответ пошёл — даём дописать
            full += piece; onText(full);
          }
        } catch (_) { /* неполная строка */ }
      }
    }
  } catch (e) {
    if (!full) return { ok: false, status: 504, err: "timeout " + String(e).slice(0, 100) };
  } finally { clearTimeout(tm); }
  full = full.trim();
  return { ok: !!full, status: 200, text: full, err: full ? "" : "empty" };
}
async function callModel(k: string, model: string, text: string | Turn[], vertex: boolean, sys = SYSTEM, maxTok = 4096) {
  const turns: Turn[] = typeof text === "string" ? [{ role: "user", text }] : text;
  const url = vertex
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(k)}`
    : `${GL}/models/${model}:generateContent`;
  const send = (gc: any) => tfetch(url, {
    method: "POST",
    headers: vertex ? { "content-type": "application/json" } : { "content-type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: gc,
    }),
  }, maxTok > 4096 ? 60000 : 30000);
  let r: Response;
  try { r = await send(genCfg(model, { maxOutputTokens: maxTok, temperature: 0.7 })); } catch (e) { return { ok: false, status: 504, err: "timeout" }; }
  let j = await r.json().catch(() => ({}));
  if (!r.ok && thinkRejected(r.status, JSON.stringify(j))) {
    noThink.add(model);
    try { r = await send({ maxOutputTokens: maxTok, temperature: 0.7 }); } catch (e) { return { ok: false, status: 504, err: "timeout" }; }
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) return { ok: false, status: r.status, err: JSON.stringify(j).slice(0, 300) };
  const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  return { ok: !!out, status: r.status, text: out, err: out ? "" : "empty " + JSON.stringify(j).slice(0, 200) };
}
// у каждой модели свой бесплатный лимит: исчерпанную пропускаем 30 минут и идём к следующей,
// а если кончились все — отвечает запасной бесплатный ИИ (Pollinations)
const blocked = new Map<string, number>();
async function ask(text: string | Turn[], onText?: (t: string) => void, sys = SYSTEM, maxTok = 4096) {
  const k = await key();
  let last: any = { ok: false, status: 503, err: "no key" };
  if (k) {
    const list = (await pickModels(k)).filter((m) => (blocked.get(m) || 0) < Date.now()).slice(0, 8);
    const started = Date.now();
    for (const vertex of useVertex ? [true] : [false, true]) {
      let any429 = false;
      for (const m of list) {
        if (Date.now() - started > 35000) break;   // общий предел: дальше — запасной ИИ, а не бесконечный перебор
        const turns: Turn[] = typeof text === "string" ? [{ role: "user", text }] : text;
        const res: any = onText && !vertex ? await streamModel(k, m, turns, onText, sys) : await callModel(k, m, text, vertex, sys, maxTok);
        // модель, которая не отвечает или недоступна ключу, на время пропускаем — не тратим на неё секунды
        if (!res.ok && res.status !== 429 && (res.status === 404 || res.status === 403 || res.status === 504)) blocked.set(m, Date.now() + 10 * 60_000);
        if (res.ok) { useVertex = vertex; return { ...res, model: m, vertex }; }
        last = { ...res, model: m, vertex };
        if (res.status === 429) { blocked.set(m, Date.now() + 30 * 60_000); any429 = true; }
      }
      if (any429) break;   // ключ принят, просто лимиты — адрес Vertex не поможет
    }
  }
  const fb = await pollinationsText(text, sys);
  return fb.ok ? fb : last;
}
async function pollinationsText(text: string | Turn[], sys = SYSTEM) {
  try {
    const turns: Turn[] = typeof text === "string" ? [{ role: "user", text }] : text;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch("https://text.pollinations.ai/openai", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openai", messages: [{ role: "system", content: sys },
        ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))] }),
    });
    clearTimeout(tm);
    const j = await r.json().catch(() => ({}));
    const out = String(j?.choices?.[0]?.message?.content || "").trim();
    return out ? { ok: true, status: 200, text: out, model: "pollinations" } : { ok: false, status: r.status, err: "pollinations empty", model: "pollinations" };
  } catch (e) {
    return { ok: false, status: 504, err: String(e).slice(0, 200), model: "pollinations" };
  }
}

// ---------- изображения ----------
let imageModels: string[] | null = null;
async function pickImageModels(k: string) {
  if (imageModels) return imageModels;
  try {
    const r = await fetch(GL + "/models?pageSize=300", { headers: { "x-goog-api-key": k } });
    const j = await r.json();
    const ver = (n: string) => Number((/gemini-(\d+(?:\.\d+)?)/.exec(n) || [])[1] || 0);
    imageModels = (j.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""))
      .filter((n: string) => /^gemini-[\d.]+-flash.*image/.test(n))
      .sort((a: string, b: string) => (ver(b) - ver(a)) || (a.includes("preview") ? 1 : 0) - (b.includes("preview") ? 1 : 0));
  } catch (_) { imageModels = []; }
  if (!imageModels!.length) imageModels = ["gemini-2.5-flash-image", "gemini-2.0-flash-preview-image-generation"];
  return imageModels!;
}
let geminiImgBlockedUntil = 0;   // бесплатный ключ: квота на картинки нулевая — не тратим время пользователя на повторные отказы
async function makeImage(prompt: string, english = false) {
  const k = await key();
  let last: any = { ok: false, err: "no model" };
  for (const model of Date.now() < geminiImgBlockedUntil ? [] : (await pickImageModels(k)).slice(0, 2)) {
    const r = await fetch(`${GL}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      last = { ok: false, status: r.status, model, err: JSON.stringify(j).slice(0, 300) };
      if (r.status === 429 || r.status === 403) { geminiImgBlockedUntil = Date.now() + 3600_000; break; }
      continue;
    }
    const parts = (j.candidates || [])[0]?.content?.parts || [];
    const img = parts.find((x: any) => x.inlineData && String(x.inlineData.mimeType || "").startsWith("image/"));
    const text = parts.filter((x: any) => x.text).map((x: any) => x.text).join("").trim();
    if (img) return { ok: true, model, mime: img.inlineData.mimeType, bytes: Uint8Array.from(atob(img.inlineData.data), (ch) => ch.charCodeAt(0)), text };
    last = { ok: false, status: 200, model, err: "no image " + text.slice(0, 200) };
  }
  // у бесплатного ключа Gemini картинок нет — рисуем через бесплатный Pollinations (без ключа)
  const p = await pollinations(prompt, english);
  return p.ok ? p : last.status === 429 && p.status !== 429 ? p : last;
}
async function pollinations(prompt: string, english = false) {
  try {
    const tr = english ? { ok: true, text: prompt } : await ask("Переведи на английский как короткий промпт для генерации изображения (до 60 слов). Выведи только сам промпт, без кавычек и пояснений:\n" + prompt);
    const en = tr && tr.ok ? tr.text.replace(/^["'«]|["'»]$/g, "").slice(0, 600) : prompt;
    const seed = Math.floor(Math.random() * 1e9);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(en)}?width=1024&height=1024&nologo=true&seed=${seed}`;
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 90000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(tm);
    const mime = (r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !mime.startsWith("image/")) return { ok: false, status: r.status, model: "pollinations", err: "bad response " + mime };
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length < 1000) return { ok: false, status: 502, model: "pollinations", err: "tiny image" };
    return { ok: true, model: "pollinations", mime, bytes, text: "" };
  } catch (e) {
    return { ok: false, status: 504, model: "pollinations", err: String(e).slice(0, 200) };
  }
}
// просьба нарисовать: «нарисуй…», «/img …», «сгенерируй картинку…», «draw…»
function wantsImage(t: string) {
  const s = t.trim().toLowerCase();
  if (/^(\/img|\/image|нарисуй|изобрази|draw |paint )/.test(s)) return true;
  return /(сгенерир|создай|сделай|нарисуй|придумай|скинь|покажи|generate|create|make)/.test(s) &&
    /(картинк|изображени|рисунок|рисунк|фото|фотк|мем|арт|аватар|логотип|лого|постер|обои|иллюстрац|стикер|image|picture|photo|meme|logo|wallpaper)/.test(s);
}

// ответ модели в чате: без разметки Markdown (сайт показывает обычный текст)
function plain(t: string) {
  return t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "• ").trim();
}
const CHAT_NOTE = "\nСейчас ты отвечаешь в чате мессенджера: ниже — последние сообщения переписки с пользователем, отвечай на последнее. " +
  "Пиши обычным текстом без Markdown (без ** и #), списки — с символом •. Любой код всегда оформляй блоком ```язык ... ``` " +
  "с указанием языка — пользователь увидит его с кнопками «Копировать» и «Скачать файлом». " +
  "Ты умеешь рисовать и присылать картинки (рисунки, фото, мемы, арты, логотипы, обои и т. п.). Если пользователь просит " +
  "изображение или изменить прошлое, ответь ТОЛЬКО одной строкой: [[IMAGE: подробное описание картинки на английском]] — " +
  "без других слов; картинка придёт автоматически. Никогда не пиши, что «отправляешь запрос» или «генерируешь», не прислав эту строку.";

// блоки кода из ответа превращаем в файлы
const EXT: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  html: "html", css: "css", json: "json", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", sql: "sql", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", php: "php", kotlin: "kt", swift: "swift",
  lua: "lua", ruby: "rb", yaml: "yml", yml: "yml", xml: "xml", markdown: "md", md: "md", dart: "dart", r: "r", luau: "lua", vb: "vb", toml: "toml" };
// текст ответа → сообщения до 3900 символов: проза без Markdown, блоки кода остаются ```язык …```
// (сайт показывает их карточкой с кнопками). Блок длиннее одного сообщения уходит файлом.
function buildReply(t: string) {
  const segs: { kind: "text" | "code"; text: string; lang?: string }[] = [];
  let last = 0;
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(t))) {
    if (mm.index > last) segs.push({ kind: "text", text: plain(t.slice(last, mm.index)) });
    segs.push({ kind: "code", lang: (mm[1] || "").toLowerCase(), text: mm[2].replace(/\s+$/, "") });
    last = re.lastIndex;
  }
  if (last < t.length) segs.push({ kind: "text", text: plain(t.slice(last)) });
  const files: { name: string; code: string }[] = [];
  const msgs: string[] = [];
  let cur = "";
  const push = (piece: string) => {
    if (!piece) return;
    if (cur && (cur + "\n\n" + piece).length > 3900) { msgs.push(cur); cur = ""; }
    if (piece.length > 3900) { for (let i = 0; i < piece.length; i += 3900) msgs.push(piece.slice(i, i + 3900)); return; }
    cur = cur ? cur + "\n\n" + piece : piece;
  };
  let n = 0;
  for (const s of segs) {
    if (s.kind === "text") { push(s.text.trim()); continue; }
    if (!s.text.trim()) continue;
    n++;
    const ext = EXT[s.lang || ""] || "txt";
    const block = "```" + (s.lang || ext) + "\n" + s.text + "\n```";
    if (block.length <= 3800) push(block);
    else { const name = `code_${n}.${ext}`; files.push({ name, code: s.text + "\n" }); push(`📄 Код длинный — он в файле ${name} (ниже)`); }
  }
  if (cur) msgs.push(cur);
  return { msgs, files };
}

// расшифровка голосового для ИИ: тот же Gemini, что отвечает; результат сохраняется для всех участников чата
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function voiceText(m: any): Promise<string> {
  const { data: done } = await sb.from("message_transcripts").select("body").eq("message_id", m.id).maybeSingle();
  if (done) return done.body;
  if (Number(m.voice_secs ?? m.video_secs) > 600) return "";
  const f = await sb.storage.from("attachments").download(m.file_path);
  if (f.error || !f.data) return "";
  const bytes = new Uint8Array(await f.data.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) return "";
  const t = String(m.file_type || "");
  const mime = /webm/.test(t) ? "video/webm" : /ogg/.test(t) ? "audio/ogg" : /mp4|m4a|aac/.test(t) ? (m.video_secs != null ? "video/mp4" : "audio/aac") : /mpeg|mp3/.test(t) ? "audio/mp3" : /wav/.test(t) ? "audio/wav" : (t || "audio/ogg");
  const k = await key();
  if (!k) return "";
  const data = b64(bytes);
  const prompt = "Это голосовое сообщение из мессенджера. Запиши дословно, что сказано, на языке оригинала, с обычной пунктуацией. " +
    "Без пояснений, кавычек и меток времени. Если речи нет или ничего не разобрать — ответь ровно: [без слов]";
  for (const model of (await pickModels(k)).filter((x) => (blocked.get(x) || 0) < Date.now()).slice(0, 6)) {
    let r: Response;
    try {
      r = await tfetch(`${GL}/models/${model}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data } }, { text: prompt }] }], generationConfig: genCfg(model, { temperature: 0, maxOutputTokens: 4096 }) }),
      }, 30000);
    } catch (_) { continue; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) { blocked.set(model, Date.now() + 30 * 60_000); continue; }
    if (!r.ok) continue;
    const out = ((j.candidates || [])[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim().replace(/^["«]|["»]$/g, "").slice(0, 8000);
    if (!out) continue;
    await sb.from("message_transcripts").upsert({ message_id: m.id, chat_id: m.chat_id, body: out, by_user: m.sender_id });
    return out;
  }
  return "";
}

let botCached = "";
async function botId() {
  if (!botCached) botCached = (await sb.from("profiles").select("id").eq("username", "ai").maybeSingle()).data?.id || "";
  return botCached;
}
async function botReply(messageId: number) {
  // запросы к базе — параллельно: каждая лишняя очередь — это задержка перед ответом
  const [bq, mq] = await Promise.all([
    botId(),
    sb.from("messages").select("id,chat_id,sender_id,body,file_path,file_type,voice_secs,video_secs,sticker_id,deleted_at").eq("id", messageId).maybeSingle(),
  ]);
  const bot = bq, m = mq.data;
  if (!bot || !m || m.deleted_at || m.sender_id === bot) return "skip";
  const [{ data: chat }, { data: members }] = await Promise.all([
    sb.from("chats").select("id,is_group").eq("id", m.chat_id).maybeSingle(),
    sb.from("chat_members").select("user_id").eq("chat_id", m.chat_id).eq("user_id", bot),
  ]);
  if (!chat || chat.is_group) return "skip";
  if (!(members || []).length) return "skip";
  // отвечаем ровно один раз: запустить могут и база, и само приложение
  const { data: claimed } = await sb.rpc("ai_claim", { p_message: m.id });
  if (!claimed) return "dup";
  const say = (body: string) => sb.from("messages").insert({ chat_id: m.chat_id, sender_id: bot, body: body.slice(0, 4000) });

  const [{ data: u }, bal, { data: hist }] = await Promise.all([
    sb.from("profiles").select("is_admin,banned_at,deleted_at").eq("id", m.sender_id).maybeSingle(),
    sb.rpc("ai_balance", { p_user: m.sender_id }),
    sb.from("messages").select("id,sender_id,body,voice_secs,video_secs").eq("chat_id", m.chat_id).is("deleted_at", null)
      .lte("id", m.id).order("id", { ascending: false }).limit(14),
  ]);
  if (!u || u.banned_at || u.deleted_at) return "skip";
  const unlimited = !!u.is_admin;
  const isVoice = !!m.file_path && (m.voice_secs != null || m.video_secs != null);
  if ((!m.body || !String(m.body).trim()) && !isVoice) { await say("Я понимаю текст и голосовые сообщения. Напишите вопрос словами или запишите голосовое."); return "no text"; }
  let balance = 0;
  if (!unlimited) {
    balance = Number(bal.data) || 0;
    if (balance < 1) {
      await say("У вас нет ИИ-кредитов. Я списываю 1 кредит за каждую секунду работы над ответом.\nКупить кредиты можно за Mest: кнопка «+ Кредиты» вверху этого чата (1 Mest = 1 кредит).");
      return "no credits";
    }
  }
  const t0 = Date.now();
  // голосовое: сначала расшифровываем (текст сохраняется и виден под голосовым), дальше отвечаем на сказанное
  let question = String(m.body || "").trim();
  if (!question && isVoice) {
    const heard = await voiceText(m);
    if (!heard) { await say("Не получилось разобрать голосовое — попробуйте ещё раз или напишите текстом. Кредиты не списаны."); return "voice failed"; }
    if (/^\[без слов\]$/i.test(heard.trim())) { await say("В голосовом не слышно слов — запишите, пожалуйста, ещё раз. Кредиты не списаны."); return "voice empty"; }
    question = heard;
  }
  // последние сообщения переписки — чтобы можно было уточнять; у голосовых берём их расшифровку
  const vids = (hist || []).filter((x: any) => !x.body && (x.voice_secs != null || x.video_secs != null)).map((x: any) => x.id);
  const heardMap = new Map<number, string>();
  if (vids.length) for (const r of ((await sb.from("message_transcripts").select("message_id,body").in("message_id", vids)).data || [])) heardMap.set(r.message_id, r.body);
  heardMap.set(m.id, question);
  const turns: Turn[] = [];
  for (const x of (hist || []).reverse()) {
    const body = x.body || (heardMap.has(x.id) ? "(голосовое) " + heardMap.get(x.id) : "");
    if (!body) continue;
    const role = x.sender_id === bot ? "model" : "user";
    const text = role === "model" ? String(body).replace(/\n*⏱[^\n]*$/, "") : String(body);
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].text += "\n" + text;
    else turns.push({ role, text });
  }
  while (turns.length && turns[0].role === "model") turns.shift();
  if (!turns.length) turns.push({ role: "user", text: question });

  // запись в историю — не ждём, она не нужна для ответа
  const rowP = sb.from("ai_history").insert({ user_id: m.sender_id, question: question.slice(0, 1000) }).select("id").single().then((x: any) => x.data);
  let imagePrompt = "", english = false;
  let r: any = null;
  // ответ печатается прямо в чате по мере готовности: первое сообщение появляется через секунду-две и дописывается
  let live: number | null = null, shown = "", lastPush = 0, chain: Promise<unknown> = Promise.resolve();
  const preview = (full: string) => { const b = buildReply(full).msgs[0] || ""; return b.length > 3900 ? b.slice(0, 3900) : b; };
  const onText = (full: string) => {
    if (/^\s*\[\[/.test(full)) return;                 // это команда нарисовать картинку — не показываем
    const now = Date.now();
    if (now - lastPush < (live ? 700 : 250) || full.length < 12) return;
    lastPush = now;
    const text = preview(full) + " ▍";
    if (text === shown) return;
    shown = text;
    chain = chain.then(async () => {
      if (live == null) {
        const { data } = await sb.from("messages").insert({ chat_id: m.chat_id, sender_id: bot, body: text }).select("id").single();
        live = data ? data.id : null;
      } else await sb.from("messages").update({ body: text }).eq("id", live);
    }).catch(() => {});
  };
  if (wantsImage(question)) imagePrompt = question.replace(/^\s*\/(img|image)\s*/i, "");
  else {
    r = await ask(turns.map((t, i) => i === 0 ? { ...t, text: CHAT_NOTE + "\n\n" + t.text } : t), onText);
    await chain;
    const mk = r && r.ok ? /\[\[\s*IMAGE\s*:\s*([\s\S]+?)\]\]/i.exec(r.text) : null;
    if (mk) { imagePrompt = mk[1].trim(); english = true; }
  }
  if (imagePrompt) {
    const im = await makeImage(imagePrompt, english);
    const secs = Math.max(1, Math.ceil((Date.now() - t0) / 1000));
    if (!im.ok) {
      console.error("image failed", im.model, im.status, im.err);
      { const row = await rowP; if (row) await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id); }
      await say(im.status === 429 ? "Рисовалка сейчас перегружена — попробуйте через минуту. Кредиты не списаны."
        : "Не получилось нарисовать. Кредиты не списаны — попробуйте описать картинку иначе.");
      return "image failed";
    }
    let itail: string;
    if (unlimited) itail = `⏱ ${secs} с · без ограничений (админ)`;
    else {
      const c = (await sb.rpc("ai_charge", { p_user: m.sender_id, p_cost: secs })).data || { charged: secs, left: balance - secs };
      itail = `⏱ ${secs} с · −${c.charged} ${plural(c.charged)} · осталось ${c.left}`;
    }
    const bytes: Uint8Array = im.bytes;
    const ext = String(im.mime).includes("jpeg") ? "jpg" : String(im.mime).includes("webp") ? "webp" : "png";
    const path = `${m.chat_id}/ai-${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("attachments").upload(path, bytes, { contentType: im.mime });
    if (up.error) { await say("Картинка получилась, но не загрузилась. Попробуйте ещё раз."); return "upload failed"; }
    const caption = (plain(im.text || "").slice(0, 3000) + "\n\n" + itail).trim();
    await sb.from("messages").insert({ chat_id: m.chat_id, sender_id: bot, body: caption, file_path: path,
      file_name: "mestario-ai." + ext, file_type: im.mime, file_size: bytes.length });
    { const row = await rowP; if (row) await sb.from("ai_history").update({ answer: "[изображение] " + (im.text || ""), status: "done" }).eq("id", row.id); }
    return "image ok";
  }
  const secs = Math.max(1, Math.ceil((Date.now() - t0) / 1000));
  if (!r || !r.ok) {
    if (live != null) await sb.from("messages").delete().eq("id", live);
    { const row = await rowP; if (row) await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id); }
    await say(r?.status === 429 ? "Я сейчас перегружен — попробуйте через минуту. Кредиты не списаны." : "Не получилось ответить. Кредиты не списаны — попробуйте ещё раз.");
    return "failed";
  }
  let tail: string;
  if (unlimited) tail = `⏱ ${secs} с · без ограничений (админ)`;
  else {
    const c = (await sb.rpc("ai_charge", { p_user: m.sender_id, p_cost: secs })).data || { charged: secs, left: balance - secs };
    tail = `⏱ ${secs} с · −${c.charged} ${plural(c.charged)} · осталось ${c.left}`;
  }
  const { msgs, files } = buildReply(r.text);
  { const row = await rowP; if (row) await sb.from("ai_history").update({ answer: r.text.slice(0, 20000), status: "done" }).eq("id", row.id); }
  if (!msgs.length) msgs.push("…");
  msgs[msgs.length - 1] += "\n\n" + tail;
  if (live != null) {
    await sb.from("messages").update({ body: msgs[0].slice(0, 4000) }).eq("id", live);
    for (const x of msgs.slice(1)) await say(x);
  } else for (const x of msgs) await say(x);
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

// ---------- боты пользователей: ответы ИИ и помощник конструктора ----------
function botVars(t: string, p: any, mest: number) {
  return String(t || "").replaceAll("{name}", p?.display_name || "").replaceAll("{username}", p?.username ? "@" + p.username : "")
    .replaceAll("{mest}", String(mest || 0)).replaceAll("{id}", p?.num != null ? String(p.num) : "")
    .replaceAll("{date}", new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("."));
}
async function botAiReply(messageId: number) {
  const { data: ctx } = await sb.rpc("bot_ai_context", { p_message: messageId });
  if (!ctx || ctx.matched) return "skip";
  const cfg = ctx.config || {};
  if (!cfg.ai || !cfg.ai.on || cfg.deleted) return "off";
  const { data: claimed } = await sb.rpc("ai_claim", { p_message: messageId });
  if (!claimed) return "dup";
  const [{ data: m }, { data: who }, { data: w }] = await Promise.all([
    sb.from("messages").select("id,chat_id,sender_id,body,file_path,file_type,voice_secs,video_secs").eq("id", messageId).maybeSingle(),
    sb.from("profiles").select("display_name,username,num").eq("id", ctx.sender).maybeSingle(),
    sb.from("wallets").select("balance").eq("user_id", ctx.sender).maybeSingle(),
  ]);
  const mest = Number(w?.balance || 0);
  const unknown = async () => {
    const u = cfg.unknown;
    if (!u || !u.text) return;
    const mk: any = {}; if (u.kb) mk.kb = u.kb; if (u.inline) mk.inline = u.inline; if (u.hide) mk.hide = true;
    await sb.from("messages").insert({ chat_id: ctx.chat, sender_id: ctx.bot, body: botVars(u.text, who, mest).slice(0, 4000), markup: Object.keys(mk).length ? mk : null });
  };
  const { data: ok } = await sb.rpc("bot_ai_take", { p_owner: ctx.owner, p_kind: "reply" });
  if (!ok) { await unknown(); return "limit"; }
  let question = String(m?.body || "").trim();
  if (!question && m && m.file_path && (m.voice_secs != null || m.video_secs != null)) question = await voiceText(m);
  if (!question || /^\[без слов\]$/i.test(question)) { await unknown(); return "empty"; }
  const { data: hist } = await sb.from("messages").select("id,sender_id,body").eq("chat_id", ctx.chat).is("deleted_at", null)
    .lte("id", messageId).order("id", { ascending: false }).limit(12);
  const turns: Turn[] = [];
  for (const x of (hist || []).reverse()) {
    const text = x.id === messageId ? question : String(x.body || "");
    if (!text) continue;
    const role = x.sender_id === ctx.bot ? "model" : "user";
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].text += "\n" + text;
    else turns.push({ role, text });
  }
  while (turns.length && turns[0].role === "model") turns.shift();
  if (!turns.length) turns.push({ role: "user", text: question });
  const buttons = [...new Set(((cfg.cmds || []) as any[]).map((c) => String(c.on || "").split("|")[0].trim()).filter(Boolean))].slice(0, 60);
  const sys = `Ты — бот «${ctx.name}» (@${ctx.username}) в мессенджере Mestario. Собеседника зовут ${who?.display_name || "пользователь"}, у него ${mest} Mest.
Отвечай кратко и по делу, на языке собеседника, обычным текстом без Markdown (без ** и #). Не выдумывай фактов. Не помогай с опасными, незаконными или вредными просьбами.
${buttons.length ? "У бота есть кнопки и команды: " + buttons.join(", ") + ". Если вопрос про них — предложи нажать нужную кнопку." : ""}
${cfg.ai.prompt ? "Инструкция владельца бота (характер, знания, правила):\n" + String(cfg.ai.prompt).slice(0, 3000) : ""}`;
  let live: number | null = null, shown = "", lastPush = 0, chain: Promise<unknown> = Promise.resolve();
  const onText = (full: string) => {
    const now = Date.now();
    if (now - lastPush < (live ? 700 : 250) || full.length < 12) return;
    lastPush = now;
    const text = plain(full).slice(0, 3900) + " ▍";
    if (text === shown) return;
    shown = text;
    chain = chain.then(async () => {
      if (live == null) { const { data } = await sb.from("messages").insert({ chat_id: ctx.chat, sender_id: ctx.bot, body: text }).select("id").single(); live = data ? data.id : null; }
      else await sb.from("messages").update({ body: text }).eq("id", live);
    }).catch(() => {});
  };
  const r: any = await ask(turns, onText, sys);
  await chain;
  if (!r || !r.ok) {
    if (live != null) await sb.from("messages").update({ body: "Не получилось ответить — попробуйте ещё раз." }).eq("id", live);
    else await unknown();
    return "failed";
  }
  const out = plain(r.text).slice(0, 4000) || "…";
  if (live != null) await sb.from("messages").update({ body: out }).eq("id", live);
  else await sb.from("messages").insert({ chat_id: ctx.chat, sender_id: ctx.bot, body: out });
  return "ok";
}
const GEN_SYS = `Ты помогаешь собрать бота в конструкторе мессенджера Mestario (как боты Telegram, но без кода).
Верни ТОЛЬКО JSON без пояснений и без \`\`\`, вида:
{"start":{"text":"...","kb":[["Кнопка 1","Кнопка 2"]],"inline":[[{"t":"Сайт","u":"https://..."}]]},
 "cmds":[{"on":"Кнопка 1|синоним|/команда","text":"...","kb":[["..."]],"inline":[[{"t":"Ещё","s":"Кнопка 2"}]],"hide":false}],
 "unknown":{"text":"..."},"ai":{"on":false,"prompt":"..."}}
Правила: start — ответ на «Начать»; cmds — ответы на нажатие кнопки или текст (варианты через |); unknown — если ничего не подошло.
kb — клавиатура над полем ввода: до 10 рядов по 4 кнопки, текст кнопки до 40 символов. inline — кнопки под сообщением: {"t":"текст","u":"https://..."} (ссылка) или {"t":"текст","s":"текст команды"}.
У каждой кнопки клавиатуры и каждой inline-кнопки с "s" должна быть команда с таким "on". Обычно повторяй главное меню (kb) в ответах, чтобы клавиатура не пропадала.
В текстах можно использовать {name} (имя человека), {username}, {mest} (его баланс Mest), {id}, {date}. Бот не умеет платить, хранить данные и считать — только отвечать текстом и кнопками; для свободных ответов есть ИИ ("ai").
Если дан текущий бот — сохрани его и измени по задаче. Не больше 80 команд. Пиши на языке задачи.`;
async function botGen(uid: string, input: any) {
  const id = String(input.bot || "");
  const { data: b } = await sb.from("bots").select("id,owner,config").eq("id", id).maybeSingle();
  if (!b || b.owner !== uid) return { error: "not owner", status: 403 };
  const { data: ok } = await sb.rpc("bot_ai_take", { p_owner: uid, p_kind: "gen" });
  if (!ok) return { error: "no access", status: 402 };
  const task = String(input.request || "").trim().slice(0, 2000);
  if (!task) return { error: "empty", status: 400 };
  const cur = input.config && typeof input.config === "object" ? JSON.stringify(input.config).slice(0, 60000) : "";
  const r: any = await ask((cur ? "Текущий бот:\n" + cur + "\n\n" : "") + "Задача: " + task, undefined, GEN_SYS, 16384);
  if (!r || !r.ok) return { error: r?.status === 429 ? "busy" : "ai", status: 502 };
  const raw = String(r.text);
  const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
  try { return { config: JSON.parse(raw.slice(a, z + 1)) }; } catch (_) { return { error: "bad json", status: 502 }; }
}
function plural(n: number) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? "кредит" : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? "кредита" : "кредитов";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    // бот пользователя: ответ ИИ, когда готовой команды нет (вызывает база с секретом или приложение собеседника)
    if (input.bot_message) {
      const id = Number(input.bot_message);
      if (input.client) {
        const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const { data: au } = await sb.auth.getUser(jwt);
        const { data: mm } = await sb.from("messages").select("sender_id").eq("id", id).maybeSingle();
        if (!au?.user?.id || !mm || mm.sender_id !== au.user.id) return reply({ error: "forbidden" }, 403);
        const job = botAiReply(id).catch((e) => console.error("botAiReply", e));
        // @ts-ignore: EdgeRuntime есть в среде Supabase
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(job); return reply({ queued: true }); }
        return reply({ result: await job });
      }
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      return reply({ result: await botAiReply(id) });
    }
    // помощник конструктора: собрать или изменить бота по описанию (владелец, с доступом к ИИ для ботов)
    if (input.bot_gen) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: au } = await sb.auth.getUser(jwt);
      if (!au?.user?.id) return reply({ error: "auth" }, 401);
      const g: any = await botGen(au.user.id, input);
      return reply(g, g.status || 200);
    }
    // сообщение боту @ai из самого приложения (если запрос из базы завис): только своё сообщение
    if (input.message_id && input.client) {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: au } = await sb.auth.getUser(jwt);
      const { data: mm } = await sb.from("messages").select("sender_id").eq("id", Number(input.message_id)).maybeSingle();
      if (!au?.user?.id || !mm || mm.sender_id !== au.user.id) return reply({ error: "forbidden" }, 403);
      const job = botReply(Number(input.message_id)).catch((e) => console.error("botReply", e));
      // @ts-ignore: EdgeRuntime есть в среде Supabase — ответ продолжает готовиться, даже если приложение закрыли
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(job); return reply({ queued: true }); }
      return reply({ result: await job });
    }
    // сообщение боту @ai: вызывает база, с секретом
    if (input.message_id) {
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      return reply({ result: await botReply(Number(input.message_id)) });
    }
    // самопроверка из базы: с секретом push-функции, без пользователя и без списания кредитов
    if (input.selftest) {
      const { data: pc } = await sb.rpc("push_server_config");
      if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return reply({ error: "forbidden" }, 403);
      if (input.list) {
        const lr = await fetch(GL + "/models?pageSize=300", { headers: { "x-goog-api-key": await key() } });
        const lj = await lr.json().catch(() => ({}));
        return reply({ status: lr.status, models: (lj.models || []).map((x: any) => String(x.name).replace(/^models\//, "") + " [" + (x.supportedGenerationMethods || []).join(",") + "]") });
      }
      // замер: сколько отвечает каждая модель, с выключенным «размышлением» и без
      if (input.probe) {
        const k = await key(); const out: any[] = [];
        for (const m of (await pickModels(k)).slice(0, 5)) for (const think of [true, false]) {
          const t = Date.now();
          const gc: any = { maxOutputTokens: 256, temperature: 0.7 };
          if (think) gc.thinkingConfig = /gemini-2\.5/.test(m) ? { thinkingBudget: 0 } : { thinkingLevel: String(input.level || "minimal") };
          const r = await fetch(`${GL}/models/${m}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": k },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Привет! Как дела? Ответь одним предложением." }] }], generationConfig: gc }) });
          const j = await r.json().catch(() => ({}));
          out.push({ m, think, status: r.status, ms: Date.now() - t, err: r.ok ? "" : JSON.stringify(j).slice(0, 160) });
        }
        return reply(out);
      }
      if (input.image) { const im = await makeImage(String(input.image)); return reply({ ok: im.ok, model: im.model, status: im.status, mime: im.mime, size: im.bytes?.length, err: im.err, text: im.text }); }
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
