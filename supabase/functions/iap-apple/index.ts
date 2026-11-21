// Mestario: зачисление Mest за покупку в App Store.
// Приложение для iPhone присылает подписанную Apple транзакцию (StoreKit 2, JWS). Проверяем подпись Apple,
// что покупка сделана в нашем приложении, этим пользователем (appAccountToken = его id) и не возвращена,
// и зачисляем Mest один раз на одну покупку. Ключей Apple не нужно: подпись проверяется по цепочке сертификатов.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyAppleJws } from "./verify.ts";

const BUNDLE_ID = "top.mestario.app";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method" }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await sb.auth.getUser(jwt);
  const user = au && au.user;
  if (!user) return reply({ error: "auth" }, 401);
  let body: { jws?: string };
  try { body = await req.json(); } catch { return reply({ error: "bad request" }, 400); }

  let tx: Record<string, unknown>;
  try { tx = await verifyAppleJws(String(body.jws || "")); }
  catch (e) { return reply({ error: "verify", detail: String((e as Error).message || e) }, 400); }

  if (tx.bundleId !== BUNDLE_ID) return reply({ error: "bundle" }, 400);
  if (tx.revocationDate) return reply({ error: "revoked" }, 400);
  if (tx.type && tx.type !== "Consumable") return reply({ error: "type" }, 400);
  // покупку сделал именно этот аккаунт Mestario (приложение передаёт его id в Apple при покупке)
  const token = String(tx.appAccountToken || "").toLowerCase();
  if (!token || token !== user.id.toLowerCase()) return reply({ error: "account" }, 403);

  const { data, error } = await sb.rpc("iap_apple_credit", {
    p_user: user.id,
    p_tx: String(tx.transactionId),
    p_orig: tx.originalTransactionId ? String(tx.originalTransactionId) : null,
    p_product: String(tx.productId),
    p_env: String(tx.environment || "Production"),
    p_purchased: tx.purchaseDate ? new Date(Number(tx.purchaseDate)).toISOString() : null,
  });
  if (error) return reply({ error: "credit", detail: error.message }, 400);
  return reply({ ok: true, ...data, transactionId: String(tx.transactionId) });
});
