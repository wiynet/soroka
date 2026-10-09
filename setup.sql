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

-- ---------- администраторы и коллекционные (NFT) юзернеймы ----------
create table private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
-- Назначить администратора: подставьте почту его аккаунта и раскомментируйте.
-- insert into private.admins (user_id) select id from auth.users where lower(email) = 'ПОЧТА_АДМИНА';

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()));
$$;

create table public.collectible_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{1,32}$'),
  owner_id uuid references public.profiles(id) on delete set null,
  granted_by uuid,
  granted_at timestamptz not null default now()
);
create index collectible_usernames_owner_idx on public.collectible_usernames(owner_id);
alter table public.collectible_usernames enable row level security;
create policy collectibles_select on public.collectible_usernames for select to authenticated using (true);
revoke all on public.collectible_usernames from anon, authenticated;
grant select on public.collectible_usernames to authenticated;

-- обычный юзернейм не может совпадать с коллекционным
create function private.check_username_free() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.collectible_usernames where username = new.username) then
    raise exception 'username is reserved' using errcode = '23505';
  end if;
  return new;
end;
$$;
create trigger profiles_username_free before insert or update of username on public.profiles
for each row execute function private.check_username_free();

create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where username = lower(u))
     and not exists (select 1 from public.collectible_usernames where username = lower(u));
$$;

create function public.admin_grant_username(p_name text, p_owner text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n text := lower(btrim(coalesce(p_name, '')));
  o uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if n !~ '^[a-z0-9_]{1,32}$' then raise exception 'bad name'; end if;
  select id into o from public.profiles where username = lower(btrim(coalesce(p_owner, '')));
  if o is null then raise exception 'user not found'; end if;
  if exists (select 1 from public.profiles where username = n) then raise exception 'name in use'; end if;
  insert into public.collectible_usernames (username, owner_id, granted_by)
  values (n, o, auth.uid())
  on conflict (username) do update
    set owner_id = excluded.owner_id, granted_by = excluded.granted_by, granted_at = now();
end;
$$;

-- «Забрать»: юзернейм остаётся в списке без владельца
create function public.admin_revoke_username(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.collectible_usernames set owner_id = null, granted_by = auth.uid(), granted_at = now()
   where username = lower(btrim(coalesce(p_name, '')));
end;
$$;

revoke all on function private.check_username_free() from public;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_grant_username(text, text) from public, anon;
revoke all on function public.admin_revoke_username(text) from public, anon;
grant execute on function public.is_admin(), public.admin_grant_username(text, text),
  public.admin_revoke_username(text) to authenticated;

-- ======================================================================
-- Баны, галочки, «был в сети», изменение и удаление сообщений, каналы
-- ======================================================================
alter table public.profiles
  add column last_seen_at timestamptz,
  add column banned_at timestamptz,
  add column ban_reason text check (ban_reason is null or char_length(ban_reason) <= 200),
  add column verified boolean not null default false;

alter table public.messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

alter table public.chats
  add column is_channel boolean not null default false,
  add column description text not null default '' check (char_length(description) <= 300);
create index chats_channel_idx on public.chats (is_channel) where is_channel;

-- удалённое сообщение остаётся пустой строкой с отметкой deleted_at
alter table public.messages drop constraint messages_not_empty;
alter table public.messages add constraint messages_not_empty
  check (body <> '' or file_path is not null or deleted_at is not null);

create function private.is_banned() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and banned_at is not null);
$$;

-- забаненный перестаёт быть участником любых чатов
create or replace function private.is_chat_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = c and user_id = (select auth.uid()) and left_at is null
  ) and not private.is_banned();
$$;

-- в канале пишет только его автор
create function private.can_post(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not is_channel or created_by = (select auth.uid()) from public.chats where id = c), false);
$$;

alter policy messages_insert on public.messages
  with check (sender_id = (select auth.uid()) and private.is_chat_member(chat_id) and private.can_post(chat_id));

alter policy profiles_update on public.profiles
  using (id = (select auth.uid()) and banned_at is null)
  with check (id = (select auth.uid()) and banned_at is null);

create function public.touch_presence() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = (select auth.uid()) and banned_at is null;
$$;

