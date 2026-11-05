-- 2026-11-05: крафт с шансом (новая функция craft_gift_try, старая craft_gifts закрыта). В крафт можно положить 1–3 NFT одного вида: 1 — 33 %, 2 — 66 %, 3 — 100 %.
-- Положенные NFT сгорают в любом случае. Ответ: {ok, chance, gift, burned}.
create or replace function public.craft_gift_try(p_gifts bigint[])
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  me uuid := auth.uid();
  ids bigint[];
  n integer;
  chance integer;
  tid text;
  nums text;
  num integer;
  gid bigint;
  x bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select array_agg(distinct v) into ids from unnest(p_gifts) v where v is not null;
  n := coalesce(array_length(ids, 1), 0);
  if n < 1 or n > 3 then raise exception 'need 1 to 3 gifts'; end if;
  perform 1 from public.gifts where id = any(ids) order by id for update;
  if (select count(*) from public.gifts where id = any(ids) and to_id = me and sold_at is null and nft_number is not null) <> n then
    raise exception 'not allowed';
  end if;
  if (select count(distinct type_id) from public.gifts where id = any(ids)) <> 1 then raise exception 'same type only'; end if;
  select type_id into tid from public.gifts where id = ids[1];
  perform 1 from public.gift_types where id = tid for update;
  if not exists (select 1 from public.gift_models where type_id = tid and craft_only) then raise exception 'not craftable'; end if;
  if exists (select 1 from public.gift_auctions where gift_id = any(ids) and status = 'open') then raise exception 'on auction'; end if;
  if exists (select 1 from public.nft_listings where gift_id = any(ids) and status = 'open') then raise exception 'on market'; end if;
  chance := case n when 1 then 33 when 2 then 66 else 100 end;
  foreach x in array ids loop perform private.unwear(x); end loop;
  select string_agg('№' || nft_number, ', ' order by nft_number) into nums from public.gifts where id = any(ids);
  update public.gifts set sold_at = now(), sold_for = 0, pinned_at = null where id = any(ids);
  if random() * 100 >= chance then
    return jsonb_build_object('ok', false, 'chance', chance, 'burned', n);
  end if;
  select coalesce(max(nft_number), 0) + 1 into num from public.gifts where type_id = tid;
  insert into public.gifts (type_id, from_id, to_id, note, price_paid, granted, nft_number, nft_model, nft_backdrop, upgraded_at)
  values (tid, null, me, 'Крафт из ' || nums, 0, true, num, private.pick_craft_model(tid), private.pick_backdrop(), now())
  returning id into gid;
  return jsonb_build_object('ok', true, 'chance', chance, 'gift', gid, 'burned', n);
end;
$function$;
revoke all on function public.craft_gift_try(bigint[]) from public, anon;
grant execute on function public.craft_gift_try(bigint[]) to authenticated;
-- старый крафт «ровно 3» больше не вызывается из приложения
revoke execute on function public.craft_gifts(bigint[]) from authenticated;
