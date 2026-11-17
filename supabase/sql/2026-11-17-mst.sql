begin;
-- ============================================================================
-- MestCoin (MST), 2026-11-17: токен Mestario в сети TON.
--   • оплата Mest и премиума в MST: перевод токена на кошелёк Mestario с кодом заказа в комментарии;
--   • цена в MST считается по пулу DeDust MST/TON. Чтобы цену нельзя было «накрутить» (поднять MST в пуле,
--     заплатить дорогими MST и продать обратно), берётся САМАЯ НИЗКАЯ цена MST за последние 6 часов;
--   • карточки переводов MST в чатах.
-- Функция ton-check раз в 5 минут присылает цену пула ({"action":"mst_rate"}) и находит оплаты MST.
-- ============================================================================
create table if not exists private.mst_config (
  id boolean primary key default true check (id),
  master text not null,                    -- адрес токена MST (raw 0:…)
  pool text not null,                      -- пул DeDust MST/TON (raw 0:…)
  enabled boolean not null default false,
  units_per_mest bigint,                   -- сколько единиц MST (1 MST = 10^9) стоит 1 Mest
  rate_at timestamptz
);
alter table private.mst_config enable row level security;
insert into private.mst_config (master, pool, enabled)
values ('0:51e69b7d0cb2eca55c1fcc435b83abc58168a924932414179005446333e09f51',
        '0:490896988f3188f0e08e62362d5542272fe43f8d7d661744985260424e5b6332', true)
on conflict (id) do update set master = excluded.master, pool = excluded.pool, enabled = excluded.enabled;

-- снимки цены пула: нано-TON за 1 MST
create table if not exists private.mst_prices (
  at timestamptz not null default now(),
  nano_per_mst numeric not null check (nano_per_mst > 0)
);
alter table private.mst_prices enable row level security;
create index if not exists mst_prices_at on private.mst_prices (at);

alter table public.ton_orders add column if not exists mst_units bigint;
alter table public.ton_orders drop constraint if exists ton_orders_asset_check;
alter table public.ton_orders add constraint ton_orders_asset_check check (asset in ('ton', 'usdt', 'mst'));

-- для сервера: новая цена пула. Возвращает курс, по которому сейчас продаём Mest за MST
create or replace function public.mst_set_price(p_nano_per_mst numeric)
returns bigint language plpgsql security definer set search_path to '' as $$
declare lo numeric; v bigint;
begin
  if p_nano_per_mst is null or p_nano_per_mst <= 0 or p_nano_per_mst > 1e15 then raise exception 'bad price'; end if;
  insert into private.mst_prices (nano_per_mst) values (p_nano_per_mst);
  delete from private.mst_prices where at < now() - interval '2 days';
  -- самая низкая цена MST за 6 часов: накрутка цены вверх ничего не даёт
  select min(nano_per_mst) into lo from private.mst_prices where at > now() - interval '6 hours';
  v := ceil((select nano_per_mest from private.ton_config) * 1e9 / lo)::bigint;
  update private.mst_config set units_per_mest = greatest(v, 1), rate_at = now() where id;
  return v;
end $$;
revoke all on function public.mst_set_price(numeric) from public, anon, authenticated;
grant execute on function public.mst_set_price(numeric) to service_role;

-- что показать на странице оплаты
create or replace function public.pay_info()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'usdt_on', coalesce((select enabled and address is not null from private.usdt_config), false),
    'usdt_address', (select address from private.usdt_config where enabled),
    'usdt_micro_per_mest', (select micro_per_mest from private.usdt_config where enabled),
    'nano_per_mest', (select nano_per_mest::text from private.ton_config),
    'ton_usd', (select ton_usd from private.usdt_config where enabled),
    'mst_on', coalesce((select enabled and units_per_mest > 0 and rate_at > now() - interval '30 minutes' from private.mst_config), false),
    'mst_units_per_mest', (select units_per_mest::text from private.mst_config where enabled and rate_at > now() - interval '30 minutes'),
    'mst_master', (select master from private.mst_config where enabled));
$$;
revoke all on function public.pay_info() from public, anon;
grant execute on function public.pay_info() to authenticated;

-- заказ в MST: пополнение Mest или премиум на 30 дней
create or replace function public.mst_order(p_kind text, p_mest integer)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); c private.mst_config; v_addr text; v_mest bigint; v_ref bigint; v_units bigint; v_code text;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  select * into c from private.mst_config;
  if not found or not c.enabled or coalesce(c.units_per_mest, 0) <= 0 or c.rate_at < now() - interval '30 minutes' then raise exception 'mst off'; end if;
  select address into v_addr from private.ton_config;
  if v_addr is null then raise exception 'mst off'; end if;
  if not private.ton_rate_ok(me) then raise exception 'too many orders'; end if;
  if p_kind = 'mest' then
    if p_mest is null or p_mest < 10 or p_mest > 100000 then raise exception 'bad amount'; end if;
    v_mest := p_mest;
  elsif p_kind = 'premium' then
    v_mest := 150; v_ref := 30;
  else
    raise exception 'bad kind';
  end if;
  v_units := ceil(v_mest * c.units_per_mest / 1e7)::bigint * 10000000;   -- до 0,01 MST вверх (так же считает экран оплаты)
  v_code := private.ton_new_code();
  insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to, asset, mst_units)
  values (me, v_code, v_mest, 1, p_kind, v_ref, v_addr, 'mst', v_units);
  return jsonb_build_object('code', v_code, 'units', v_units::text, 'address', v_addr, 'master', c.master, 'kind', p_kind,
                            'expires_at', now() + interval '1 hour');
