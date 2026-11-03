begin;
-- ============================================================================
-- Оплата в USDT TRC-20 (сеть TRON), 2026-11-03.
-- В переводах TRC-20 нет комментария, поэтому заказ узнаём по уникальной сумме: к цене добавляется
-- 1–99 центов, свободных среди незакрытых USDT-заказов. Функция ton-check смотрит входящие переводы
-- токена USDT (контракт TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) на адрес из private.usdt_config через TronGrid.
-- ============================================================================
create table if not exists private.usdt_config (
  id boolean primary key default true check (id),
  address text,
  micro_per_mest bigint not null,          -- микро-USDT за 1 Mest (1 USDT = 1 000 000)
  enabled boolean not null default false
);
alter table private.usdt_config enable row level security;
alter table private.usdt_config add column if not exists ton_usd numeric;
alter table private.usdt_config add column if not exists rate_at timestamptz;
-- цена в USDT = цена в TON × курс TON/USD (CoinGecko, обновляется каждый час); 1,17 — курс на 03.11.2026
insert into private.usdt_config (address, micro_per_mest, enabled, ton_usd, rate_at)
values ('TNtTdMRDPksZf9zSoRtWmzgLZK6g9dNEeP', 2340, true, 1.17, now())
on conflict (id) do update set address = excluded.address, micro_per_mest = excluded.micro_per_mest, enabled = excluded.enabled,
  ton_usd = excluded.ton_usd, rate_at = excluded.rate_at;

alter table public.ton_orders add column if not exists asset text not null default 'ton';
alter table public.ton_orders add column if not exists usdt_micro bigint;
alter table public.ton_orders drop constraint if exists ton_orders_asset_check;
alter table public.ton_orders add constraint ton_orders_asset_check check (asset in ('ton', 'usdt'));
create index if not exists ton_orders_usdt_pending on public.ton_orders (usdt_micro) where asset = 'usdt' and status = 'pending';

-- что показать на странице заказа
create or replace function public.pay_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'usdt_on', coalesce((select enabled and address is not null from private.usdt_config), false),
    'usdt_address', (select address from private.usdt_config where enabled),
    'usdt_micro_per_mest', (select micro_per_mest from private.usdt_config where enabled),
    'nano_per_mest', (select nano_per_mest::text from private.ton_config),
    'ton_usd', (select ton_usd from private.usdt_config where enabled));
$$;
revoke all on function public.pay_info() from public, anon;
grant execute on function public.pay_info() to authenticated;

-- заказ в USDT: пополнение Mest или премиум на 30 дней
create or replace function public.usdt_order(p_kind text, p_mest integer)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); c private.usdt_config; base bigint; amt bigint; k int; v_code text; v_mest bigint; v_ref bigint;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  select * into c from private.usdt_config;
  if not found or not c.enabled or c.address is null then raise exception 'usdt off'; end if;
  if not private.ton_rate_ok(me) then raise exception 'too many orders'; end if;
  if p_kind = 'mest' then
    if p_mest is null or p_mest < 10 or p_mest > 100000 then raise exception 'bad amount'; end if;
    v_mest := p_mest;
  elsif p_kind = 'premium' then
    v_mest := 150; v_ref := 30;
  else
    raise exception 'bad kind';
  end if;
  base := ceil(v_mest * c.micro_per_mest / 10000.0)::bigint * 10000;   -- до целых центов вверх
  amt := null;
  for k in 1..99 loop
    if not exists (select 1 from public.ton_orders where asset = 'usdt' and status = 'pending' and usdt_micro = base + k * 10000
                   and created_at > now() - interval '3 hours') then
      amt := base + k * 10000; exit;
    end if;
  end loop;
  if amt is null then raise exception 'busy'; end if;
  v_code := private.ton_new_code();
  insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to, asset, usdt_micro)
  values (me, v_code, v_mest, 1, p_kind, v_ref, c.address, 'usdt', amt);
  return jsonb_build_object('code', v_code, 'micro', amt::text, 'address', c.address, 'kind', p_kind, 'expires_at', now() + interval '1 hour');
end $$;
revoke all on function public.usdt_order(text, integer) from public, anon;
grant execute on function public.usdt_order(text, integer) to authenticated;

