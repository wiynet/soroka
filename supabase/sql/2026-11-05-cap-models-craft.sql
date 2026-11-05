-- 2026-11-05: модели NFT-кепки Mestario и крафт.
--   gift_models.rarity (common / rare / epic / legendary) и gift_models.craft_only (модель выпадает только из крафта).
--   Mestario Cap улучшается за 30 Mest: 15 моделей с шансом по редкости. Ещё 5 моделей — только из крафта.
--   public.craft_gifts(p_gifts) — 3 своих NFT одного вида сгорают, взамен новый NFT с крафтовой моделью
--   (номер следующий по виду, фон случайный, в тираж не входит — granted). Бесплатно.

alter table public.gift_models
  add column if not exists rarity text check (rarity in ('common', 'rare', 'epic', 'legendary')),
  add column if not exists craft_only boolean not null default false;

insert into public.gift_models (type_id, id, name, emoji, weight, art, rarity, craft_only) values
  ('m_cap', 'cap_classic', 'Classic Black',   '🧢', 160, 'https://mestario.lol/gifts/m/cap/cap_classic.svg', 'common',    false),
  ('m_cap', 'cap_neon',    'Neon Glow',       '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_neon.svg',    'rare',      false),
  ('m_cap', 'cap_carbon',  'Carbon Fiber',    '🧢',  14, 'https://mestario.lol/gifts/m/cap/cap_carbon.svg',  'epic',      false),
  ('m_cap', 'cap_cyber',   'Cyber Punk',      '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_cyber.svg',   'rare',      false),
  ('m_cap', 'cap_stealth', 'Stealth Ops',     '🧢', 160, 'https://mestario.lol/gifts/m/cap/cap_stealth.svg', 'common',    false),
  ('m_cap', 'cap_gold',    'Gold Edition',    '🧢',   4, 'https://mestario.lol/gifts/m/cap/cap_gold.svg',    'legendary', false),
  ('m_cap', 'cap_holo',    'Holographic M',   '🧢',  14, 'https://mestario.lol/gifts/m/cap/cap_holo.svg',    'epic',      false),
  ('m_cap', 'cap_mesh',    'Mesh Summer',     '🧢', 160, 'https://mestario.lol/gifts/m/cap/cap_mesh.svg',    'common',    false),
  ('m_cap', 'cap_rider',   'Urban Rider',     '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_rider.svg',   'rare',      false),
  ('m_cap', 'cap_velvet',  'Velvet Night',    '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_velvet.svg',  'rare',      false),
  ('m_cap', 'cap_acid',    'Acid Blue',       '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_acid.svg',    'rare',      false),
  ('m_cap', 'cap_mini',    'Minimalist',      '🧢', 160, 'https://mestario.lol/gifts/m/cap/cap_mini.svg',    'common',    false),
  ('m_cap', 'cap_wash',    'Acid Wash',       '🧢',  50, 'https://mestario.lol/gifts/m/cap/cap_wash.svg',    'rare',      false),
  ('m_cap', 'cap_titan',   'Titanium Shield', '🧢',  14, 'https://mestario.lol/gifts/m/cap/cap_titan.svg',   'epic',      false),
  ('m_cap', 'cap_glitch',  'Glitch Art',      '🧢',  14, 'https://mestario.lol/gifts/m/cap/cap_glitch.svg',  'epic',      false),
  ('m_cap', 'cap_winter',  'Winter Wool',     '🧢', 350, 'https://mestario.lol/gifts/m/cap/cap_winter.svg',  'common',    true),
  ('m_cap', 'cap_reflex',  'Reflex 360',      '🧢', 220, 'https://mestario.lol/gifts/m/cap/cap_reflex.svg',  'rare',      true),
  ('m_cap', 'cap_crown',   'Crown M',         '🧢',  40, 'https://mestario.lol/gifts/m/cap/cap_crown.svg',   'legendary', true),
  ('m_cap', 'cap_ocean',   'Deep Ocean',      '🧢', 350, 'https://mestario.lol/gifts/m/cap/cap_ocean.svg',   'common',    true),
  ('m_cap', 'cap_founder', 'Founder 2026',    '🧢',  40, 'https://mestario.lol/gifts/m/cap/cap_founder.svg', 'legendary', true);

update public.gift_types set upgrade_price = 30 where id = 'm_cap';

-- улучшение больше не выдаёт крафтовые модели
create or replace function private.pick_model(p_type text)
 returns text language sql security definer set search_path to ''
as $function$
  select id from public.gift_models where type_id = p_type and not craft_only order by -ln(1 - random()) / weight limit 1;
$function$;

create or replace function private.pick_craft_model(p_type text)
 returns text language sql security definer set search_path to ''
as $function$
  select id from public.gift_models where type_id = p_type and craft_only order by -ln(1 - random()) / weight limit 1;
$function$;

create or replace function public.craft_gifts(p_gifts bigint[])
 returns bigint language plpgsql security definer set search_path to ''
as $function$
declare
  me uuid := auth.uid();
  ids bigint[];
  t public.gift_types;
  tid text;
  nums text;
  num integer;
  gid bigint;
  x bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select array_agg(distinct v) into ids from unnest(p_gifts) v where v is not null;
  if coalesce(array_length(ids, 1), 0) <> 3 then raise exception 'need 3 gifts'; end if;
  perform 1 from public.gifts where id = any(ids) order by id for update;
  if (select count(*) from public.gifts where id = any(ids) and to_id = me and sold_at is null and nft_number is not null) <> 3 then
    raise exception 'not allowed';
  end if;
  if (select count(distinct type_id) from public.gifts where id = any(ids)) <> 1 then raise exception 'same type only'; end if;
  select type_id into tid from public.gifts where id = ids[1];
  select * into t from public.gift_types where id = tid for update;
  if not exists (select 1 from public.gift_models where type_id = tid and craft_only) then raise exception 'not craftable'; end if;
  if exists (select 1 from public.gift_auctions where gift_id = any(ids) and status = 'open') then raise exception 'on auction'; end if;
  if exists (select 1 from public.nft_listings where gift_id = any(ids) and status = 'open') then raise exception 'on market'; end if;
  foreach x in array ids loop perform private.unwear(x); end loop;
  select string_agg('№' || nft_number, ', ' order by nft_number) into nums from public.gifts where id = any(ids);
  update public.gifts set sold_at = now(), sold_for = 0, pinned_at = null where id = any(ids);
  select coalesce(max(nft_number), 0) + 1 into num from public.gifts where type_id = tid;
  insert into public.gifts (type_id, from_id, to_id, note, price_paid, granted, nft_number, nft_model, nft_backdrop, upgraded_at)
  values (tid, null, me, 'Крафт из ' || nums, 0, true, num, private.pick_craft_model(tid), private.pick_backdrop(), now())
  returning id into gid;
  return gid;
end;
$function$;

revoke all on function public.craft_gifts(bigint[]) from public, anon;
grant execute on function public.craft_gifts(bigint[]) to authenticated;
revoke all on function private.pick_craft_model(text) from public, anon, authenticated;

-- проверка: должно вернуть 20 и 5
select count(*) as models, count(*) filter (where craft_only) as craft from public.gift_models where type_id = 'm_cap';
