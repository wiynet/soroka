begin;
-- ============================================================================
-- Новости, 2026-11-20.
--   • Лента собирается из RSS выбранных источников (функция news-fetch раз в 15 минут): только заголовок,
--     короткий анонс, картинка и ссылка на оригинал. Зарубежные заголовки переводятся на русский.
--   • Админы выдают верификацию людям и публичным каналам. Вместе с галочкой можно включить автопостинг:
--     посты верифицированного канала сами попадают в Новости, верифицированный человек публикует прямо из Новостей.
--   • Люди и владельцы каналов могут подать заявку на верификацию.
-- ============================================================================

alter table public.chats add column if not exists verified boolean not null default false;
grant select (verified) on public.chats to authenticated;

create table if not exists public.news_sources (
  id text primary key,
  name text not null,
  region text not null check (region in ('ru', 'world')),
  category text not null,
  feed_url text,
  site text,
  color text,
  letter text,
  lang text not null default 'ru',
  sort int not null default 0,
  enabled boolean not null default true,
  default_on boolean not null default false,
  last_fetch_at timestamptz,
  last_count int,
  last_error text
);
alter table public.news_sources enable row level security;
drop policy if exists news_sources_read on public.news_sources;
create policy news_sources_read on public.news_sources for select to authenticated using (enabled);
grant select (id, name, region, category, site, color, letter, lang, sort, enabled, default_on) on public.news_sources to authenticated;

create table if not exists public.news_publishers (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('user', 'channel')),
  user_id uuid references public.profiles(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  category text not null,
  region text not null check (region in ('ru', 'world')),
  autopost boolean not null default true,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((kind = 'user' and user_id is not null and chat_id is null) or (kind = 'channel' and chat_id is not null and user_id is null))
);
create unique index if not exists news_publishers_user on public.news_publishers (user_id) where user_id is not null;
create unique index if not exists news_publishers_chat on public.news_publishers (chat_id) where chat_id is not null;
alter table public.news_publishers enable row level security;

