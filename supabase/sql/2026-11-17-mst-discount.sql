begin;
-- ============================================================================
-- MestCoin (MST), 2026-11-17: при оплате в MST пополнение Mest и премиум дешевле в 1,2 раза.
-- Скидка хранится в private.mst_config.discount (1.2 = цена ÷ 1,2); экран оплаты берёт её из pay_info.
-- ============================================================================
alter table private.mst_config add column if not exists discount numeric not null default 1.2
  check (discount >= 1 and discount <= 10);

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
    'mst_discount', (select discount from private.mst_config where enabled),
    'mst_master', (select master from private.mst_config where enabled));
$$;
revoke all on function public.pay_info() from public, anon;
grant execute on function public.pay_info() to authenticated;

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
  -- со скидкой за оплату в MST; до 0,01 MST вверх (так же считает экран оплаты)
  v_units := ceil(v_mest * c.units_per_mest / greatest(coalesce(c.discount, 1), 1) / 1e7)::bigint * 10000000;
  v_code := private.ton_new_code();
  insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to, asset, mst_units)
  values (me, v_code, v_mest, 1, p_kind, v_ref, v_addr, 'mst', v_units);
  return jsonb_build_object('code', v_code, 'units', v_units::text, 'address', v_addr, 'master', c.master, 'kind', p_kind,
                            'discount', c.discount, 'expires_at', now() + interval '1 hour');
end $$;
revoke all on function public.mst_order(text, integer) from public, anon;
grant execute on function public.mst_order(text, integer) to authenticated;
commit;
