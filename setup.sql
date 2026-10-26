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

-- messenger_gift_card_by_link: public.gift_card(p_id, p_type, p_number) — карточка подарка по ссылке.
-- Открывает подарок по id или по «тип-номер» (Star-1). Скрытый подарок чужому отдаётся без владельца,
-- отправителя, подписи и цены. SECURITY DEFINER, search_path = '', execute только для authenticated.

-- messenger_profile_channel: канал в профиле.
-- profiles.pinned_chat uuid → chats(id) on delete set null (читается только через функцию, отдельный grant не нужен).
-- public.set_profile_channel(p_chat): закрепить открытый канал, где вызывающий владелец или админ; null — убрать.
-- public.profile_channel(p_user): канал для показа в профиле (название, подписчики, последний пост);
--   пусто, если канал стал частным или человек им больше не управляет.
-- Обе SECURITY DEFINER, search_path = '', execute только для authenticated.

-- messenger_stories: истории (публикации в профиле).
-- Таблицы public.stories (user_id, file_path, caption, created_at, deleted_at) и public.story_views (story_id, user_id);
-- RLS включён, прямого доступа нет — только через функции (SECURITY DEFINER, search_path = '', execute для authenticated):
--   story_quota()            — лимит и сколько использовано за 7 дней: 1 в неделю, с премиумом 3 (удалённые тоже считаются);
--   add_story(path, caption) — путь только вида <uid>/story-<число>.(webp|jpg|png) в бакете avatars, подпись до 200 знаков;
--   delete_story(id)         — владелец или админ (помечает deleted_at);
--   user_stories(user)       — публикации человека со счётчиком просмотров и признаком «я видел»;
--   view_story(id)           — засчитать просмотр (свои не считаются, повторные тоже).

-- messenger_stories_video_and_expiry: видео в историях и срок жизни 24 часа.
-- Открытый бакет storage `stories` (картинки и видео mp4/webm/mov до 20 МБ), политика stories_upload: загрузка только в папку <uid>/.
-- stories.kind ('image' | 'video') и stories.bucket ('stories' у новых, 'avatars' у самых первых).
-- add_story: вид определяется по расширению файла; active_stories(user) — истории не старше 24 часов
-- (вместе с kind и bucket); user_stories и view_story тоже учитывают только последние сутки.
-- Недельный лимит прежний: 1 история, с премиумом 3.

-- messenger_media_preview_labels: подпись последнего сообщения в списке чатов.
-- private.media_label(...) : «Фото», «Фото (3)», «Видео», «Видео (2)», «Фото и видео (5)», «Голосовое сообщение»,
--   у файла — его название; текст сообщения (подпись) важнее ярлыка.
-- private.on_message_insert и private.refresh_chat_preview считают фото и видео одного альбома (album_id) вместе.
-- Push-функция: «📷 Фото», «🎥 Видео», «🎤 Голосовое сообщение», «📎 название файла».

-- messenger_story_users: public.story_users() — id людей, у которых сейчас есть действующая (моложе 24 часов) история;
-- по нему в списке чатов рисуется синяя рамка вокруг аватарки. SECURITY DEFINER, execute только для authenticated.

-- messenger_story_feed: public.story_feed() — лента историй над списком чатов:
-- свои истории и истории тех, с кем есть личный чат (user_id, сколько историй, все ли просмотрены, время последней).
-- SECURITY DEFINER, search_path = '', execute только для authenticated.

-- messenger_story_views_owner_only: просмотры истории видит только автор.
-- active_stories и user_stories отдают число просмотров только автору (остальным null);
-- public.story_viewers(story_id) — кто и когда посмотрел, только для автора истории.

-- messenger_story_expiry_roles: срок жизни истории по ролям.
-- stories.expires_at (по умолчанию now() + 24 часа); все выборки историй смотрят на expires_at > now().
-- public.post_story(path, caption, expires): обычный аккаунт — всегда 24 часа и 1 история в неделю;
--   премиум — срок до 7 дней, 3 истории в неделю; админ — срок до года, без лимита по количеству.
--   Сервер сам обрезает срок по правам, клиенту не доверяет. add_story оставлена для старых вкладок (24 часа).
-- public.story_quota() дополнительно отдаёт admin и max_days; public.my_story_expiry() — сроки своих историй.

-- messenger_video_notes: «кружки» — круглые видеосообщения до минуты.
-- messages.video_secs integer (0..60), grant select и insert для authenticated.
-- private.on_message_insert: video_secs сохраняется только у видеофайла; в списке чатов такое сообщение
-- подписано «Видеосообщение». refresh_chat_preview и forward_message тоже знают про video_secs.

-- messenger_story_likes_replies: лайки и ответы на истории.
-- story_views.liked; messages.story_id (на какую историю это ответ), grant select для authenticated.
-- like_story(id, on)      — поставить или снять лайк (свою лайкнуть нельзя);
-- reply_story(id, text)   — ответ уходит обычным сообщением в личный чат с автором (уважает блокировки);
-- story_list(user)        — истории человека: просмотры и лайки видит только автор, «мой лайк» — каждый про себя;
-- story_audience(id)      — кто посмотрел и кто лайкнул, только для автора; story_owner(id) — чья история.

-- messenger_storage_cleanup: автоочистка хранилища (раз в сутки, pg_cron 'storage-cleanup' в 03:17 UTC).
-- private.run_storage_cleanup() вызывает серверную функцию cleanup (supabase/functions/cleanup) с тем же секретом, что у push.
-- public.cleanup_candidates(limit) и public.cleanup_mark(kind, ids) доступны только service_role.
-- Удаляются файлы: 1) исчезнувших (спустя час) и удалённых историй — stories.purged_at;
--   2) удалённых сообщений — у сообщения обнуляется file_path;
--   3) видео и «кружков» старше 6 месяцев — сообщение остаётся, файл убирается, пустой текст заменяется пометкой.
-- Фото, голосовые и обычные файлы не трогаются.

-- messenger_profile_background: цветной фон профиля для премиума.
-- profiles.profile_bg ('blue' | 'sky' | 'pink' | 'red' | 'green' | null), grant select для authenticated.
-- public.set_profile_bg(color): поставить цвет может только аккаунт с премиумом, убрать (null) — любой.
-- На экране фон виден, только пока премиум действует; надетый NFT-подарок перекрывает его своим фоном.

-- messenger_profile_background_admin_nft: админам доступны все фоны NFT-подарков как фон профиля.
-- profiles.profile_bg дополнительно принимает 'nft:<id из gift_backdrops>'; set_profile_bg разрешает такое значение
-- только админам, а пять обычных цветов — премиуму и админам.

-- messenger_delete_chat: удаление группы или канала.
-- chats.deleted_at; public.delete_chat(chat) — может владелец (или админ сайта), кроме канала обновлений.
-- Чат закрывается для всех: участники выводятся (left_at), он становится частным без юзернейма и ссылки-приглашения,
-- сообщения помечаются удалёнными, закрепление канала в профилях снимается. Файлы потом убирает автоочистка.

-- messenger_devices_and_password_check: устройства и смена почты/пароля.
-- public.my_sessions()       — где выполнен вход (из auth.sessions), с признаком «это устройство» и «можно отключить»;
-- public.kick_session(id)    — отключить устройство: только то, что вошло ПОЗЖЕ текущего, либо более старое,
--                              если оно молчит 30 дней. Сеанс помечается истёкшим, ключи обновления отзываются;
-- public.session_ok()        — жив ли текущий сеанс (сайт на отключённом устройстве сам выходит из аккаунта);
-- public.check_my_password() — проверка текущего пароля, наружу только «да/нет», не больше 5 ошибок за 15 минут
--                              (private.pw_fails). Хеш пароля наружу не отдаётся.

-- messenger_giveaways: розыгрыши сорочек в группах и каналах.
-- Таблицы public.giveaways (chat_id, creator_id, prize, fee, winners, ends_at, status open|done|refunded, message_id)
-- и public.giveaway_entries (giveaway_id, user_id, won); messages.giveaway_id (grant select для authenticated).
-- public.create_giveaway(chat, prize, winners, minutes) — устроить может тот, кто может писать в чате;
--     со счёта списывается приз + 20 % комиссии (округление вверх); приз 10…100 000, победителей 1…10,
--     срок от 5 минут до 7 дней, не больше трёх открытых розыгрышей на чат;
-- public.join_giveaway(id)      — кнопка «Участвовать»: только участники чата, организатор не участвует;
-- public.giveaway_info(ids)     — данные для карточек: приз, срок, число участников, участвую ли я, победители;
-- private.settle_due_giveaways() — итоги: случайные победители среди тех, кто всё ещё в чате и не заблокирован,
--     приз делится поровну (остаток — первому); если никто не участвовал, приз (без комиссии) возвращается организатору;
-- public.settle_giveaways()     — то же по запросу с сайта; pg_cron 'settle-giveaways' подводит итоги раз в минуту.

