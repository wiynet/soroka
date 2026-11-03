// Mestario: проверка оплаты Mest в TON. Смотрит последние входящие переводы на кошелёк Mestario
// (публичный API toncenter), находит комментарий с кодом заказа «MST-XXXXXX» и зачисляет Mest
// через public.ton_settle — один раз на заказ и один раз на транзакцию.
// Вызывают: экран оплаты (с токеном пользователя, body {code}) и расписание раз в минуту (без body).
// Начисление зависит только от данных блокчейна, поэтому лишний вызов ничего не даёт — только сканирование.
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const svc = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: svc, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}

const CODE = /MST-[A-Z0-9]{6}/;
function commentOf(m: any): string {
  let t = typeof m?.message === "string" ? m.message : "";
  if (!t && m?.msg_data?.["@type"] === "msg.dataText" && m.msg_data.text) {
    try { t = new TextDecoder().decode(Uint8Array.from(atob(m.msg_data.text), (c) => c.charCodeAt(0))); } catch { /* не текст */ }
  }
  return t.toUpperCase();
}

let lastScan = 0;
let running: Promise<number> | null = null;
async function scan(): Promise<number> {
  const p = await rpc("ton_pending");
  const want = new Set<string>((p.orders || []).map((o: any) => o.code));
  if (!want.size || !p.address) return 0;
  const r = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(p.address)}&limit=100&archival=true`);
  if (!r.ok) throw new Error("toncenter " + r.status);
  const j = await r.json();
  if (!j.ok || !Array.isArray(j.result)) throw new Error("toncenter: " + JSON.stringify(j).slice(0, 200));
  let paid = 0;
  for (const tx of j.result) {
    const m = tx.in_msg;
    if (!m || !m.source) continue; // внешние сообщения (свои исходящие) пропускаем
    const code = commentOf(m).match(CODE)?.[0];
    if (!code || !want.has(code)) continue;
    const nano = Number(m.value);
    if (!Number.isFinite(nano) || nano <= 0) continue;
    const res = await rpc("ton_settle", { p_code: code, p_tx: String(tx.transaction_id?.hash || ""), p_nano: nano, p_from: String(m.source) });
    if (res === "paid") { paid++; want.delete(code); }
  }
  return paid;
}
function scanThrottled(): Promise<number> {
  if (running) return running;
  if (Date.now() - lastScan < 2500) return Promise.resolve(0);
  lastScan = Date.now();
  running = scan().finally(() => { running = null; });
  return running;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    let scanErr = "";
    try { await scanThrottled(); } catch (e) { scanErr = String(e).slice(0, 120); console.error(e); }
    const code = String(input.code || "").toUpperCase().match(CODE)?.[0];
    if (!code) return reply({ ok: true });
    // статус отдаём только владельцу заказа
    const auth = req.headers.get("Authorization") || "";
    const u = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: auth } });
    const me = u.ok ? (await u.json())?.id : null;
    if (!me) return reply({ error: "auth" }, 401);
    const o = await fetch(`${URL}/rest/v1/ton_orders?code=eq.${code}&select=user_id,status,credited`, { headers: svc }).then((r) => r.json());
    const row = Array.isArray(o) ? o[0] : null;
    if (!row || row.user_id !== me) return reply({ error: "not found" }, 404);
    return reply({ status: row.status, credited: row.credited, ...(scanErr ? { retry: true } : {}) });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
