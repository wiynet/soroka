-- закрытый живой канал открытого чата «live:<chat_id>»: «печатает…» и мгновенная доставка текста,
-- пока сообщение ещё записывается в базу. Слушать и писать могут только участники чата.
drop policy if exists "chat live read" on realtime.messages;
create policy "chat live read" on realtime.messages for select to authenticated
  using (case when realtime.topic() like 'live:%' then substring(realtime.topic() from 6) in (select x::text from private.my_chat_ids() x) else false end);
drop policy if exists "chat live write" on realtime.messages;
create policy "chat live write" on realtime.messages for insert to authenticated
  with check (case when realtime.topic() like 'live:%' then substring(realtime.topic() from 6) in (select x::text from private.my_chat_ids() x) else false end);
