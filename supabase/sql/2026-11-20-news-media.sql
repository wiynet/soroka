begin;
-- ============================================================================
-- Новости: фото и видео, 2026-11-20.
--   • Верифицированный человек прикладывает к публикации до 10 фото и видео (бакет news, видео до 100 МБ).
--   • Посты верифицированных каналов уходят в Новости вместе с фото и видео, альбомы — целиком.
-- ============================================================================

-- бакет для публикаций в Новостях: читать может любой (новости публичные), загружать — только верифицированный автор в свою папку
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news', 'news', true, 104857600, array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.news_can_post() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.news_publishers p where p.user_id = (select auth.uid()) and p.revoked_at is null and p.autopost)
     and not private.is_banned();
$$;
drop policy if exists news_upload on storage.objects;
create policy news_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'news' and (storage.foldername(name))[1] = (select auth.uid())::text and private.news_can_post());
drop policy if exists news_delete_own on storage.objects;
create policy news_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'news' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- фото и видео новости
create table if not exists public.news_media (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.news_items(id) on delete cascade,
  bucket text not null check (bucket in ('news', 'attachments')),
  path text not null,
  kind text not null check (kind in ('image', 'video')),
  message_id bigint,
  pos int not null default 0,
  unique (item_id, path)
);
create index if not exists news_media_item on public.news_media (item_id, pos);
create index if not exists news_media_path on public.news_media (path);
alter table public.news_media enable row level security;
alter table public.news_items add column if not exists album_id uuid;
create index if not exists news_items_album on public.news_items (album_id) where album_id is not null;

-- вложения постов из Новостей видят и те, кто не подписан на канал
create or replace function private.news_image_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.news_items where image_path = p_name)
      or exists (select 1 from public.news_media where bucket = 'attachments' and path = p_name);
$$;

-- лента: + список фото и видео
drop function if exists public.news_feed(text, text, text[], boolean, timestamptz, int);
create function public.news_feed(p_category text default null, p_region text default null, p_sources text[] default null,
                                 p_pubs boolean default true, p_before timestamptz default null, p_limit int default 30)
returns table (id bigint, kind text, source_id text, category text, region text, title text, summary text, title_ru text, summary_ru text,
               lang text, url text, image text, image_path text, published_at timestamptz,
               pub_id uuid, pub_name text, pub_username text, pub_avatar text, chat_id uuid, message_id bigint, joined boolean, members bigint,
               media jsonb)
language sql stable security definer set search_path = '' as $$
  select i.id, case when i.source_id is not null then 'rss' else p.kind end, i.source_id, i.category, i.region,
         i.title, i.summary, i.title_ru, i.summary_ru, i.lang, i.url, i.image, i.image_path, i.published_at,
         coalesce(p.user_id, p.chat_id), coalesce(c.title, u.display_name), coalesce(c.username, u.username), coalesce(c.avatar_path, u.avatar_path),
         i.chat_id, i.message_id,
         case when i.chat_id is null then null else exists (select 1 from public.chat_members m where m.chat_id = i.chat_id and m.user_id = (select auth.uid()) and m.left_at is null) end,
         case when i.chat_id is null then null else (select count(*) from public.chat_members m where m.chat_id = i.chat_id and m.left_at is null) end,
         (select jsonb_agg(jsonb_build_object('bucket', md.bucket, 'path', md.path, 'kind', md.kind) order by md.message_id nulls first, md.pos, md.id)
            from public.news_media md where md.item_id = i.id)
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
revoke execute on function public.news_feed(text, text, text[], boolean, timestamptz, int) from public, anon;
grant execute on function public.news_feed(text, text, text[], boolean, timestamptz, int) to authenticated;

-- публикация от верифицированного человека: + фото и видео (до 10)
drop function if exists public.news_publish(text, text, text);
create function public.news_publish(p_title text, p_text text, p_url text default null, p_media jsonb default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; v bigint; t text := btrim(coalesce(p_title, '')); x text := nullif(btrim(coalesce(p_text, '')), '');
        u text := nullif(btrim(coalesce(p_url, '')), ''); me uuid := (select auth.uid()); m jsonb; n int := 0; pth text; knd text;
begin
  if private.is_banned() then raise exception 'not allowed'; end if;
  select * into pb from public.news_publishers where user_id = me and revoked_at is null and autopost;
  if not found then raise exception 'not verified'; end if;
  if char_length(t) < 3 or char_length(t) > 160 then raise exception 'bad title'; end if;
  if char_length(coalesce(x, '')) > 2000 then raise exception 'too long'; end if;
  if u is not null and (u !~* '^https?://[^\s]+$' or char_length(u) > 500) then raise exception 'bad url'; end if;
  if p_media is not null and (jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) > 10) then raise exception 'bad media'; end if;
  if (select count(*) from public.news_items where publisher_id = pb.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'limit';
  end if;
  insert into public.news_items (publisher_id, category, region, title, summary, lang, url, published_at)
  values (pb.id, pb.category, pb.region, t, x, 'ru', u, now()) returning id into v;
  for m in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    pth := m ->> 'path'; knd := m ->> 'kind';
    if knd not in ('image', 'video') or pth is null or split_part(pth, '/', 1) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'news' and o.name = pth) then
      raise exception 'bad media';
    end if;
    insert into public.news_media (item_id, bucket, path, kind, pos) values (v, 'news', pth, knd, n) on conflict do nothing;
    n := n + 1;
  end loop;
  return v;
