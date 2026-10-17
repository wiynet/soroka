// Mestario: ежедневная резервная копия данных.
// Раз в сутки вызывается из базы (pg_cron 'daily-backup'); доступ проверяется секретом в заголовке x-hook-secret.
// Каждая таблица схемы public выгружается в закрытый бакет backups: <дата>/<таблица>.json.gz.
// Хранятся копии за последние 14 дней. Файлы (фото, видео) не копируются — только данные базы.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const TABLES = [
  "profiles", "chats", "chat_members", "messages", "message_reactions", "post_comments",
  "wallets", "coin_ledger", "gift_types", "gift_models", "gift_backdrops", "gifts", "gift_auctions",
  "collectible_usernames", "nft_listings", "nft_offers", "stories", "story_views", "user_blocks",
  "support_tickets", "reports", "giveaways", "giveaway_entries", "polls", "poll_answers",
  "scheduled_messages", "sticker_packs", "stickers", "user_sticker_packs", "app_settings", "push_subscriptions",
];
const KEEP_DAYS = 14;

let secret: string | null = null;
async function hookSecret() {
  if (secret) return secret;
  const { data, error } = await sb.rpc("push_server_config");
  if (error || !data?.hook_secret) throw new Error("no config");
  secret = data.hook_secret;
  return secret!;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function dumpTable(table: string): Promise<{ rows: number; text: string }> {
  const all: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(table + ": " + error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows: all.length, text: JSON.stringify(all) };
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-hook-secret") !== await hookSecret()) return new Response("forbidden", { status: 403 });
    const day = new Date().toISOString().slice(0, 10);
    const report: Record<string, number | string> = {};
    for (const t of TABLES) {
      try {
        const { rows, text } = await dumpTable(t);
        const body = await gzip(text);
        const up = await sb.storage.from("backups").upload(day + "/" + t + ".json.gz", body, { contentType: "application/gzip", upsert: true });
        report[t] = up.error ? "upload error: " + up.error.message : rows;
      } catch (e) {
        report[t] = "error: " + String((e as Error).message ?? e).slice(0, 120);
      }
    }
    // старые копии удаляем
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
    const { data: days } = await sb.storage.from("backups").list("", { limit: 1000 });
    let removed = 0;
    for (const d of days ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.name) || d.name >= cutoff) continue;
      const { data: files } = await sb.storage.from("backups").list(d.name, { limit: 1000 });
      const paths = (files ?? []).map((f) => d.name + "/" + f.name);
      if (paths.length) { await sb.storage.from("backups").remove(paths); removed += paths.length; }
    }
    return new Response(JSON.stringify({ day, tables: report, removed_old_files: removed }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
