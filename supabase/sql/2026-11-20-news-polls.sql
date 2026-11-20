begin;
-- ============================================================================
-- Новости: опросы и курсы, 2026-11-20.
--   • Верифицированный автор публикует не только пост, но и опрос (до 10 вариантов, у варианта может быть фото,
--     у самого опроса — фото и видео) или «курс» — живой график MST, TON или USDT со своим комментарием.
--   • Голосовать может любой вошедший; голос можно поменять, пока опрос открыт.
-- ============================================================================

alter table public.news_items add column if not exists post_type text not null default 'post';
alter table public.news_items drop constraint if exists news_items_post_type_check;
alter table public.news_items add constraint news_items_post_type_check check (post_type in ('post', 'poll', 'rate'));
alter table public.news_items add column if not exists rate_asset text check (rate_asset in ('MST', 'TON', 'USDT'));
alter table public.news_items add column if not exists poll_multi boolean not null default false;
alter table public.news_items add column if not exists poll_closes_at timestamptz;

create table if not exists public.news_poll_options (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.news_items(id) on delete cascade,
  pos int not null default 0,
  text text not null check (char_length(text) between 1 and 100),
  image_path text
);
create index if not exists news_poll_options_item on public.news_poll_options (item_id, pos);
alter table public.news_poll_options enable row level security;

create table if not exists public.news_poll_votes (
  item_id bigint not null references public.news_items(id) on delete cascade,
  option_id bigint not null references public.news_poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id, option_id)
);
create index if not exists news_poll_votes_opt on public.news_poll_votes (option_id);
alter table public.news_poll_votes enable row level security;

-- состояние опроса: варианты с голосами, всего проголосовавших, мой выбор
create or replace function public.news_poll_state(p_item bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'multi', i.poll_multi, 'closes_at', i.poll_closes_at, 'closed', i.poll_closes_at is not null and i.poll_closes_at < now(),
    'voters', (select count(distinct v.user_id) from public.news_poll_votes v where v.item_id = i.id),
    'mine', coalesce((select jsonb_agg(v.option_id) from public.news_poll_votes v where v.item_id = i.id and v.user_id = (select auth.uid())), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'image', o.image_path,
                                   'votes', (select count(*) from public.news_poll_votes v where v.option_id = o.id)) order by o.pos, o.id)
                           from public.news_poll_options o where o.item_id = i.id), '[]'::jsonb))
  from public.news_items i where i.id = p_item and i.post_type = 'poll';
$$;

-- лента: + вид публикации, курс и опрос с результатами
drop function if exists public.news_feed(text, text, text[], boolean, timestamptz, int);
create function public.news_feed(p_category text default null, p_region text default null, p_sources text[] default null,
                                 p_pubs boolean default true, p_before timestamptz default null, p_limit int default 30)
returns table (id bigint, kind text, source_id text, category text, region text, title text, summary text, title_ru text, summary_ru text,
               lang text, url text, image text, image_path text, published_at timestamptz,
               pub_id uuid, pub_name text, pub_username text, pub_avatar text, chat_id uuid, message_id bigint, joined boolean, members bigint,
               media jsonb, post_type text, rate_asset text, poll jsonb)
language sql stable security definer set search_path = '' as $$
  select i.id, case when i.source_id is not null then 'rss' else p.kind end, i.source_id, i.category, i.region,
         i.title, i.summary, i.title_ru, i.summary_ru, i.lang, i.url, i.image, i.image_path, i.published_at,
         coalesce(p.user_id, p.chat_id), coalesce(c.title, u.display_name), coalesce(c.username, u.username), coalesce(c.avatar_path, u.avatar_path),
         i.chat_id, i.message_id,
         case when i.chat_id is null then null else exists (select 1 from public.chat_members m where m.chat_id = i.chat_id and m.user_id = (select auth.uid()) and m.left_at is null) end,
         case when i.chat_id is null then null else (select count(*) from public.chat_members m where m.chat_id = i.chat_id and m.left_at is null) end,
         (select jsonb_agg(jsonb_build_object('bucket', md.bucket, 'path', md.path, 'kind', md.kind) order by md.message_id nulls first, md.pos, md.id)
            from public.news_media md where md.item_id = i.id),
         i.post_type, i.rate_asset,
         case when i.post_type = 'poll' then public.news_poll_state(i.id) end
    from public.news_items i
    left join public.news_publishers p on p.id = i.publisher_id
    left join public.chats c on c.id = p.chat_id
    left join public.profiles u on u.id = p.user_id
   where (select auth.uid()) is not null and not private.is_banned()
     and (p_category is null or i.category = p_category)
     and (p_region is null or i.region = p_region)
     and (p_before is null or i.published_at < p_before)
     and ((i.source_id is not null and (p_sources is null or i.source_id = any (p_sources))
           and exists (select 1 from public.news_sources s where s.id = i.source_id and s.enabled))
       or (i.publisher_id is not null and coalesce(p_pubs, true) and p.revoked_at is null
           and (c.id is null or (c.deleted_at is null and not c.is_private)) and (u.id is null or u.banned_at is null)))
   order by i.published_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 60);
