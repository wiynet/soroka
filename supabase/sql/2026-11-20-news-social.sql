begin;
-- ============================================================================
-- Новости: комментарии, реакции, матчи, верификация на несколько разделов, 2026-11-20.
--   • Под любой новостью можно оставить комментарий и реакцию (одна реакция на человека, без эмодзи —
--     нравится / огонь / поддерживаю / звезда).
--   • Новый вид публикации «Матч»: команды с фото, счёт, статус и минута, владение, удары, угловые,
--     фолы, карточки и шансы П1 / ничья / П2. Всё вводит автор и может обновлять по ходу игры.
--   • Админ выдаёт верификацию сразу на несколько разделов и регионов (или на все); автор выбирает раздел
--     при публикации, посты канала идут в первый из выбранных.
-- ============================================================================

-- ---------- верификация на несколько разделов ----------
alter table public.news_publishers add column if not exists categories text[];
alter table public.news_publishers add column if not exists regions text[];
update public.news_publishers set categories = array[category] where categories is null;
update public.news_publishers set regions = array[region] where regions is null;
alter table public.news_publishers alter column categories set not null;
alter table public.news_publishers alter column regions set not null;

create or replace function private.news_cats_ok(p text[]) returns boolean language sql immutable as $$
  select coalesce(array_length(p, 1), 0) between 1 and 9
     and p <@ array['news', 'tech', 'business', 'science', 'sport', 'games', 'auto', 'culture', 'edu'];
$$;
create or replace function private.news_regs_ok(p text[]) returns boolean language sql immutable as $$
  select coalesce(array_length(p, 1), 0) between 1 and 2 and p <@ array['ru', 'world'];
$$;
alter function private.news_cats_ok(text[]) set search_path = '';
alter function private.news_regs_ok(text[]) set search_path = '';

drop function if exists public.news_admin_grant(text, uuid, text, text, boolean);
create function public.news_admin_grant(p_kind text, p_target uuid, p_categories text[], p_regions text[], p_autopost boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid; ttl text; cats text[]; regs text[];
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  -- порядок как выбрал админ, без повторов: первый раздел и регион — основные (туда идут посты канала)
  select array_agg(x order by o) into cats from (select distinct on (x) x, o from unnest(p_categories) with ordinality u(x, o) order by x, o) s;
  select array_agg(x order by o) into regs from (select distinct on (x) x, o from unnest(p_regions) with ordinality u(x, o) order by x, o) s;
  if not private.news_cats_ok(cats) then raise exception 'bad category'; end if;
  if not private.news_regs_ok(regs) then raise exception 'bad region'; end if;
  if p_kind = 'user' then
    update public.profiles set verified = true where id = p_target and deleted_at is null;
    if not found then raise exception 'user not found'; end if;
    insert into public.news_publishers (kind, user_id, category, region, categories, regions, autopost, granted_by)
    values ('user', p_target, cats[1], regs[1], cats, regs, coalesce(p_autopost, true), (select auth.uid()))
    on conflict (user_id) where user_id is not null do update
      set category = excluded.category, region = excluded.region, categories = excluded.categories, regions = excluded.regions,
          autopost = excluded.autopost, granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
    update public.news_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now()
     where user_id = p_target and chat_id is null and status = 'pending';
    perform private.post_event(p_target, 'verified', '✅', 'Галочка подтверждённого аккаунта',
      case when coalesce(p_autopost, true) then 'Теперь вы можете публиковать в Новостях' else null end);
  elsif p_kind = 'channel' then
    update public.chats set verified = true where id = p_target and is_channel and not is_private and deleted_at is null
      returning created_by, title into owner, ttl;
    if not found then raise exception 'channel not found'; end if;
    insert into public.news_publishers (kind, chat_id, category, region, categories, regions, autopost, granted_by)
    values ('channel', p_target, cats[1], regs[1], cats, regs, coalesce(p_autopost, true), (select auth.uid()))
    on conflict (chat_id) where chat_id is not null do update
      set category = excluded.category, region = excluded.region, categories = excluded.categories, regions = excluded.regions,
          autopost = excluded.autopost, granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
    update public.news_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now()
     where chat_id = p_target and status = 'pending';
    if owner is not null then
      perform private.post_event(owner, 'verified', '✅', 'Канал «' || ttl || '» верифицирован',
        case when coalesce(p_autopost, true) then 'Посты канала теперь автоматически попадают в Новости' else null end);
    end if;
  else raise exception 'bad kind'; end if;
end $$;

-- статус и поиск в админке: + списки разделов и регионов
create or replace function public.news_my_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'me', (select jsonb_build_object('category', p.category, 'region', p.region, 'categories', p.categories, 'regions', p.regions, 'autopost', p.autopost)
             from public.news_publishers p where p.user_id = (select auth.uid()) and p.revoked_at is null),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'username', c.username, 'avatar_path', c.avatar_path,
                                  'verified', c.verified, 'private', c.is_private,
                                  'news', (select jsonb_build_object('category', p.category, 'region', p.region, 'categories', p.categories, 'regions', p.regions, 'autopost', p.autopost)
                                             from public.news_publishers p where p.chat_id = c.id and p.revoked_at is null),
                                  'pending', exists (select 1 from public.news_requests r where r.chat_id = c.id and r.status = 'pending'))
                                order by c.title)
                 from public.chats c
                where c.is_channel and c.deleted_at is null
                  and (c.created_by = (select auth.uid())
                       or exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = (select auth.uid()) and m.is_admin and m.left_at is null))), '[]'::jsonb),
    'pending', exists (select 1 from public.news_requests r where r.user_id = (select auth.uid()) and r.chat_id is null and r.status = 'pending'));
