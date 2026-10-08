-- Настройка базы для мессенджера «Сорока».
-- Запускается один раз в пустом проекте: Supabase → SQL Editor → вставить → Run.

create schema if not exists private;

-- ---------- таблицы ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{3,31}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_path text, -- путь к аватарке в хранилище avatars
  bio text not null default '' constraint profiles_bio_len check (char_length(bio) <= 200), -- «О себе»
  created_at timestamptz not null default now(),
  constraint profiles_avatar_own check (avatar_path is null or avatar_path like id::text || '/%')
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text check (title is null or char_length(title) between 1 and 64),
  direct_key text unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_text text,
  last_message_sender uuid
);

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz, -- заполнено, если человек вышел из группы
  primary key (chat_id, user_id)
);
create index chat_members_user_idx on public.chat_members(user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_type text check (file_type is null or char_length(file_type) <= 127),
  file_size bigint,
  created_at timestamptz not null default now(),
  constraint messages_not_empty check (body <> '' or file_path is not null),
  constraint messages_file_in_chat check (file_path is null or file_path like chat_id::text || '/%')
);
create index messages_chat_idx on public.messages(chat_id, id desc);

-- ---------- служебные функции ----------
create function private.is_chat_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = c and user_id = (select auth.uid()) and left_at is null
  );
$$;

create function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  update public.chats
     set last_message_at = new.created_at,
         last_message_text = left(case when new.body <> '' then new.body else coalesce(new.file_name, 'Файл') end, 140),
         last_message_sender = new.sender_id
   where id = new.chat_id;
  return new;
end;
$$;

create trigger messages_before_insert before insert on public.messages
for each row execute function private.on_message_insert();

-- ---------- функции, которые вызывает сайт ----------
create function public.username_available(u text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;

create function public.open_direct_chat(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  k text;
  cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = me)
     or not exists (select 1 from public.profiles where id = other) then
    raise exception 'user not found';
  end if;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into cid from public.chats where direct_key = k;
  if cid is not null then return cid; end if;
  insert into public.chats (is_group, direct_key, created_by)
  values (false, k, me)
  on conflict (direct_key) do nothing
  returning id into cid;
  if cid is null then
    select id into cid from public.chats where direct_key = k;
    return cid;
  end if;
  insert into public.chat_members (chat_id, user_id) values (cid, me);
  if other <> me then
    insert into public.chat_members (chat_id, user_id) values (cid, other);
  end if;
  return cid;
end;
$$;

create function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cid uuid;
  t text := btrim(coalesce(p_title, ''));
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not authenticated';
  end if;
  if char_length(t) < 1 or char_length(t) > 64 then raise exception 'bad title'; end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then raise exception 'too many members'; end if;
  insert into public.chats (is_group, title, created_by) values (true, t, me) returning id into cid;
  insert into public.chat_members (chat_id, user_id)
  select cid, p.id from public.profiles p
  where p.id = me or p.id = any (coalesce(p_members, '{}'::uuid[]));
  return cid;
end;
$$;

create function public.add_group_members(p_chat uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_chat_member(p_chat)
     or not exists (select 1 from public.chats where id = p_chat and is_group) then
    raise exception 'not allowed';
  end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then raise exception 'too many members'; end if;
  insert into public.chat_members (chat_id, user_id)
  select p_chat, p.id from public.profiles p where p.id = any (coalesce(p_members, '{}'::uuid[]))
  on conflict (chat_id, user_id) do update set left_at = null, joined_at = now()
  where public.chat_members.left_at is not null;
end;
$$;

create function public.leave_group(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.chats where id = p_chat and is_group) then
    raise exception 'not allowed';
  end if;
  -- строка не удаляется: вышедший помечается и перестаёт видеть группу
  update public.chat_members set left_at = now()
   where chat_id = p_chat and user_id = auth.uid() and left_at is null;
end;
$$;

-- ---------- правила доступа ----------
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

-- профили (имя и юзернейм) видят все вошедшие; менять можно только свой
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- чаты, участников и сообщения видят только участники чата
create policy chats_select on public.chats for select to authenticated using (private.is_chat_member(id));
create policy members_select on public.chat_members for select to authenticated
  using (private.is_chat_member(chat_id) and left_at is null);
create policy messages_select on public.messages for select to authenticated using (private.is_chat_member(chat_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.is_chat_member(chat_id));

-- ---------- права ----------
revoke all on public.profiles, public.chats, public.chat_members, public.messages from anon, authenticated;
grant select on public.profiles, public.chats, public.chat_members, public.messages to authenticated;
grant insert (id, username, display_name) on public.profiles to authenticated;
grant update (username, display_name, avatar_path, bio) on public.profiles to authenticated;
grant insert (chat_id, sender_id, body, file_path, file_name, file_type, file_size) on public.messages to authenticated;

grant usage on schema private to authenticated;
revoke all on function private.is_chat_member(uuid) from public;
grant execute on function private.is_chat_member(uuid) to authenticated;
revoke all on function private.on_message_insert() from public;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
revoke all on function public.open_direct_chat(uuid) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.open_direct_chat(uuid), public.create_group(text, uuid[]),
  public.add_group_members(uuid, uuid[]), public.leave_group(uuid) to authenticated;

-- ---------- сообщения в реальном времени ----------
alter publication supabase_realtime add table public.messages, public.chat_members;

-- ---------- хранилище фото и файлов (до 20 МБ, доступ только участникам чата) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520);

create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and private.is_chat_member(((storage.foldername(name))[1])::uuid));
create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and private.is_chat_member(((storage.foldername(name))[1])::uuid));

-- ---------- аватарки (видны всем по ссылке, загружать можно только в свою папку) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png']);

create policy avatars_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