-- messenger_chat_list_actions: меню чата в списке (правая кнопка / долгое нажатие): закрепить, архив, удалить.
-- chat_members: pinned_at, archived, hidden_at, cleared_before — личные отметки участника; grant select на них НЕТ,
-- свои отметки отдаёт public.my_chat_flags(), поэтому другие участники их не видят.
-- public.set_chat_pinned(chat, on)   — закрепить чат вверху списка (не больше пяти; закрепление достаёт чат из архива);
-- public.set_chat_archived(chat, on) — убрать в архив / вернуть (архив снимает закрепление);
-- public.hide_chat(chat)             — «удалить у себя», только личный чат: он пропадает из списка, пока в нём не появится
--                                      новое сообщение, а сообщения с id <= cleared_before мне больше не показываются;
-- public.wipe_direct_chat(chat)      — «удалить у обоих», только личный чат и только его участник: все сообщения помечаются
--                                      удалёнными (файлы потом убирает автоочистка), чат скрывается у обоих.
-- Для групп и каналов в том же меню: «Покинуть/Отписаться» (leave_group) и «Удалить у всех» (delete_chat, владелец).

-- messenger_fee_receiver: все комиссии сайта зачисляются одному аккаунту.
-- private.fee_config(receiver) — id аккаунта-получателя (сейчас это @user; хранится id, а не юзернейм).
-- private.pay_fee(fee, why)    — зачисляет комиссию получателю и пишет строку «Комиссия: …» в его историю сорочек.
-- Вызывается там, где сайт удерживает комиссию:
--   public.sell_gift            — 10 % при обмене подарка на сорочки (цена минус то, что получил продавец);
--   private.settle_gift_auction — 10 % с проданного на аукционе подарка;
--   public.create_giveaway      — 20 % сверх приза (не возвращается, даже если никто не участвовал).
-- Обычные покупки (премиум, подарки, улучшения, юзернеймы) комиссией не считаются и получателю не идут.

-- messenger_giveaway_entrants: список участников розыгрыша.
-- public.giveaway_entrants(id) — кто нажал «Участвовать» и когда (joined_at), у победителей — сколько выиграли.
-- Доступно только владельцу и админам чата, где идёт розыгрыш (private.chat_role); остальным — 'not allowed'.

-- messenger_delete_my_account: удаление своего аккаунта (Настройки → Безопасность).
-- profiles.deleted_at; public.delete_my_account(password):
--   * нужен текущий пароль (check_my_password, не больше 5 ошибок за 15 минут); главный админ удалить себя не может;
--   * при открытых аукционах, продажах, предложениях и розыгрышах — отказ 'open deals';
--   * свои группы и каналы переходят старшему админу или участнику, пустые закрываются; из остальных групп человек выходит;
--   * профиль обезличивается («Удалённый аккаунт», случайный юзернейм deleted_…), истории и push отключаются,
--     коллекционные юзернеймы освобождаются, аккаунт помечается заблокированным с причиной «Аккаунт удалён владельцем»;
--   * вход закрывается: сеансы завершены, пароль затёрт, почта в auth заменена на deleted+<id>@deleted.invalid,
--     поэтому прежний адрес можно использовать для новой регистрации.
-- Строки физически не удаляются; сообщения, отправленные другим людям, остаются у них без имени автора.
-- Тексты пользовательского соглашения, политики конфиденциальности и правил лежат в index.html (DOCS), в базе их нет.

-- messenger_reports: жалобы на людей, группы/каналы и сообщения.
-- public.reports (reporter_id, kind user|chat|message, target_user, target_chat, target_message, reason, comment,
--   snapshot — текст сообщения / название чата на момент жалобы, status open|closed, resolution, closed_by).
-- RLS: читать могут только админы сайта; вставка и правка — только через функции.
-- public.send_report(kind, user, chat, message, reason, comment): причины spam, fraud, abuse, violence, adult, child,
--   fake, personal, illegal, other (для other комментарий обязателен); нельзя жаловаться на себя и своё сообщение;
--   на сообщение — только участнику чата; не больше 20 жалоб в сутки; повтор той же открытой жалобы — 'duplicate'.
-- public.close_report(id, note) — закрыть жалобу, только админ сайта.

-- messenger_site_gate_ip_limit: три защиты от наплыва и накрутки.
-- 1) Жалобы: send_report принимает не больше 3 жалоб в сутки с одного аккаунта.
-- 2) Автозакрытие сайта. private.site_state (closed, reason, auto, opened_at, limit_n = 50, window_min = 5),
--    private.site_entries (user_id, at) — по строке на человека, время последнего входа.
--    public.site_gate()   — вызывается при входе: отмечает человека; если за window_min минут вошло больше limit_n
--                           разных людей, сайт закрывается, а всем админам уходит личное сообщение
--                           (private.notify_admins, пишет главный админ; чат создаёт private.direct_chat);
--    public.site_status() — состояние сайта (для экрана «Сайт закрыт», плашки админа и админки);
--    public.admin_set_site_closed(closed) — открыть или закрыть вручную, только админ сайта. После открытия счёт входов
--                           начинается заново (opened_at), поэтому сайт не закрывается тут же повторно.
--    private.is_banned() теперь возвращает true и тогда, когда сайт закрыт, а человек не админ: чаты и действия
--    недоступны на уровне базы, а не только на экране. Поддержка (create_ticket) при этом работает.
--    Лимит и окно меняются в private.site_state (limit_n, window_min).
-- 3) Не больше 10 аккаунтов с одного IP. private.signup_ips (user_id, ip); триггер profiles_signup_ip
--    (private.check_signup_ip) берёт IP из сеанса входа (auth.sessions.ip), при его отсутствии — из заголовков запроса,
--    и отклоняет создание профиля с ошибкой 'too many accounts from this address'. Удалённые аккаунты тоже считаются.
--    Для уже существующих аккаунтов IP взят из их первого сеанса.

-- messenger_site_gate_floating_limit: плавающий лимит автозакрытия сайта.
-- private.site_limit() = большее из двух: базовый limit_n (50) или треть от числа людей, заходивших за последние 7 дней.
-- В расчёт идут только незаблокированные аккаунты старше суток, чтобы свежие аккаунты самого наплыва не поднимали лимит.
-- site_gate() и site_status() используют это значение; в админке показывается действующий лимит.

-- messenger_admin_delete_gift: главный админ может удалить чужой NFT-подарок.
-- public.admin_delete_gift(gift) — только главный админ (is_chief_admin) и только коллекционный (NFT) подарок:
-- подарок снимается с профиля владельца и помечается удалённым (sold_at, sold_for = 0), как при обычном удалении;
-- если он стоял на аукционе, аукцион отменяется, ставка возвращается покупателю.

-- messenger_transfer_fee_and_upgrade_to_fee_receiver:
-- public.transfer_gift — передача подарка другому человеку теперь стоит 25 сорочек (private.spend),
--   они зачисляются получателю комиссий (private.pay_fee, сейчас @user); без 25 сорочек передать нельзя ('insufficient').
-- public.upgrade_gift — плата за улучшение подарка тоже зачисляется получателю комиссий.

-- mestario_rebrand_texts: проект переименован в Mestario, валюта — Mest (не склоняется).
-- private.coins_text(n) теперь возвращает «N Mest»; тексты в create_giveaway и delete_my_account обновлены.
-- Старые записи истории и сообщения пользователей не менялись. Подарок «Сорока» (magpie) — это птица, его имя оставлено.

-- mestario_badges_and_stickers (+ mestario_sticker_message_trigger, mestario_messages_not_empty_sticker):
-- Значок премиума. profiles.badge_style: 'форма-цвет' (формы tick|star|heart|crown|diamond|bolt|flame|moon,
--   цвета violet|blue|sky|green|gold|orange|red|pink|white|rainbow) или 'photo' + profiles.badge_path (своя картинка
--   в бакете avatars, <id>/badge-*.webp). public.set_badge(style, path) — только премиум и админы; null — обычный значок.
--   Пока надет NFT-подарок, на сайте вместо значка премиума показывается он (подтверждённая галочка остаётся).
-- Стикеры. public.sticker_packs (owner_id, title, deleted_at), public.stickers (pack_id, file_path, position, deleted_at),
--   public.user_sticker_packs (user_id, pack_id) — добавленные к себе наборы. Читать могут все вошедшие, менять — только функции:
--   create_sticker_pack(title) (не больше 20 своих), rename_sticker_pack, delete_sticker_pack, add_sticker(pack, path)
--   (путь только в своей папке <id>/st/..., не больше 50 в наборе), delete_sticker, install_sticker_pack(pack, on) (до 50 наборов).
--   Картинки лежат в публичном бакете avatars.
-- Сообщение-стикер: клиент передаёт messages.sticker_id, триггер on_message_insert подставляет sticker_path сам
--   (чужой путь подсунуть нельзя), очищает текст и пишет в список чатов «Стикер».
--   Ограничение messages_not_empty допускает сообщение, где есть только стикер.

-- mestario_badges_gem_only: значки премиума упрощены.
-- profiles.badge_style: 'gem-tick' (кристальная галочка, по умолчанию) | 'gem-crown' (кристальная корона) | 'photo'.
-- 'photo' (своя картинка) — только админы сайта; set_badge отклоняет его остальным ('admins only').
-- Прежние формы и цвета убраны, у кого они были — значок сброшен на стандартный.