$$;

create or replace function public.news_admin_list(p_revoked boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select p.kind, coalesce(p.user_id, p.chat_id) as target, p.category, p.region, p.categories, p.regions, p.autopost,
           coalesce(p.revoked_at, p.granted_at) as at, coalesce(c.title, u.display_name) as name,
           coalesce(c.username, u.username) as username, coalesce(c.avatar_path, u.avatar_path) as avatar_path,
           (select count(*) from public.news_items i where i.publisher_id = p.id) as items
      from public.news_publishers p
      left join public.chats c on c.id = p.chat_id
      left join public.profiles u on u.id = p.user_id
     where (p.revoked_at is not null) = coalesce(p_revoked, false)
     order by coalesce(p.revoked_at, p.granted_at) desc limit 200) x), '[]'::jsonb);
end $$;

create or replace function public.news_admin_lookup(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  q := regexp_replace(q, '^(https?://)?(www\.)?(mestario\.(lol|top)|soroka\.lol)/(#)?', '');
  q := btrim(q, ' @#/');
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    (select 'channel' as kind, c.id as target, c.title as name, c.username, c.avatar_path, c.verified,
            (select count(*) from public.chat_members m where m.chat_id = c.id and m.left_at is null) as members,
            (select jsonb_build_object('category', p.category, 'region', p.region, 'categories', p.categories, 'regions', p.regions, 'autopost', p.autopost)
               from public.news_publishers p where p.chat_id = c.id and p.revoked_at is null) as news
       from public.chats c where c.is_channel and not c.is_private and c.deleted_at is null and (c.username like q || '%' or position(q in lower(c.title)) > 0)
      order by (c.username = q) desc nulls last limit 8)
    union all
    (select 'user', u.id, u.display_name, u.username, u.avatar_path, u.verified, null,
            (select jsonb_build_object('category', p.category, 'region', p.region, 'categories', p.categories, 'regions', p.regions, 'autopost', p.autopost)
               from public.news_publishers p where p.user_id = u.id and p.revoked_at is null)
       from public.profiles u where u.deleted_at is null and u.banned_at is null and (u.username like q || '%' or position(q in lower(u.display_name)) > 0)
      order by (u.username = q) desc limit 8)) x), '[]'::jsonb);
