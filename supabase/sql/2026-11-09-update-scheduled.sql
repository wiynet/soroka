-- изменить отложенное сообщение: текст и время (только своё и ещё не отправленное)
create or replace function public.update_scheduled(p_id bigint, p_body text, p_at timestamptz)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare me uuid := (select auth.uid()); b text := btrim(coalesce(p_body, '')); r public.scheduled_messages;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into r from public.scheduled_messages where id = p_id and sender_id = me and sent_at is null and cancelled_at is null for update;
  if not found then raise exception 'not found'; end if;
  if not private.is_chat_member(r.chat_id) or not private.can_post(r.chat_id) then raise exception 'cannot post'; end if;
  if char_length(b) < 1 or char_length(b) > 4000 then raise exception 'bad body'; end if;
  if p_at is null or p_at < now() + interval '30 seconds' or p_at > now() + interval '365 days' then raise exception 'bad time'; end if;
  update public.scheduled_messages set body = b, send_at = p_at where id = p_id;
end $function$;
revoke all on function public.update_scheduled(bigint, text, timestamptz) from public, anon;
grant execute on function public.update_scheduled(bigint, text, timestamptz) to authenticated;
