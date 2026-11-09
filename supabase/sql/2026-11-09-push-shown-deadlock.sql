-- строки вставляются всегда в одном порядке: два одновременных вызова больше не ждут друг друга по кругу (deadlock)
create or replace function public.push_shown_add(p_subs bigint[], p_chat uuid, p_msg bigint)
 returns void language sql security definer set search_path to ''
as $function$
  insert into private.push_shown (sub_id, chat_id, msg_id, cleared, at)
  select distinct s, p_chat, p_msg, false, now() from unnest(p_subs) s order by s
  on conflict (sub_id, chat_id) do update set msg_id = greatest(private.push_shown.msg_id, excluded.msg_id), cleared = false, at = now();
$function$;
