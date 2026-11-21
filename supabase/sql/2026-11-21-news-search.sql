begin;
-- ============================================================================
-- Поиск по Новостям, 2026-11-21.
-- Ищет по заголовку и анонсу (и их переводу), по названию канала, имени автора и источника.
-- Источники — все включённые, не только выбранные в «Моих источниках». Самые свежие сверху.
-- ============================================================================
create or replace function public.news_search(p_q text, p_category text default null, p_before timestamptz default null, p_limit int default 30)
returns table (id bigint, kind text, source_id text, category text, region text, title text, summary text, title_ru text, summary_ru text,
               lang text, url text, image text, image_path text, published_at timestamptz,
               pub_id uuid, pub_name text, pub_username text, pub_avatar text, chat_id uuid, message_id bigint, joined boolean, members bigint,
               media jsonb, post_type text, rate_asset text, poll jsonb, match jsonb, reactions jsonb, comments bigint)
language sql stable security definer set search_path = '' as $$
  with q as (
    -- с начала слова: «нефтч» найдёт «Нефтчи», а «TON» не найдёт «Bloomington»
    select '\m' || regexp_replace(btrim(coalesce(p_q, '')), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') as pat,
           char_length(btrim(coalesce(p_q, ''))) as len
  )
  select i.id, case when i.source_id is not null then 'rss' else p.kind end, i.source_id, i.category, i.region,
         i.title, i.summary, i.title_ru, i.summary_ru, i.lang, i.url, i.image, i.image_path, i.published_at,
         coalesce(p.user_id, p.chat_id), coalesce(c.title, u.display_name), coalesce(c.username, u.username), coalesce(c.avatar_path, u.avatar_path),
         i.chat_id, i.message_id,
         case when i.chat_id is null then null else exists (select 1 from public.chat_members m where m.chat_id = i.chat_id and m.user_id = (select auth.uid()) and m.left_at is null) end,
         case when i.chat_id is null then null else (select count(*) from public.chat_members m where m.chat_id = i.chat_id and m.left_at is null) end,
         (select jsonb_agg(jsonb_build_object('bucket', md.bucket, 'path', md.path, 'kind', md.kind) order by md.message_id nulls first, md.pos, md.id)
            from public.news_media md where md.item_id = i.id),
         i.post_type, i.rate_asset,
         case when i.post_type = 'poll' then public.news_poll_state(i.id) end,
         case when i.post_type = 'match' then i.match end,
         private.news_react_state(i.id),
         (select count(*) from public.news_comments cm where cm.item_id = i.id and cm.deleted_at is null)
    from q, public.news_items i
    left join public.news_publishers p on p.id = i.publisher_id
    left join public.chats c on c.id = p.chat_id
    left join public.profiles u on u.id = p.user_id
    left join public.news_sources s on s.id = i.source_id
   where (select auth.uid()) is not null and not private.is_banned()
     and q.len between 2 and 100
     and (p_category is null or i.category = p_category)
     and (p_before is null or i.published_at < p_before)
     and ((i.source_id is not null and s.enabled)
       or (i.publisher_id is not null and p.revoked_at is null
           and (c.id is null or (c.deleted_at is null and not c.is_private)) and (u.id is null or u.banned_at is null)))
     and (i.title ~* q.pat or i.title_ru ~* q.pat or i.summary ~* q.pat or i.summary_ru ~* q.pat
          or c.title ~* q.pat or u.display_name ~* q.pat or c.username ~* q.pat or u.username ~* q.pat or s.name ~* q.pat)
   order by i.published_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 60);
$$;
revoke execute on function public.news_search(text, text, timestamptz, int) from public, anon;
grant execute on function public.news_search(text, text, timestamptz, int) to authenticated;
commit;