end $$;

-- ---------- матч ----------
alter table public.news_items add column if not exists match jsonb;
alter table public.news_items drop constraint if exists news_items_post_type_check;
alter table public.news_items add constraint news_items_post_type_check check (post_type in ('post', 'poll', 'rate', 'match'));

-- проверка и очистка данных матча: только известные поля, числа в разумных пределах, фото — из своей папки
create or replace function private.news_match_clean(p jsonb, me uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; side text; nm text; img text; st text; k text; stats jsonb := '{}'::jsonb;
  num text := '^\s*\d{1,3}\s*$';
  cl int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'bad match'; end if;
  r := jsonb_build_object('league', left(btrim(coalesce(p ->> 'league', '')), 60));
  foreach side in array array['home', 'away'] loop
    nm := btrim(coalesce(p -> side ->> 'name', ''));
    if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'bad match'; end if;
    img := nullif(p -> side ->> 'image', '');
    if img is not null and (split_part(img, '/', 1) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'news' and o.name = img)) then
      raise exception 'bad media';
    end if;
    r := r || jsonb_build_object(side, jsonb_build_object('name', nm, 'image', img));
  end loop;
  st := coalesce(p ->> 'status', 'soon');
  if st not in ('soon', 'live', 'ht', 'ft') then raise exception 'bad match'; end if;
  r := r || jsonb_build_object('status', st,
    'minute', case when coalesce(p ->> 'minute', '') ~ num then least((p ->> 'minute')::int, 150) else 0 end,
    'score', jsonb_build_array(case when coalesce(p -> 'score' ->> 0, '') ~ num then least((p -> 'score' ->> 0)::int, 99) else 0 end,
                               case when coalesce(p -> 'score' ->> 1, '') ~ num then least((p -> 'score' ->> 1)::int, 99) else 0 end),
    'starts_at', case when coalesce(p ->> 'starts_at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d' then left(p ->> 'starts_at', 30) end);
  foreach k in array array['possession', 'shots', 'on_target', 'corners', 'fouls', 'yellow', 'red'] loop
    if jsonb_typeof(p -> 'stats' -> k) = 'array'
       and coalesce(p -> 'stats' -> k ->> 0, '') ~ num and coalesce(p -> 'stats' -> k ->> 1, '') ~ num then
      cl := case when k = 'possession' then 100 else 999 end;
      stats := stats || jsonb_build_object(k, jsonb_build_array(least((p -> 'stats' -> k ->> 0)::int, cl), least((p -> 'stats' -> k ->> 1)::int, cl)));
    end if;
  end loop;
  r := r || jsonb_build_object('stats', stats);
  if jsonb_typeof(p -> 'odds') = 'array' and jsonb_array_length(p -> 'odds') = 3
     and coalesce(p -> 'odds' ->> 0, '') ~ num and coalesce(p -> 'odds' ->> 1, '') ~ num and coalesce(p -> 'odds' ->> 2, '') ~ num then
    r := r || jsonb_build_object('odds', jsonb_build_array(least((p -> 'odds' ->> 0)::int, 100), least((p -> 'odds' ->> 1)::int, 100), least((p -> 'odds' ->> 2)::int, 100)));
  end if;
  return r;
end $$;

-- обновить счёт и статистику по ходу игры (только автор)
create or replace function public.news_match_update(p_item bigint, p_match jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); m jsonb;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.news_items i join public.news_publishers p on p.id = i.publisher_id
                  where i.id = p_item and i.post_type = 'match' and p.user_id = me and p.revoked_at is null) then
    raise exception 'not allowed';
  end if;
  m := private.news_match_clean(p_match, me);
  update public.news_items set match = m where id = p_item;
  return m;
