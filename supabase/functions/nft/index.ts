// Mestario: NFT в сети TON (подарки-NFT, коллекционные юзернеймы и номера).
// Служебный кошелёк Mestario (ключ создаётся здесь один раз и хранится в Vault — его никто не видит) владеет коллекцией,
// выпускает NFT по оплаченным заказам и принимает их обратно.
//   POST {action:"setup"}  — создать служебный кошелёк (если его нет) и, когда на нём есть TON, развернуть коллекцию;
//   POST {action:"scan"}   — найти оплаты вывода и возвраты, выпустить или перевести NFT (раз в минуту, пока есть заказы);
//   GET  /nft/meta/<id>.json, /nft/img/<id>.svg — карточка NFT для Tonkeeper и других кошельков.
import TonWeb from "npm:tonweb@0.0.66";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SELF = URL_ + "/functions/v1/nft";
const TONAPI = "https://tonapi.io/v2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const svc = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: svc, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- сеть: toncenter не чаще раза в секунду (без ключа) ----------
let lastTc = 0;
async function tcWait() { const w = lastTc + 1100 - Date.now(); if (w > 0) await sleep(w); lastTc = Date.now(); }
class SlowProvider extends (TonWeb as any).HttpProvider {
  async send(method: string, params: unknown) { await tcWait(); return super.send(method, params); }
}
const tw = new (TonWeb as any)(new SlowProvider("https://toncenter.com/api/v2/jsonRPC"));
const { Address, BN, nacl, toNano, hexToBytes, bytesToHex } = (TonWeb as any).utils;
const { NftCollection, NftItem } = (TonWeb as any).token.nft;
async function tonapi(path: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(TONAPI + path);
    if (r.status === 429) { await sleep(1200 * (i + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("tonapi " + r.status);
    return r.json();
  }
  throw new Error("tonapi rate");
}
const same = (a?: string | null, b?: string | null) => {
  try { return !!a && !!b && new Address(a).toString(false) === new Address(b).toString(false); } catch { return false; }
};
const friendly = (a: string, bounce: boolean) => new Address(a).toString(true, true, bounce);

// ---------- служебный кошелёк ----------
async function minter() {
  let hex: string | null = await rpc("nft_srv_key", { p_hex: null });
  if (!hex) {
    const kp = nacl.sign.keyPair();
    hex = await rpc("nft_srv_key", { p_hex: bytesToHex(kp.secretKey) });
  }
  const secretKey = hexToBytes(hex!);
  const publicKey = secretKey.slice(32);
  const wallet = new tw.wallet.all.v4R2(tw.provider, { publicKey, wc: 0 });
  const addr = (await wallet.getAddress()).toString(true, true, false);
  return { wallet, secretKey, addr };
}
function collectionOf(ownerAddr: string) {
  return new NftCollection(tw.provider, {
    ownerAddress: new Address(ownerAddr),
    royalty: 0, royaltyAddress: new Address(ownerAddr),
    collectionContentUri: SELF + "/meta/collection.json",
    nftItemContentBaseUri: SELF + "/meta/",
    nftItemCodeHex: NftItem.codeHex,
  });
}
async function seqnoOf(wallet: any) { const n = await wallet.methods.seqno().call(); return typeof n === "number" ? n : 0; }
// отправить с кошелька и дождаться, что сеть его приняла (seqno вырос)
async function send(m: { wallet: any; secretKey: Uint8Array }, to: string, nano: bigint, payload?: unknown, stateInit?: unknown) {
  const seqno = await seqnoOf(m.wallet);
  await m.wallet.methods.transfer({ secretKey: m.secretKey, toAddress: to, amount: new BN(nano.toString()), seqno, payload, sendMode: 3, stateInit }).send();
  for (let i = 0; i < 20; i++) { await sleep(3000); if ((await seqnoOf(m.wallet)) > seqno) return true; }
  return false;
}
async function balanceOf(addr: string) { const a = await tonapi("/accounts/" + encodeURIComponent(addr)); return BigInt(a?.balance || 0); }

async function setup() {
  const m = await minter();
  const st = await rpc("nft_srv_state");
  const coll = collectionOf(m.addr), collAddr = (await coll.getAddress()).toString(true, true, true);
  if (!st.cfg.minter || !st.cfg.collection) await rpc("nft_srv_config", { p_minter: m.addr, p_collection: collAddr, p_deployed: null });
  if (st.cfg.deployed) return { minter: m.addr, collection: collAddr, deployed: true };
  const bal = await balanceOf(m.addr);
  if (bal < 150000000n) return { minter: m.addr, collection: collAddr, deployed: false, need: "Пополните служебный кошелёк минимум на 0,2 TON", balance: bal.toString() };
  const acc = await tonapi("/accounts/" + encodeURIComponent(collAddr));
  if (!acc || acc.status !== "active") {
    const { stateInit } = await coll.createStateInit();
    const ok = await send(m, collAddr, 50000000n, undefined, stateInit);
    if (!ok) return { minter: m.addr, collection: collAddr, deployed: false, need: "Сеть не подтвердила создание коллекции — повторите через минуту" };
    for (let i = 0; i < 10; i++) { await sleep(3000); const a = await tonapi("/accounts/" + encodeURIComponent(collAddr)); if (a?.status === "active") break; }
  }
  await rpc("nft_srv_config", { p_minter: null, p_collection: null, p_deployed: true });
  return { minter: m.addr, collection: collAddr, deployed: true };
}

// ---------- оплаты и возвраты ----------
const CODE = /NFT-[A-Z0-9]{6}/;
function commentOf(m: any): string {
  let t = typeof m?.message === "string" ? m.message : "";
  if (!t && m?.msg_data?.["@type"] === "msg.dataText" && m.msg_data.text) {
    try { t = new TextDecoder().decode(Uint8Array.from(atob(m.msg_data.text), (c) => c.charCodeAt(0))); } catch { /* */ }
  }
  return t.toUpperCase();
}
async function itemOwner(itemAddr: string) {
  const n = await tonapi("/nfts/" + encodeURIComponent(itemAddr));
  return n && n.owner ? n.owner.address as string : null;
}
async function scan() {
  const st = await rpc("nft_srv_state");
  const cfg = st.cfg, orders: any[] = st.orders || [];
  if (!cfg.deployed || !cfg.minter || !orders.length) return { orders: orders.length };
  const m = await minter();
  if (!same(m.addr, cfg.minter)) throw new Error("minter mismatch");
  const coll = collectionOf(m.addr);
  const out: string[] = [];
  // 1) оплаты вывода: входящие на служебный кошелёк с кодом
  const want = new Map(orders.filter((o) => o.op === "out" && o.status === "pending").map((o) => [o.code, o]));
  if (want.size) {
    await tcWait();
    const r = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(m.addr)}&limit=50&archival=true`).then((x) => x.json());
    for (const tx of r.result || []) {
      const msg = tx.in_msg; if (!msg || !msg.source) continue;
      const code = commentOf(msg).match(CODE)?.[0]; if (!code || !want.has(code)) continue;
      const res = await rpc("nft_srv_paid", { p_code: code, p_tx: "ton:" + (tx.transaction_id?.hash || ""), p_nano: Number(msg.value) });
      want.delete(code);
      if (res) { const o = orders.find((x) => x.code === code); if (o) { o.status = "paid"; o.chain = res.chain; o.id = res.order; } out.push("paid " + code); }
    }
  }
  // 2) оплаченные: выпустить новый NFT или перевести тот, что хранится у Mestario. По одному за запуск — seqno идёт по порядку
  const job = orders.find((o) => o.status === "paid");
  if (job && job.chain) {
    const ch = job.chain, dest = job.dest as string;
    const itemAddr = ch.item_addr || (await coll.getNftItemAddressByIndex(new BN(String(ch.item_index)))).toString(true, true, true);
    const owner = await itemOwner(itemAddr).catch(() => null);
    if (owner && same(owner, dest)) { await rpc("nft_srv_done", { p_order: job.id, p_item_addr: itemAddr, p_ok: true, p_note: null }); out.push("done " + job.code); }
    else {
      const sentAt = /^sent:(\d+)/.exec(job.note || "")?.[1];
      if (sentAt && Date.now() - Number(sentAt) < 180000) out.push("waiting " + job.code);
      else if ((await balanceOf(m.addr)) < 80000000n) out.push("minter low");
      else {
        await markSent(job.id);
        let ok: boolean;
        if (!owner) {
          const body = coll.createMintBody({ amount: toNano("0.03"), itemIndex: Number(ch.item_index), itemOwnerAddress: new Address(dest), itemContentUri: ch.kind[0] + "-" + encodeURIComponent(ch.ref) + ".json", queryId: Date.now() });
          ok = await send(m, (await coll.getAddress()).toString(true, true, true), 50000000n, body);
        } else if (same(owner, m.addr)) {
          const item = new NftItem(tw.provider, { address: itemAddr });
          const body = await item.createTransferBody({ newOwnerAddress: new Address(dest), forwardAmount: toNano("0.000000001"), responseAddress: new Address(m.addr), queryId: Date.now() });
          ok = await send(m, itemAddr, 50000000n, body);
        } else {
          await rpc("nft_srv_done", { p_order: job.id, p_item_addr: itemAddr, p_ok: false, p_note: "NFT не у Mestario: " + owner });
          ok = false; out.push("lost " + job.code);
        }
        if (ok) {
          for (let i = 0; i < 8; i++) {
            await sleep(4000);
            const o2 = await itemOwner(itemAddr).catch(() => null);
            if (o2 && same(o2, dest)) { await rpc("nft_srv_done", { p_order: job.id, p_item_addr: itemAddr, p_ok: true, p_note: null }); out.push("done " + job.code); break; }
          }
        }
      }
    }
  }
  // 3) возвраты: NFT пришёл на служебный кошелёк с кодом
  const back = orders.filter((o) => o.op === "back" && o.status === "pending");
  if (back.length) {
    const ev = await tonapi("/accounts/" + encodeURIComponent(m.addr) + "/events?limit=50");
    for (const e of ev?.events || []) for (const a of e.actions || []) {
      if (a.type !== "NftItemTransfer" || a.status !== "ok") continue;
      const t = a.NftItemTransfer || {};
      if (!same(t.recipient?.address, m.addr)) continue;
      const code = String(t.comment || "").toUpperCase().match(CODE)?.[0];
      if (!code || !back.some((o) => o.code === code)) continue;
      const res = await rpc("nft_srv_returned", { p_code: code, p_item_addr: friendly(t.nft, true), p_tx: "ton-ev:" + e.event_id });
      out.push("back " + code + " " + res);
    }
  }
  return { out };
}
async function markSent(id: number) {
  await fetch(`${URL_}/rest/v1/nft_orders?id=eq.${id}`, { method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body: JSON.stringify({ note: "sent:" + Date.now() }) });
}

// ---------- карточки NFT ----------
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function parseId(id: string) {
  const k = { g: "gift", u: "user", n: "num" }[id[0]];
  return k && id[1] === "-" ? { kind: k, ref: decodeURIComponent(id.slice(2)) } : null;
}
async function cardSvg(kind: string, d: any) {
  const c1 = d.c1 || (kind === "num" ? "#2f9e6e" : "#6aa9ff"), c2 = d.c2 || (kind === "num" ? "#0f4d36" : "#24307a");
  const title = kind === "gift" ? d.type : kind === "user" ? "@" + d.username : d.number;
  const sub = kind === "gift" ? "№" + d.number + (d.model ? " · " + d.model : "") : kind === "user" ? "Коллекционный юзернейм Mestario" : "Коллекционный номер Mestario";
  let center = "";
  const art = kind === "gift" ? (d.model_art || d.type_art) : null;
  if (art) center = `<image href="${esc(art)}" x="136" y="96" width="240" height="240" preserveAspectRatio="xMidYMid meet"/>`;
  else if (kind === "gift") center = `<text x="256" y="270" font-size="190" text-anchor="middle">${esc(d.emoji || "🎁")}</text>`;
  else center = `<path transform="translate(186 120) scale(5.8)" d="M6 3h12l4 6-10 12L2 9z" fill="#fff" opacity=".22"/><path transform="translate(186 120) scale(5.8)" d="M6 3h12l4 6-10 12L2 9zM2 9h20M9 3l-2 6 5 12 5-12-2-6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`;
  const fs = title.length > 14 ? 30 : title.length > 10 ? 38 : 46;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><radialGradient id="g" cx="35%" cy="25%" r="90%"><stop offset="0" stop-color="${esc(c1)}"/><stop offset="1" stop-color="${esc(c2)}"/></radialGradient></defs>
<rect width="512" height="512" rx="48" fill="url(#g)"/>${center}
<text x="256" y="408" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff" text-anchor="middle">${esc(title)}</text>
<text x="256" y="452" font-family="Inter,Arial,sans-serif" font-size="22" fill="#fff" fill-opacity=".8" text-anchor="middle">${esc(sub)}</text>
<text x="256" y="52" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="20" fill="#fff" fill-opacity=".7" text-anchor="middle" letter-spacing="3">MESTARIO</text></svg>`;
}
async function meta(path: string) {
  const mm = /\/(meta|img)\/([^/]+)\.(json|svg)$/.exec(path);
  if (!mm) return new Response("not found", { status: 404, headers: cors });
  const [, what, id] = mm;
  const head = { ...cors, "Cache-Control": "public, max-age=600" };
  if (what === "meta" && id === "collection") {
    return new Response(JSON.stringify({ name: "Mestario Collectibles", description: "Коллекционные подарки, юзернеймы и номера мессенджера Mestario (mestario.lol).",
      image: "https://mestario.lol/icon-512.png", external_link: "https://mestario.lol", social_links: ["https://mestario.lol"] }), { headers: { ...head, "Content-Type": "application/json" } });
  }
  const p = parseId(id);
  const d = p ? await rpc("nft_srv_meta", { p_kind: p.kind, p_ref: p.ref }) : null;
  if (!p || !d) return new Response("not found", { status: 404, headers: cors });
  if (what === "img") return new Response(await cardSvg(p.kind, d), { headers: { ...head, "Content-Type": "image/svg+xml" } });
  const name = p.kind === "gift" ? `${d.type} #${d.number}` : p.kind === "user" ? "@" + d.username : d.number;
  const attrs = p.kind === "gift" ? [{ trait_type: "Модель", value: d.model || "—" }, { trait_type: "Фон", value: d.backdrop || "—" }, { trait_type: "Номер", value: String(d.number) }]
    : [{ trait_type: "Тип", value: p.kind === "user" ? "Юзернейм" : "Номер" }];
  return new Response(JSON.stringify({ name, description: p.kind === "gift" ? "Коллекционный подарок Mestario." : p.kind === "user" ? `Коллекционный юзернейм @${d.username} в Mestario.` : `Коллекционный номер ${d.number} в Mestario.`,
    image: SELF + "/img/" + id + ".svg", attributes: attrs, external_url: "https://mestario.lol" }), { headers: { ...head, "Content-Type": "application/json" } });
}

let running: Promise<unknown> | null = null;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "GET") return await meta(path);
    const input = await req.json().catch(() => ({}));
    // setup — только с ключом сервера (его знает только Mestario)
    if (input.action === "setup") {
      if ((req.headers.get("Authorization") || "") !== "Bearer " + KEY) return reply({ error: "auth" }, 401);
      return reply(await setup());
    }
    if (input.action === "scan") {
      if (!running) running = scan().finally(() => { running = null; });
      return reply(await running);
    }
    return reply({ ok: true });
  } catch (e) {
    console.error(e);
    return reply({ error: String(e).slice(0, 200) }, 500);
  }
});