-- mestario_premium_crown_once: корона в подарок за премиум.
-- private.premium_crowns (user_id, gift_id) — кому уже выдана; private.give_premium_crown(u) выдаёт обычную (не улучшенную)
-- «Корону» (granted = true, тираж магазина не занимает) и пишет об этом в личный чат от получателя комиссий.
-- Триггер profiles_premium_crown срабатывает, когда у человека появляется или продлевается премиум, но корона выдаётся
-- только один раз на аккаунт. Улучшить её можно обычным upgrade_gift. Всем, у кого премиум уже был, корона выдана при миграции.

-- mestario_premium_crown_saved: сообщение о короне за премиум приходит в «Избранное» самого человека
-- (отправитель — он сам), уже выданные 9 сообщений перенесены туда же, последние сообщения прежних чатов пересчитаны.
-- На сайте карточка подарка в «Избранном» подписана «Вам подарок от Mestario».

-- mestario_hide_badges: profiles.hide_badges — спрятать свои значки у ника (корону премиума и галочку).
-- public.set_hide_badges(on): включить может премиум или админ, выключить — любой. Надетый NFT при этом остаётся виден.

-- mestario_hide_badges: свои значки у ника можно скрыть нажатием на них.
-- profiles.hide_crown / hide_tick (grant select); public.set_badge_hidden(kind 'crown'|'tick', hide).
-- Скрытый значок другие не видят, а владелец видит его полупрозрачным и может вернуть тем же нажатием.
-- Прежняя общая настройка hide_badges (Настройки → Конфиденциальность) убрана с сайта; колонка осталась без использования.

-- mestario_polls + mestario_poll_answers: опросы в группах и каналах.
-- public.polls (chat_id, creator_id, question, options jsonb, multiple, closed_at); messages.poll_id (grant select).
-- public.poll_answers (poll_id, user_id, options int[]) — голос одной строкой, пустой массив = голос отозван.
-- create_poll(chat, question, options[], multiple) — 2–10 вариантов, только кто может писать в чате;
-- vote_poll(poll, options[]); close_poll(poll) — автор или админ чата; poll_results(ids[]) — итоги и мой выбор.
-- (Таблица poll_votes из первой версии не используется.)

-- mestario_scheduled_messages (+ cron 'send-scheduled' раз в минуту, + флаг messages.scheduled):
-- public.scheduled_messages; schedule_message(chat, body, at) — от 30 секунд до года вперёд, до 50 в очереди;
-- cancel_scheduled(id); private.send_due_scheduled() отправляет вовремя, если человек всё ещё может писать в чат.
-- В «Избранном» это напоминание: push-функция присылает его уведомлением «⏰ Напоминание».

-- mestario_referrals: приглашения. Ссылка ?ref=юзернейм; после регистрации сайт вызывает claim_referral(username)
-- (в течение суток после создания профиля, один раз). Оба получают по 25 Mest, если адреса регистрации разные
-- и у пригласившего меньше 50 наград. private.referrals; profiles.ref_by; my_referrals() — статистика.

-- mestario_pin_code: ПИН-код. private.user_pins (хеш), private.pin_sessions (сеансы, где ПИН введён), private.pin_fails.
-- pin_status(), verify_pin(pin) (5 ошибок за 15 минут), set_pin(new, old_pin, password) — поставить, сменить
-- или убрать (new = null) по старому ПИН или паролю. Пока ПИН на устройстве не введён, private.is_banned()
-- возвращает true — сервер закрывает чаты и действия, а не только экран.

-- mestario_scheduled_flag_and_backups: резервные копии. Закрытый бакет backups, функция supabase/functions/backup,
-- private.run_backup() и pg_cron 'daily-backup' (02:41 UTC). Каждая таблица public → <дата>/<таблица>.json.gz,
-- хранится 14 дней. Файлы (фото, видео) и схема private в копию не входят. Копия лежит в том же проекте Supabase.

-- =====================================================================
-- mestario_mentions_ttl_moderation_cols + mestario_links_regex_fix
-- Упоминания, исчезающие сообщения, медленный режим, запрет ссылок новичкам.
-- messages.mentions uuid[] — кого упомянули (@ник), заполняет триггер private.on_message_insert:
--   только участники этого чата, без самого отправителя. Push-функция шлёт уведомление
--   упомянутым даже из заглушённого чата.
-- messages.expires_at — когда сообщение исчезнет; chats.msg_ttl (3600/86400/604800 или null) —
--   только личные чаты, ставит public.set_chat_ttl(chat, seconds) с системным сообщением.
--   private.expire_messages() раз в минуту (cron 'expire-messages') помечает истёкшие deleted_at.
-- chats.slow_seconds (0/10/30/60/300/900/3600) и chats.links_new_block — public.set_chat_moderation
--   (владелец и админы группы). Триггер для обычных участников: 'slow mode' — если писали меньше
--   slow_seconds назад; 'links blocked' — ссылка от того, кто вступил меньше суток назад.
--   В регулярном выражении граница слова в Postgres — \y (а не \b, это «backspace»), исправлено отдельно.
-- =====================================================================

-- =====================================================================
-- mestario_daily_stats_folders
-- private.daily_rewards(user_id, last_day, streak) и public.claim_daily():
--   раз в сутки по времени Asia/Baku; награда 3, 5, 7 … 15 Mest (с 7-го дня подряд — 15),
--   пропуск дня сбрасывает серию. Клиент вызывает при входе и раз в минуту, повтор сервер отклоняет (claimed=false).
-- public.channel_stats(chat) — только владельцу и админам: участники, вступили/вышли/сообщения за 7 дней,
--   по дням за 14 дней, 5 самых читаемых за 30 дней (прочитали = участники с last_read_id ≥ id сообщения).
-- public.chat_folders(id, user_id, title, chat_ids, position, deleted_at) — свои папки (до 10),
--   RLS: видны только свои неудалённые; изменение через public.save_folder / public.delete_folder (флаг deleted_at).
-- =====================================================================

-- =====================================================================
-- mestario_referral_cap_100
-- public.claim_referral: пригласивший получает за приглашения не больше 100 Mest
-- (оплачивается 4 приглашения по 25; private.referrals.rewarded = «пригласившему заплатили»).
-- Новый человек получает свои 25 Mest и после достижения потолка (если не тот же адрес регистрации).
-- Строка пригласившего блокируется (for update), чтобы одновременные регистрации не превысили потолок.
-- =====================================================================

-- =====================================================================
-- mestario_ai_questions + edge-функция ai
-- public.ai_questions(user_id, day, question, answer, status pending/done/failed): RLS — видны только свои.
-- Уникальный индекс (user_id, day) where status <> 'failed' — один вопрос в сутки (день по Asia/Baku);
-- если модель не ответила, строка помечается failed и вопрос не засчитывается.
-- Функция supabase/functions/ai (verify_jwt = true): проверяет вход, бан и действующий премиум,
-- занимает сегодняшний вопрос и спрашивает модель Claude. Ключ — секрет функций ANTHROPIC_API_KEY
-- (Supabase → Edge Functions → Secrets); в репозитории и в базе его нет. Без ключа отвечает 'not configured'.
-- =====================================================================

-- =====================================================================
-- mestario_ai_credits + mestario_ai_history (ИИ-помощник теперь за платные ИИ-кредиты, без премиума и дневного лимита)
-- private.ai_credits(user_id, balance ≥ 0), private.ai_credit_log — история начислений и списаний.
-- public.my_ai_credits() — свой баланс; public.admin_grant_ai_credits(user, ±amount) и public.admin_ai_credits(user) —
--   только главные администраторы (is_chief_admin). Продажа пока вручную: покупатели пишут @boss.
-- public.ai_take_credit(user) / public.ai_refund_credit(user) — только service_role (вызывает функция ai):
--   кредит списывается до запроса к модели и возвращается, если ответ не получен.
-- public.ai_history — вопросы и ответы (RLS: только свои). Таблица ai_questions с индексом «один в сутки»
--   больше не используется (удалить индекс миграцией не дали — отклоняется как DROP).
-- =====================================================================

-- =====================================================================
-- mestario_ai_config: ИИ-помощник переведён на Google Gemini (бесплатная модель Flash).
-- private.ai_config(provider, api_key) — ключ хранится только здесь (в репозитории его нет);
-- public.ai_server_config() — только service_role, читает функция ai.
-- Функция сама выбирает самую новую модель gemini-X-flash из доступных ключу; при лимите Google (429)
-- возвращает 'busy', кредит не списывается. Самопроверка: POST {"selftest":true} с заголовком x-hook-secret.
-- =====================================================================

-- =====================================================================
-- mestario_username_allow_ai + mestario_ai_bot_chat: ИИ-помощник — собеседник @ai в личном чате.
-- Юзернейм может быть 'ai' (исключение из правила «от 4 символов»: ограничение profiles_username_ok).
-- Аккаунт @ai («Mestario AI», с галочкой) — служебный: вход в него закрыт (banned_until в auth.users).
-- Триггер messages_ai (private.on_message_ai): новое сообщение в личном чате с @ai → POST в функцию ai
--   с x-hook-secret. Функция берёт последние 14 сообщений переписки как контекст и отвечает от имени @ai.
-- Оплата: 1 ИИ-кредит за каждую начатую секунду работы модели (минимум 1); при нехватке списывается остаток.
--   Без кредитов бот отвечает, что кредиты можно купить у @boss. Админам сайта (is_admin) — без ограничений.
--   public.ai_balance / public.ai_charge — только service_role. В конце ответа строка «⏱ N с · −N кредитов · осталось N».
-- =====================================================================

