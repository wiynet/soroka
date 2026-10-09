// Сорока: отправка push-уведомлений о новом сообщении.
// Вызывается только триггером базы; доступ проверяется секретом в заголовке x-hook-secret.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let cfg: { vapid_public: string; vapid_private: string; hook_secret: string } | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await sb.rpc("push_server_config");
  if (error || !data) throw new Error("no push config: " + (error?.message ?? "empty"));
  cfg = data;
  webpush.setVapidDetails("https://soroka.lol", cfg!.vapid_public, cfg!.vapid_private);
  return cfg!;
}

function preview(m: any): string {
  if (m.gift_type) return "🎁 Подарок";
  if (m.event_kind) return m.body || "Выдача от администратора";
  if (m.body) return m.body.length > 140 ? m.body.slice(0, 140) + "…" : m.body;
  if (m.file_type && String(m.file_type).startsWith("image/")) return "📷 Фото";
  return "📎 " + (m.file_name || "Файл");
}

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// самопроверка: шифрует и подписывает тестовое уведомление на заведомо несуществующий адрес
async function selftest() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  try {
    await webpush.sendNotification(
      { endpoint: "https://fcm.googleapis.com/fcm/send/soroka-selftest", keys: { p256dh: b64u(raw), auth: b64u(auth) } },
      "test", { TTL: 0 });
    return { encrypted: true, statusCode: 201 };
  } catch (e: any) {
    return { encrypted: typeof e?.statusCode === "number", statusCode: e?.statusCode ?? null, message: String(e?.message ?? e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  try {
    const c = await config();
    if (req.headers.get("x-hook-secret") !== c.hook_secret) return new Response("forbidden", { status: 403 });
    const input = await req.json();
    if (input.selftest) return new Response(JSON.stringify(await selftest()), { headers: { "Content-Type": "application/json" } });

    const { data: m } = await sb.from("messages")
      .select("id,chat_id,sender_id,body,file_name,file_type,gift_type,event_kind,deleted_at")
      .eq("id", input.message_id).maybeSingle();
    if (!m || m.deleted_at) return new Response("skip");

    const [{ data: chat }, { data: sender }, { data: members }] = await Promise.all([
      sb.from("chats").select("id,is_group,is_channel,title").eq("id", m.chat_id).maybeSingle(),
      sb.from("profiles").select("display_name").eq("id", m.sender_id).maybeSingle(),
      sb.from("chat_members").select("user_id,muted").eq("chat_id", m.chat_id).is("left_at", null),
    ]);
    if (!chat) return new Response("skip");
    const targets = (members ?? []).filter((x: any) => x.user_id !== m.sender_id && !x.muted).map((x: any) => x.user_id);
    if (!targets.length) return new Response("nobody");

    const { data: subs } = await sb.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth").in("user_id", targets).eq("enabled", true);
    if (!subs?.length) return new Response("no devices");

    const who = sender?.display_name ?? "Сорока";
    const title = chat.is_group ? (chat.title || "Группа") : who;
    const body = (chat.is_group && !chat.is_channel ? who + ": " : "") + preview(m);
    const payload = JSON.stringify({ title, body, chat_id: chat.id, url: "/#c-" + chat.id });

    let sent = 0;
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e: any) {
        // устройство отписалось или адрес устарел: больше туда не шлём
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await sb.from("push_subscriptions").update({ enabled: false }).eq("id", s.id);
        } else console.error("push failed", e?.statusCode, e?.body ?? String(e));
      }
    }));
    return new Response(JSON.stringify({ sent, devices: subs.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
