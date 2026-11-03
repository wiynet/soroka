begin;
-- ============================================================================
-- Премиум и NFT-юзернеймы/номера за TON (TON Connect), 2026-11-03
-- ============================================================================

-- 1. Заказы: вид (mest / premium / listing), ссылка (дни премиума или id лота), куда должны прийти деньги
alter table public.ton_orders add column if not exists kind text not null default 'mest';
alter table public.ton_orders add column if not exists ref bigint;
alter table public.ton_orders add column if not exists pay_to text;
alter table public.ton_orders add column if not exists note text;
alter table public.ton_orders drop constraint if exists ton_orders_kind_check;
alter table public.ton_orders add constraint ton_orders_kind_check check (kind in ('mest', 'premium', 'listing'));
alter table public.ton_orders drop constraint if exists ton_orders_status_check;
alter table public.ton_orders add constraint ton_orders_status_check check (status in ('pending', 'paid', 'review'));

-- 2. Лоты: цена в TON, кошелёк продавца, резерв на время оплаты
alter table public.nft_listings add column if not exists ton_nano bigint;
alter table public.nft_listings add column if not exists ton_to text;
alter table public.nft_listings add column if not exists hold_by uuid references public.profiles(id) on delete set null;
alter table public.nft_listings add column if not exists hold_until timestamptz;
alter table public.nft_listings add column if not exists sold_ton_nano bigint;
alter table public.nft_listings alter column price drop not null;
alter table public.nft_listings drop constraint if exists nft_listings_price_check;
alter table public.nft_listings add constraint nft_listings_price_check
  check ((price is null or (price > 0 and price <= 1000000000)) and (price is not null or ton_nano is not null));
alter table public.nft_listings drop constraint if exists nft_listings_ton_check;
alter table public.nft_listings add constraint nft_listings_ton_check
  check (ton_nano is null or (ton_nano >= 10000000 and ton_nano <= 1000000000000000));

-- адрес TON в основной сети: EQ…/UQ… (48 символов) или 0:<64 hex>
create or replace function private.ton_addr_ok(p text)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce(p ~ '^(EQ|UQ)[A-Za-z0-9_-]{46}$' or p ~ '^0:[0-9a-fA-F]{64}$', false);
$$;

-- лот сейчас оплачивает кто-то другой
create or replace function private.held_by_other(l public.nft_listings, me uuid)
returns boolean language sql stable set search_path to '' as $$
  select l.hold_until is not null and l.hold_until > now() and l.hold_by is distinct from me;
$$;

-- 3. Выставить свой юзернейм/номер: цена в Mest, в TON или обе; TON идут на кошелёк продавца
create or replace function public.list_mine(p_username text, p_number text, p_price bigint, p_ton_nano bigint, p_ton_to text)
returns bigint language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); n text; u text; lid bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_price is null and p_ton_nano is null then raise exception 'need price'; end if;
  if p_price is not null and (p_price <= 0 or p_price > 1000000000) then raise exception 'bad price'; end if;
  if p_ton_nano is not null and (p_ton_nano < 10000000 or p_ton_nano > 1000000000000000) then raise exception 'bad ton price'; end if;
  if p_ton_nano is not null and not private.ton_addr_ok(p_ton_to) then raise exception 'bad address'; end if;
  if p_number is not null then
    n := private.norm_number(p_number);
    if not exists (select 1 from public.collectible_numbers where number = n and owner_id = me) then raise exception 'not owner'; end if;
    if exists (select 1 from public.nft_listings where number = n and status = 'open') then raise exception 'already listed'; end if;
    insert into public.nft_listings (number, seller_id, by_admin, price, ton_nano, ton_to, created_by)
    values (n, me, false, p_price, p_ton_nano, case when p_ton_nano is null then null else p_ton_to end, me) returning id into lid;
  else
    u := lower(btrim(coalesce(p_username, '')));
    if not exists (select 1 from public.collectible_usernames where username = u and owner_id = me) then raise exception 'not owner'; end if;
    if exists (select 1 from public.nft_listings where username = u and status = 'open') then raise exception 'already listed'; end if;
    insert into public.nft_listings (username, seller_id, by_admin, price, ton_nano, ton_to, created_by)
    values (u, me, false, p_price, p_ton_nano, case when p_ton_nano is null then null else p_ton_to end, me) returning id into lid;
  end if;
  return lid;
end $$;
revoke all on function public.list_mine(text, text, bigint, bigint, text) from public, anon;
grant execute on function public.list_mine(text, text, bigint, bigint, text) to authenticated;

