// Mestario: отдаёт 30-секундный отрывок Apple Music через наш сервер — для тех, у кого серверы Apple
// не открываются. Пропускает только адреса audio-ssl.itunes.apple.com, поэтому это не открытый прокси.
const ok = /^https:\/\/audio-ssl\.itunes\.apple\.com\/[A-Za-z0-9/._%-]{10,500}$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "range" } });
  const u = new URL(req.url).searchParams.get("u") || "";
  if (!ok.test(u)) return new Response("bad url", { status: 400 });
  const range = req.headers.get("range");
  const r = await fetch(u, { headers: range ? { range } : {} });
  const h = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) { const v = r.headers.get(k); if (v) h.set(k, v); }
  // Apple подписывает отрывки как audio/x-m4p — браузеры его не знают, а внутри обычный AAC в MP4
  if (/m4p|octet/i.test(h.get("content-type") || "")) h.set("content-type", "audio/mp4");
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Cache-Control", "public, max-age=86400");
  return new Response(r.body, { status: r.status, headers: h });
});
