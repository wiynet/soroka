begin;
-- ============================================================================
-- NFT в кошельке Mestario, 2026-11-17: платная витрина.
--   • подарок-NFT, коллекционный юзернейм или номер можно «вывести» в кошелёк Mestario — он появится во вкладке NFT,
--     а в карточке юзернейма или номера будет виден адрес кошелька владельца;
--   • услуга стоит 0,02 TON или вдвое дешевле в MST (по курсу пула); деньги приходят на кошелёк владельца Mestario;
--   • NFT остаётся обычным: его можно продать или передать. Тогда из кошелька прежнего владельца он пропадает,
--     а новый владелец может вывести его в свой кошелёк заново.
-- Оплату находит ton-check (тот же, что для пополнений): перевод на кошелёк Mestario с кодом «NFT-XXXXXX» в комментарии.
-- ============================================================================
create table if not exists private.nft_link_config (
  id boolean primary key default true check (id),
  address text not null,                 -- куда приходят деньги
  ton_nano bigint not null default 20000000,
  mst_share numeric not null default 0.5  -- в MST — вдвое дешевле
);
alter table private.nft_link_config enable row level security;
insert into private.nft_link_config (address) values ('UQCPFUNA7Dusz1tycxfHwcV2sbH9s87oyTP5mEY2_nwQTTXR')
on conflict (id) do update set address = excluded.address;

-- NFT, выведенные в кошелёк: показываем, пока владелец тот же
create table if not exists public.wallet_nfts (
  kind text not null check (kind in ('gift', 'user', 'num')),
  ref text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.wallet_nfts enable row level security;
drop policy if exists wallet_nfts_read on public.wallet_nfts;
create policy wallet_nfts_read on public.wallet_nfts for select to authenticated using (true);

create table if not exists public.nft_link_orders (
  id bigserial primary key,
  code text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null, ref text not null,
  asset text not null check (asset in ('ton', 'mst')),
  units bigint not null,                 -- нанотоны или единицы MST (1 MST = 10^9)
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  tx text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.nft_link_orders enable row level security;
drop policy if exists nft_link_orders_own on public.nft_link_orders;
create policy nft_link_orders_own on public.nft_link_orders for select to authenticated using (user_id = (select auth.uid()));

-- владелец NFT сейчас
create or replace function private.nft_owner(p_kind text, p_ref text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'gift' then (select g.to_id from public.gifts g where g.id::text = p_ref and g.nft_number is not null and g.sold_at is null)
    when 'user' then (select u.owner_id from public.collectible_usernames u where u.username = p_ref)
    when 'num' then (select n.owner_id from public.collectible_numbers n where n.number = p_ref)
  end;
$$;

-- цена: TON и MST (MST — по самой низкой цене пула за 6 часов, как и остальные оплаты в MST)
create or replace function public.nft_link_quote() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('address', c.address, 'ton', c.ton_nano::text,
    'mst', (select (ceil(c.ton_nano * c.mst_share * 1e9 / min(p.nano_per_mst) / 1e7) * 1e7)::bigint::text
            from private.mst_prices p where p.at > now() - interval '6 hours'),
    'master', (select master from private.mst_config where enabled))
  from private.nft_link_config c;
$$;
revoke all on function public.nft_link_quote() from public, anon;
grant execute on function public.nft_link_quote() to authenticated;

create or replace function public.nft_link_order(p_kind text, p_ref text, p_asset text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); q jsonb; u bigint; v_code text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; i int;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_kind not in ('gift', 'user', 'num') or p_asset not in ('ton', 'mst') then raise exception 'bad kind'; end if;
  if private.nft_owner(p_kind, p_ref) is distinct from me then raise exception 'not yours'; end if;
  if exists (select 1 from public.wallet_nfts w where w.kind = p_kind and w.ref = p_ref and w.user_id = me) then raise exception 'already linked'; end if;
  if (select count(*) from public.nft_link_orders where user_id = me and created_at > now() - interval '1 hour') >= 20 then raise exception 'too many orders'; end if;
  q := public.nft_link_quote();
  u := case when p_asset = 'ton' then (q->>'ton')::bigint else (q->>'mst')::bigint end;
  if u is null or u <= 0 then raise exception 'mst off'; end if;
  update public.nft_link_orders set status = 'expired' where user_id = me and kind = p_kind and ref = p_ref and status = 'pending';
  loop
    b := extensions.gen_random_bytes(6); v_code := 'NFT-';
    for i in 0..5 loop v_code := v_code || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.nft_link_orders o where o.code = v_code);
  end loop;
  insert into public.nft_link_orders (code, user_id, kind, ref, asset, units) values (v_code, me, p_kind, p_ref, p_asset, u);
  return jsonb_build_object('code', v_code, 'address', q->>'address', 'units', u::text, 'asset', p_asset, 'master', q->>'master');
end $$;
revoke all on function public.nft_link_order(text, text, text) from public, anon;
grant execute on function public.nft_link_order(text, text, text) to authenticated;

create or replace function public.nft_link_status(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.nft_link_orders where code = upper(trim(p_code)) and user_id = auth.uid();
$$;
revoke all on function public.nft_link_status(text) from public, anon;
grant execute on function public.nft_link_status(text) to authenticated;

-- адрес кошелька Mestario, к которому выведен NFT (для карточки юзернейма или номера)
create or replace function public.nft_wallet_of(p_kind text, p_ref text) returns text
language sql stable security definer set search_path = '' as $$
  select a.address from public.wallet_nfts w join public.ton_accounts a on a.user_id = w.user_id
   where w.kind = p_kind and w.ref = p_ref and w.user_id = private.nft_owner(p_kind, p_ref) and auth.uid() is not null;
$$;
revoke all on function public.nft_wallet_of(text, text) from public, anon;
grant execute on function public.nft_wallet_of(text, text) to authenticated;

-- для сервера: незакрытые заказы и зачёт оплаты
create or replace function public.nft_link_pending() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('address', (select address from private.nft_link_config), 'master', (select master from private.mst_config where enabled),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'asset', asset, 'units', units::text))
                        from public.nft_link_orders where status = 'pending' and created_at > now() - interval '3 days'), '[]'::jsonb));
