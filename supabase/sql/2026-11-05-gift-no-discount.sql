-- 2026-11-05: скидки премиума на подарки больше нет — подарок всегда стоит gift_types.price.
CREATE OR REPLACE FUNCTION public.send_gift(p_to uuid, p_type text, p_note text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  g public.gift_types;
  cost integer;
  who text;
  note text := nullif(left(btrim(coalesce(p_note, '')), 120), '');
  cid uuid;
  gid bigint;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not allowed';
  end if;
  select * into g from public.gift_types where id = p_type for update;
  if not found or g.hidden then raise exception 'gift not found'; end if;
  if g.supply is not null and (select count(*) from public.gifts where type_id = g.id and not granted) >= g.supply then
    raise exception 'sold out';
  end if;
  select username into who from public.profiles where id = p_to and banned_at is null;
  if who is null or private.blocks_me(p_to) then raise exception 'user not found'; end if;
  cost := g.price;
  perform private.spend(me, cost, 'Подарок «' || g.name || '» для @' || who);
  insert into public.gifts (type_id, from_id, to_id, note, price_paid) values (g.id, me, p_to, note, cost)
  returning id into gid;
  cid := public.open_direct_chat(p_to);
  insert into public.messages (chat_id, sender_id, body, gift_type, gift_note, gift_id)
  values (cid, me, '🎁 Подарок: ' || g.name, g.id, note, gid);
  return (select balance from public.wallets where user_id = me);
end;
$function$;
