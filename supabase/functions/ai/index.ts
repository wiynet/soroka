// Mestario: ИИ-помощник. Один вопрос в сутки (по времени Баку), только для премиума.
// Ключ модели хранится в секретах функций Supabase (ANTHROPIC_API_KEY), в коде и в репозитории его нет.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const MODEL = "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Ты — ИИ-помощник мессенджера Mestario. Отвечай на языке вопроса (обычно по-русски), ясно и по делу,
без лишней воды; при необходимости используй короткие списки. Это единственный вопрос пользователя на сегодня,
поэтому ответ должен быть полным и самодостаточным: уточнить ничего не получится. Не выдумывай фактов; если не уверен —
так и скажи. Не помогай с опасными, незаконными или вредными просьбами. Ответ — не длиннее 2500 символов.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return reply({ error: "auth" }, 401);

    const { data: p } = await sb.from("profiles").select("premium_until,banned_at,deleted_at").eq("id", uid).maybeSingle();
    if (!p || p.banned_at || p.deleted_at) return reply({ error: "not allowed" }, 403);
    if (!p.premium_until || new Date(p.premium_until) <= new Date()) return reply({ error: "premium" }, 403);

    const input = await req.json().catch(() => ({}));
    const question = String(input.question ?? "").trim().slice(0, 1000);
    if (!question) return reply({ error: "empty" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return reply({ error: "not configured" }, 503);

    // занимаем сегодняшний вопрос; уникальный индекс не даст задать второй
    const { data: row, error: insErr } = await sb.from("ai_questions").insert({ user_id: uid, question }).select("id").single();
    if (insErr) return reply({ error: insErr.code === "23505" ? "limit" : "db" }, insErr.code === "23505" ? 429 : 500);

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: question }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error("api " + r.status + " " + JSON.stringify(j).slice(0, 300));
      const answer = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || "…";
      await sb.from("ai_questions").update({ answer, status: "done" }).eq("id", row.id);
      return reply({ id: row.id, answer });
    } catch (e) {
      console.error(e);
      // вопрос не засчитывается, если ответ не получен
      await sb.from("ai_questions").update({ status: "failed" }).eq("id", row.id);
      return reply({ error: "ai" }, 502);
    }
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
