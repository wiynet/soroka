// Mestario: поиск песен в каталоге Apple (iTunes Search) через сервер — для тех, у кого Apple из браузера
// не открывается (блокировка сети, Safari, VPN). Ответы кэшируются на 10 минут, чтобы не упираться в лимит Apple.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const cache = new Map<string, { at: number; items: unknown[] }>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    const q = String(input.q || "").trim().slice(0, 80);
    const cc = /^[a-z]{2}$/.test(String(input.country || "")) ? String(input.country) : "ru";
    if (q.length < 2) return reply({ items: [] });
    const key = cc + "|" + q.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return reply({ items: hit.items, cached: true });
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=25&country=${cc}&term=${encodeURIComponent(q)}`);
    if (r.status === 403 || r.status === 429) return reply({ error: "busy" }, 429);
    if (!r.ok) return reply({ error: "apple", status: r.status }, 502);
    const j = JSON.parse((await r.text()).trim() || "{}");
    const items = (j.results || []).filter((x: any) => x.previewUrl && x.trackId).map((x: any) => ({
      trackId: x.trackId, trackName: String(x.trackName || "").slice(0, 200), artistName: String(x.artistName || "").slice(0, 200),
      previewUrl: x.previewUrl, artworkUrl100: x.artworkUrl100 || x.artworkUrl60 || "", trackViewUrl: x.trackViewUrl || "", trackExplicitness: x.trackExplicitness || "",
    }));
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), items });
    return reply({ items });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
