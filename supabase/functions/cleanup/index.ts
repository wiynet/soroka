// Сорока: автоочистка хранилища.
// Раз в сутки вызывается из базы (pg_cron); доступ проверяется секретом в заголовке x-hook-secret.
// Удаляет файлы исчезнувших и удалённых историй, файлы удалённых сообщений
// и видео с «кружками» старше 6 месяцев (сами сообщения остаются, с пометкой).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let secret: string | null = null;
async function hookSecret() {
  if (secret) return secret;
  const { data, error } = await sb.rpc("push_server_config");
  if (error || !data?.hook_secret) throw new Error("no config");
  secret = data.hook_secret;
  return secret!;
}

type Row = { kind: string; id: number; bucket: string; path: string };

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-hook-secret") !== await hookSecret()) return new Response("forbidden", { status: 403 });
    const input = await req.json().catch(() => ({}));
    const dry = !!input.dry;
    const done: Record<string, number> = { story: 0, deleted: 0, oldvideo: 0 };
    const failed: string[] = [];

    for (let round = 0; round < 10; round++) {
      const { data, error } = await sb.rpc("cleanup_candidates", { p_limit: 200 });
      if (error) throw new Error("candidates: " + error.message);
      const rows = (data ?? []) as Row[];
      if (!rows.length) break;
      if (dry) {
        for (const r of rows) done[r.kind] = (done[r.kind] ?? 0) + 1;
        return new Response(JSON.stringify({ dry: true, would_delete: done }), { headers: { "Content-Type": "application/json" } });
      }
      let progressed = false;
      // удаляем пачками по бакету и виду; отмечаем в базе только то, что действительно удалилось без ошибки
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        if (!r.path || !r.bucket) continue;
        const k = r.kind + "|" + r.bucket;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      for (const [k, list] of groups) {
        const [kind, bucket] = k.split("|");
        const rm = await sb.storage.from(bucket).remove(list.map((r) => r.path));
        if (rm.error) { failed.push(kind + ": " + rm.error.message); continue; }
        const mark = await sb.rpc("cleanup_mark", { p_kind: kind, p_ids: list.map((r) => r.id) });
        if (mark.error) { failed.push(kind + " mark: " + mark.error.message); continue; }
        done[kind] = (done[kind] ?? 0) + list.length;
        progressed = true;
      }
      if (!progressed) break;   // чтобы не крутиться впустую, если что-то не удаляется
    }
    if (failed.length) console.error("cleanup problems", failed);
    return new Response(JSON.stringify({ deleted: done, failed }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