create function private.refresh_chat_preview(c uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select body, file_name, sender_id into m from public.messages
   where chat_id = c and deleted_at is null order by id desc limit 1;
  if found then
    update public.chats set last_message_text = left(case when m.body <> '' then m.body else coalesce(m.file_name, 'Файл') end, 140),
           last_message_sender = m.sender_id where id = c;
  else
    update public.chats set last_message_text = null, last_message_sender = null where id = c;
  end if;
end;
$$;

create function public.edit_message(p_id bigint, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  b text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.messages where id = p_id;
  if not found or m.sender_id <> auth.uid() or m.deleted_at is not null
     or not private.is_chat_member(m.chat_id) then
    raise exception 'not allowed';
  end if;
  if char_length(b) > 4000 or (b = '' and m.file_path is null) then raise exception 'bad body'; end if;
  update public.messages set body = b, edited_at = now() where id = p_id;
  perform private.refresh_chat_preview(m.chat_id);
end;
$$;

-- удалить может автор сообщения, создатель группы или канала и администратор
create function public.delete_message(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_id;
  if not found or m.deleted_at is not null or not private.is_chat_member(m.chat_id) then
    raise exception 'not allowed';
  end if;
  if m.sender_id <> auth.uid() and not public.is_admin()
     and not exists (select 1 from public.chats where id = m.chat_id and is_group and created_by = auth.uid()) then
    raise exception 'not allowed';
  end if;
  update public.messages
     set deleted_at = now(), body = '', file_path = null, file_name = null, file_type = null, file_size = null
   where id = p_id;
  perform private.refresh_chat_preview(m.chat_id);
end;
$$;

create function public.create_channel(p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cid uuid;
  t text := btrim(coalesce(p_title, ''));
  d text := btrim(coalesce(p_description, ''));
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  if char_length(t) < 1 or char_length(t) > 64 then raise exception 'bad title'; end if;
  if char_length(d) > 300 then raise exception 'bad description'; end if;
  insert into public.chats (is_group, is_channel, title, description, created_by)
  values (true, true, t, d, me) returning id into cid;
  insert into public.chat_members (chat_id, user_id) values (cid, me);
  return cid;
end;
$$;

create function public.join_channel(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me)
     or not exists (select 1 from public.chats where id = p_chat and is_channel) then
    raise exception 'not allowed';
  end if;
  insert into public.chat_members (chat_id, user_id) values (p_chat, me)
  on conflict (chat_id, user_id) do update set left_at = null, joined_at = now()
  where public.chat_members.left_at is not null;
end;
$$;

create function public.search_channels(q text)
returns table (id uuid, title text, description text, members bigint, joined boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.description,
         (select count(*) from public.chat_members m where m.chat_id = c.id and m.left_at is null),
         exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = (select auth.uid()) and m.left_at is null)
    from public.chats c
   where c.is_channel and (select auth.uid()) is not null and not private.is_banned()
     and char_length(btrim(coalesce(q, ''))) >= 2
     and position(lower(btrim(q)) in lower(c.title)) > 0
   order by 4 desc
   limit 20;
$$;

-- в канал добавлять людей может только автор
create or replace function public.add_group_members(p_chat uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_chat_member(p_chat)
     or not exists (select 1 from public.chats where id = p_chat and is_group
                    and (not is_channel or created_by = auth.uid())) then
    raise exception 'not allowed';
  end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then raise exception 'too many members'; end if;
  insert into public.chat_members (chat_id, user_id)
  select p_chat, p.id from public.profiles p where p.id = any (coalesce(p_members, '{}'::uuid[]))
  on conflict (chat_id, user_id) do update set left_at = null, joined_at = now()
  where public.chat_members.left_at is not null;
end;
$$;

-- open_direct_chat и create_group в рабочей базе дополнительно отклоняют забаненных:
-- в начало каждой добавлена проверка private.is_banned().

create function public.admin_set_ban(p_user uuid, p_banned boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if exists (select 1 from private.admins where user_id = p_user) then raise exception 'cannot ban admin'; end if;
  update public.profiles
     set banned_at = case when p_banned then now() else null end,
         ban_reason = case when p_banned then nullif(left(btrim(coalesce(p_reason, '')), 200), '') else null end
   where id = p_user;
  if not found then raise exception 'user not found'; end if;
end;
$$;

create function public.admin_set_verified(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.profiles set verified = coalesce(p_on, false) where id = p_user;
  if not found then raise exception 'user not found'; end if;
end;
$$;

create function public.admin_stats() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'banned', (select count(*) from public.profiles where banned_at is not null),
    'online', (select count(*) from public.profiles where last_seen_at > now() - interval '2 minutes'),
    'messages', (select count(*) from public.messages where deleted_at is null),
    'groups', (select count(*) from public.chats where is_group and not is_channel),
    'channels', (select count(*) from public.chats where is_channel));
end;
$$;

revoke all on function private.is_banned() from public;
revoke all on function private.can_post(uuid) from public;
revoke all on function private.refresh_chat_preview(uuid) from public;
grant execute on function private.is_banned(), private.can_post(uuid) to authenticated;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.edit_message(bigint, text) from public, anon;
revoke all on function public.delete_message(bigint) from public, anon;
revoke all on function public.create_channel(text, text) from public, anon;
revoke all on function public.join_channel(uuid) from public, anon;
revoke all on function public.search_channels(text) from public, anon;
revoke all on function public.admin_set_ban(uuid, boolean, text) from public, anon;
revoke all on function public.admin_set_verified(uuid, boolean) from public, anon;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.touch_presence(), public.edit_message(bigint, text), public.delete_message(bigint),
  public.create_channel(text, text), public.join_channel(uuid), public.search_channels(text),
  public.admin_set_ban(uuid, boolean, text), public.admin_set_verified(uuid, boolean), public.admin_stats()
  to authenticated;

-- ======================================================================
-- Сорочки: валюта мессенджера. Баланс видят владелец и администраторы.
-- ======================================================================
create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null,
  reason text check (reason is null or char_length(reason) <= 200),
  granted_by uuid,
  created_at timestamptz not null default now()
);
create index coin_ledger_user_idx on public.coin_ledger (user_id, id desc);

alter table public.wallets enable row level security;
alter table public.coin_ledger enable row level security;
create policy wallets_select on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy ledger_select on public.coin_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke all on public.wallets, public.coin_ledger from anon, authenticated;
grant select on public.wallets, public.coin_ledger to authenticated;

-- выдать (плюс) или списать (минус) сорочки; возвращает новый баланс
create function public.admin_grant_coins(p_user uuid, p_amount bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nb bigint;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then raise exception 'bad amount'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance + p_amount into nb from public.wallets where user_id = p_user for update;
  if nb < 0 then raise exception 'insufficient'; end if;
  update public.wallets set balance = nb, updated_at = now() where user_id = p_user;
  insert into public.coin_ledger (user_id, amount, balance_after, reason, granted_by)
  values (p_user, p_amount, nb, nullif(left(btrim(coalesce(p_reason, '')), 200), ''), auth.uid());
  return nb;
end;
$$;
revoke all on function public.admin_grant_coins(uuid, bigint, text) from public, anon;
grant execute on function public.admin_grant_coins(uuid, bigint, text) to authenticated;
-- в рабочей базе admin_stats дополнительно возвращает 'coins': сумму всех балансов.

-- ======================================================================
-- Подарки, премиум, ответы на сообщения, отметки «прочитано», значок админа
-- ======================================================================
alter table public.profiles
  add column premium_until timestamptz,
  add column name_hue smallint check (name_hue is null or name_hue between 0 and 359),
  add column is_admin boolean not null default false; -- только для значка; права проверяются по private.admins
update public.profiles p set is_admin = true from private.admins a where a.user_id = p.id;

alter table public.messages add column reply_to bigint references public.messages(id) on delete set null;
grant insert (reply_to) on public.messages to authenticated;
alter table public.chat_members add column last_read_id bigint not null default 0;

-- описание: до 200 символов всем, до 500 с премиумом
alter table public.profiles drop constraint profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 500);

create function private.is_premium(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = u and premium_until > now());
$$;

create function private.check_bio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(new.bio) > 200 and not coalesce(new.premium_until > now(), false) then
    raise exception 'bio too long' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger profiles_bio_limit before insert or update of bio on public.profiles
for each row execute function private.check_bio();

-- ответ можно дать только на сообщение из того же чата
create or replace function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if new.reply_to is not null and not exists (
       select 1 from public.messages where id = new.reply_to and chat_id = new.chat_id and deleted_at is null) then
    new.reply_to := null;
  end if;
  update public.chats
     set last_message_at = new.created_at,
         last_message_text = left(case when new.body <> '' then new.body else coalesce(new.file_name, 'Файл') end, 140),
         last_message_sender = new.sender_id
   where id = new.chat_id;
  return new;
end;
$$;

create function public.mark_read(p_chat uuid, p_message bigint) returns void
language sql security definer set search_path = '' as $$
  update public.chat_members
     set last_read_id = p_message
   where chat_id = p_chat and user_id = (select auth.uid()) and left_at is null
     and last_read_id < p_message
     and not private.is_banned()
     and exists (select 1 from public.messages where id = p_message and chat_id = p_chat);
$$;

create function private.spend(u uuid, cost bigint, why text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare nb bigint;
begin
  if cost <= 0 then raise exception 'bad amount'; end if;
  insert into public.wallets (user_id) values (u) on conflict (user_id) do nothing;
  select balance - cost into nb from public.wallets where user_id = u for update;
  if nb < 0 then raise exception 'insufficient'; end if;
  update public.wallets set balance = nb, updated_at = now() where user_id = u;
  insert into public.coin_ledger (user_id, amount, balance_after, reason) values (u, -cost, nb, left(why, 200));
  return nb;
end;
$$;

-- премиум: 150 сорочек за 30 дней, повторная покупка продлевает срок
create function public.buy_premium() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  perform private.spend(me, 150, 'Премиум на 30 дней');
  update public.profiles
     set premium_until = greatest(coalesce(premium_until, now()), now()) + interval '30 days'
   where id = me returning premium_until into t;
  return t;
end;
$$;

create function public.set_name_color(p_hue integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_hue is not null and (not private.is_premium(me) or p_hue < 0 or p_hue > 359) then
    raise exception 'premium required';
  end if;
  update public.profiles set name_hue = p_hue where id = me;
end;
$$;

create table public.gift_types (
  id text primary key,
  emoji text not null,
  name text not null,
  price integer not null check (price > 0),
  sort integer not null default 0
);
insert into public.gift_types (id, emoji, name, price, sort) values
  ('bear', '🧸', 'Мишка', 15, 1), ('rose', '🌹', 'Роза', 25, 2), ('cake', '🎂', 'Торт', 50, 3),
  ('rocket', '🚀', 'Ракета', 50, 4), ('magpie', '🐦‍⬛', 'Сорока', 75, 5), ('cup', '🏆', 'Кубок', 100, 6),
  ('gem', '💎', 'Алмаз', 150, 7), ('unicorn', '🦄', 'Единорог', 250, 8);

create table public.gifts (
  id bigint generated always as identity primary key,
  type_id text not null references public.gift_types(id),
  from_id uuid references public.profiles(id) on delete set null,
  to_id uuid not null references public.profiles(id) on delete cascade,
  note text check (note is null or char_length(note) <= 120),
  price_paid integer not null,
  created_at timestamptz not null default now()
);
create index gifts_to_idx on public.gifts (to_id, id desc);

alter table public.gift_types enable row level security;
alter table public.gifts enable row level security;
create policy gift_types_select on public.gift_types for select to authenticated using (true);
create policy gifts_select on public.gifts for select to authenticated using (true);
revoke all on public.gift_types, public.gifts from anon, authenticated;
grant select on public.gift_types, public.gifts to authenticated;

-- купить подарок и подарить; с премиумом скидка 20 %
create function public.send_gift(p_to uuid, p_type text, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.gift_types;
  cost integer;
  who text;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  select * into g from public.gift_types where id = p_type;
  if not found then raise exception 'gift not found'; end if;
  select username into who from public.profiles where id = p_to and banned_at is null;
  if who is null then raise exception 'user not found'; end if;
  cost := case when private.is_premium(me) then ceil(g.price * 0.8)::integer else g.price end;
  perform private.spend(me, cost, 'Подарок «' || g.name || '» для @' || who);
  insert into public.gifts (type_id, from_id, to_id, note, price_paid)
  values (g.id, me, p_to, nullif(left(btrim(coalesce(p_note, '')), 120), ''), cost);
  return (select balance from public.wallets where user_id = me);
end;
$$;

revoke all on function private.is_premium(uuid) from public;
revoke all on function private.check_bio() from public;
revoke all on function private.spend(uuid, bigint, text) from public;
revoke all on function public.mark_read(uuid, bigint) from public, anon;
revoke all on function public.buy_premium() from public, anon;
revoke all on function public.set_name_color(integer) from public, anon;
revoke all on function public.send_gift(uuid, text, text) from public, anon;
grant execute on function public.mark_read(uuid, bigint), public.buy_premium(),
  public.set_name_color(integer), public.send_gift(uuid, text, text) to authenticated;

-- ======================================================================
-- Главные администраторы: только они выдают и снимают админку
-- ======================================================================
alter table private.admins
  add column is_chief boolean not null default false,
  add column revoked_at timestamptz,
  add column granted_by uuid;
-- Назначить главных: подставьте почты и раскомментируйте.
-- update private.admins a set is_chief = true from auth.users u
--  where u.id = a.user_id and lower(u.email) in ('ПОЧТА_1', 'ПОЧТА_2');

alter table public.profiles add column is_chief boolean not null default false; -- только для значка
update public.profiles p set is_chief = true from private.admins a where a.user_id = p.id and a.is_chief;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()) and revoked_at is null);
$$;

create function public.is_chief_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()) and revoked_at is null and is_chief);
$$;

create function public.admin_set_admin(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_chief_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  if exists (select 1 from private.admins where user_id = p_user and is_chief) then raise exception 'chief is fixed'; end if;
  if p_on then
    if exists (select 1 from public.profiles where id = p_user and banned_at is not null) then raise exception 'user is banned'; end if;
    insert into private.admins (user_id, granted_by) values (p_user, auth.uid())
    on conflict (user_id) do update set revoked_at = null, granted_by = excluded.granted_by, added_at = now();
  else
    update private.admins set revoked_at = now(), granted_by = auth.uid() where user_id = p_user and not is_chief;
  end if;
  update public.profiles set is_admin = coalesce(p_on, false) where id = p_user;
end;
$$;
-- в рабочей базе admin_set_ban дополнительно не даёт банить действующих администраторов (revoked_at is null).

revoke all on function public.is_chief_admin() from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.is_chief_admin(), public.admin_set_admin(uuid, boolean) to authenticated;

-- ======================================================================
-- Подарок появляется сообщением в личном чате дарителя и получателя
-- ======================================================================
alter table public.messages
  add column gift_type text references public.gift_types(id),
  add column gift_note text check (gift_note is null or char_length(gift_note) <= 120);
-- В рабочей базе send_gift после записи подарка открывает личный чат (open_direct_chat)
-- и добавляет туда сообщение с gift_type и gift_note; edit_message такие сообщения не меняет.
-- Клиенту запись gift_type не разрешена, поэтому подделать сообщение-подарок нельзя.

-- ======================================================================
-- Обмен подарка на сорочки: возвращается 90 % уплаченного, 10 % — комиссия
-- ======================================================================
alter table public.gifts
  add column sold_at timestamptz,
  add column sold_for integer;
alter table public.messages add column gift_id bigint references public.gifts(id) on delete set null;
-- send_gift в рабочей базе записывает gift_id в сообщение-подарок.

create function public.sell_gift(p_gift bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.gifts;
  nm text;
  gain integer;
  nb bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into g from public.gifts where id = p_gift for update;
  if not found or g.to_id <> me then raise exception 'not allowed'; end if;
  if g.sold_at is not null then raise exception 'already sold'; end if;
  gain := floor(g.price_paid * 0.9)::integer;
  if gain < 1 then raise exception 'nothing to gain'; end if;
  select name into nm from public.gift_types where id = g.type_id;
  update public.gifts set sold_at = now(), sold_for = gain where id = p_gift;
  insert into public.wallets (user_id) values (me) on conflict (user_id) do nothing;
  select balance + gain into nb from public.wallets where user_id = me for update;
  update public.wallets set balance = nb, updated_at = now() where user_id = me;
  insert into public.coin_ledger (user_id, amount, balance_after, reason)
  values (me, gain, nb, 'Продажа подарка «' || coalesce(nm, 'Подарок') || '» (комиссия 10 %)');
  return nb;
end;
$$;
revoke all on function public.sell_gift(bigint) from public, anon;
grant execute on function public.sell_gift(bigint) to authenticated;

-- В рабочей базе set_name_color разрешён не только с премиумом, но и администраторам (public.is_admin()).

-- ======================================================================
-- Реакции: одна на человека на сообщение; снятая реакция хранится как пустая
-- ======================================================================
create table public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  emoji text,
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_chat_idx on public.message_reactions (chat_id);

alter table public.message_reactions enable row level security;
create policy reactions_select on public.message_reactions for select to authenticated
  using (private.is_chat_member(chat_id));
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;

create function public.set_reaction(p_message bigint, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cid uuid;
begin
  select chat_id into cid from public.messages where id = p_message and deleted_at is null;
  if cid is null or me is null or not private.is_chat_member(cid) then raise exception 'not allowed'; end if;
  if p_emoji is not null and p_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👎') then
    raise exception 'bad emoji';
  end if;
  insert into public.message_reactions (message_id, user_id, chat_id, emoji) values (p_message, me, cid, p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, updated_at = now();
end;
$$;
revoke all on function public.set_reaction(bigint, text) from public, anon;
grant execute on function public.set_reaction(bigint, text) to authenticated;

alter publication supabase_realtime add table public.message_reactions;

-- ======================================================================
-- Аккаунт поддержки: к нему ведёт кнопка «Поддержка»
-- ======================================================================
create table public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using (true);
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;

create function public.admin_set_support(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_chief_admin() then raise exception 'not allowed'; end if;
  select id into uid from public.profiles where username = lower(btrim(coalesce(p_username, ''))) and banned_at is null;
  if uid is null then raise exception 'user not found'; end if;
  insert into public.app_settings (key, value) values ('support_user', uid::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;
revoke all on function public.admin_set_support(text) from public, anon;
grant execute on function public.admin_set_support(text) to authenticated;

-- Несколько аккаунтов поддержки: ключ support_users хранит JSON-массив id, человек выбирает, кому написать.
create function public.admin_set_support_team(p_usernames text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; want int := coalesce(array_length(p_usernames, 1), 0);
begin
  if not public.is_chief_admin() then raise exception 'not allowed'; end if;
  if want < 1 or want > 5 then raise exception 'bad count'; end if;
  select array_agg(p.id order by t.ord) into ids
    from unnest(p_usernames) with ordinality as t(name, ord)
    join public.profiles p on p.username = lower(btrim(t.name)) and p.banned_at is null;
  if coalesce(array_length(ids, 1), 0) <> want then raise exception 'user not found'; end if;
  insert into public.app_settings (key, value) values ('support_users', to_json(ids)::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;
revoke all on function public.admin_set_support_team(text[]) from public, anon;
grant execute on function public.admin_set_support_team(text[]) to authenticated;

-- ======================================================================
-- Маркет NFT-юзернеймов (миграция messenger_nft_market в проекте Supabase)
-- ======================================================================
-- Таблицы: nft_listings (лоты: username, seller_id, by_admin, price, status open/sold/cancelled)
--          nft_offers   (предложения цены: listing_id, bidder_id, amount, status)
-- Функции для сайта: admin_list_username, list_my_username, cancel_listing, buy_listing,
--                    make_offer, cancel_offer, answer_offer.
-- Правила: предложение всегда ниже цены лота; сорочки за предложение списываются сразу
-- и возвращаются при отказе, отмене, снятии лота или продаже другому; деньги за лот
-- получает продавец, а за лоты администраторов сорочки никому не начисляются.
-- Полный текст хранится в истории миграций проекта (Database → Migrations).

-- Администратор выдаёт премиум на срок (1, 7, 30 или 365 дней) или снимает его (0).
create function public.admin_grant_premium(p_user uuid, p_days integer) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_days is null or p_days not in (0, 1, 7, 30, 365) then raise exception 'bad period'; end if;
  update public.profiles
     set premium_until = case when p_days = 0 then null
                              else greatest(coalesce(premium_until, now()), now()) + make_interval(days => p_days) end
   where id = p_user
  returning premium_until into t;
  if not found then raise exception 'user not found'; end if;
  return t;
end;
$$;
revoke all on function public.admin_grant_premium(uuid, integer) from public, anon;
grant execute on function public.admin_grant_premium(uuid, integer) to authenticated;

-- ======================================================================
-- Аватарки групп и каналов, владелец и администраторы группы
-- (миграция messenger_group_roles_and_avatars в проекте Supabase)
-- ======================================================================
-- chats.avatar_path, chat_members.is_admin; функции set_chat_admin (только владелец),
-- set_chat_avatar, update_chat, remove_member (владелец и администраторы; администратор
-- не может убрать владельца и другого администратора). В канале пишут владелец и
-- администраторы; удалять чужие сообщения в чате могут они же.

-- Выдача от администратора (сорочки, премиум, NFT-юзернейм, галочка, админка) появляется
-- карточкой в личном чате: миграция messenger_admin_grant_messages. Поля messages.event_kind,
-- event_title, event_note заполняет только сервер (private.post_event), клиенту запись в них закрыта.

-- Push-уведомления: миграция messenger_push_notifications.
--   chat_members.muted — уведомления из чата выключены (меняет public.set_chat_muted).
--   public.push_subscriptions — подписки устройств (public.save_push_subscription), видны только владельцу.
--   private.push_config — VAPID-ключи и секрет вызова; хранится только в базе, клиенту недоступно,
--   читает его лишь функция push через public.push_server_config() (только service_role).
--   Триггер messages_push после вставки сообщения вызывает через pg_net функцию
--   supabase/functions/push (заголовок x-hook-secret); она шлёт уведомления всем участникам,
--   кроме отправителя и тех, у кого чат заглушён.

-- Улучшаемые и NFT-подарки: миграция messenger_nft_gifts.
--   gift_types.supply — тираж (сколько штук можно купить всего), gift_types.upgrade_price — цена улучшения.
--   public.gift_models (модели вида подарка, weight = шанс) и public.gift_backdrops (фоны из двух цветов).
--   gifts.nft_number / nft_model / nft_backdrop / upgraded_at заполняются при улучшении; gifts.granted — выдан
--   администратором и в тираж не входит.
--   public.upgrade_gift(p_gift) — владелец платит upgrade_price, подарок получает следующий номер, случайные модель и фон.
--   public.admin_grant_nft_gift(p_user, p_type, p_model, p_backdrop) — выдача готового NFT-подарка (только администраторы).
--   public.gift_stats() — сколько куплено и улучшено по видам. send_gift проверяет тираж, sell_gift не принимает NFT.
--   Первый такой подарок: «Золото» (id gold), 100 сорочек, тираж 20, улучшение 25, пять моделей.

-- Ещё 20 улучшаемых подарков и надетый NFT: миграция messenger_more_gifts_and_worn_nft.
--   20 видов подарков (по 4 модели, улучшение 25); у «Космоса», «Дракона» и «Короны» тираж 40, 30 и 15.
--   profiles.worn_gift / worn_type / worn_model / worn_backdrop / worn_number — надетый NFT-подарок;
--   пишет их только public.wear_gift(p_gift) (null снимает), клиенту доступно чтение.

-- Передача подарков и аукцион: миграции messenger_gift_transfer_and_auction, messenger_gift_hidden_and_cron.
--   gift_types.hidden — вид скрыт из магазина (12 из 20 новых подарков); у всех видимых подарков задан тираж supply.
--   public.transfer_gift(p_gift, p_to) — бесплатная передача любого своего подарка; карточка в личном чате.
--   public.gift_auctions — торги за NFT-подарки: start_gift_auction(p_gift, p_price, p_hours из 1/6/24/72),
--   bid_gift_auction(p_auction, p_amount) (шаг 5 %, ставка замораживается, перебитая возвращается, ставка в последние
--   2 минуты продлевает торги), cancel_gift_auction (пока нет ставок). Итоги подводит private.settle_gift_auction:
--   подарок уходит победителю, продавец получает 90 %. Запуск: pg_cron раз в минуту и public.settle_gift_auctions() с клиента.

-- Старые обычные подарки (Мишка, Роза, Торт, Ракета, Сорока, Кубок, Алмаз, Единорог) без тиража и без улучшения:
-- миграция messenger_classic_gifts_unlimited.

-- Надеть NFT-подарок на профиль можно только с премиумом: миграция messenger_wear_gift_premium_only
-- (wear_gift отклоняет запрос без премиума; клиент не показывает надетый подарок, если премиум истёк).

-- Голосовые, альбомы, пересылка, закреп, счётчик непрочитанных: миграция messenger_voice_forward_pin_unread_albums.
--   messages.voice_secs — голосовое сообщение (длительность), messages.album_id — несколько фото одним сообщением,
--   messages.forwarded_from — чьё сообщение переслали (ставит только сервер: public.forward_message(p_message, p_chat, p_file_path),
--   файл клиент заранее копирует в папку нового чата).
--   chats.pinned_message + public.pin_message(p_chat, p_message): в личном чате закрепляет любой, в группе владелец и админы.
--   public.unread_counts() — число непрочитанных по моим чатам. Таблица chats добавлена в публикацию supabase_realtime.
--   «Печатает…» идёт через Realtime Broadcast (канал typing:<id чата>) и в базе не хранится.

-- Автоподписка на канал новостей «Soroka updates»: миграция messenger_auto_subscribe_updates_channel.
--   private.updates_channel() хранит id канала; триггер profiles_subscribe_updates подписывает каждый новый профиль,
--   существующие аккаунты подписаны разово. Отписаться человек может сам, повторно его не подписывает.

-- Инструменты подарков, бонусы премиума, открытые и частные чаты, комментарии и просмотры:
-- миграция messenger_gift_tools_premium_bonuses_public_chats_comments.
--   gifts.hidden + set_gift_hidden (скрытый подарок видит только владелец: политика gifts_select);
--   delete_gift (помечает sold_at, sold_for = 0); cancel_gift_auction снимает лот в любой момент и возвращает ставку.
--   Новые фоны (sun, rose, mint, sky, lava, midnight, pearl) и по две новые модели у девяти улучшаемых подарков.
--   Премиум: profiles.bonus_coins_at / bonus_gift_at, claim_premium_coins() (50 сорочек) и claim_premium_gift()
--   (случайный тиражный подарок, price_paid = 0) раз в 30 дней; profiles.hide_seen + set_hide_seen, touch_presence
--   не пишет last_seen_at, пока время скрыто.
--   Чаты: chats.username, chats.is_private (группы по умолчанию частные: триггер chats_defaults), chats.invite_code;
--   set_chat_access (владелец), chat_invite (владелец и админы), invite_info, join_by_invite, search_public_chats;
--   join_channel пускает только в открытые чаты.
--   Каналы: public.post_comments + add_comment / delete_comment; post_stats(ids) — комментарии и просмотры
--   (просмотр = подписчик, дочитавший до поста).

-- VPN для премиума: миграция messenger_premium_vpn. Ссылка лежит в private.vpn_config (в репозитории её нет),
-- отдаёт её public.premium_vpn() только при действующем премиуме; меняет главный админ через public.admin_set_vpn(p_link).

-- Бот поддержки: миграция messenger_support_bot. public.support_tickets (запрос, статус open/answered/closed, ответ),
-- create_ticket(p_body) — не больше пяти открытых запросов на человека; answer_ticket(p_id, p_answer) — только
-- администраторы, пустой ответ закрывает запрос; support_seen() отмечает ответы прочитанными. Свои запросы видит
-- автор, все запросы видят администраторы.

-- Комментарии канала можно выключить: миграция messenger_channel_comments_toggle
-- (chats.comments_off, set_chat_comments(p_chat, p_on) для владельца и админов; add_comment отклоняет запись).

-- Чёрный список: миграция messenger_user_blocks. public.user_blocks (свои записи видит только заблокировавший),
-- block_user(p_user, p_on). Заблокированный не может писать в личный чат (private.can_post), дарить и передавать
-- подарки (send_gift, transfer_gift отвечают «user not found»). В группах и каналах блокировка не действует.

-- Закреплённые NFT-подарки: миграция messenger_pinned_gifts. gifts.pinned_at + pin_gift(p_gift, p_on), не больше шести;
-- закреп снимается при передаче, продаже с аукциона, скрытии и удалении.

-- Рейтинг и номера аккаунтов: миграции messenger_rating_and_user_ids, messenger_profiles_num_seq_grant.
--   profiles.num — номер аккаунта (ID) по порядку регистрации с 1001, выдаёт счётчик profiles_num_seq.
--   profiles.rating_points — потраченные сорочки; пополняет триггер coin_ledger_rating (возвраты вычитаются,
--   операции администратора не считаются). Уровень на клиенте: floor(sqrt(очки / 25)).

-- messenger_hidden_gifts_owner_only: скрытый подарок видит только владелец (админы больше не видят чужие скрытые)
alter policy gifts_select on public.gifts using ((not hidden) or (to_id = (select auth.uid())));