create table if not exists public.news_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('user', 'channel')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create unique index if not exists news_requests_pending on public.news_requests (user_id, coalesce(chat_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';
alter table public.news_requests enable row level security;

create table if not exists public.news_items (
  id bigint generated always as identity primary key,
  source_id text references public.news_sources(id) on delete cascade,
  publisher_id bigint references public.news_publishers(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  message_id bigint,
  guid text,
  category text not null,
  region text not null,
  title text not null,
  summary text,
  title_ru text,
  summary_ru text,
  lang text not null default 'ru',
  url text,
  image text,
  image_path text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists news_items_src_guid on public.news_items (source_id, guid);   -- у постов каналов source_id пустой и не мешает
create unique index if not exists news_items_msg on public.news_items (message_id) where message_id is not null;
create index if not exists news_items_time on public.news_items (published_at desc);
create index if not exists news_items_cat on public.news_items (category, published_at desc);
create index if not exists news_items_pub on public.news_items (publisher_id) where publisher_id is not null;
create index if not exists news_items_img on public.news_items (image_path) where image_path is not null;
create index if not exists news_items_untr on public.news_items (created_at) where lang <> 'ru' and title_ru is null;
alter table public.news_items enable row level security;

-- источники из таблицы: категория × Россия / Мир
insert into public.news_sources (id, name, region, category, feed_url, site, color, letter, lang, sort, default_on) values
  ('rbc',        'ТАСС',          'ru',    'news',     'https://tass.ru/rss/v2.xml',                        'tass.ru',         '#1c4f9c', 'Т', 'ru', 10, true),   -- лента РБК с сервера не отвечает
  ('bbc',        'BBC News',      'world', 'news',     'https://feeds.bbci.co.uk/news/world/rss.xml',       'bbc.com',         '#b80000', 'B', 'en', 11, true),
  ('habr',       'Хабр',          'ru',    'tech',     'https://habr.com/ru/rss/articles/?fl=ru',           'habr.com',        '#548eaa', 'Х', 'ru', 20, true),
  ('techcrunch', 'TechCrunch',    'world', 'tech',     'https://techcrunch.com/feed/',                      'techcrunch.com',  '#0a9e01', 'T', 'en', 21, true),
  ('forbes',     'Ведомости',     'ru',    'business', 'https://www.vedomosti.ru/rss/news',                 'vedomosti.ru',    '#222222', 'В', 'ru', 30, true),   -- лента Forbes пустая
  ('bloomberg',  'Bloomberg',     'world', 'business', 'https://feeds.bloomberg.com/markets/news.rss',      'bloomberg.com',   '#2800d7', 'B', 'en', 31, true),
  ('nplus1',     'N+1',           'ru',    'science',  'https://nplus1.ru/rss',                             'nplus1.ru',       '#e4572e', 'N', 'ru', 40, true),
  ('nasa',       'NASA',          'world', 'science',  'https://www.nasa.gov/news-release/feed/',           'nasa.gov',        '#0b3d91', 'N', 'en', 41, false),
  ('championat', 'Чемпионат',     'ru',    'sport',    'https://www.championat.com/rss/news/',              'championat.com',  '#d6001c', 'Ч', 'ru', 50, true),
  ('espn',       'ESPN',          'world', 'sport',    'https://www.espn.com/espn/rss/news',                'espn.com',        '#cc0000', 'E', 'en', 51, false),
  ('igromania',  'Игромания',     'ru',    'games',    'https://www.igromania.ru/rss/news.rss',             'igromania.ru',    '#c8102e', 'И', 'ru', 60, false),
  ('ign',        'IGN',           'world', 'games',    'https://feeds.feedburner.com/ign/all',              'ign.com',         '#bf1313', 'I', 'en', 61, true),
  ('autoreview', 'Motor.ru',      'ru',    'auto',     'https://motor.ru/exports/rss',                      'motor.ru',        '#2f4f8f', 'M', 'ru', 70, false),  -- у Авторевю нет RSS
  ('topgear',    'Motor1',        'world', 'auto',     'https://www.motor1.com/rss/news/all/',              'motor1.com',      '#e4002b', 'M', 'en', 71, false),  -- Top Gear закрывает ленту
  ('afisha',     'Афиша',         'ru',    'culture',  'https://daily.afisha.ru/rss/',                      'afisha.ru',       '#c99a1c', 'А', 'ru', 80, false),
  ('variety',    'Variety',       'world', 'culture',  'https://variety.com/feed/',                         'variety.com',     '#7a1fa2', 'V', 'en', 81, false),
  ('habr_edu',   'Хабр',          'ru',    'edu',      'https://habr.com/ru/rss/hubs/study/articles/?fl=ru', 'habr.com',       '#548eaa', 'Х', 'ru', 90, false),
  ('coursera',   'Coursera',      'world', 'edu',      'https://blog.coursera.org/feed/',                   'coursera.org',    '#0056d2', 'C', 'en', 91, true)
on conflict (id) do nothing;

-- ---------- лента ----------
create or replace function public.news_feed(p_category text default null, p_region text default null, p_sources text[] default null,
                                            p_pubs boolean default true, p_before timestamptz default null, p_limit int default 30)
returns table (id bigint, kind text, source_id text, category text, region text, title text, summary text, title_ru text, summary_ru text,
               lang text, url text, image text, image_path text, published_at timestamptz,
               pub_id uuid, pub_name text, pub_username text, pub_avatar text, chat_id uuid, message_id bigint, joined boolean, members bigint)
language sql stable security definer set search_path = '' as $$
  select i.id, case when i.source_id is not null then 'rss' else p.kind end, i.source_id, i.category, i.region,
         i.title, i.summary, i.title_ru, i.summary_ru, i.lang, i.url, i.image, i.image_path, i.published_at,
         coalesce(p.user_id, p.chat_id), coalesce(c.title, u.display_name), coalesce(c.username, u.username), coalesce(c.avatar_path, u.avatar_path),
         i.chat_id, i.message_id,
         case when i.chat_id is null then null else exists (select 1 from public.chat_members m where m.chat_id = i.chat_id and m.user_id = (select auth.uid()) and m.left_at is null) end,
         case when i.chat_id is null then null else (select count(*) from public.chat_members m where m.chat_id = i.chat_id and m.left_at is null) end
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
grant execute on function public.news_feed(text, text, text[], boolean, timestamptz, int) to authenticated;

-- последнее обновление Mestario для карточки «Что нового» в ленте
create or replace function public.news_whats_new() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(w) from (select id, title, body, images, created_at from public.whats_new
     where (expires_at is null or expires_at > now()) order by id desc limit 1) w;
$$;
grant execute on function public.news_whats_new() to authenticated;

-- ---------- автопостинг: посты верифицированного канала уходят в Новости ----------
create or replace function private.news_split(t text, out ttl text, out rest text) language plpgsql immutable as $$
declare ws text := E' \n\r\t';
begin
  t := btrim(coalesce(t, ''), ws);
  ttl := btrim(split_part(t, E'\n', 1), ws);
  rest := btrim(substr(t, char_length(split_part(t, E'\n', 1)) + 1), ws);
  if char_length(ttl) > 140 then
    rest := btrim(substr(ttl, 131) || E'\n' || rest, ws);
    ttl := btrim(left(ttl, 130), ws) || '…';
  end if;
  if char_length(rest) > 600 then rest := btrim(left(rest, 597), ws) || '…'; end if;
  if rest = '' then rest := null; end if;
end $$;

create or replace function private.news_from_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; s record; img text;
begin
  if tg_op = 'UPDATE' and new.deleted_at is not null then
    delete from public.news_items where message_id = new.id;
    return null;
  end if;
  if coalesce(new.scheduled, false) or new.event_kind is not null or new.deleted_at is not null then return null; end if;
  select p.* into pb from public.news_publishers p
    join public.chats c on c.id = p.chat_id
   where p.chat_id = new.chat_id and p.revoked_at is null and p.autopost and c.is_channel and not c.is_private and c.deleted_at is null;
  if not found then return null; end if;
  if char_length(btrim(coalesce(new.body, ''))) < 3 then return null; end if;
  select * into s from private.news_split(new.body);
  img := case when new.file_type like 'image/%' then new.file_path end;
  if tg_op = 'INSERT' or (old.scheduled and not coalesce(new.scheduled, false)) then
    insert into public.news_items (publisher_id, chat_id, message_id, category, region, title, summary, lang, image_path, published_at)
    values (pb.id, new.chat_id, new.id, pb.category, pb.region, s.ttl, s.rest, 'ru', img, now())
    on conflict (message_id) where message_id is not null do nothing;
  else
    update public.news_items set title = s.ttl, summary = s.rest, image_path = img where message_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists messages_news on public.messages;
create trigger messages_news after insert or update of body, deleted_at, scheduled, file_path on public.messages
  for each row execute function private.news_from_message();

-- картинки постов из Новостей видят и те, кто не подписан на канал
create or replace function private.news_image_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.news_items where image_path = p_name);
$$;
drop policy if exists attachments_news_read on storage.objects;
create policy attachments_news_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and private.news_image_ok(name));

-- ---------- публикация от верифицированного человека ----------
create or replace function public.news_publish(p_title text, p_text text, p_url text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; v bigint; t text := btrim(coalesce(p_title, '')); x text := nullif(btrim(coalesce(p_text, '')), '');
        u text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if private.is_banned() then raise exception 'not allowed'; end if;
  select * into pb from public.news_publishers where user_id = (select auth.uid()) and revoked_at is null and autopost;
  if not found then raise exception 'not verified'; end if;
  if char_length(t) < 3 or char_length(t) > 160 then raise exception 'bad title'; end if;
  if char_length(coalesce(x, '')) > 2000 then raise exception 'too long'; end if;
  if u is not null and (u !~* '^https?://[^\s]+$' or char_length(u) > 500) then raise exception 'bad url'; end if;
  if (select count(*) from public.news_items where publisher_id = pb.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'limit';
  end if;
  insert into public.news_items (publisher_id, category, region, title, summary, lang, url, published_at)
  values (pb.id, pb.category, pb.region, t, x, 'ru', u, now()) returning id into v;
  return v;
end $$;
grant execute on function public.news_publish(text, text, text) to authenticated;

-- удалить свою публикацию (админ — любую)
create or replace function public.news_delete(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.news_items i using public.news_publishers p
   where i.id = p_id and p.id = i.publisher_id and i.message_id is null
     and (p.user_id = (select auth.uid()) or public.is_admin());
  if not found and public.is_admin() then delete from public.news_items where id = p_id; end if;
end $$;
grant execute on function public.news_delete(bigint) to authenticated;

-- ---------- заявки и статус для пользователя ----------
create or replace function public.news_my_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'me', (select jsonb_build_object('category', p.category, 'region', p.region, 'autopost', p.autopost)
             from public.news_publishers p where p.user_id = (select auth.uid()) and p.revoked_at is null),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'username', c.username, 'avatar_path', c.avatar_path,
                                  'verified', c.verified, 'private', c.is_private,
                                  'news', (select jsonb_build_object('category', p.category, 'region', p.region, 'autopost', p.autopost)
                                             from public.news_publishers p where p.chat_id = c.id and p.revoked_at is null),
                                  'pending', exists (select 1 from public.news_requests r where r.chat_id = c.id and r.status = 'pending'))
                                order by c.title)
                 from public.chats c
                where c.is_channel and c.deleted_at is null
                  and (c.created_by = (select auth.uid())
                       or exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = (select auth.uid()) and m.is_admin and m.left_at is null))), '[]'::jsonb),
    'pending', exists (select 1 from public.news_requests r where r.user_id = (select auth.uid()) and r.chat_id is null and r.status = 'pending'));