$$;

-- голос: выбрать варианты (пустой список — отозвать голос)
create or replace function public.news_vote(p_item bigint, p_options bigint[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); it public.news_items; n int;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into it from public.news_items where id = p_item and post_type = 'poll';
  if not found then raise exception 'not found'; end if;
  if it.poll_closes_at is not null and it.poll_closes_at < now() then raise exception 'closed'; end if;
  n := coalesce(array_length(p_options, 1), 0);
  if n > 1 and not it.poll_multi then raise exception 'one option'; end if;
  if exists (select 1 from unnest(coalesce(p_options, '{}')) x where not exists (select 1 from public.news_poll_options o where o.id = x and o.item_id = p_item)) then
    raise exception 'bad option';
  end if;
  delete from public.news_poll_votes where item_id = p_item and user_id = me;
  insert into public.news_poll_votes (item_id, option_id, user_id) select p_item, x, me from unnest(coalesce(p_options, '{}')) x on conflict do nothing;
  return public.news_poll_state(p_item);
end $$;

-- публикация: пост, опрос или курс
drop function if exists public.news_publish(text, text, text, jsonb);
create function public.news_publish(p_title text, p_text text, p_url text default null, p_media jsonb default null,
                                    p_kind text default 'post', p_poll jsonb default null, p_rate text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; v bigint; t text := btrim(coalesce(p_title, '')); x text := nullif(btrim(coalesce(p_text, '')), '');
        u text := nullif(btrim(coalesce(p_url, '')), ''); me uuid := (select auth.uid()); m jsonb; n int := 0; pth text; knd text;
        k text := coalesce(p_kind, 'post'); opts jsonb; ot text; oimg text; days int;
begin
  if private.is_banned() then raise exception 'not allowed'; end if;
  select * into pb from public.news_publishers where user_id = me and revoked_at is null and autopost;
  if not found then raise exception 'not verified'; end if;
  if k not in ('post', 'poll', 'rate') then raise exception 'bad kind'; end if;
  if char_length(t) < 3 or char_length(t) > 160 then raise exception 'bad title'; end if;
  if char_length(coalesce(x, '')) > 2000 then raise exception 'too long'; end if;
  if u is not null and (u !~* '^https?://[^\s]+$' or char_length(u) > 500) then raise exception 'bad url'; end if;
  if p_media is not null and (jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) > 10) then raise exception 'bad media'; end if;
  if k = 'rate' and coalesce(p_rate, '') not in ('MST', 'TON', 'USDT') then raise exception 'bad rate'; end if;
  if k = 'poll' then
    opts := p_poll -> 'options';
    if opts is null or jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 10 then raise exception 'bad poll'; end if;
  end if;
  if (select count(*) from public.news_items where publisher_id = pb.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'limit';
  end if;
  days := least(greatest(coalesce((p_poll ->> 'days')::int, 0), 0), 30);
  insert into public.news_items (publisher_id, category, region, title, summary, lang, url, published_at, post_type, rate_asset, poll_multi, poll_closes_at)
  values (pb.id, pb.category, pb.region, t, x, 'ru', u, now(), k, case when k = 'rate' then p_rate end,
          k = 'poll' and coalesce((p_poll ->> 'multi')::boolean, false), case when k = 'poll' and days > 0 then now() + make_interval(days => days) end)
  returning id into v;
  for m in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    pth := m ->> 'path'; knd := m ->> 'kind';
    if knd not in ('image', 'video') or pth is null or split_part(pth, '/', 1) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'news' and o.name = pth) then
      raise exception 'bad media';
    end if;
    insert into public.news_media (item_id, bucket, path, kind, pos) values (v, 'news', pth, knd, n) on conflict do nothing;
    n := n + 1;
  end loop;
  if k = 'poll' then
    n := 0;
    for m in select * from jsonb_array_elements(opts) loop
      ot := btrim(coalesce(m ->> 'text', '')); oimg := nullif(m ->> 'image', '');
      if char_length(ot) < 1 or char_length(ot) > 100 then raise exception 'bad poll'; end if;
      if oimg is not null and (split_part(oimg, '/', 1) <> me::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'news' and o.name = oimg)) then
        raise exception 'bad media';
      end if;
      insert into public.news_poll_options (item_id, pos, text, image_path) values (v, n, ot, oimg);
      n := n + 1;
    end loop;
  end if;
  return v;
end $$;

revoke execute on function public.news_feed(text, text, text[], boolean, timestamptz, int), public.news_poll_state(bigint), public.news_vote(bigint, bigint[]),
  public.news_publish(text, text, text, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.news_feed(text, text, text[], boolean, timestamptz, int), public.news_poll_state(bigint), public.news_vote(bigint, bigint[]),
  public.news_publish(text, text, text, jsonb, text, jsonb, text) to authenticated;
commit;
