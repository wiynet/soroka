-- Быстрые права на чтение: раньше private.is_chat_member() вызывалась для КАЖДОЙ строки (≈0,5 мс на строку,
-- 60 сообщений ≈ 30–130 мс). Теперь список моих чатов считается один раз на запрос.
create or replace function private.my_chat_ids()
 returns setof uuid language sql stable security definer set search_path to ''
as $function$
  select m.chat_id from public.chat_members m
   where m.user_id = (select auth.uid()) and m.left_at is null and not private.is_banned();
$function$;
revoke all on function private.my_chat_ids() from public;
grant execute on function private.my_chat_ids() to authenticated, anon;

alter policy messages_select on public.messages using (chat_id in (select private.my_chat_ids()));
alter policy reactions_select on public.message_reactions using (chat_id in (select private.my_chat_ids()));
alter policy members_select on public.chat_members using (chat_id in (select private.my_chat_ids()) and left_at is null);
alter policy chats_select on public.chats using (id in (select private.my_chat_ids()));
alter policy post_comments_select on public.post_comments using (chat_id in (select private.my_chat_ids()));
alter policy transcripts_read on public.message_transcripts using (chat_id in (select private.my_chat_ids()));
alter policy voice_chats_select on public.voice_chats using (chat_id in (select private.my_chat_ids()));
alter policy support_tickets_select on public.support_tickets using ((user_id = (select auth.uid())) or (select public.is_admin()));
alter policy reports_select on public.reports using ((select public.is_admin()));
