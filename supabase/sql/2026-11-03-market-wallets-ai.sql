begin;
-- ============================================================================
-- 2026-11-03: кошельки в профиле, NFT-подарки на маркете, новый ИИ (свои чаты, картинки), бот @ai выключен.
-- ============================================================================

-- ---------- 1. Криптокошельки аккаунта (TON и TRON) ----------
-- Адреса публичные: их видно на NFT владельца. Писать — только через set_my_wallet.
create table if not exists public.user_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ton text check (ton is null or length(ton) between 40 and 70),
  tron text check (tron is null or tron ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'),
  updated_at timestamptz not null default now()
);
alter table public.user_wallets enable row level security;
drop policy if exists user_wallets_select on public.user_wallets;
create policy user_wallets_select on public.user_wallets for select to authenticated using (true);
revoke all on public.user_wallets from anon, authenticated;
grant select on public.user_wallets to authenticated;

create or replace function public.set_my_wallet(p_kind text, p_addr text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); a text := nullif(btrim(coalesce(p_addr, '')), ''); w public.user_wallets;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  if p_kind = 'ton' then
    if a is not null and not private.ton_addr_ok(a) then raise exception 'bad address'; end if;
    -- без кошелька TON нельзя держать лоты с ценой в TON: сначала снимите их или уберите цену в TON
    if a is null and exists (select 1 from public.nft_listings where seller_id = me and not by_admin and status = 'open' and ton_nano is not null) then
      raise exception 'wallet in use';
    end if;
    insert into public.user_wallets (user_id, ton) values (me, a)
    on conflict (user_id) do update set ton = excluded.ton, updated_at = now();
    -- новые покупатели платят уже на новый кошелёк
    if a is not null then
      update public.nft_listings set ton_to = a where seller_id = me and not by_admin and status = 'open' and ton_nano is not null;
    end if;
  elsif p_kind = 'tron' then
    if a is not null and a !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception 'bad address'; end if;
    insert into public.user_wallets (user_id, tron) values (me, a)
    on conflict (user_id) do update set tron = excluded.tron, updated_at = now();
  else
    raise exception 'bad kind';
  end if;
  select * into w from public.user_wallets where user_id = me;
  return jsonb_build_object('ton', w.ton, 'tron', w.tron);
end $$;
revoke all on function public.set_my_wallet(text, text) from public, anon;
grant execute on function public.set_my_wallet(text, text) to authenticated;

-- ---------- 2. NFT-подарки на маркете ----------
alter table public.nft_listings add column if not exists gift_id bigint references public.gifts(id);
alter table public.nft_listings drop constraint if exists nft_listings_item_check;
alter table public.nft_listings add constraint nft_listings_item_check check (num_nonnulls(username, number, gift_id) = 1);
create unique index if not exists nft_listings_gift_open on public.nft_listings (gift_id) where status = 'open';
create index if not exists nft_listings_seller_idx on public.nft_listings (seller_id, id desc);

create or replace function private.lot_label(l public.nft_listings)
returns text language sql stable security definer set search_path to '' as $$
  select case when l.gift_id is not null then coalesce('«' || private.gift_title(l.gift_id) || '»', 'подарок')
              when l.number is not null then 'номер ' || l.number else '@' || l.username end;
$$;