$$;
revoke all on function public.nft_link_pending() from public, anon, authenticated;
grant execute on function public.nft_link_pending() to service_role;

create or replace function public.nft_link_settle(p_code text, p_tx text, p_asset text, p_units bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.nft_link_orders;
begin
  select * into o from public.nft_link_orders where code = upper(trim(p_code)) for update;
  if not found then return 'unknown'; end if;
  if o.status = 'paid' then return 'already'; end if;
  if coalesce(p_tx, '') = '' or exists (select 1 from public.nft_link_orders where tx = p_tx) then return 'tx used'; end if;
  if p_asset is distinct from o.asset or p_units is null or p_units < o.units then return 'short'; end if;
  update public.nft_link_orders set status = 'paid', tx = p_tx, paid_at = now() where id = o.id;
  -- NFT мог уйти к другому, пока шла оплата, — тогда деньги разбираем вручную, а в кошелёк не выводим
  if private.nft_owner(o.kind, o.ref) is distinct from o.user_id then return 'not owner'; end if;
  insert into public.wallet_nfts (kind, ref, user_id) values (o.kind, o.ref, o.user_id)
  on conflict (kind, ref) do update set user_id = excluded.user_id, linked_at = now();
  return 'paid';
end $$;
revoke all on function public.nft_link_settle(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.nft_link_settle(text, text, text, bigint) to service_role;

-- проверка оплат раз в минуту — и для заказов NFT
create or replace function private.ton_poll()
returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.ton_orders where status = 'pending' and created_at > now() - interval '2 hours')
     or exists (select 1 from public.nft_link_orders where status = 'pending' and created_at > now() - interval '2 hours')
     or (extract(minute from now())::int % 10 = 0
         and (exists (select 1 from public.ton_orders where status = 'pending' and created_at > now() - interval '3 days')
              or exists (select 1 from public.nft_link_orders where status = 'pending' and created_at > now() - interval '3 days'))) then
    perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/ton-check',
                          body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
end $$;
commit;