end $$;
revoke all on function public.mst_order(text, integer) from public, anon;
grant execute on function public.mst_order(text, integer) to authenticated;

-- для сервера: незакрытые MST-заказы
create or replace function public.mst_pending()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('address', (select address from private.ton_config), 'master', (select master from private.mst_config where enabled),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'units', mst_units::text))
                        from public.ton_orders where asset = 'mst' and status = 'pending' and created_at > now() - interval '3 days'), '[]'::jsonb));
$$;
revoke all on function public.mst_pending() from public, anon, authenticated;
grant execute on function public.mst_pending() to service_role;

-- для сервера: зачесть найденный перевод MST (токен и адрес получателя ton-check уже сверил)
create or replace function public.mst_settle(p_code text, p_tx text, p_units bigint, p_from text, p_to text)
returns text language plpgsql security definer set search_path to '' as $$
declare o public.ton_orders; gain bigint;
begin
  select * into o from public.ton_orders where code = upper(trim(p_code)) and asset = 'mst' for update;
  if not found then return 'unknown'; end if;
  if o.status <> 'pending' then return 'already'; end if;
  if coalesce(p_tx, '') = '' or p_units is null or p_units <= 0 then return 'bad'; end if;
  if p_to is distinct from o.pay_to then return 'wrong address'; end if;
  if exists (select 1 from public.ton_orders where tx_hash = p_tx) then return 'tx used'; end if;
  if o.kind = 'mest' then
    gain := least(floor(p_units::numeric * o.mest / o.mst_units)::bigint, o.mest * 10);   -- по курсу самого заказа
    if gain <= 0 then return 'too small'; end if;
    update public.ton_orders set status = 'paid', tx_hash = p_tx, credited = gain, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
    perform private.credit(o.user_id, gain, 'Пополнение MST · ' || o.code);
    return 'paid';
  end if;
  if p_units >= o.mst_units then
    update public.profiles set premium_until = greatest(coalesce(premium_until, now()), now()) + make_interval(days => coalesce(o.ref, 30)::int) where id = o.user_id;
    update public.ton_orders set status = 'paid', tx_hash = p_tx, from_addr = left(p_from, 100), paid_at = now() where id = o.id;
    return 'paid';
  end if;
  -- перевели меньше: премиум не даём, пришедшее зачисляем в Mest
  gain := floor(p_units::numeric * o.mest / o.mst_units)::bigint;
  update public.ton_orders set status = 'paid', tx_hash = p_tx, credited = nullif(gain, 0), from_addr = left(p_from, 100), paid_at = now(), note = 'short' where id = o.id;
  if gain > 0 then perform private.credit(o.user_id, gain, 'Оплата премиума в MST — не хватило суммы · ' || o.code); end if;
  return 'short';
end $$;
revoke all on function public.mst_settle(text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.mst_settle(text, text, bigint, text, text) to service_role;

-- карточки переводов MST в чатах
create or replace function private.messages_pay_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if new.pay is null then return new; end if;
  select address into a from public.ton_accounts where user_id = new.sender_id;
  if a is null then raise exception 'no ton wallet'; end if;
  if coalesce(new.pay->>'cur', '') not in ('TON', 'USDT', 'MST') or coalesce(new.pay->>'amt', '') !~ '^[0-9]{1,12}(\.[0-9]{1,9})?$'
     or coalesce(new.pay->>'to', '') !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then
    raise exception 'bad pay';
  end if;
  if new.pay ? 'chq' and coalesce(current_setting('mestario.cheque', true), '') <> (new.pay->>'chq') then raise exception 'bad pay'; end if;
  new.pay := jsonb_build_object('v', 1, 'cur', new.pay->>'cur', 'amt', new.pay->>'amt', 'to', new.pay->>'to', 'from', a,
                                'at', (extract(epoch from now()) * 1000)::bigint,
                                'cmt', left(coalesce(new.pay->>'cmt', ''), 120))
            || case when new.pay ? 'chq' then jsonb_build_object('chq', (new.pay->>'chq')::bigint) else '{}'::jsonb end;
  return new;
end $$;

-- раз в 5 минут — цена пула (она же проверяет оплаты)
create or replace function private.mst_rate_poll()
returns void language plpgsql security definer set search_path to '' as $$
begin
  perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/ton-check',
                        body := '{"action": "mst_rate"}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;
select cron.unschedule('mst-rate') where exists (select 1 from cron.job where jobname = 'mst-rate');
select cron.schedule('mst-rate', '*/5 * * * *', 'select private.mst_rate_poll()');
commit;
