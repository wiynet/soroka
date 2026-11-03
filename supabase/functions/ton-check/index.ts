// Mestario: проверка оплат в TON и USDT TRC-20 (пополнение Mest, премиум, NFT-лоты). Смотрит последние входящие переводы
// на кошелёк Mestario и на кошельки продавцов (публичный API toncenter), находит комментарий с кодом заказа «MST-XXXXXX» и зачисляет Mest
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// входящие переводы на один адрес; toncenter без ключа пускает ~1 запрос в секунду
async function txsOf(addr: string): Promise<any[]> {
  const r = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(addr)}&limit=100&archival=true`);
  if (!r.ok) throw new Error("toncenter " + r.status);
  const j = await r.json();
  if (!j.ok || !Array.isArray(j.result)) throw new Error("toncenter: " + JSON.stringify(j).slice(0, 200));
  return j.result;
}
async function scan(): Promise<number> {
  const p = await rpc("ton_pending");
  // заказы по адресам: кошелёк Mestario (пополнение, премиум, лоты Mestario) и кошельки продавцов (их лоты)
  const byAddr = new Map<string, Set<string>>();
  for (const o of p.orders || []) {
    const to = String(o.to || p.address || "");
    if (!to) continue;
    if (!byAddr.has(to)) byAddr.set(to, new Set());
    byAddr.get(to)!.add(o.code);
  }
  let paid = 0, first = true;
  for (const [addr, want] of [...byAddr.entries()].slice(0, 8)) {
    if (!first) await sleep(1100);
    first = false;
    let txs: any[];
    try { txs = await txsOf(addr); } catch (e) { console.error(addr.slice(0, 6), e); continue; }
    for (const tx of txs) {
      const m = tx.in_msg;
      if (!m || !m.source) continue; // внешние сообщения (свои исходящие) пропускаем
      const code = commentOf(m).match(CODE)?.[0];
      if (!code || !want.has(code)) continue;
      const nano = Number(m.value);
      if (!Number.isFinite(nano) || nano <= 0) continue;
      const res = await rpc("ton_settle", { p_code: code, p_tx: String(tx.transaction_id?.hash || ""), p_nano: nano, p_from: String(m.source), p_to: addr });
      if (res === "paid" || res === "short" || res === "review") { paid++; want.delete(code); }
    }
  }
  return paid;
}
// USDT TRC-20: переводы без комментария, заказ узнаём по точной сумме (к цене добавлены уникальные центы)
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
async function scanUsdt(): Promise<number> {
  let p: any;
  try { p = await rpc("usdt_pending"); } catch { return 0; }   // USDT ещё не настроен
  const orders: any[] = p && p.address ? (p.orders || []) : [];
  if (!orders.length) return 0;
  const r = await fetch(`https://api.trongrid.io/v1/accounts/${p.address}/transactions/trc20?only_to=true&only_confirmed=true&limit=100&contract_address=${USDT}`);
  if (!r.ok) throw new Error("trongrid " + r.status);
  const j = await r.json();
  let paid = 0;
  for (const tx of j.data || []) {
    if (tx.to !== p.address || tx.type !== "Transfer" || tx.token_info?.address !== USDT) continue;
    const o = orders.find((x) => x.micro === String(tx.value) && Number(tx.block_timestamp) >= Number(x.created) - 60000);
    if (!o) continue;
    const res = await rpc("usdt_settle", { p_code: o.code, p_tx: "tron:" + tx.transaction_id, p_micro: Number(tx.value), p_from: String(tx.from || ""), p_to: p.address, p_ts_ms: Number(tx.block_timestamp) });
    if (res === "paid") { paid++; orders.splice(orders.indexOf(o), 1); }
  }
  return paid;
}
function scanThrottled(): Promise<number> {
  if (running) return running;
  if (Date.now() - lastScan < 2500) return Promise.resolve(0);
  lastScan = Date.now();
  running = Promise.allSettled([scan(), scanUsdt()]).then((rs) => {
    for (const x of rs) if (x.status === "rejected") console.error(x.reason);
    return rs.reduce((n, x) => n + (x.status === "fulfilled" ? x.value : 0), 0);
  }).finally(() => { running = null; });
  return running;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json().catch(() => ({}));
    // раз в час: курс TON/USD для цены в USDT (цена в USDT = цена в TON × курс)
    if (input.action === "rate") {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd");
      const usd = r.ok ? Number((await r.json())?.["the-open-network"]?.usd) : NaN;
      if (!(usd > 0)) return reply({ error: "rate source" }, 502);
      return reply({ ton_usd: usd, micro_per_mest: await rpc("usdt_set_rate", { p_ton_usd: usd }) });
    }
    let scanErr = "";
    try { await scanThrottled(); } catch (e) { scanErr = String(e).slice(0, 120); console.error(e); }
    const code = String(input.code || "").toUpperCase().match(CODE)?.[0];
    if (!code) return reply({ ok: true });
    // статус отдаём только владельцу заказа
    const auth = req.headers.get("Authorization") || "";
    const u = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: auth } });
    const me = u.ok ? (await u.json())?.id : null;
    if (!me) return reply({ error: "auth" }, 401);
    const o = await fetch(`${URL}/rest/v1/ton_orders?code=eq.${code}&select=user_id,status,credited,kind,note`, { headers: svc }).then((r) => r.json());
    const row = Array.isArray(o) ? o[0] : null;
    if (!row || row.user_id !== me) return reply({ error: "not found" }, 404);
    return reply({ status: row.status, credited: row.credited, kind: row.kind, note: row.note, ...(scanErr ? { retry: true } : {}) });
  } catch (e) {
    console.error(e);
    return reply({ error: "server" }, 500);
  }
});
