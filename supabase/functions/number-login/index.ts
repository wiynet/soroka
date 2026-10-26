// Mestario: вход по NFT-номеру +555. Код приходит владельцу номера сообщением от бота «Mestario» (@mest)
// на все его устройства и письмом на почту. Подходит любой из двух кодов; после проверки выдаём вход
// одноразовой ссылкой (как «Войти через браузер») или сессией из кода письма.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = () => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const realEmail = (e: unknown) => typeof e === "string" && e.includes("@") && !/@bots\.mestario\.invalid$/i.test(e) ? e : "";
const hint = (e: string) => { const [a, d] = e.split("@"); return (a.length <= 2 ? a[0] + "*" : a[0] + "***" + a[a.length - 1]) + "@" + d; };

async function emailOf(uid: string) {
  const { data } = await sb.auth.admin.getUserById(uid);
  return realEmail(data?.user?.email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    if (input.action === "start") {
      const { data: j, error } = await sb.rpc("nl_start", { p_number: String(input.number || "").slice(0, 32) });
      if (error || !j) { console.error("nl_start", error?.message); return reply({ error: "server" }, 500); }
      if (j.error) return reply({ error: j.error });
      const email = await emailOf(j.user_id);
      let mailed = false;
      if (email) {
        // письмо с кодом — тем же шаблоном, что и вход по коду из почты
        const { error: me } = await anon().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        mailed = !me;
        if (me) console.error("otp mail", me.message);
      }
      return reply({ id: j.id, number: j.number, email: mailed ? hint(email) : "" });
    }
    if (input.action === "verify") {
      const id = String(input.id || ""), code = String(input.code || "").replace(/\D/g, "").slice(0, 10);
      if (!/^[0-9a-f-]{36}$/.test(id) || code.length < 6) return reply({ error: "bad" });
      const { data: k, error } = await sb.rpc("nl_check", { p_id: id, p_code: code });
      if (error || !k) return reply({ error: "server" }, 500);
      if (k.error) return reply({ error: k.error });
      const email = await emailOf(k.user_id);
      if (!email) return reply({ error: "no email" });
      if (k.ok) {
        const { data: link, error: le } = await sb.auth.admin.generateLink({ type: "magiclink", email });
        const token_hash = link?.properties?.hashed_token;
        if (le || !token_hash) { console.error("generateLink", le?.message); return reply({ error: "server" }, 500); }
        return reply({ token_hash });
      }
      // не код от бота — может быть код из письма
      const { data: v } = await anon().auth.verifyOtp({ email, token: code, type: "email" });
      if (v?.session) {
        await sb.rpc("nl_done", { p_id: id });
        return reply({ session: { access_token: v.session.access_token, refresh_token: v.session.refresh_token } });
      }
      return reply({ error: "wrong", left: k.left });
    }
    return reply({ error: "bad" }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