end $$;
revoke execute on function public.news_publish(text, text, text, jsonb) from public, anon;
grant execute on function public.news_publish(text, text, text, jsonb) to authenticated;

-- автопостинг из канала: текст, фото и видео; альбом уходит одной новостью
create or replace function private.news_from_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pb public.news_publishers; s record; knd text; it bigint; has_text boolean;
begin
  knd := case when new.file_path is null then null when new.file_type like 'image/%' then 'image' when new.file_type like 'video/%' then 'video' end;
  if tg_op = 'UPDATE' and new.deleted_at is not null then
    delete from public.news_items where message_id = new.id;
    delete from public.news_media where message_id = new.id;
    return null;
  end if;
  if coalesce(new.scheduled, false) or new.event_kind is not null or new.deleted_at is not null then return null; end if;
  select p.* into pb from public.news_publishers p
    join public.chats c on c.id = p.chat_id
   where p.chat_id = new.chat_id and p.revoked_at is null and p.autopost and c.is_channel and not c.is_private and c.deleted_at is null;
  if not found then return null; end if;
  has_text := char_length(btrim(coalesce(new.body, ''), E' \n\r\t')) >= 3;

  if tg_op = 'UPDATE' and not (old.scheduled and not coalesce(new.scheduled, false)) then
    -- правка поста
    if has_text then
      select * into s from private.news_split(new.body);
      update public.news_items set title = s.ttl, summary = s.rest,
             image_path = case when knd = 'image' then new.file_path else image_path end where message_id = new.id;
    end if;
    if new.file_path is distinct from old.file_path then
      delete from public.news_media where message_id = new.id;
      select id into it from public.news_items where message_id = new.id or (new.album_id is not null and album_id = new.album_id) limit 1;
      if it is not null and knd is not null then
        insert into public.news_media (item_id, bucket, path, kind, message_id, pos) values (it, 'attachments', new.file_path, knd, new.id, 0) on conflict do nothing;
      end if;
    end if;
    return null;
  end if;

  if has_text then
    select * into s from private.news_split(new.body);
    select id into it from public.news_items where new.album_id is not null and album_id = new.album_id and chat_id = new.chat_id limit 1;
    if it is null then
      insert into public.news_items (publisher_id, chat_id, message_id, album_id, category, region, title, summary, lang, image_path, published_at)
      values (pb.id, new.chat_id, new.id, new.album_id, pb.category, pb.region, s.ttl, s.rest, 'ru',
              case when knd = 'image' then new.file_path end, now())
      on conflict (message_id) where message_id is not null do nothing
      returning id into it;
    else
      update public.news_items set title = s.ttl, summary = s.rest, message_id = coalesce(message_id, new.id) where id = it;
    end if;
    if it is null then return null; end if;
    if knd is not null then
      insert into public.news_media (item_id, bucket, path, kind, message_id, pos) values (it, 'attachments', new.file_path, knd, new.id, 0) on conflict do nothing;
    end if;
    -- части альбома, пришедшие раньше подписи
    if new.album_id is not null then
      insert into public.news_media (item_id, bucket, path, kind, message_id, pos)
      select it, 'attachments', m.file_path, case when m.file_type like 'video/%' then 'video' else 'image' end, m.id, row_number() over (order by m.id)
        from public.messages m
       where m.chat_id = new.chat_id and m.album_id = new.album_id and m.id <> new.id and m.deleted_at is null
         and m.file_path is not null and (m.file_type like 'image/%' or m.file_type like 'video/%')
      on conflict do nothing;
    end if;
  elsif knd is not null and new.album_id is not null then
    -- фото или видео из альбома без подписи — к новости альбома, если она уже есть
    select id into it from public.news_items where album_id = new.album_id and chat_id = new.chat_id limit 1;
    if it is not null then
      insert into public.news_media (item_id, bucket, path, kind, message_id, pos)
      values (it, 'attachments', new.file_path, knd, new.id, (select count(*) from public.news_media where item_id = it))
      on conflict do nothing;
    end if;
  end if;
  return null;
end $$;
commit;