-- админ выставляет новый юзернейм/номер от имени Mestario: TON идут на кошелёк Mestario
create or replace function public.admin_list_lot(p_username text, p_number text, p_price bigint, p_ton_nano bigint)
returns bigint language plpgsql security definer set search_path to '' as $$
declare n text; u text; lid bigint;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_price is null and p_ton_nano is null then raise exception 'need price'; end if;
  if p_price is not null and (p_price <= 0 or p_price > 1000000000) then raise exception 'bad price'; end if;
  if p_ton_nano is not null and (p_ton_nano < 10000000 or p_ton_nano > 1000000000000000) then raise exception 'bad ton price'; end if;
  if p_number is not null then
    n := private.norm_number(p_number);
    if exists (select 1 from public.collectible_numbers where replace(number, ' ', '') = replace(n, ' ', '') and number <> n) then raise exception 'number taken'; end if;
    insert into public.collectible_numbers (number, owner_id, granted_by) values (n, null, auth.uid()) on conflict (number) do nothing;
    if exists (select 1 from public.collectible_numbers where number = n and owner_id is not null) then raise exception 'name owned'; end if;
    if exists (select 1 from public.nft_listings where number = n and status = 'open') then raise exception 'already listed'; end if;
    insert into public.nft_listings (number, seller_id, by_admin, price, ton_nano, created_by) values (n, null, true, p_price, p_ton_nano, auth.uid()) returning id into lid;
  else
    u := lower(btrim(coalesce(p_username, '')));
    if u !~ '^[a-z0-9_]{1,32}$' then raise exception 'bad name'; end if;
    if exists (select 1 from public.profiles where username = u) then raise exception 'name in use'; end if;
    insert into public.collectible_usernames (username, owner_id, granted_by) values (u, null, auth.uid()) on conflict (username) do nothing;
    if exists (select 1 from public.collectible_usernames where username = u and owner_id is not null) then raise exception 'name owned'; end if;
    if exists (select 1 from public.nft_listings where username = u and status = 'open') then raise exception 'already listed'; end if;
    insert into public.nft_listings (username, seller_id, by_admin, price, ton_nano, created_by) values (u, null, true, p_price, p_ton_nano, auth.uid()) returning id into lid;
  end if;
  return lid;
end $$;
revoke all on function public.admin_list_lot(text, text, bigint, bigint) from public, anon;
grant execute on function public.admin_list_lot(text, text, bigint, bigint) to authenticated;

-- 4. Покупка за Mest, снятие с продажи и принятие предложения — не во время чужой оплаты в TON
create or replace function public.buy_listing(p_listing bigint)
returns bigint language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); l public.nft_listings;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  select * into l from public.nft_listings where id = p_listing for update;
  if not found or l.status <> 'open' then raise exception 'not open'; end if;
  if l.seller_id = me then raise exception 'own listing'; end if;
  if l.price is null then raise exception 'ton only'; end if;
  if private.held_by_other(l, me) then raise exception 'reserved'; end if;
  perform private.refund_offers(p_listing, null);
  perform private.spend(me, l.price, 'Покупка ' || private.lot_label(l));
  perform private.settle_listing(p_listing, me, l.price);
  return (select balance from public.wallets where user_id = me);
end $$;

create or replace function public.cancel_listing(p_listing bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare l public.nft_listings;
begin
  select * into l from public.nft_listings where id = p_listing for update;
  if not found or l.status <> 'open' or not private.manages_listing(l) then raise exception 'not allowed'; end if;
  if private.held_by_other(l, null) then raise exception 'reserved'; end if;
  perform private.refund_offers(p_listing, null);
  update public.nft_listings set status = 'cancelled', closed_at = now() where id = p_listing;
end $$;

create or replace function public.answer_offer(p_offer bigint, p_accept boolean)
returns void language plpgsql security definer set search_path to '' as $$
declare o public.nft_offers; l public.nft_listings;
begin
  if private.is_banned() then raise exception 'not allowed'; end if;
  select * into o from public.nft_offers where id = p_offer for update;
  if not found or o.status <> 'pending' then raise exception 'not allowed'; end if;
  select * into l from public.nft_listings where id = o.listing_id for update;
  if l.status <> 'open' or not private.manages_listing(l) then raise exception 'not allowed'; end if;
  if p_accept then
    if private.held_by_other(l, null) then raise exception 'reserved'; end if;
    update public.nft_offers set status = 'accepted', closed_at = now() where id = p_offer;
    perform private.refund_offers(l.id, p_offer);
    perform private.settle_listing(l.id, o.bidder_id, o.amount);
  else
    update public.nft_offers set status = 'rejected', closed_at = now() where id = p_offer;
    perform private.credit(o.bidder_id, o.amount, 'Возврат предложения за ' || private.lot_label(l));
  end if;
end $$;

-- предложение в Mest на лот только за TON сравнивать не с чем — только меньше цены в Mest, если она есть
create or replace function public.make_offer(p_listing bigint, p_amount bigint)
returns bigint language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); l public.nft_listings; old public.nft_offers;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  select * into l from public.nft_listings where id = p_listing for update;
  if not found or l.status <> 'open' then raise exception 'not open'; end if;
  if l.seller_id = me then raise exception 'own listing'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then raise exception 'bad amount'; end if;
  if l.price is not null and p_amount >= l.price then raise exception 'use buy'; end if;
  select * into old from public.nft_offers where listing_id = p_listing and bidder_id = me and status = 'pending' for update;
  if found then
    update public.nft_offers set status = 'cancelled', closed_at = now() where id = old.id;
    perform private.credit(me, old.amount, 'Возврат предложения за ' || private.lot_label(l));
  end if;
  perform private.spend(me, p_amount, 'Предложение за ' || private.lot_label(l));
  insert into public.nft_offers (listing_id, bidder_id, amount) values (p_listing, me, p_amount);
  return (select balance from public.wallets where user_id = me);