$$;
grant execute on function public.news_my_status() to authenticated;

create or replace function public.news_request(p_chat uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); r text := btrim(coalesce(p_reason, ''));
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if char_length(r) < 3 or char_length(r) > 500 then raise exception 'bad reason'; end if;
  if p_chat is not null and not exists (
       select 1 from public.chats c where c.id = p_chat and c.is_channel and not c.is_private and c.deleted_at is null
          and (c.created_by = me or exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = me and m.is_admin and m.left_at is null))) then
    raise exception 'not channel admin';
  end if;
  if (select count(*) from public.news_requests where user_id = me and created_at > now() - interval '1 day') >= 5 then raise exception 'limit'; end if;
  insert into public.news_requests (kind, user_id, chat_id, reason)
  values (case when p_chat is null then 'user' else 'channel' end, me, p_chat, r)
  on conflict do nothing;
end $$;
grant execute on function public.news_request(uuid, text) to authenticated;

-- ---------- админка ----------
create or replace function public.news_admin_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select r.id, r.kind, r.reason, r.created_at, r.user_id, r.chat_id,
           u.username, u.display_name, u.avatar_path, u.verified as user_verified,
           c.title, c.username as chat_username, c.avatar_path as chat_avatar,
           (select count(*) from public.chat_members m where m.chat_id = r.chat_id and m.left_at is null) as members,
           (select count(*) from public.messages m where m.chat_id = r.chat_id and m.deleted_at is null) as posts,
           (select count(*) from public.reports rp where (r.chat_id is null and rp.target_user = r.user_id) or (r.chat_id is not null and rp.target_chat = r.chat_id)) as reports
      from public.news_requests r
      join public.profiles u on u.id = r.user_id
      left join public.chats c on c.id = r.chat_id
     where r.status = 'pending'
     order by r.created_at desc limit 100) x), '[]'::jsonb);
