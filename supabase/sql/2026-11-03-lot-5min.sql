-- Оплата лота в TON: 5 минут. Лот закреплён за покупателем на 5 минут; после этого заказ не продлевается,
-- а лот снова доступен всем. Поздний перевод зачтётся, только если лот ещё свободен (иначе — на ручной разбор).
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
  -- свой заказ, который ещё не истёк (меньше 5 минут), — отдаём его же
  select * into o from public.ton_orders where user_id = me and kind = 'listing' and ref = p_listing and status = 'pending'
     and nano = l.ton_nano and pay_to = v_to and created_at > now() - interval '5 minutes' order by id desc limit 1;
  if not found then
    if not private.ton_rate_ok(me) then raise exception 'too many orders'; end if;
    v_code := private.ton_new_code();
    insert into public.ton_orders (user_id, code, mest, nano, kind, ref, pay_to) values (me, v_code, 1, l.ton_nano, 'listing', p_listing, v_to)
    returning * into o;
    update public.nft_listings set hold_by = me, hold_until = now() + interval '5 minutes' where id = p_listing;
  end if;
  return jsonb_build_object('code', o.code, 'nano', o.nano::text, 'address', v_to, 'kind', 'listing',
                            'hold_until', o.created_at + interval '5 minutes', 'expires_at', o.created_at + interval '5 minutes');
end $$;