end $$;

-- передача лота после оплаты в TON: продавцу Mest не начисляются — TON он уже получил на свой кошелёк
create or replace function private.settle_listing_ton(p_listing bigint, p_buyer uuid, p_nano bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare l public.nft_listings; owner uuid;
begin
  select * into l from public.nft_listings where id = p_listing for update;
  if l.number is not null then
    select owner_id into owner from public.collectible_numbers where number = l.number for update;
  else
    select owner_id into owner from public.collectible_usernames where username = l.username for update;
  end if;
  if l.by_admin then
    if owner is not null then raise exception 'stale listing'; end if;
  elsif owner is distinct from l.seller_id or l.seller_id is null then
    raise exception 'stale listing';
  end if;
  if l.number is not null then
    update public.collectible_numbers set owner_id = p_buyer, granted_at = now() where number = l.number;
  else
    update public.collectible_usernames set owner_id = p_buyer, granted_at = now() where username = l.username;
  end if;
  update public.nft_listings set status = 'sold', buyer_id = p_buyer, sold_price = null, sold_ton_nano = p_nano,
         hold_by = null, hold_until = null, closed_at = now() where id = p_listing;
end $$;

-- 5. Заказы на премиум и на лот
create or replace function private.ton_new_code()
returns text language plpgsql volatile set search_path to '' as $$
declare abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; c text; i int;
begin
  loop
    b := extensions.gen_random_bytes(6); c := 'MST-';
    for i in 0..5 loop c := c || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.ton_orders o where o.code = c);
  end loop;
  return c;
end $$;

create or replace function private.ton_rate_ok(me uuid)
returns boolean language sql stable set search_path to '' as $$
  select (select count(*) from public.ton_orders where user_id = me and created_at > now() - interval '10 minutes') < 10;
$$;

create or replace function public.ton_order_premium()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); c private.ton_config; v_code text; v_nano bigint;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  if not private.ton_rate_ok(me) then raise exception 'too many orders'; end if;
  select * into c from private.ton_config;
  v_nano := 150 * c.nano_per_mest;   -- 150 Mest за 30 дней = 1,5 TON
  v_code := private.ton_new_code();
  insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to) values (me, v_code, 150, v_nano, 'premium', 30, c.address);
  return jsonb_build_object('code', v_code, 'nano', v_nano::text, 'address', c.address, 'kind', 'premium');
end $$;
revoke all on function public.ton_order_premium() from public, anon;
grant execute on function public.ton_order_premium() to authenticated;

create or replace function public.ton_order_listing(p_listing bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); c private.ton_config; l public.nft_listings; o public.ton_orders; v_to text; v_code text;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  select * into c from private.ton_config;
  select * into l from public.nft_listings where id = p_listing for update;
  if not found or l.status <> 'open' then raise exception 'not open'; end if;
  if l.ton_nano is null then raise exception 'no ton price'; end if;
  if l.seller_id = me then raise exception 'own listing'; end if;
  if private.held_by_other(l, me) then raise exception 'reserved'; end if;
  v_to := case when l.by_admin then c.address else l.ton_to end;
  if not private.ton_addr_ok(v_to) then raise exception 'bad address'; end if;
  -- свой незакрытый заказ на этот лот — продлеваем резерв и отдаём его же
  select * into o from public.ton_orders where user_id = me and kind = 'listing' and ref = p_listing and status = 'pending'
     and nano = l.ton_nano and pay_to = v_to and created_at > now() - interval '1 hour' order by id desc limit 1;
  if not found then
    if not private.ton_rate_ok(me) then raise exception 'too many orders'; end if;
    v_code := private.ton_new_code();
    insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to) values (me, v_code, 1, l.ton_nano, 'listing', p_listing, v_to)
    returning * into o;
  end if;
  update public.nft_listings set hold_by = me, hold_until = now() + interval '20 minutes' where id = p_listing;
  return jsonb_build_object('code', o.code, 'nano', o.nano::text, 'address', v_to, 'kind', 'listing', 'hold_until', now() + interval '20 minutes');
