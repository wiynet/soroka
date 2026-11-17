begin;
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

-- ============================================================================
-- Переводы «чеком» (тому, у кого не было кошелька), 2026-11-17.
-- Раньше перевод с временного кошелька доходил, а отметка о завершении — нет (пустой счёт в сети считался «неизвестным»),
-- и перевод навсегда оставался «в ожидании». Теперь отметить завершение может любой из двоих, а кто забрал —
-- решает сервер по адресу, куда ушли деньги: на кошелёк отправителя — «вернулся», иначе — «получен».
-- ============================================================================
create or replace function public.ton_cheque_settle(p_id bigint, p_to text)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c private.ton_cheques; sa text; st text;
begin
  select * into c from private.ton_cheques where id = p_id for update;
  if not found or me is null or me not in (c.recipient_id, c.sender_id) then raise exception 'not allowed'; end if;
  if c.status <> 'sent' then return c.status; end if;
  if coalesce(p_to, '') !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then raise exception 'bad address'; end if;
  select address into sa from public.ton_accounts where user_id = c.sender_id;
  -- адреса сравниваем без первого символа и флага (EQ/UQ — один и тот же кошелёк)
  st := case when sa is not null and substr(sa, 3) = substr(p_to, 3) then 'refunded'
             when me = c.sender_id and sa is null then 'refunded'
             else 'claimed' end;
  update private.ton_cheques set status = st, done_to = p_to, done_at = now() where id = p_id;
  return st;
end $$;
revoke all on function public.ton_cheque_settle(bigint, text) from public, anon;
grant execute on function public.ton_cheque_settle(bigint, text) to authenticated;

-- прошлые переводы, которые в сети уже завершены (сверено по блокчейну 17.11)
update private.ton_cheques set status = 'claimed',  done_to = 'UQCq4UIrT2L6fimlcC7zebXTX9_fYv9M5_9ohuuSGkpPSkfa', done_at = '2026-11-13 21:26:00+00' where id = 1 and status = 'sent';
update private.ton_cheques set status = 'refunded', done_to = 'UQCPFUNA7Dusz1tycxfHwcV2sbH9s87oyTP5mEY2_nwQTTXR', done_at = '2026-11-13 13:10:00+00' where id = 3 and status = 'sent';
update private.ton_cheques set status = 'claimed',  done_to = 'UQD4mn0Z-hDfishgpEiem0l0phftBmd0lplz_jx-hNkzj2t6', done_at = '2026-11-16 16:36:00+00' where id = 4 and status = 'sent';
update private.ton_cheques set status = 'claimed',  done_to = 'UQD4mn0Z-hDfishgpEiem0l0phftBmd0lplz_jx-hNkzj2t6', done_at = '2026-11-17 09:38:00+00' where id = 5 and status = 'sent';

-- ============================================================================
-- Нагрузка: проверка оплат каждую минуту — только пока есть свежие заказы (до 2 часов);
-- по брошенным заказам до 3 дней — раз в 10 минут (вдруг оплатят позже).
-- ============================================================================
create or replace function private.ton_poll()
returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.ton_orders where status = 'pending' and created_at > now() - interval '2 hours')
     or (extract(minute from now())::int % 10 = 0
         and exists (select 1 from public.ton_orders where status = 'pending' and created_at > now() - interval '3 days')) then
    perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/ton-check',
                          body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
end $$;

-- правило доступа к заказам: auth.uid() считается один раз на запрос, а не на каждую строку
drop policy if exists ton_orders_own on public.ton_orders;
create policy ton_orders_own on public.ton_orders for select to authenticated using (user_id = (select auth.uid()));
commit;
