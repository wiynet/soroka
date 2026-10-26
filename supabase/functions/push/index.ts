// Mestario: отправка push-уведомлений о новом сообщении.
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
  webpush.setVapidDetails("https://mestario.top", cfg!.vapid_public, cfg!.vapid_private);
  return cfg!;
}

function preview(m: any): string {
  if (m.sticker_id) return "🖼 Стикер";
  if (m.gif_url) return "GIF";
  if (m.gift_type) return "🎁 Подарок";
  if (m.event_kind) return m.body || "Выдача от администратора";
  if (m.body) return m.body.length > 140 ? m.body.slice(0, 140) + "…" : m.body;
  if (m.file_type && String(m.file_type).startsWith("image/")) return "📷 Фото";
  if (m.file_type && String(m.file_type).startsWith("video/")) return "🎥 Видео";
  if (m.file_name === "Голосовое сообщение") return "🎤 Голосовое сообщение";
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

    // отвечаем базе сразу, а рассылаем в фоне: перед отправкой иногда ждём пару секунд (см. ниже)
    const job = sendFor(Number(input.message_id)).catch((e) => console.error("push job", e));
    // @ts-ignore: EdgeRuntime есть в среде Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(job); return new Response("queued"); }
    return new Response(JSON.stringify(await job), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sendFor(messageId: number) {
    const { data: m } = await sb.from("messages")
      .select("id,chat_id,sender_id,body,file_name,file_type,gift_type,event_kind,sticker_id,gif_url,scheduled,mentions,deleted_at")
      .eq("id", messageId).maybeSingle();
    if (!m || m.deleted_at) return "skip";

    const [{ data: chat }, { data: sender }, { data: members }] = await Promise.all([
      sb.from("chats").select("id,is_group,is_channel,title").eq("id", m.chat_id).maybeSingle(),
      sb.from("profiles").select("display_name").eq("id", m.sender_id).maybeSingle(),
      sb.from("chat_members").select("user_id,muted,last_read_id").eq("chat_id", m.chat_id).is("left_at", null),
    ]);
    if (!chat) return "skip";
    // упомянутым (@ник) уведомление приходит, даже если чат заглушён
    const mentioned = new Set<string>((m.mentions ?? []) as string[]);
    let targets = (members ?? []).filter((x: any) => x.user_id !== m.sender_id && (!x.muted || mentioned.has(x.user_id))).map((x: any) => x.user_id);
    // напоминание в «Избранном» (отложенное сообщение самому себе) тоже приходит уведомлением
    if (!targets.length && m.scheduled && (members ?? []).length === 1 && members![0].user_id === m.sender_id) targets = [m.sender_id];
    // уже прочитал (например, открыт этот чат на другом устройстве) — уведомлять незачем
    const readOf = new Map((members ?? []).map((x: any) => [x.user_id, Number(x.last_read_id) || 0]));
    targets = targets.filter((u) => u === m.sender_id || (readOf.get(u) || 0) < m.id);
    if (!targets.length) return "nobody";
    // кто сейчас в сети на каком-то устройстве — даём ему 3 секунды прочитать там; прочитал — на остальные не шлём
    // (присутствие хранится отдельно и есть даже у тех, кто скрыл «в сети»)
    const { data: act } = await sb.rpc("push_active", { p_users: targets.filter((u) => u !== m.sender_id), p_secs: 150 });
    const online: string[] = Array.isArray(act) ? act : [];
    if (online.length) {
      await sleep(3500);
      const { data: again } = await sb.from("chat_members").select("user_id,last_read_id").eq("chat_id", m.chat_id).in("user_id", online);
      const read = new Set((again ?? []).filter((x: any) => (Number(x.last_read_id) || 0) >= m.id).map((x: any) => x.user_id));
      targets = targets.filter((u) => !read.has(u));
      if (!targets.length) return "read elsewhere";
      const { data: still } = await sb.from("messages").select("deleted_at").eq("id", m.id).maybeSingle();
      if (!still || still.deleted_at) return "skip";
    }

    const { data: subs } = await sb.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth").in("user_id", targets).eq("enabled", true);
    if (!subs?.length) return "no devices";
    // заодно убираем на этих устройствах уведомления чатов, которые уже прочитаны в другом месте
    const closeMap = new Map<number, string[]>();
    for (const r of ((await sb.rpc("push_take_read", { p_subs: subs.map((s: any) => s.id) })).data ?? []) as any[]) {
      if (r.chat_id === m.chat_id) continue;
      closeMap.set(r.sub_id, [...(closeMap.get(r.sub_id) ?? []), r.chat_id]);
    }

    const who = sender?.display_name ?? "Mestario";
    const self = !chat.is_group && targets.length === 1 && targets[0] === m.sender_id;
    const title = self ? "⏰ Напоминание" : chat.is_group ? (chat.title || "Группа") : who;
    const body = (chat.is_group && !chat.is_channel ? who + ": " : "") + preview(m);
    const payloadFor = (uid: string, sub: number) => JSON.stringify({
      close: closeMap.get(sub) ?? [],
      title: mentioned.has(uid) && chat.is_group ? "@ " + title : title,
      body: mentioned.has(uid) && chat.is_group ? who + " упомянул(а) вас: " + preview(m) : body,
      chat_id: chat.id, url: "/#c-" + chat.id,
    });

    let sent = 0;
    const ok: number[] = [];
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payloadFor(s.user_id, s.id), { TTL: 3600, urgency: "high" });
        sent++; ok.push(s.id);
      } catch (e: any) {
        // устройство отписалось или адрес устарел: больше туда не шлём
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await sb.from("push_subscriptions").update({ enabled: false }).eq("id", s.id);
        } else console.error("push failed", e?.statusCode, e?.body ?? String(e));
      }
    }));
    if (ok.length) await sb.rpc("push_shown_add", { p_subs: ok, p_chat: m.chat_id, p_msg: m.id });
    return { sent, devices: subs.length };
}