end $$;
revoke all on function public.ton_order_listing(bigint) from public, anon;
grant execute on function public.ton_order_listing(bigint) to authenticated;

-- 6. Для сервера: незакрытые заказы с адресом, куда должны прийти деньги
create or replace function public.ton_pending()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('address', (select address from private.ton_config),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'nano', o.nano::text,
                          'to', coalesce(o.pay_to, (select address from private.ton_config))) order by o.id desc)
                        from public.ton_orders o
                        where o.status = 'pending' and o.created_at > now() - interval '3 days'), '[]'::jsonb));
$$;
revoke all on function public.ton_pending() from public, anon, authenticated;
grant execute on function public.ton_pending() to service_role;

-- 7. Зачесть найденный перевод. p_to — адрес, на который он пришёл (сервер смотрит именно его)
drop function if exists public.ton_settle(text, text, bigint, text);
create or replace function public.ton_settle(p_code text, p_tx text, p_nano bigint, p_from text, p_to text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare o public.ton_orders; c private.ton_config; gain bigint; l public.nft_listings; why text;
begin
  select * into c from private.ton_config;
  select * into o from public.ton_orders where code = upper(trim(p_code)) for update;
  if not found then return 'unknown'; end if;
  if o.status <> 'pending' then return 'already'; end if;
  if coalesce(p_tx, '') = '' or p_nano is null or p_nano <= 0 then return 'bad'; end if;
  if p_to is distinct from coalesce(o.pay_to, c.address) then return 'wrong address'; end if;
  if exists (select 1 from public.ton_orders where tx_hash = p_tx) then return 'tx used'; end if;

  if o.kind = 'mest' then
    gain := least(p_nano / c.nano_per_mest, o.mest * 10);
    if gain <= 0 then return 'too small'; end if;
    update public.ton_orders set status = 'paid', tx_hash = p_tx, paid_nano = p_nano, credited = gain, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
    perform private.credit(o.user_id, gain, 'Пополнение TON · ' || o.code);
    return 'paid';
  end if;

  if o.kind = 'premium' then
    if p_nano >= o.nano then
      update public.profiles set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => o.ref::int) where id = o.user_id;
      update public.ton_orders set status = 'paid', tx_hash = p_tx, paid_nano = p_nano, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
      return 'paid';
    end if;
    -- перевели меньше: премиум не даём, пришедшее зачисляем в Mest
    gain := p_nano / c.nano_per_mest;
    update public.ton_orders set status = 'paid', tx_hash = p_tx, paid_nano = p_nano, credited = nullif(gain, 0), from_addr = left(p_from, 100), paid_at = now(),
           note = 'short' where id = o.id;
    if gain > 0 then perform private.credit(o.user_id, gain, 'Оплата премиума в TON — не хватило суммы · ' || o.code); end if;
    return 'short';
  end if;

  -- лот: передаём, если он ещё открыт, не занят другим покупателем и сумма полная; иначе — на ручной разбор
  select * into l from public.nft_listings where id = o.ref for update;
  why := case when not found then 'listing gone'
              when l.status <> 'open' then 'listing ' || l.status
              when private.held_by_other(l, o.user_id) then 'held by other'
              when p_nano < o.nano then 'short'
              when coalesce(l.ton_nano, 0) <> o.nano then 'price changed' end;
  if why is null then
    begin
      perform private.refund_offers(l.id, null);
      perform private.settle_listing_ton(l.id, o.user_id, p_nano);
    exception when others then why := 'settle: ' || sqlerrm;
    end;
  end if;
  update public.ton_orders set status = case when why is null then 'paid' else 'review' end, tx_hash = p_tx, paid_nano = p_nano,
         from_addr = left(p_from, 100), paid_at = now(), note = why where id = o.id;
  return case when why is null then 'paid' else 'review' end;
end $$;
revoke all on function public.ton_settle(text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.ton_settle(text, text, bigint, text, text) to service_role;

update public.ton_orders set pay_to = (select address from private.ton_config) where pay_to is null;
commit;