end $$;

-- ---------- комментарии ----------
create table if not exists public.news_comments (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.news_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists news_comments_item on public.news_comments (item_id, id) where deleted_at is null;
create index if not exists news_comments_user on public.news_comments (user_id, created_at);
alter table public.news_comments enable row level security;

create or replace function private.news_comment_json(c public.news_comments) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
    'user', jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar_path', u.avatar_path,
                               'verified', u.verified, 'is_admin', u.is_admin),
    'can_delete', c.user_id = (select auth.uid()) or public.is_admin()
       or exists (select 1 from public.news_items i join public.news_publishers p on p.id = i.publisher_id
                   where i.id = c.item_id and p.user_id = (select auth.uid())))
  from public.profiles u where u.id = c.user_id;
$$;

create or replace function public.news_comments_list(p_item bigint, p_before bigint default null, p_limit int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.news_comment_json(c) order by c.id), '[]'::jsonb)
    from (select * from public.news_comments c
           where c.item_id = p_item and c.deleted_at is null and (p_before is null or c.id < p_before)
             and (select auth.uid()) is not null
             and not exists (select 1 from public.profiles u where u.id = c.user_id and u.banned_at is not null)
           order by c.id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) c;
$$;

create or replace function public.news_comment_add(p_item bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); b text := btrim(coalesce(p_body, '')); c public.news_comments;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if char_length(b) < 1 or char_length(b) > 1000 then raise exception 'bad comment'; end if;
  if not exists (select 1 from public.news_items where id = p_item) then raise exception 'not found'; end if;
  if (select count(*) from public.news_comments where user_id = me and created_at > now() - interval '1 hour') >= 60 then raise exception 'limit'; end if;
  insert into public.news_comments (item_id, user_id, body) values (p_item, me, b) returning * into c;
  return private.news_comment_json(c);
end $$;

create or replace function public.news_comment_delete(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.news_comments c set deleted_at = now()
   where c.id = p_id and c.deleted_at is null
     and (c.user_id = me or public.is_admin()
          or exists (select 1 from public.news_items i join public.news_publishers p on p.id = i.publisher_id where i.id = c.item_id and p.user_id = me));
  if not found then raise exception 'not allowed'; end if;
end $$;

-- ---------- реакции ----------
create table if not exists public.news_reactions (
  item_id bigint not null references public.news_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('heart', 'fire', 'up', 'star')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists news_reactions_item on public.news_reactions (item_id, kind);
alter table public.news_reactions enable row level security;

create or replace function private.news_react_state(p_item bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.news_reactions where item_id = p_item group by kind) x), '{}'::jsonb),
    'mine', (select kind from public.news_reactions where item_id = p_item and user_id = (select auth.uid())));
$$;

-- реакция: то же нажатие снимает её, другое — меняет
create or replace function public.news_react(p_item bigint, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); cur text;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_kind is not null and p_kind not in ('heart', 'fire', 'up', 'star') then raise exception 'bad kind'; end if;
  if not exists (select 1 from public.news_items where id = p_item) then raise exception 'not found'; end if;
  select kind into cur from public.news_reactions where item_id = p_item and user_id = me;
  if p_kind is null or cur = p_kind then
    delete from public.news_reactions where item_id = p_item and user_id = me;
  else
    insert into public.news_reactions (item_id, user_id, kind) values (p_item, me, p_kind)
    on conflict (item_id, user_id) do update set kind = excluded.kind, created_at = now();
  end if;
  return private.news_react_state(p_item);
end $$;

-- ---------- лента: + матч, реакции, число комментариев ----------
drop function if exists public.news_feed(text, text, text[], boolean, timestamptz, int);
create function public.news_feed(p_category text default null, p_region text default null, p_sources text[] default null,
                                 p_pubs boolean default true, p_before timestamptz default null, p_limit int default 30)