-- =====================================================================
-- mestario_ai_admin_limits_premium
-- Выдавать ИИ-кредиты могут все админы (public.is_admin): @boss — без ограничений,
--   остальные — до 200 кредитов за календарный месяц (по Asia/Baku); списания в лимит не входят.
--   private.ai_grant_left(admin) / public.admin_ai_grant_left() — сколько ещё можно выдать (null = без ограничений).
-- Премиуму — 50 ИИ-кредитов каждый месяц: private.grant_premium_ai(), cron 'premium-ai-credits' (каждый час, :07);
--   private.ai_premium_grants(user_id, month) не даёт начислить дважды за месяц.
-- Чат с @ai есть у всех: созданы для всех существующих аккаунтов, новым — триггер profiles_ai_chat.
-- =====================================================================

-- =====================================================================
-- @ai: аватарка (ai-avatar.png в репозитории) загружена служебной функцией bot-setup (только с x-hook-secret).
-- Блоки кода в ответах @ai (```язык ... ```) автоматически сохраняются файлами code_N.<расширение>
-- в хранилище attachments и приходят отдельными сообщениями-файлами; в тексте остаётся «📄 Код в файле …».
-- =====================================================================

-- =====================================================================
-- @ai: картинки и карточки кода.
-- Картинки: просьба «нарисуй …», «/img …», «сгенерируй картинку …» → функция ai рисует изображение и присылает фото.
--   Сначала пробует модели Gemini *-flash-image; у бесплатного ключа их квота нулевая (429), поэтому запасной путь —
--   бесплатный Pollinations (без ключа): описание переводится на английский моделью Gemini, картинка 1024×1024.
--   Оплата та же: 1 ИИ-кредит за секунду работы, при неудаче не списывается.
-- Код: блоки ```язык … ``` остаются в тексте ответа; сайт показывает их карточкой с отметкой </> и кнопками
--   «Копировать» и «Файлом» (файл собирается в браузере, расширение по языку). Блок длиннее сообщения уходит файлом.
-- =====================================================================
-- Исправление: просьбу о картинке теперь распознаёт сам ИИ — модель отвечает строкой [[IMAGE: англ. описание]],
-- и функция рисует по ней (раньше «сделай фотографию…» не распознавалось, и модель только делала вид, что рисует).
-- Плюс расширен список слов (фото, мем, стикер, аватар…). После отказа Gemini (429) час не тратим на него время.
-- «ИИ перегружен»: у бесплатного ключа Gemini дневной лимит у каждой модели свой. Теперь функция ai при отказе (429)
-- откладывает модель на 30 минут и пробует следующую (все Flash, затем Flash-Lite, до 8 моделей),
-- а если отказали все — отвечает запасной бесплатный ИИ Pollinations (text.pollinations.ai, без ключа).

-- =====================================================================
-- mestario_remove_updates_channel: по просьбе владельца удалён канал «Mestario Official» (@mestario_official,
-- id 4a49f7b8-…), на который автоматически подписывали новых пользователей. Удалён флагом (как delete_chat):
-- подписчики отписаны, посты помечены удалёнными. private.subscribe_to_updates теперь не подписывает на удалённый канал.
-- =====================================================================

-- =====================================================================
-- mestario_location_messages: отправка местоположения в чат.
-- messages.geo_lat / geo_lng / geo_acc (точность в метрах) — grant select и insert для authenticated.
-- Клиент: скрепка → «Местоположение» (браузер спрашивает разрешение), тело сообщения «📍 Местоположение»
-- (так же видно в списке чатов и в push). Карточка: карта из плиток OpenStreetMap, кнопки Google Maps и Waze.
-- =====================================================================

-- ===== Android: кнопка APK в ленте историй, тихое обновление интерфейса, проверка новой сборки (клиент + workflow, без изменений БД) =====
-- В браузере на Android рядом с «Моя история» — круг «Скачать» (releases/latest/download/Mestario.apk).
-- В приложении: раз за запуск качает index.html с сайта; если отпечаток (sha-256) отличается от встроенного (meta mestario-bundle,
--   его вписывает workflow), сохраняет в localStorage и показывает его со следующего запуска. Если свежая версия не дошла до
--   отметки mestario.boot=ok, при следующем запуске она отбрасывается и открывается встроенная.
-- Новая сборка APK: api.github.com releases/latest, тег android-N больше meta mestario-apk → круг «Обновить».
-- Workflow собирает APK только при изменении app/** или самого workflow; подпись — постоянным debug-ключом (~/.android/debug.keystore) из actions/cache
--   (раз в неделю отдельная задача освежает кэш). Секреты ANDROID_KEYSTORE_* по-прежнему имеют приоритет.

-- ===== Анимации по всему интерфейсу (только клиент, без изменений БД) =====
-- Заставка #boot при открытии сайта/приложения и поочерёдное появление частей интерфейса (#app.enter).
-- Окна (dialog) закрываются с анимацией: patched close/showModal/open, во время «уезжания» окно считается закрытым.
-- Меню и подсказки исчезают плавно; чаты в списке переезжают (FLIP), счётчики непрочитанных подпрыгивают.
-- Отправленное сообщение вылетает из поля ввода; удалённое сжимается и растворяется; изменённое мягко вспыхивает.
-- «Волна» от нажатия на кнопках и строках; смена темы/цвета/фона — через View Transitions.
-- При системной настройке «уменьшить движение» всё это отключается.

-- ===== Mestario для Windows (desktop/, .github/workflows/windows.yml; без изменений БД) =====
-- Electron-окно открывает сайт (обновления сразу), без интернета — встроенную копию интерфейса.
-- Выпуск windows-N: Mestario-Setup.exe и Mestario.exe, make_latest: false (releases/latest остаётся за APK).
-- При переезде на mestario.top поменять SITE в desktop/main.js.

-- ===== Mestario для iPhone (.github/workflows/ios.yml; без изменений БД) =====
-- Capacitor iOS, интерфейс встроен (capacitor://localhost), тихое обновление интерфейса с сайта работает и тут.
-- Сборка без подписи (нет аккаунта Apple Developer): выпуск ios-N с Mestario.ipa, make_latest: false.
-- Ставится через AltStore/Sideloadly со своим Apple ID; для TestFlight/App Store нужен аккаунт разработчика.

-- ===== Кнопки «скачать приложение» над историями (только клиент) =====
-- #getApps: одна кнопка «Скачать приложение», по нажатию меню Android (APK) / Windows (EXE) / iPhone (IPA), своё устройство первым. В приложениях не показывается.
-- APK — releases/latest/download; EXE и IPA — самый свежий выпуск windows-*/ios-* через api.github.com (они не «latest»).

