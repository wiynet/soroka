-- Копия кошелька на сервере, зашифрованная паролем кошелька на устройстве (AES-GCM, PBKDF2).
-- Сервер видит только шифротекст. Отдаём её только в сессии, вошедшей по коду с почты не раньше 15 минут назад.
create table if not exists private.ton_backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  address text not null,
  blob jsonb not null check (jsonb_typeof(blob) = 'object' and length(blob::text) <= 2000),
  updated_at timestamptz not null default now()
);
alter table private.ton_backups enable row level security;

create or replace function public.ton_backup_set(p_blob jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); a text;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select address into a from public.ton_accounts where user_id = me;
  if a is null or p_blob->>'addr' is distinct from a then raise exception 'address mismatch'; end if;
  if coalesce(p_blob->>'ct', '') = '' or coalesce(p_blob->>'salt', '') = '' or coalesce(p_blob->>'iv', '') = ''
     or coalesce((p_blob->>'it')::int, 0) < 100000 then raise exception 'bad backup'; end if;
  insert into private.ton_backups (user_id, address, blob) values (me, a, p_blob)
  on conflict (user_id) do update set address = excluded.address, blob = excluded.blob, updated_at = now();
  return true;
end $$;
revoke all on function public.ton_backup_set(jsonb) from public, anon;
grant execute on function public.ton_backup_set(jsonb) to authenticated;

-- есть ли копия для текущего кошелька (без кода — только да/нет)
create or replace function public.ton_backup_has() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.ton_backups b join public.ton_accounts a on a.user_id = b.user_id and a.address = b.address
                 where b.user_id = auth.uid())
$$;
revoke all on function public.ton_backup_has() from public, anon;
grant execute on function public.ton_backup_has() to authenticated;

create or replace function public.ton_backup_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  sid := nullif(auth.jwt()->>'session_id', '')::uuid;
  if sid is null or not exists (select 1 from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id
      where c.session_id = sid and s.user_id = me and c.authentication_method = 'otp' and c.updated_at > now() - interval '15 minutes')
  then raise exception 'need email code'; end if;
  return (select b.blob from private.ton_backups b join public.ton_accounts a on a.user_id = b.user_id and a.address = b.address
          where b.user_id = me);
end $$;
revoke all on function public.ton_backup_get() from public, anon;
grant execute on function public.ton_backup_get() to authenticated;
