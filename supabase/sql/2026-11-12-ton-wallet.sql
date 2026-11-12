-- Встроенный TON-кошелёк Mestario (некастодиальный).
-- Сид-фраза создаётся и хранится только на устройстве человека (зашифрована его паролем); сервер знает лишь публичный адрес,
-- чтобы друзья могли переводить по @юзернейму, и хранит карточки переводов в чате.
create table if not exists public.ton_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^[EU]Q[A-Za-z0-9_-]{46}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ton_accounts enable row level security;
drop policy if exists "ton_accounts own read" on public.ton_accounts;
create policy "ton_accounts own read" on public.ton_accounts for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ton_accounts from anon, authenticated;
grant select on public.ton_accounts to authenticated;

-- свой адрес: записать (при создании или восстановлении кошелька) или убрать
create or replace function public.ton_account_set(p_addr text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_addr is null then delete from public.ton_accounts where user_id = me; return; end if;
  if p_addr !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then raise exception 'bad address'; end if;
  insert into public.ton_accounts (user_id, address) values (me, p_addr)
  on conflict (user_id) do update set address = excluded.address, updated_at = now();
end $$;
revoke all on function public.ton_account_set(text) from public, anon;
grant execute on function public.ton_account_set(text) to authenticated;

-- адрес кошелька человека — чтобы перевести ему по @юзернейму или прямо из чата
create or replace function public.ton_address_of(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select a.address from public.ton_accounts a join public.profiles p on p.id = a.user_id
  where a.user_id = p_user and auth.uid() is not null and p.deleted_at is null and p.banned_at is null
$$;
revoke all on function public.ton_address_of(uuid) from public, anon;
grant execute on function public.ton_address_of(uuid) to authenticated;

-- карточка перевода в чате: {v, cur, amt, to, at, cmt?}. Адрес отправителя сервер подставляет сам —
-- карточку нельзя выдать за чужой перевод; подтверждение берётся из блокчейна по этому адресу.
alter table public.messages add column if not exists pay jsonb;
alter table public.messages drop constraint if exists messages_pay_check;
alter table public.messages add constraint messages_pay_check check (pay is null or (jsonb_typeof(pay) = 'object' and length(pay::text) <= 700));
grant insert (pay) on public.messages to authenticated;

create or replace function private.messages_pay_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if new.pay is null then return new; end if;
  select address into a from public.ton_accounts where user_id = new.sender_id;
  if a is null then raise exception 'no ton wallet'; end if;
  if coalesce(new.pay->>'cur', '') not in ('TON', 'USDT') or coalesce(new.pay->>'amt', '') !~ '^[0-9]{1,12}(\.[0-9]{1,9})?$'
     or coalesce(new.pay->>'to', '') !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then
    raise exception 'bad pay';
  end if;
  new.pay := jsonb_build_object('v', 1, 'cur', new.pay->>'cur', 'amt', new.pay->>'amt', 'to', new.pay->>'to', 'from', a,
                                'at', (extract(epoch from now()) * 1000)::bigint,
                                'cmt', left(coalesce(new.pay->>'cmt', ''), 120));
  return new;
end $$;
drop trigger if exists messages_pay_guard on public.messages;
create trigger messages_pay_guard before insert on public.messages for each row when (new.pay is not null) execute function private.messages_pay_guard();
