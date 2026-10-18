// Mestario: служебная функция — ставит аватарку служебному аккаунту (например, @ai).
// Вызывается только из базы с секретом x-hook-secret.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  try {
    const { data: pc } = await sb.rpc("push_server_config");
    if (!pc || req.headers.get("x-hook-secret") !== pc.hook_secret) return new Response("forbidden", { status: 403 });
    const input = await req.json();
    const { data: p } = await sb.from("profiles").select("id").eq("username", String(input.username || "")).maybeSingle();
    if (!p) return new Response("no user", { status: 404 });
    const bytes = Uint8Array.from(atob(String(input.png_b64 || "")), (c) => c.charCodeAt(0));
    if (bytes.length < 100 || bytes.length > 500000) return new Response("bad image", { status: 400 });
    const path = p.id + "/avatar-" + Date.now() + ".png";
    const up = await sb.storage.from("avatars").upload(path, bytes, { contentType: "image/png", cacheControl: "31536000" });
    if (up.error) return new Response("upload: " + up.error.message, { status: 500 });
    const { error } = await sb.from("profiles").update({ avatar_path: path }).eq("id", p.id);
    if (error) return new Response("profile: " + error.message, { status: 500 });
    return new Response(JSON.stringify({ path }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response("error: " + String(e), { status: 500 });
  }
});