-- TON-проверка не трогает USDT-заказы
create or replace function public.ton_pending()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('address', (select address from private.ton_config),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'nano', o.nano::text,
                          'to', coalesce(o.pay_to, (select address from private.ton_config))) order by o.id desc)
                        from public.ton_orders o
                        where o.status = 'pending' and o.asset = 'ton' and o.created_at > now() - interval '3 days'), '[]'::jsonb));
$$;

-- для сервера: незакрытые USDT-заказы
create or replace function public.usdt_pending()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('address', (select address from private.usdt_config where enabled),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'micro', usdt_micro::text, 'created', extract(epoch from created_at) * 1000))
                        from public.ton_orders where asset = 'usdt' and status = 'pending' and created_at > now() - interval '3 hours'), '[]'::jsonb));
$$;
revoke all on function public.usdt_pending() from public, anon, authenticated;
grant execute on function public.usdt_pending() to service_role;

-- для сервера: зачесть найденный перевод USDT (сумма уже сверена точно)
create or replace function public.usdt_settle(p_code text, p_tx text, p_micro bigint, p_from text, p_to text, p_ts_ms bigint)
returns text language plpgsql security definer set search_path to '' as $$
declare o public.ton_orders; c private.usdt_config;
begin
  select * into c from private.usdt_config;
  select * into o from public.ton_orders where code = upper(trim(p_code)) and asset = 'usdt' for update;
  if not found then return 'unknown'; end if;
  if o.status <> 'pending' then return 'already'; end if;
  if coalesce(p_tx, '') = '' or p_micro is distinct from o.usdt_micro then return 'bad'; end if;
  if p_to is distinct from o.pay_to then return 'wrong address'; end if;
  if to_timestamp(p_ts_ms / 1000.0) < o.created_at - interval '1 minute' then return 'too early'; end if;
  if exists (select 1 from public.ton_orders where tx_hash = p_tx) then return 'tx used'; end if;
  if o.kind = 'mest' then
    update public.ton_orders set status = 'paid', tx_hash = p_tx, credited = o.mest, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
    perform private.credit(o.user_id, o.mest, 'Пополнение USDT · ' || o.code);
  else
    update public.profiles set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => coalesce(o.ref, 30)::int) where id = o.user_id;
    update public.ton_orders set status = 'paid', tx_hash = p_tx, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
  end if;
  return 'paid';
end $$;
revoke all on function public.usdt_settle(text, text, bigint, text, text, bigint) from public, anon, authenticated;
grant execute on function public.usdt_settle(text, text, bigint, text, text, bigint) to service_role;

-- расписание ton-check заодно проверяет и USDT
create or replace function private.ton_poll()
returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.ton_orders where status = 'pending' and created_at > now() - interval '3 days') then
    perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/ton-check',
                          body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
  end if;
end $$;

-- новый курс: 1 Mest = 0,002 TON (уже созданные заказы оплачиваются и зачисляются по своему курсу)
update private.ton_config set nano_per_mest = 2000000 where id;

-- курс TON/USD для цены в USDT: функция ton-check с {"action":"rate"} берёт его у CoinGecko и вызывает это
create or replace function public.usdt_set_rate(p_ton_usd numeric)
returns bigint language plpgsql security definer set search_path to '' as $$
declare v bigint;
begin
  if p_ton_usd is null or p_ton_usd < 0.05 or p_ton_usd > 500 then raise exception 'bad rate'; end if;
  v := greatest(1, round((select nano_per_mest from private.ton_config) / 1e9 * p_ton_usd * 1e6))::bigint;
  update private.usdt_config set ton_usd = p_ton_usd, micro_per_mest = v, rate_at = now() where id;
  return v;
end $$;
revoke all on function public.usdt_set_rate(numeric) from public, anon, authenticated;
grant execute on function public.usdt_set_rate(numeric) to service_role;

create or replace function private.usdt_rate_poll()
returns void language plpgsql security definer set search_path to '' as $$
begin
  perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/ton-check',
                        body := '{"action": "rate"}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;
select cron.schedule('usdt-rate', '13 * * * *', 'select private.usdt_rate_poll()');

-- зачисление TON по курсу самого заказа
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
    gain := least(floor(p_nano::numeric * o.mest / o.nano)::bigint, o.mest * 10);   -- по курсу самого заказа
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
    gain := floor(p_nano::numeric * o.mest / o.nano)::bigint;   -- по курсу самого заказа
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
commit;