end $$;
grant execute on function public.news_admin_requests() to authenticated;

create or replace function public.news_admin_list(p_revoked boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select p.kind, coalesce(p.user_id, p.chat_id) as target, p.category, p.region, p.autopost,
           coalesce(p.revoked_at, p.granted_at) as at, coalesce(c.title, u.display_name) as name,
           coalesce(c.username, u.username) as username, coalesce(c.avatar_path, u.avatar_path) as avatar_path,
           (select count(*) from public.news_items i where i.publisher_id = p.id) as items
      from public.news_publishers p
      left join public.chats c on c.id = p.chat_id
      left join public.profiles u on u.id = p.user_id
     where (p.revoked_at is not null) = coalesce(p_revoked, false)
     order by coalesce(p.revoked_at, p.granted_at) desc limit 200) x), '[]'::jsonb);
end $$;
grant execute on function public.news_admin_list(boolean) to authenticated;

-- найти человека или публичный канал по юзернейму или ссылке
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
            (select jsonb_build_object('category', p.category, 'region', p.region, 'autopost', p.autopost) from public.news_publishers p where p.chat_id = c.id and p.revoked_at is null) as news
       from public.chats c where c.is_channel and not c.is_private and c.deleted_at is null and (c.username like q || '%' or position(q in lower(c.title)) > 0)
      order by (c.username = q) desc nulls last limit 8)
    union all
    (select 'user', u.id, u.display_name, u.username, u.avatar_path, u.verified, null,
            (select jsonb_build_object('category', p.category, 'region', p.region, 'autopost', p.autopost) from public.news_publishers p where p.user_id = u.id and p.revoked_at is null)
       from public.profiles u where u.deleted_at is null and u.banned_at is null and (u.username like q || '%' or position(q in lower(u.display_name)) > 0)
      order by (u.username = q) desc limit 8)) x), '[]'::jsonb);
end $$;
grant execute on function public.news_admin_lookup(text) to authenticated;

