// Mestario: поиск GIF для панели стикеров. Ходим в GIPHY со своим ключом (ключ задаёт админ в админке,
// хранится в private.gif_config, функция получает его через gif_server_config() с правами service_role).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
let cache: { key: string; at: number } | null = null;
async function giphyKey() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.key;
  const { data } = await sb.rpc("gif_server_config");
  cache = { key: typeof data === "string" ? data : "", at: Date.now() };
  return cache.key;
}
const clean = (u: unknown) => {
  const s = String(u || "").split("?")[0];
  return /^https:\/\/(media[0-9]?|i)\.giphy\.com\/[A-Za-z0-9/_.-]+$/.test(s) ? s : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user?.id) return reply({ error: "auth" }, 401);
    const key = await giphyKey();
    if (!key) return reply({ error: "not configured" }, 503);
    const q = String(input.q || "").trim().slice(0, 60);
    const offset = Math.max(0, Math.min(4000, Math.floor(Number(input.offset) || 0)));
    const lang = String(input.lang || "ru") === "en" ? "en" : "ru";
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24&offset=${offset}&rating=pg-13&lang=${lang}`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=24&offset=${offset}&rating=pg-13`;
    const r = await fetch(url);
    if (r.status === 429) return reply({ error: "busy" }, 429);
    if (!r.ok) return reply({ error: "giphy", status: r.status }, 502);
    const j = await r.json().catch(() => ({}));
    const items = (j.data || []).map((g: any) => {
      const im = g.images || {};
      const full = im.fixed_width || im.downsized_small || {};
      const small = im.fixed_width_small || full;
      return { id: String(g.id || ""), mp4: clean(full.mp4), preview: clean(small.mp4 || full.mp4), w: Number(full.width) || 200, h: Number(full.height) || 200, title: String(g.title || "").slice(0, 80) };
    }).filter((x: any) => x.mp4);
    return reply({ items, next: offset + 24, total: Number(j.pagination?.total_count) || items.length });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
