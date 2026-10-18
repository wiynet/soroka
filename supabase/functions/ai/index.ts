// Mestario: ИИ-помощник за ИИ-кредиты: один вопрос — один кредит. Кредиты выдают главные администраторы.
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
без лишней воды; при необходимости используй короткие списки. Каждый вопрос стоит пользователю кредит, а переписки нет,
поэтому ответ должен быть полным и самодостаточным: уточнить ничего не получится. Не выдумывай фактов; если не уверен —
так и скажи. Не помогай с опасными, незаконными или вредными просьбами. Ответ — не длиннее 2500 символов.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const uid = u?.user?.id;
    if (!uid) return reply({ error: "auth" }, 401);

    const { data: p } = await sb.from("profiles").select("banned_at,deleted_at").eq("id", uid).maybeSingle();
    if (!p || p.banned_at || p.deleted_at) return reply({ error: "not allowed" }, 403);

    const input = await req.json().catch(() => ({}));
    const question = String(input.question ?? "").trim().slice(0, 1000);
    if (!question) return reply({ error: "empty" }, 400);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return reply({ error: "not configured" }, 503);

    // списываем кредит заранее; если ответа не будет — вернём
    const { data: left, error: takeErr } = await sb.rpc("ai_take_credit", { p_user: uid });
    if (takeErr) return reply({ error: "db" }, 500);
    if (left === null) return reply({ error: "credits" }, 402);
    const { data: row, error: insErr } = await sb.from("ai_history").insert({ user_id: uid, question }).select("id").single();
    if (insErr) { await sb.rpc("ai_refund_credit", { p_user: uid }); return reply({ error: "db" }, 500); }

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: question }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error("api " + r.status + " " + JSON.stringify(j).slice(0, 300));
      const answer = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || "…";
      await sb.from("ai_history").update({ answer, status: "done" }).eq("id", row.id);
      return reply({ id: row.id, answer, credits: left });
    } catch (e) {
      console.error(e);
      // ответа нет — кредит возвращается
      await sb.from("ai_history").update({ status: "failed" }).eq("id", row.id);
      await sb.rpc("ai_refund_credit", { p_user: uid });
      return reply({ error: "ai" }, 502);
    }
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