create or replace function public.news_admin_grant(p_kind text, p_target uuid, p_category text, p_region text, p_autopost boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid; ttl text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_category not in ('news', 'tech', 'business', 'science', 'sport', 'games', 'auto', 'culture', 'edu') then raise exception 'bad category'; end if;
  if p_region not in ('ru', 'world') then raise exception 'bad region'; end if;
  if p_kind = 'user' then
    update public.profiles set verified = true where id = p_target and deleted_at is null;
    if not found then raise exception 'user not found'; end if;
    insert into public.news_publishers (kind, user_id, category, region, autopost, granted_by)
    values ('user', p_target, p_category, p_region, coalesce(p_autopost, true), (select auth.uid()))
    on conflict (user_id) where user_id is not null do update
      set category = excluded.category, region = excluded.region, autopost = excluded.autopost,
          granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
    update public.news_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now()
     where user_id = p_target and chat_id is null and status = 'pending';
    perform private.post_event(p_target, 'verified', '✅', 'Галочка подтверждённого аккаунта',
      case when coalesce(p_autopost, true) then 'Теперь вы можете публиковать в Новостях' else null end);
  elsif p_kind = 'channel' then
    update public.chats set verified = true where id = p_target and is_channel and not is_private and deleted_at is null
      returning created_by, title into owner, ttl;
    if not found then raise exception 'channel not found'; end if;
    insert into public.news_publishers (kind, chat_id, category, region, autopost, granted_by)
    values ('channel', p_target, p_category, p_region, coalesce(p_autopost, true), (select auth.uid()))
    on conflict (chat_id) where chat_id is not null do update
      set category = excluded.category, region = excluded.region, autopost = excluded.autopost,
          granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
    update public.news_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now()
     where chat_id = p_target and status = 'pending';
    if owner is not null then
      perform private.post_event(owner, 'verified', '✅', 'Канал «' || ttl || '» верифицирован',
        case when coalesce(p_autopost, true) then 'Посты канала теперь автоматически попадают в Новости' else null end);
    end if;
  else raise exception 'bad kind'; end if;
end $$;
grant execute on function public.news_admin_grant(text, uuid, text, text, boolean) to authenticated;

create or replace function public.news_admin_revoke(p_kind text, p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_kind = 'user' then
    update public.news_publishers set revoked_at = now() where user_id = p_target and revoked_at is null;
    update public.profiles set verified = false where id = p_target;
  elsif p_kind = 'channel' then
    update public.news_publishers set revoked_at = now() where chat_id = p_target and revoked_at is null;
    update public.chats set verified = false where id = p_target;
  else raise exception 'bad kind'; end if;
end $$;
grant execute on function public.news_admin_revoke(text, uuid) to authenticated;

create or replace function public.news_admin_reject(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.news_requests set status = 'rejected', decided_by = (select auth.uid()), decided_at = now() where id = p_id and status = 'pending';
end $$;
grant execute on function public.news_admin_reject(bigint) to authenticated;

-- ---------- для функции news-fetch (ключ service_role) ----------
create or replace function public.news_server_sources() returns setof public.news_sources
language sql stable security definer set search_path = '' as $$ select * from public.news_sources where enabled and feed_url is not null order by sort; $$;
revoke execute on function public.news_server_sources() from public, anon, authenticated;

-- ---------- сбор раз в 15 минут ----------
create or replace function private.news_fetch_poll() returns void
language plpgsql security definer set search_path = '' as $$
declare cfg private.push_config;
begin
  delete from public.news_items where source_id is not null and published_at < now() - interval '10 days';
  select * into cfg from private.push_config limit 1;
  if cfg.function_url is null then return; end if;
  perform net.http_post(
    url := regexp_replace(cfg.function_url, '/push/?$', '/news-fetch'),
    body := jsonb_build_object('run', true),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', cfg.hook_secret),
    timeout_milliseconds := 120000);
end $$;
select cron.unschedule('news-fetch') where exists (select 1 from cron.job where jobname = 'news-fetch');
select cron.schedule('news-fetch', '2,17,32,47 * * * *', 'select private.news_fetch_poll()');
commit;

-- ---------- доступ: только вошедшим (не anon), функции разбора — со своим search_path ----------
alter function private.news_split(text) set search_path = '';
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'news\_%' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function public.news_feed(text, text, text[], boolean, timestamptz, int), public.news_whats_new(), public.news_publish(text, text, text),
  public.news_delete(bigint), public.news_my_status(), public.news_request(uuid, text), public.news_admin_requests(), public.news_admin_list(boolean),
  public.news_admin_lookup(text), public.news_admin_grant(text, uuid, text, text, boolean), public.news_admin_revoke(text, uuid), public.news_admin_reject(bigint) to authenticated;
grant execute on function public.news_server_sources() to service_role;
