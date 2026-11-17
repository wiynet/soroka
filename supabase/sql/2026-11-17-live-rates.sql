begin;
-- ============================================================================
-- Живой курс оплаты, 2026-11-17. Цена в TON задана (Mest и премиум: 150 Mest = 0,3 TON), из неё считаются
--   • цена в USDT — по курсу TON/$ (теперь обновляется каждые 15 минут, а не раз в час);
--   • цена в MST — по цене пула DeDust. Раньше бралась самая низкая цена MST за 6 часов (защита от «накрутки»),
--     и после роста MST цена в MST долго оставалась завышенной. Теперь — самая низкая за 15 минут:
--     падение MST учитывается сразу, рост — через 15 минут (накрутить цену на короткое время всё так же бесполезно).
-- ============================================================================
create or replace function public.mst_set_price(p_nano_per_mst numeric)
returns bigint language plpgsql security definer set search_path to '' as $$
declare lo numeric; v bigint;
begin
  if p_nano_per_mst is null or p_nano_per_mst <= 0 or p_nano_per_mst > 1e15 then raise exception 'bad price'; end if;
  insert into private.mst_prices (nano_per_mst) values (p_nano_per_mst);
  delete from private.mst_prices where at < now() - interval '2 days';
  select min(nano_per_mst) into lo from private.mst_prices where at > now() - interval '15 minutes';
  v := ceil((select nano_per_mest from private.ton_config) * 1e9 / lo)::bigint;
  update private.mst_config set units_per_mest = greatest(v, 1), rate_at = now() where id;
  return v;
end $$;

create or replace function public.nft_link_quote() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('address', c.address, 'ton', c.ton_nano::text, 'free', auth.uid() = any (c.free_users),
    'mst', (select (ceil(c.ton_nano * c.mst_share * 1e9 / min(p.nano_per_mst) / 1e7) * 1e7)::bigint::text
            from private.mst_prices p where p.at > now() - interval '15 minutes'),
    'master', (select master from private.mst_config where enabled))
  from private.nft_link_config c;
$$;

-- курс TON/$ — каждые 15 минут
select cron.unschedule('usdt-rate') where exists (select 1 from cron.job where jobname = 'usdt-rate');
select cron.schedule('usdt-rate', '4,19,34,49 * * * *', 'select private.usdt_rate_poll()');
commit;