-- передача лота покупателю: юзернейм, номер или NFT-подарок
create or replace function private.lot_handover(l public.nft_listings, p_buyer uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare owner uuid; g public.gifts;
begin
  if l.gift_id is not null then
    select * into g from public.gifts where id = l.gift_id for update;
    if not found or l.by_admin or g.to_id is distinct from l.seller_id or g.sold_at is not null or g.nft_number is null
       or exists (select 1 from public.gift_auctions where gift_id = g.id and status = 'open') then
      raise exception 'stale listing';
    end if;
    perform private.move_gift(g.id, l.seller_id, p_buyer);
    return;
  end if;
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
end $$;

create or replace function private.settle_listing(p_listing bigint, p_buyer uuid, p_amount bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare l public.nft_listings;
begin
  select * into l from public.nft_listings where id = p_listing for update;
  -- сначала закрываем лот: проверка на подарках не должна принять его за «брошенный»
  update public.nft_listings set status = 'sold', buyer_id = p_buyer, sold_price = p_amount, hold_by = null, hold_until = null, closed_at = now() where id = p_listing;
  perform private.lot_handover(l, p_buyer);
  if not l.by_admin then
    perform private.credit(l.seller_id, p_amount, 'Продажа ' || private.lot_label(l));
  end if;
end $$;

create or replace function private.settle_listing_ton(p_listing bigint, p_buyer uuid, p_nano bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare l public.nft_listings;
begin
  select * into l from public.nft_listings where id = p_listing for update;
  update public.nft_listings set status = 'sold', buyer_id = p_buyer, sold_price = null, sold_ton_nano = p_nano,
         hold_by = null, hold_until = null, closed_at = now() where id = p_listing;
  perform private.lot_handover(l, p_buyer);
end $$;

-- выставить свой NFT-подарок: цена в Mest и/или в TON (TON придут на кошелёк из профиля)
create or replace function public.list_gift(p_gift bigint, p_price bigint, p_ton_nano bigint)
returns bigint language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); g public.gifts; v_to text; lid bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_price is null and p_ton_nano is null then raise exception 'need price'; end if;
  if p_price is not null and (p_price <= 0 or p_price > 1000000000) then raise exception 'bad price'; end if;
  if p_ton_nano is not null and (p_ton_nano < 10000000 or p_ton_nano > 1000000000000000) then raise exception 'bad ton price'; end if;
  select * into g from public.gifts where id = p_gift for update;
  if not found or g.to_id <> me or g.sold_at is not null then raise exception 'not owner'; end if;
  if g.nft_number is null then raise exception 'not nft'; end if;
  if exists (select 1 from public.gift_auctions where gift_id = p_gift and status = 'open') then raise exception 'on auction'; end if;
  if exists (select 1 from public.nft_listings where gift_id = p_gift and status = 'open') then raise exception 'already listed'; end if;
  if p_ton_nano is not null then
    select ton into v_to from public.user_wallets where user_id = me;
    if not private.ton_addr_ok(v_to) then raise exception 'no wallet'; end if;
  end if;
  update public.gifts set hidden = false where id = p_gift;   -- лот должен быть виден покупателям
  insert into public.nft_listings (gift_id, seller_id, by_admin, price, ton_nano, ton_to, created_by)
  values (p_gift, me, false, p_price, p_ton_nano, v_to, me) returning id into lid;
  return lid;
end $$;
revoke all on function public.list_gift(bigint, bigint, bigint) from public, anon;
grant execute on function public.list_gift(bigint, bigint, bigint) to authenticated;

-- подарок ушёл от продавца не через маркет (передан, удалён) — лот снимаем, предложения возвращаем
create or replace function private.on_gift_moved()
returns trigger language plpgsql security definer set search_path to '' as $$
declare l record;
begin
  for l in select id from public.nft_listings where gift_id = new.id and status = 'open'
            and (new.sold_at is not null or seller_id is distinct from new.to_id) for update loop
    perform private.refund_offers(l.id, null);
    update public.nft_listings set status = 'cancelled', closed_at = now() where id = l.id;
  end loop;
  return null;
end $$;
drop trigger if exists gifts_listing_guard on public.gifts;
create trigger gifts_listing_guard after update of to_id, sold_at on public.gifts
  for each row execute function private.on_gift_moved();

-- подарок на продаже нельзя скрыть, передать или выставить на аукцион
create or replace function private.gift_listed_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.hidden and not old.hidden and exists (select 1 from public.nft_listings where gift_id = new.id and status = 'open') then
    raise exception 'listed';
  end if;
  return new;
end $$;
drop trigger if exists gifts_hide_guard on public.gifts;
create trigger gifts_hide_guard before update of hidden on public.gifts
  for each row execute function private.gift_listed_guard();

create or replace function public.transfer_gift(p_gift bigint, p_to uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); g public.gifts; cid uuid;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into g from public.gifts where id = p_gift for update;
  if not found or g.to_id <> me or g.sold_at is not null then raise exception 'not allowed'; end if;
  if p_to = me or not exists (select 1 from public.profiles where id = p_to and banned_at is null) or private.blocks_me(p_to) then raise exception 'user not found'; end if;
  if exists (select 1 from public.gift_auctions where gift_id = p_gift and status = 'open') then raise exception 'on auction'; end if;
  if exists (select 1 from public.nft_listings where gift_id = p_gift and status = 'open') then raise exception 'listed'; end if;
  perform private.spend(me, 25, 'Передача подарка «' || private.gift_title(p_gift) || '»');
  perform private.pay_fee(25, 'передача подарка «' || private.gift_title(p_gift) || '»');
  perform private.move_gift(p_gift, me, p_to);
  cid := public.open_direct_chat(p_to);
  insert into public.messages (chat_id, sender_id, body, gift_type, gift_id)
  values (cid, me, '🎁 Подарок передан: ' || private.gift_title(p_gift), g.type_id, p_gift);
end;
$$;

create or replace function public.start_gift_auction(p_gift bigint, p_price bigint, p_hours integer)
returns bigint language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); g public.gifts; aid bigint;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into g from public.gifts where id = p_gift for update;
  if not found or g.to_id <> me or g.sold_at is not null or g.nft_number is null then raise exception 'not allowed'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000000 then raise exception 'bad amount'; end if;
  if p_hours is null or p_hours not in (1, 6, 24, 72) then raise exception 'bad duration'; end if;
  if exists (select 1 from public.gift_auctions where gift_id = p_gift and status = 'open') then raise exception 'on auction'; end if;
  if exists (select 1 from public.nft_listings where gift_id = p_gift and status = 'open') then raise exception 'listed'; end if;
  update public.gifts set hidden = false where id = p_gift;
  insert into public.gift_auctions (gift_id, seller_id, start_price, ends_at)
  values (p_gift, me, p_price, now() + make_interval(hours => p_hours)) returning id into aid;
  return aid;
end;
$$;

-- ---------- 3. Новый ИИ: свои чаты (5 без премиума, 20 с премиумом), картинки ----------
create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Новый чат' check (length(title) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_chats_user_idx on public.ai_chats (user_id, updated_at desc);
create table if not exists public.ai_msgs (
  id bigserial primary key,
  chat_id uuid not null references public.ai_chats(id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  body text not null default '' check (length(body) <= 40000),
  images text[] not null default '{}',
  secs integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_msgs_chat_idx on public.ai_msgs (chat_id, id);
alter table public.ai_chats enable row level security;
alter table public.ai_msgs enable row level security;
drop policy if exists ai_chats_own on public.ai_chats;
create policy ai_chats_own on public.ai_chats for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ai_chats_del on public.ai_chats;
create policy ai_chats_del on public.ai_chats for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists ai_msgs_own on public.ai_msgs;
create policy ai_msgs_own on public.ai_msgs for select to authenticated
  using (exists (select 1 from public.ai_chats c where c.id = chat_id and c.user_id = (select auth.uid())));
revoke all on public.ai_chats, public.ai_msgs from anon, authenticated;
grant select, delete on public.ai_chats to authenticated;
grant select on public.ai_msgs to authenticated;

create or replace function private.ai_chat_max(u uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select case when private.is_premium(u) or exists (select 1 from public.profiles where id = u and is_admin) then 20 else 5 end;
$$;
create or replace function public.ai_chat_limit()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('used', (select count(*) from public.ai_chats where user_id = (select auth.uid())),
                            'max', private.ai_chat_max((select auth.uid())),
                            'credits', public.my_ai_credits());
$$;
create or replace function public.ai_new_chat()
returns uuid language plpgsql security definer set search_path to '' as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null or private.is_banned() or not exists (select 1 from public.profiles where id = me) then raise exception 'not allowed'; end if;
  perform 1 from public.profiles where id = me for update;   -- два запроса подряд не обходят лимит
  if (select count(*) from public.ai_chats where user_id = me) >= private.ai_chat_max(me) then raise exception 'chat limit'; end if;
  insert into public.ai_chats (user_id) values (me) returning id into cid;
  return cid;
end $$;
create or replace function public.ai_rename_chat(p_chat uuid, p_title text)
returns void language plpgsql security definer set search_path to '' as $$
declare t text := left(btrim(coalesce(p_title, '')), 80);
begin
  if t = '' then raise exception 'empty'; end if;
  update public.ai_chats set title = t where id = p_chat and user_id = (select auth.uid());
  if not found then raise exception 'not allowed'; end if;
end $$;
revoke all on function public.ai_chat_limit(), public.ai_new_chat(), public.ai_rename_chat(uuid, text) from public, anon;
grant execute on function public.ai_chat_limit(), public.ai_new_chat(), public.ai_rename_chat(uuid, text) to authenticated;
revoke all on function private.ai_chat_max(uuid) from public, anon, authenticated;

-- картинки для ИИ: приватная папка каждого пользователя
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai', 'ai', false, 6291456, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists ai_upload on storage.objects;
create policy ai_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'ai' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists ai_read on storage.objects;
create policy ai_read on storage.objects for select to authenticated
  using (bucket_id = 'ai' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists ai_remove on storage.objects;
create policy ai_remove on storage.objects for delete to authenticated
  using (bucket_id = 'ai' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- 4. Бот @ai больше не отвечает в чатах: ИИ теперь в настройках ----------
drop trigger if exists messages_ai on public.messages;
commit;
