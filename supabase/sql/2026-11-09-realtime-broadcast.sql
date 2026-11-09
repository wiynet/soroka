-- Живые обновления через Broadcast вместо postgres_changes.
-- Раньше сервер Realtime постоянно опрашивал журнал изменений базы и для каждого изменения проверял права каждого
-- подписчика — это была самая большая нагрузка на базу. Теперь триггеры сами рассылают изменение нужным людям
-- в личный закрытый канал «u:<id>», а опрос журнала не нужен.
create or replace function private.rt_fanout() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
declare
  r jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  chat uuid; extra uuid[] := '{}'; ids uuid[]; u uuid; payload jsonb;
begin
  begin
    if tg_table_name = 'message_reactions' and tg_op = 'DELETE' then r := o || '{"emoji": null}'::jsonb; end if;   -- реакцию сняли
    if tg_table_name in ('messages', 'chat_members', 'message_reactions', 'post_comments', 'voice_chats') then
      chat := coalesce((r->>'chat_id'), (o->>'chat_id'))::uuid;
      if tg_table_name = 'chat_members' then extra := array[coalesce(r->>'user_id', o->>'user_id')::uuid]; end if;   -- сам добавленный или вышедший
    elsif tg_table_name = 'chats' then
      chat := coalesce(r->>'id', o->>'id')::uuid;
    end if;
    if chat is not null then
      select array_agg(distinct x) into ids from (
        select user_id x from public.chat_members where chat_id = chat and left_at is null
        union select unnest(extra)) s where x is not null;
    elsif tg_table_name = 'calls' then
      ids := array_remove(array[(coalesce(r->>'caller', o->>'caller'))::uuid, (coalesce(r->>'callee', o->>'callee'))::uuid], null);
    elsif tg_table_name = 'support_tickets' then
      select array_agg(distinct x) into ids from (
        select coalesce(r->>'user_id', o->>'user_id')::uuid x
        union select id from public.profiles where is_admin and banned_at is null) s where x is not null;
    end if;
    if ids is null then return null; end if;
    payload := jsonb_build_object('eventType', tg_op, 'table', tg_table_name, 'new', r, 'old', o);
    foreach u in array ids loop
      perform realtime.send(payload, tg_table_name, 'u:' || u::text, true);
    end loop;
  exception when others then
    raise warning 'rt_fanout %: %', tg_table_name, sqlerrm;   -- рассылка не должна ломать саму запись
  end;
  return null;
end $function$;
revoke all on function private.rt_fanout() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['messages','chat_members','message_reactions','chats','post_comments','support_tickets','calls','voice_chats'] loop
    execute format('drop trigger if exists rt_fanout on public.%I', t);
    execute format('create trigger rt_fanout after insert or update or delete on public.%I for each row execute function private.rt_fanout()', t);
  end loop;
end $$;

-- читать свой канал может только его хозяин
drop policy if exists "own user topic" on realtime.messages;
create policy "own user topic" on realtime.messages for select to authenticated
  using (realtime.topic() = 'u:' || (select auth.uid())::text);