returns table (id bigint, kind text, source_id text, category text, region text, title text, summary text, title_ru text, summary_ru text,
               lang text, url text, image text, image_path text, published_at timestamptz,
               pub_id uuid, pub_name text, pub_username text, pub_avatar text, chat_id uuid, message_id bigint, joined boolean, members bigint,
               media jsonb, post_type text, rate_asset text, poll jsonb, match jsonb, reactions jsonb, comments bigint)
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
         case when i.post_type = 'poll' then public.news_poll_state(i.id) end,
         case when i.post_type = 'match' then i.match end,
         private.news_react_state(i.id),
         (select count(*) from public.news_comments cm where cm.item_id = i.id and cm.deleted_at is null)
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

-- ---------- публикация: + матч, выбор раздела и региона из разрешённых ----------
drop function if exists public.news_publish(text, text, text, jsonb, text, jsonb, text);
create function public.news_publish(p_title text, p_text text, p_url text default null, p_media jsonb default null,
                                    p_kind text default 'post', p_poll jsonb default null, p_rate text default null,
                                    p_match jsonb default null, p_category text default null, p_region text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; v bigint; t text := btrim(coalesce(p_title, '')); x text := nullif(btrim(coalesce(p_text, '')), '');
        u text := nullif(btrim(coalesce(p_url, '')), ''); me uuid := (select auth.uid()); m jsonb; n int := 0; pth text; knd text;
        k text := coalesce(p_kind, 'post'); opts jsonb; ot text; oimg text; days int; mt jsonb; cat text; reg text;
begin
  if private.is_banned() then raise exception 'not allowed'; end if;
  select * into pb from public.news_publishers where user_id = me and revoked_at is null and autopost;
  if not found then raise exception 'not verified'; end if;
  if k not in ('post', 'poll', 'rate', 'match') then raise exception 'bad kind'; end if;
  cat := coalesce(p_category, pb.category); reg := coalesce(p_region, pb.region);
  if not (cat = any (pb.categories)) then raise exception 'bad category'; end if;
  if not (reg = any (pb.regions)) then raise exception 'bad region'; end if;
  if k = 'match' then
    mt := private.news_match_clean(p_match, me);
    if char_length(t) < 3 then t := (mt -> 'home' ->> 'name') || ' — ' || (mt -> 'away' ->> 'name'); end if;
  end if;
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
  insert into public.news_items (publisher_id, category, region, title, summary, lang, url, published_at, post_type, rate_asset, poll_multi, poll_closes_at, match)
  values (pb.id, cat, reg, t, x, 'ru', u, now(), k, case when k = 'rate' then p_rate end,
          k = 'poll' and coalesce((p_poll ->> 'multi')::boolean, false), case when k = 'poll' and days > 0 then now() + make_interval(days => days) end, mt)
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

-- ---------- доступ ----------
revoke execute on function public.news_admin_grant(text, uuid, text[], text[], boolean), public.news_match_update(bigint, jsonb),
  public.news_comments_list(bigint, bigint, int), public.news_comment_add(bigint, text), public.news_comment_delete(bigint),
  public.news_react(bigint, text), public.news_feed(text, text, text[], boolean, timestamptz, int),
  public.news_publish(text, text, text, jsonb, text, jsonb, text, jsonb, text, text) from public, anon;
grant execute on function public.news_admin_grant(text, uuid, text[], text[], boolean), public.news_match_update(bigint, jsonb),
  public.news_comments_list(bigint, bigint, int), public.news_comment_add(bigint, text), public.news_comment_delete(bigint),
  public.news_react(bigint, text), public.news_feed(text, text, text[], boolean, timestamptz, int),
  public.news_publish(text, text, text, jsonb, text, jsonb, text, jsonb, text, text) to authenticated;
revoke execute on function private.news_match_clean(jsonb, uuid), private.news_comment_json(public.news_comments), private.news_react_state(bigint) from public, anon, authenticated;
commit;
