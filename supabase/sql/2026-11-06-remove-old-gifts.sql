-- по решению владельца (2026-11-06): старые подарки удаляются у всех; за премиум подарка нет; комиссии — на @boss
do $$
declare x bigint;
begin
  for x in select g.id from public.gifts g join public.profiles p on p.worn_gift = g.id where g.type_id not like 'm\_%' loop
    perform private.unwear(x);
  end loop;
end $$;
delete from public.nft_listings where gift_id in (select id from public.gifts where type_id not like 'm\_%');
delete from private.premium_crowns where gift_id in (select id from public.gifts where type_id not like 'm\_%');
delete from public.gifts where type_id not like 'm\_%';

create or replace function private.give_premium_crown(u uuid)
 returns bigint language sql security definer set search_path to ''
as $function$ select null::bigint $function$;   -- за покупку премиума подарок больше не выдаётся

update private.fee_config set receiver = (select id from public.profiles where username = 'boss')
  where exists (select 1 from public.profiles where username = 'boss');