-- ===== «Жидкое стекло» (Liquid Glass) — только клиент =====
-- :root[data-glass="liquid"]: полупрозрачные панели, меню, окна, пузыри с размытием и бликом; настройка «Жидкое стекло»
-- (Авто/Вкл/Выкл, settings.glass). «Авто» включает его в приложении для iPhone (capacitor://).
-- iOS-сборка выбирает Xcode 26, если он есть на сборщике, — системные элементы получают стиль iOS 26.

-- ===== Покупка ИИ-кредитов за Mest (миграция mestario_buy_ai_credits) =====
-- public.buy_ai_credits(p_amount int) → {credits, balance}: 1 Mest = 1 кредит, 1..100000, списание через private.spend
-- (запись в coin_ledger «ИИ-кредиты: N»), начисление в private.ai_credits + private.ai_credit_log (reason 'buy').
-- Клиент: кнопка «+ Кредиты» в шапке чата с @ai (кроме админов) → окно dlgAiBuy. Бот при нуле кредитов отсылает к ней (ai v10).

-- ===== Плавность и свои звуки (только клиент) =====
-- renderList не чаще раза за кадр (requestAnimationFrame); снимок списка чатов в localStorage mestario.chats.<uid>
-- (до 60 чатов) — при запуске список виден сразу, без снимка — мерцающие заготовки; при выходе снимок удаляется.
-- Звуки синтезируются WebAudio: «сообщение» (открытый чат) и «уведомление» (другой чат, + лёгкая вибрация на Android);
-- не звучат в заглушённых чатах и при скрытой вкладке; iPhone: audioSession 'ambient' — молчит в беззвучном режиме.
-- Настройка «Звуки сообщений» (settings.sounds). Звук системных пуш-уведомлений веб-версия поменять не может.

-- ===== Клавиатура не открывается сама (только клиент) =====
-- canAutoFocus(): автофокус полей только при мыши ((hover: hover) and (pointer: fine)); на телефонах и планшетах — нет.
-- Окна (showModal) на сенсорных экранах снимают фокус с первого поля, кроме [data-autofocus]; ПИН-код и ответ/правка
-- сообщения по-прежнему открывают клавиатуру (это прямое действие человека).

-- ===== Плавные переходы и «назад» смахиванием (только клиент) =====
-- Телефон (≤760px): чат въезжает справа поверх списка (список уходит на 28% влево и темнеет), «Назад» — обратно.
-- swipeBack(): палец вправо — экран едет за ним; дальше трети ширины или резкий жест — назад, иначе возвращается.
-- Работает в чате, на страницах настроек (→ меню настроек) и в окнах на весь экран (dialog.full, кроме историй).
-- Не мешает: свайпу ответа влево, полям ввода, голосовым, картам, коду, альбомам ([data-noswipe] — исключить свой элемент).

-- ===== Открытие чата и меню по долгому нажатию «как в Telegram» (только клиент) =====
-- Въезд чата стартует после тяжёлой отрисовки (два кадра), список под ним перерисовывается после анимации.
-- Долгое нажатие: строка/сообщение/папка/история «вдавливается» (.pressing), меню вырастает из точки нажатия (ctxPop),
-- фон размывается (.hold-layer), поверх — приподнятая копия элемента. Окно действий с сообщением растёт из пальца (growFrom).

-- ===== Частота кадров под экран (60/90/120/144 Гц) — без изменений БД =====
-- CSS/WAAPI-анимации и так идут с частотой экрана. Живой фон больше не ограничен 30 кадрами — рисуется каждый кадр
-- (движение по времени). Интро: догоняние считается по времени кадра, поэтому скорость одинакова на любых Гц.
-- Android: app/MainActivity.java (копируется workflow) просит у системы режим экрана с максимальной частотой.
-- iPhone: Info.plist CADisableMinimumFrameDurationOnPhone = true (ProMotion 120 Гц).

-- ===== Плавность: убраны тяжёлые эффекты (только клиент) =====
-- Убрано размытие (backdrop-filter) под непрозрачными пузырями — оно пересчитывалось на каждом кадре и не было видно.
-- Переливание своих пузырей — один раз у нового сообщения, а не бесконечно у всех (было постоянное перерисовывание).
-- Открытие чата: «подъём» только у последних 8 сообщений (на телефоне — только въезд); перерисовки переписки
-- во время въезда откладываются до его конца (slideBusy). Свайп для ответа: движение раз за кадр через
-- requestAnimationFrame, translate3d, «резиновое» сопротивление за порогом и плавный возврат пузыря.

-- ===== Выходы и сообщения «как в Telegram» (только клиент) =====
-- Новое сообщение: переписка плавно сдвигается вверх на его высоту (pushUp), чужое выезжает снизу, своё летит из поля ввода.
-- Окно действий с сообщением сворачивается обратно в точку нажатия (_growFrom). Меню сжимается к точке, откуда выросло.
-- Страницы настроек и окна на весь экран въезжают справа целиком и уезжают вправо (и по «Назад», и смахиванием).

-- ===== Телефон: список и чат всегда отрисованы стопкой (только клиент) =====
-- Раньше при входе/выходе список чатов скрывался (display:none) и показывался заново — телефон пересчитывал раскладку
-- в первый кадр анимации. Теперь .sidebar и .pane лежат друг над другом (position:absolute), между ними затемнение
-- #peekDim; открытие/закрытие/смахивание меняют только transform и opacity (paneRun/paneAt, смахивание — раз за кадр).
-- Перерисованные строки списка и сообщения, уже бывшие на экране, получают .keep — их анимации появления
-- (аватарки, счётчики, реакции, просмотры) не проигрываются заново. Во время появления интерфейса список не перерисовывается.

-- ===== Вход в приложение через браузер (миграция mestario_login_handoff, функция login-handoff v1) =====
-- private.login_handoffs: запрос живёт 5 минут, срабатывает один раз; хранится только sha-256 секрета.
-- public.handoff_create / handoff_info / handoff_decide / handoff_take — только service_role (функция login-handoff).
-- Приложение: «Войти через браузер» → create → открывает PUBLIC_SITE#approve-<id> во внешнем браузере, показывает код
-- (4 цифры из id) и опрашивает take каждые 2,5 с. Сайт (уже вошли): окно «Войти в приложение?» с тем же кодом и
-- предупреждением, decide(ok). После подтверждения take выдаёт одноразовый magic-link token_hash (письмо не уходит),
-- приложение входит verifyOtp — это новая отдельная сессия; ПИН-код, если есть, спросится как при обычном входе.
-- Программа для Windows открывает #approve-ссылки в системном браузере (desktop/main.js).
-- Служебной записи @ai в auth.users заполнены пустыми строками NULL-токены (иначе админ-API GoTrue падал на ней).

-- ===== Звук отправки, сохранение чатов, удаление «в песок», переход из поиска, анимации медленнее (только клиент) =====
-- playSound("send"): короткий «вжух» (шум через полосовой фильтр с подъёмом частоты) + лёгкий щелчок.
-- Снимок списка — все чаты (до 200 участников на чат). Переписка — в IndexedDB «mestario/msgs» (ключ uid:chat,
-- последние 2 страницы), подгружается при запуске до сети; при выходе из аккаунта очищается. Предзагрузка — до 60 чатов,
-- где кэша нет или он устарел.
-- dustAway(): элемент стирается слева направо (clip-path), на его месте разлетаются песчинки цвета пузыря/текста (canvas).
-- Удалённое сообщение (у обоих — по realtime) рассыпается, потом место схлопывается; удалённый чат — копия строки рассыпается.
-- Поиск: тап по человеку сразу открывает чат с переходом (preOpenChat до ответа сервера; есть чат — без запросов).
-- Все анимации ×1/0.85: CSS-анимации и переходы — playbackRate, Element.animate — длительность; связанные таймеры — aMs().
-- Перерисовки после въезда/выезда чата — в requestIdleCallback.

-- ===== Расшифровка голосовых и свои фоны профиля (миграция mestario_transcripts_custom_profile_bg, функция transcribe) =====
-- public.message_transcripts(message_id, chat_id, body, by_user): читают участники чата (private.is_chat_member), пишет
-- только функция transcribe (Gemini, ключ из private.ai_config). Готовый текст отдаётся всем без повторного
-- распознавания; лимит 60 новых в сутки на человека, до 10 минут, до 15 МБ. Кнопка «Аа» у голосовых и «кружков».
-- profiles.profile_bg: новые градиенты aurora/sunset/ocean/night/candy/forest и своя картинка 'img:<id>/<файл>' в бакете
-- avatars (webp до 1 МБ, ≤1280 px); set_profile_bg проверяет, что файл есть и лежит в папке самого человека. Как и цвета —
-- с премиумом или админам. Ограничение profiles_profile_bg_ok заменило старое.

-- ===== ИИ отвечает надёжно и оптимизация запуска (миграция mestario_ai_claim, функция ai v11) =====
-- Запросы из базы (pg_net) иногда зависали на DNS по 1–2 минуты, и ответ @ai не приходил. Теперь приложение после
-- отправки само вызывает /functions/v1/ai {message_id, client:true} со своим токеном (только своё сообщение; работа
-- продолжается через EdgeRuntime.waitUntil). private.ai_claims + public.ai_claim(message) — ответ ровно один раз.
-- Вход в приложение: одно проявление всего экрана (app-in) вместо десятка одновременных анимаций.
-- Облегчённый режим (data-lite): авто при deviceMemory ≤ 4 или ≤ 4 ядрах, вручную — «Оформление → Облегчённый режим»:
-- без размытий, без вечных анимаций, живой фон ~30 к/с. Луч вокруг поиска крутится только при фокусе.
-- Предзагрузка переписки и сохранение снимка списка — в requestIdleCallback.
-- Проверено: расшифровка голосового (audio/aac, 34 с) через selftest — текст получен.

-- ===== Выбор нескольких сообщений и голосовые для ИИ (функция ai v12, без изменений БД) =====
-- «Выбрать» в меню сообщения → режим выбора: касание отмечает/снимает (альбом — целиком), панель вверху:
-- «Выбрано: N», «Переслать» (все выбранные в один чат) и «Удалить» (второе нажатие — подтверждение; чужие без прав
-- не удаляются). До 8 удалённых сразу рассыпаются «в песок». Esc или ✕ — выход; смена или закрытие чата тоже.
-- ИИ: голосовое или «кружок» в чате с @ai сначала расшифровывается (voiceText → message_transcripts, видно под
-- голосовым), затем помощник отвечает на сказанное; в истории переписки голосовые подставляются расшифровкой.

-- ===== Оптимизация «после минуты» (только клиент) =====
-- Строки списка переиспользуются (rowCache + rowSig): на новое сообщение пересобирается только строка этого чата.
-- Предзагрузка переписки: один чат — не чаще раза в 10 минут (раньше каждую минуту тянулись «устаревшие» чаты);
-- в памяти — переписка не больше 40 чатов (остальное в IndexedDB). Снимок списка — раз в 5 с покоя.
-- «Подъезд» переписки под новые сообщения — не чаще 3 раз в секунду.
-- Покой (:root.calm): 8 с без касаний — фоновые «вечные» анимации и живой фон замирают; живой фон на телефоне ~40 к/с.
-- Проверка 45 с активности (входящие каждую секунду, вход/выход из чата): ни одного долгого кадра, DOM и память стабильны.

-- ===== Фоны на телефонах, лёгкая смена темы, анимированные аватарки и баннеры (клиент, без изменений базы) =====
-- Исправлено: на телефонах (≤760px) правило «#app > .pane { background: var(--bg) }» сбрасывало background-image,
--   и все фоны переписки, кроме «Кристаллов», пропадали; теперь там только background-color.
--   Живой фон (WebGL-холст) на телефоне переносится внутрь чата (он непрозрачный слой поверх списка).
--   «Конфетти» раньше перебивался общим правилом цветных фонов (специфичность) — исправлено.
-- Смена темы: кроссфейд 0,18 с только на ПК; на телефонах и в облегчённом режиме — мгновенно.
-- Анимированные аватарки и баннеры: GIF / анимированный WebP до 1 МБ загружаются без перекодирования
--   (путь <uid>/anim-…; GIF кладётся с типом image/webp — бакет avatars принимает webp/png/jpeg, браузеры
--   распознают картинку по содержимому). Только премиум/админ (проверка на клиенте); без премиума — первый кадр.
-- Серверная проверка премиума для анимации и баннер-фото для всех потребуют миграцию
--   (бакет avatars + image/gif, политика avatars_upload, set_profile_bg) — не применена.

-- ===== Вход через браузер: исправления (клиент) =====
-- Программа для Windows открывает страницу подтверждения по http://soroka.lol/#approve-… — так даже старые сборки
--   программы (до появления этой функции они открывали свой сайт у себя в окне, где вход не выполнен) отдают
--   ссылку обычному браузеру. Сайт сразу переводит http → https (вход хранится отдельно для http и https).
-- В окне ожидания — «Скопировать ссылку»: если открылся браузер, где вы не вошли, ссылку можно открыть в другом.
-- Если по ссылке пришли в браузер без входа — без интро, с подсказкой «войдите — запрос появится после входа».

-- ===== ИИ: минимальная задержка (функция ai v13 + клиент) =====
-- Причины задержек по журналу: примерно половина ответов зависала (запрос к модели без ограничения по времени —
--   функция обрывалась по лимиту в 150 с, ответ приходил только вместе со следующим вопросом); плюс «размышление»
--   модели перед ответом (2–20 с).
-- Теперь: у каждого внешнего запроса свой предел (первые слова — 12 с, иначе следующая модель; перебор — до 35 с,
--   дальше запасной ИИ); «размышление» минимальное (Gemini 3.x thinkingLevel=minimal, 2.5 — thinkingBudget=0;
--   если модель не принимает настройку — повтор без неё). Замер: 0,9 с вместо 2,5 с на ту же модель.
-- Ответ печатается в чате по мере готовности (streamGenerateContent): первое сообщение появляется через
--   1–2 с и дописывается раз в 0,7 с (с курсором ▍), в конце — итоговый текст и время/кредиты.
-- Запросы к базе перед ответом идут параллельно; запись в ai_history не задерживает ответ.
-- Клиент: правки сообщения ИИ во время печати обновляют только этот пузырь (без перерисовки чата и списка).

-- ===== Боты пользователей: конструктор без кода (миграции user_bots_constructor, user_bots_fix_url_check) =====
-- «+» → «Бот»: создать бота (название + юзернейм на …bot), до 5 ботов (с премиумом — 20).
-- Бот — отдельный аккаунт (profiles.is_bot, без входа), настройки — public.bots.config:
--   start (ответ на «Начать» /start), cmds [{on: текст кнопки или /команда, text, kb, inline, hide}], unknown.
--   kb — клавиатура над полем ввода (до 10 рядов × 4), inline — кнопки под сообщением (до 8 × 3: ссылка https или команда).
--   В тексте: {name} {username} {mest} {id} {date}.
-- Отвечает сама база триггером messages_bot (private.on_message_bot) — мгновенно, без внешних запросов.
-- messages.markup (кнопки) может задать только бот: вставка этой колонки пользователям закрыта, плюс триггер-страж.
-- Служебные триггеры регистрации (ИИ-чат, кредиты, канал обновлений, проверка IP) для ботов пропускаются (WHEN not is_bot).
-- RPC: bot_create, bot_update (владелец; аватар — из своей папки avatars), bot_delete (бот выключается, имя освобождается).

-- ===== Боты: больше команд и ИИ (миграция user_bots_ai_more_cmds, функция ai v14) =====
-- Команд — до 200 (было 50), у команды несколько вариантов через «|» (Привет|Здравствуй|/hi); в конструкторе — поиск,
--   счётчик, сворачивание. Совпадение ищет private.bot_match.
-- ИИ для бота (config.ai = {on, prompt}): если ни одна команда не подошла, триггер отправляет сообщение в функцию ai
--   (bot_message), та отвечает от имени бота с характером из prompt, печатая ответ по мере готовности; запасной запуск —
--   из приложения собеседника через 3 с. Без доступа или сверх лимита — обычный ответ «не понял».
-- Помощник конструктора (bot_gen): ИИ собирает или переделывает бота по описанию, результат попадает в конструктор.
-- Доступ (private.bot_ai_access, на владельца — все его боты): с премиумом 3 дня бесплатно один раз (bot_ai_trial),
--   дальше за Mest (bot_ai_buy): 1 день — 30, 7 дней — 150, 30 дней — 500. Лимит: 300 ответов ИИ и 40 сборок в сутки.
--   Админам — без ограничений.

-- ===== Пустой чат с приветствием; скрытие аватарки и статуса при блокировке (миграция who_blocked_me) =====
-- Пустой чат: карточка «Здесь пока ничего нет…» с анимированным приветствием — нажатие отправляет его.
--   Приветствие выбирается самому (эмодзи или свой стикер), хранится в настройках на устройстве (settings.greet).
-- Блокировка в любую сторону: аватарка собеседника не показывается, время в сети — «неизвестно», зелёной точки нет.
--   public.who_blocked_me() — только id тех, кто заблокировал меня; обновляется при входе и при возвращении в приложение.
--   Скрытие — на стороне приложения (сами профили по-прежнему общие).

-- ===== Боты: изменить можно в любой момент =====
-- Вход в конструктор: ⚙ в шапке чата со своим ботом, «Настроить бота» в профиле бота, «Мои боты» в настройках
--   (и как раньше «+» → «Бот»). Список своих ботов подгружается при входе. Сохранять можно сколько угодно раз.

-- ===== Своё приветствие, которое видят другие (миграция profile_intro_greeting) =====
-- profiles.intro = {title, text, emoji | sticker+path}; задаётся через public.set_intro (стикер проверяется).
-- В пустом личном чате показывается приветствие СОБЕСЕДНИКА (его заголовок, подзаголовок и стикер); нажатие отправляет
--   этот стикер/эмодзи. Своё — в «Настройки → Моё приветствие» или по ссылке под карточкой; с предпросмотром.
-- Если у собеседника своего нет — стандартное «Здесь пока ничего нет…» с 👋. При блокировке приветствие скрыто.

-- ===== Боты v2: движок, меню команд, покупки за Mest, умный помощник (миграции user_bots_engine_v2_menu_pay,
--       user_bots_match_contains, user_bots_text_fix; функция ai v15) =====
-- Почему «команды не работали»: совпадение было точным до символа, а ИИ-помощник писал {random:…} (не поддерживалось)
--   и обещал «начисления». Теперь: сравнение без регистра, ё=е, без эмодзи и знаков (private.bot_norm);
--   варианты с «~» — «сообщение содержит слова»; переменные {random:1..6}, {random:а|б}, {time}, {bot} (private.bot_text).
-- Меню команд: кнопка «☰ Меню» в чате с ботом → public.bot_menu(bot): команды с описаниями (desc), без скрытых (nomenu).
-- Покупки: у команды цена pay (1–100000) и текст paid; под ответом кнопка «💳 Оплатить N Mest». public.bot_pay берёт
--   сумму из сообщения бота (не от приложения), списывает у покупателя (private.spend), зачисляет владельцу
--   (private.credit), один раз на сообщение; журнал private.bot_payments; продажи владельцу — public.bot_sales.
-- Помощник: думает дольше, отвечает строгим JSON {summary, config}, помнит последние 6 просьб, в конструкторе —
--   история «что сделал» и «↶ Отменить этот шаг». Знает про меню, цены, {random}; не обещает начислений.

-- ===== {random:…} любой длины (миграция user_bots_text_random_long); бот «Игруля» расширен =====
-- private.bot_text разбирает {random:…} по позициям (без ограничения регулярок на 255 символов) — длинные варианты
--   (анекдоты, предсказания) работают. Бот @s_bot по просьбе владельца: 16 команд — меню, кубик, монетка, шар,
--   баланс, бонус-талисман, помощь, приветствие/спасибо по словам, магазин из 6 товаров за Mest (3–200).

-- ===== Кошелёк бота и вывод с комиссией 20% (миграция user_bots_wallet_withdraw) =====
-- bot_pay: оплата в боте зачисляется на кошелёк самого бота (private.credit(b.id, …)), а не владельцу.
-- bot_withdraw(p_bot, p_amount): только владелец, минимум 5 Mest; комиссия ceil(20%), владельцу приходит остальное;
--   запись в private.bot_withdrawals. bot_sales(p_bot) → {balance,total,count,withdrawn,last} (только владельцу).
-- Функция ai (v16): bot_gen с fill_missing:true — ИИ сам пишет команды для кнопок без ответа;
--   после обычной сборки ботa ИИ тоже автоматически дописывает недостающие команды.

-- ===== Прочитано на одном устройстве — без уведомлений на других (миграция push_read_sync) =====
-- private.push_shown(sub_id, chat_id, msg_id, cleared): какие уведомления какому устройству отправлены.
-- public.push_shown_add / public.push_take_read — только service_role (для функции push).
-- Функция push (v8): отвечает базе сразу и рассылает в фоне; уже прочитавшим не шлёт; тем, кто сейчас в сети,
--   даёт 3 секунды прочитать на открытом устройстве и тогда на остальные не шлёт; в каждое уведомление кладёт
--   close: [чаты, прочитанные в другом месте] — sw.js закрывает их уведомления. Сайт сам закрывает уведомления
--   чата при чтении (тут или на другом устройстве, через realtime chat_members) и после загрузки списка чатов.

-- ===== Игры на баланс бота (миграция user_bots_games_bank) =====
-- Команда может выплачивать Mest из кошелька бота: give (1–100000), chance (1–99 %, иначе 100), win (текст выигрыша), cd (сек., только без цены; по умолчанию сутки).
--   С pay — ставка: оплата → с шансом выплата give (если фонда не хватает — ставка возвращается). Без pay — бонус раз в cd.
--   Владельцу его бот Mest не выдаёт. Учёт: private.bot_payouts, private.bot_claims (когда человек последний раз брал бонус).
-- public.bot_deposit(p_bot, p_amount): владелец пополняет кошелёк бота без комиссии (private.bot_deposits).
-- bot_sales добавляет deposited и paid_out. Переменные {give} и {bank} (фонд бота). Сайт: кнопка «Пополнить бота»,
--   поля выплаты в команде, вопрос «Сохранить изменения?» при выходе из конструктора. ИИ-помощник (ai v17) знает про ставки.

-- ===== Присутствие для уведомлений (миграция push_presence_private) =====
-- private.presence(user_id, at): touch_presence и mark_read отмечают активность всегда — даже у тех, кто скрыл «в сети»
--   (их last_seen_at = null, поэтому раньше функция push считала их не в сети и не ждала прочтения на другом устройстве).
-- public.push_active(users, secs) — только service_role. Функция push (v9) ждёт 3,5 с прочтения у активных.

-- ===== Страница нового пароля reset.html =====
-- Ссылка из письма «Сброс пароля» ведёт на mestario.lol/reset.html (redirectTo), а не в само приложение:
--   новый пароль с повтором и показом, проверка надёжности; устаревшая ссылка — сразу форма «прислать новую».
-- В Supabase → Authentication → URL Configuration должен быть разрешён https://mestario.lol/** (иначе ссылка уйдёт на Site URL).

-- ===== Аудиозвонки с показом экрана (миграции voice_calls, voice_calls_label_hours) =====
-- public.calls: звонок 1:1 в личном чате (ringing → active → ended/missed/declined/busy), видна только двоим (RLS), в Realtime.
-- RPC: call_start(chat) — проверки (не бот, не @ai, нет блокировки, ≤15 звонков за 10 мин, «занят»), строка + сообщение
--   «📞 Звонок» (messages.call_id; по нему приходит push); call_accept(call, device); call_ping(call) раз в 20 с;
--   call_end(call) — итог в сообщении: «📞 Звонок · 2:31», «Пропущенный», «Отклонённый».
-- private.call_config.ice — серверы STUN (TURN можно добавить туда же позже, сайт менять не нужно).
-- Сайт: WebRTC напрямую между устройствами, обмен SDP/ICE через Realtime-канал call-<id>; показ экрана —
--   заранее согласованная видеодорожка (replaceTrack), без пересогласования. Windows-приложение отдаёт основной экран.
-- Звонки: можно зайти без микрофона (только слушать/смотреть; включить микрофон — кнопкой во время звонка).
-- Показ экрана: обычный — до 720p, 10 кадров/с, 1 Мбит/с; с премиумом (и админам) — до 1080p, 30 кадров/с, 4 Мбит/с.
-- Показ экрана: перед показом выбор качества — «Экономно» (480p, 5 к/с), «Обычное» (720p, 10 к/с),
--   «Плавно» (720p, 30 к/с, премиум), «HD» (1080p, 30 к/с, премиум); меняется на ходу кнопкой «Сменить», выбор запоминается.

-- ===== Регистрация и вход с кодом из почты (миграция login_email_code) =====
-- Регистрация: после signUp вводится код из письма (verifyOtp type=signup); ссылка в письме тоже работает.
-- Вход с кодом (по желанию): private.login_code(user_id, enabled, asked); RPC login_code_get / login_code_set / login_code_asked.
--   После первой регистрации сайт один раз спрашивает «Защитить вход кодом?»; переключатель — Настройки → Безопасность.
--   Сайт после пароля шлёт код (signInWithOtp, shouldCreateUser=false) и пускает только после кода.
--   Серверная защита: public.custom_access_token_hook — вход только по паролю для таких аккаунтов не выдаёт токен
--   ('code_required'). Включается в Supabase: Authentication → Hooks → Customize Access Token → Postgres → public.custom_access_token_hook.
-- Шаблоны писем с кодом {{ .Token }}: tools/email-templates (вставляются в Authentication → Emails → Templates).
-- Если в Supabase выключено «Confirm email» (signUp сразу выдаёт вход), сайт всё равно подтверждает почту кодом:
--   выходит и шлёт код через signInWithOtp (шаблон «Magic link or OTP»), аккаунт открывается только после кода.
-- Миграция login_code_default_on: код из почты при входе включён у всех по умолчанию (нет строки = включено);
--   выключить — Настройки → Безопасность. Вопрос после регистрации больше не показывается (asked=true).
-- Смена почты: пароль (check_my_password) + коды из писем на текущую и новую почту (verifyOtp type=email_change;
--   в Supabase включено «Secure email change»). Забыл текущий пароль, но вошёл: код на почту (resetPasswordForEmail →
--   verifyOtp type=recovery) → новый пароль, не выходя из приложения. Шаблоны «Reset password» и «Change email address»
--   в Supabase теперь с кодом {{ .Token }}; длина кода — 6 цифр (Sign In / Providers → Email → Email OTP length).

-- ===== Баннеры профиля (миграция profile_banners) =====
-- profiles.banner — путь в публичном бакете banners (6 МБ; фото, GIF, MP4/WebM/MOV); видео до 5 с проверяет сайт.
-- public.set_banner(path): премиум или админ, файл в своей папке. Показывается полосой над аватаркой (аватарка заходит на неё).
-- Фон шапки профиля теперь только от NFT (надетый подарок; у админов — любой фон NFT через set_profile_bg('nft:…')).
--   Цветные фоны и свои картинки как фон убраны (у кого стояли цвета — сброшены).

-- ===== Редактор фото и видео (только клиент, index.html) =====
-- openMediaEditor(file, opts): обрезка кадра (Оригинал/1:1/4:3/16:9/9:16), поворот, масштаб, рисование кистью,
-- обрезка видео по времени (отрезок перезаписывается через canvas.captureStream + MediaRecorder, mp4 или webm).
-- Баннер: видео длиннее 5 с открывается на вкладке «Время», можно выбрать любые 5 с; кадр 3:1 (1200x400 видео, 1500x500 фото).
-- Вложения в чат: на миниатюре ✏️ — редактировать перед отправкой (видео со звуком), результат до 20 МБ.
-- Изменений в базе нет.

-- ===== Производительность и правки вида (только клиент, index.html) =====
-- Переписка: готовые узлы сообщений переиспользуются (msgSig/msgNodeCached), DOM обновляется на месте (syncKids),
-- раскладка не пересчитывается для каждого фото (msgStick). Новое сообщение на слабом телефоне: ~230 мс → ~10 мс.
-- Список чатов: тоже обновление на месте, анимация перестановки только для строк на экране.
-- Прокрутка: обработчик scroll ничего не делает, если меню закрыто; в «жидком стекле» нет размытия под каждым пузырём.
-- Исправлено: класс .me редактора ломал кнопку «Скачать приложение» и пузыри поддержки (теперь .me-wrap);
-- кнопки в шапке профиля снова поверх баннера, баннер выше (170px) и аватарка заходит на него снизу.

-- ===== Вход через Google (клиент index.html; база не менялась) =====
-- Кнопки «Войти через Google» / «Продолжить с Google» показываются сами, когда Google включён в Supabase
-- (клиент читает открытые настройки /auth/v1/settings). Новый пользователь попадает на шаг «имя и юзернейм»:
-- имя из Google, юзернейм предлагается из почты. Хук custom_access_token_hook код из письма требует только
-- для входа по паролю — вход через Google его не просит.
-- В приложениях (Android, iPhone, Windows) Google не пускает во встроенное окно: вход идёт через системный браузер
-- (#gapprove-<id> → вход через Google → подтверждение «Войти в приложение»), как «Войти через браузер».
-- Настройка (один раз, вручную):
--   Google Cloud → APIs & Services → OAuth consent screen (External) и Credentials → OAuth client ID (Web application):
--     Authorized JavaScript origins: https://mestario.lol
--     Authorized redirect URIs:     https://zgjptlyhflfwbnmzpdsa.supabase.co/auth/v1/callback
--   Supabase → Authentication → Sign In / Providers → Google: включить, вставить Client ID и Client Secret, Save.

-- ===== NFT-номера +555 (миграция nft_numbers) =====
-- public.collectible_numbers(number, owner_id, granted_by, granted_at): «+555 » и до 10 символов (цифры и одиночные пробелы);
-- уникальность по цифрам (индекс по replace(number,' ','')). Видны всем (select), меняются только через функции.
-- Выдают и забирают только админы: admin_grant_number(p_number, p_owner username), admin_revoke_number(p_number).
-- Маркет общий с NFT-юзернеймами: nft_listings.number (username стал необязательным, ровно одно из двух),
-- admin_list_number(p_number, p_price), list_my_number(p_number, p_price); buy_listing / make_offer / answer_offer /
-- cancel_offer / refund_offers / settle_listing понимают номера (подписи операций — private.lot_label).
-- Клиент: номер — первая строка карточки профиля (над юзернеймом); выдача и список — в админке (вкладка NFT);
-- выставить номер — в маркете. Вход через Google скрыт (GOOGLE_LOGIN = false), код оставлен.
-- Профиль с галочкой: над «Заблокировать» строка «Этот аккаунт имеет официальную верификацию от Mestario».

-- ===== Профиль «Данные контакта» и темы чатов (миграция chat_themes_and_clear) =====
-- Профиль: номер под именем, круглые кнопки (Написать, Звонок, Поиск, Подарить), «Информация», «Медиа, ссылки и документы»
-- (chat_media_count + 4 последних фото), Уведомления / Исчезающие сообщения / Тема чата, общие группы (common_groups),
-- Экспорт чата (.txt), Очистить чат (clear_chat_history — только у себя), Заблокировать, Пожаловаться, Удалить чат.
-- Темы: chats.theme (общая, видят все участники) и chat_members.theme (своя). set_chat_theme(chat, theme, both):
-- both = true требует премиум (в группах — ещё и права админа чата); своя тема перекрывает общую. my_chat_themes().

-- ===== Перевод сообщений (миграция message_translate, функция translate) =====
-- Меню сообщения → «Перевести»: функция translate (Gemini тем же ключом, что ИИ-помощник; запасной — Pollinations)
-- переводит на язык интерфейса (если уже на нём — на другой). Бесплатно: готовые переводы в private.msg_translations,
-- новых — до 100 в день (премиум и админы — 500), учёт в private.translate_uses. tr_source/tr_get/tr_put/tr_take — только service_role.

-- ===== Статистика каналов: рост подписчиков и охват (миграция channel_stats, затем переименование) =====
-- public.channel_stats_v2(p_chat, p_days=30): по дням — всего участников, пришло/ушло, посты и их просмотры;
-- лучшие посты, итоги. Владелец, админы чата и админы сайта. Дополняет старую channel_stats(p_chat) в окне «Статистика»
-- (графики «Подписчики за 30 дней» и «Просмотры постов по дням публикации», среднее и охват).
-- (функция создана как channel_stats(uuid,int) и сразу переименована: alter function ... rename to channel_stats_v2)

-- ===== GIF (миграция gif_messages, функция gif) =====
-- messages.gif_url — ссылка на ролик GIPHY (только media*.giphy.com / i.giphy.com); в списке чатов и push — «GIF».
-- Ограничение messages_not_empty дополнено условием gif_url is not null (alter table … drop/add constraint).
-- Ключ GIPHY: админка → Статистика → «GIF (GIPHY)» (admin_set_gif_key), хранится в private.gif_config;
-- функция gif читает его через gif_server_config() (только service_role). gif_configured() — задан ли ключ.
-- Панель стикеров: вкладка «GIF» — популярные и поиск. push v10: превью «GIF».

-- ===== Вход по NFT-номеру (миграции number_login, number_login_digits; функция number-login) =====
-- Системный бот «Mestario» @mest (is_bot, verified) — private.system_accounts('login_bot'). Экран входа → «Войти по NFT-номеру +555».
-- nl_start(number): номер ищется по цифрам; не чаще раза в минуту и 5 раз в час; код (6 цифр, в базе только sha256)
-- приходит сообщением от @mest в личный чат владельца (push на все устройства); функция ещё шлёт письмо с кодом
-- (signInWithOtp, шаблон Magic link). nl_check(id, code): 5 попыток, 10 минут. Подошёл код бота — generateLink(magiclink)
-- → клиент verifyOtp(token_hash); подошёл код из письма — verifyOtp(email) на сервере → клиент setSession.
-- nl_* — только service_role.

-- ===== Голосовые чаты в группах и каналах (миграция voice_chats) =====
-- public.voice_chats (один активный на чат, в realtime), private.voice_participants (устройство + отметка раз в 20 с).
-- vc_join(chat, device): войти/начать (в канале начинают и говорят владелец и админы, до 12 человек), vc_ping, vc_leave,
-- vc_state(chat) — для плашки «Идёт голосовой чат · N». Пропавшие убираются через 60 с, пустой чат закрывается.
-- Звук идёт напрямую между участниками (каждый с каждым), сигналы и состав — канал realtime «vc-<id>» (broadcast + presence).
-- Заходят с выключенным микрофоном; «говорит» — по громкости звука. Английский перевод: en.js дополнен (около 360 строк).

-- ===== Пузырьки, контакты, предложение фото, фото в темах (миграция bubbles_contacts_photo_themes) =====
-- profiles.bubble + set_my_bubble(id): свой пузырёк — 18 вариантов Mestario (цвета и градиенты, фото нельзя), видят все.
-- public.contacts(owner_id, user_id, name, avatar_path, bubble): своё имя, своя аватарка (avatars/<я>/contact-<id>-<ts>.webp)
-- и пузырёк для сообщений друга — видит только владелец (RLS). Настройки → «Контакты», профиль → «Добавить в контакты».
-- messages.avatar_suggest: фото с кнопкой «Поставить себе» (копируется в avatars/<получатель>/… и ставится аватаркой).
-- Темы чатов: theme = 'img:<я>/theme-<ts>.webp' — своё фото фоном (ограничения chats_theme_check / chat_members_theme_check
-- расширены через alter table … drop/add constraint; set_chat_theme проверяет, что фото из своей папки).

-- ===== Окно «Что нового» (миграции whats_new, whats_new_pending_simple) =====
-- public.whats_new(title, body, images[]) — читают все; публикует админ: whats_new_publish(title, body, images) (фото — avatars/<админ>/news-<ts>.webp, до 8).
-- whats_new_pending() — самое новое обновление, которое человек ещё не видел; whats_new_seen(id) — отметка (private.whats_new_seen).
-- Клиент показывает окно один раз через 2,5 с после входа, если не открыто другое окно и нет звонка. Админка → «Что нового».
-- Первое обновление (список сегодняшних новинок) добавлено миграцией.
-- Исправление: в messages вставка разрешена по столбцам — выдано grant insert (gif_url, avatar_suggest) (миграция messages_grant_gif_suggest).

-- ===== Форматирование сообщений (только клиент + push v11) =====
-- **жирный**, __курсив__, ~~зачёркнутый~~, `моно`, ||скрытый|| (открывается нажатием). Панель над полем ввода при выделении
-- текста и Ctrl+B / Ctrl+I / Ctrl+Shift+X / M / P. Ссылки не форматируются. В списке чатов и push значки убираются,
-- скрытый текст заменяется на ▒▒▒.

-- ===== Повторная просьба разрешить микрофон (только клиент) =====
-- Один раз на устройстве (localStorage mestario.micAsk.1), через 6 с после входа, когда нет других окон и звонка.
-- Разрешено — окна нет; не спрашивали — «Разрешить» вызывает getUserMedia и сразу выключает микрофон;
-- запрещено — инструкция (браузер / Safari / приложение), повторно спросить сайт не может.

-- 2026-10-26: клиентская диагностика. index.html пишет в public.log_client('error'|'reload_loop', info, ua):
-- ошибки JS (до 5 за запуск) и случаи, когда страница открылась 3+ раз за 5 минут (boots, тип навигации,
-- последняя ошибка перед перезапуском, память). Смотреть: select * from private.client_events order by created_at desc;
-- Голосовые на iPhone: navigator.audioSession.type = "playback" на время гс/кружков/звонков, чтобы звук шёл
-- в беззвучном режиме; после паузы возвращается "ambient" (звуки интерфейса беззвучный режим уважают).
-- GIF-видео за краем экрана ставятся на паузу (IntersectionObserver) — меньше памяти на телефонах.
