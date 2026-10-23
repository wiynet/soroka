// Mestario: вход в приложение через браузер.
// 1) приложение: create → получает id и секрет (секрет остаётся только в приложении), открывает в браузере ссылку #approve-<id>;
// 2) браузер, где человек уже вошёл: info / decide — показывает запрос и подтверждает или отклоняет его;
// 3) приложение: take (id + секрет) — после подтверждения получает одноразовый токен входа (magic link без письма)
//    и входит им: это новая отдельная сессия, сессия браузера не трогается. Запрос живёт 5 минут и срабатывает один раз.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function userFrom(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: p } = await sb.from("profiles").select("id,banned_at,deleted_at").eq("id", uid).maybeSingle();
  return p && !p.banned_at && !p.deleted_at ? uid : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    const action = String(input.action || "");
    const id = String(input.id || "");
    if (action !== "create" && !UUID.test(id)) return reply({ error: "bad id" }, 400);

    if (action === "create") {
      const secret = crypto.randomUUID() + crypto.randomUUID();
      const { data, error } = await sb.rpc("handoff_create", { p_secret_hash: await sha(secret), p_device: String(input.device || "").slice(0, 120) });
      if (error) return reply({ error: /busy/.test(error.message) ? "busy" : "db" }, error.message.includes("busy") ? 429 : 500);
      return reply({ id: data, secret });
    }
    if (action === "info" || action === "decide") {
      const uid = await userFrom(req);
      if (!uid) return reply({ error: "auth" }, 401);
      if (action === "info") {
        const { data } = await sb.rpc("handoff_info", { p_id: id });
        return reply(data || { status: "missing" });
      }
      const { data, error } = await sb.rpc("handoff_decide", { p_id: id, p_user: uid, p_ok: !!input.ok });
      if (error) return reply({ error: "db" }, 500);
      return reply({ result: data });
    }
    if (action === "take") {
      const secret = String(input.secret || "");
      if (secret.length < 30) return reply({ error: "bad secret" }, 400);
      const { data, error } = await sb.rpc("handoff_take", { p_id: id, p_secret_hash: await sha(secret) });
      if (error || !data) return reply({ error: "db" }, 500);
      if (data.status !== "approved") return reply({ status: data.status });
      const { data: u } = await sb.auth.admin.getUserById(data.user_id);
      const email = u?.user?.email;
      if (!email) return reply({ status: "failed" });
      const { data: link, error: le } = await sb.auth.admin.generateLink({ type: "magiclink", email });
      const token_hash = link?.properties?.hashed_token;
      if (le || !token_hash) { console.error("generateLink", le?.message); return reply({ status: "failed" }); }
      return reply({ status: "approved", token_hash });
    }
    return reply({ error: "bad action" }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
