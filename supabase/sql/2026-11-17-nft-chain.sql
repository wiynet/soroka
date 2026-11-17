begin;
-- ============================================================================
-- NFT Mestario в сети TON (как у Telegram с Fragment), 2026-11-17.
--   • подарок-NFT, коллекционный юзернейм или номер можно по желанию вывести в блокчейн TON — по одному за раз;
--   • на кошелёк Mestario — сразу, на Tonkeeper и другие кошельки — через 14 дней после получения NFT;
--   • комиссию сети (0,1 TON) платит владелец: переводит её на служебный кошелёк Mestario с кодом заказа;
--   • пока NFT в блокчейне, внутри Mestario его нельзя продать, подарить, выставить на аукцион или удалить;
--   • вернуть в Mestario: отправить NFT на служебный кошелёк с кодом возврата — он снова станет обычным,
--     а владельцем в Mestario станет тот, кто вернул.
-- Выпуск и переводы подписывает функция nft (служебный кошелёк, ключ — в Vault, его никто не видит).
-- ============================================================================
create table if not exists private.nft_config (
  id boolean primary key default true check (id),
  minter text,                       -- служебный кошелёк (friendly, UQ…)
  collection text,                   -- адрес коллекции (friendly, EQ…)
  deployed boolean not null default false,
  fee_nano bigint not null default 100000000,
  next_index bigint not null default 0
);
alter table private.nft_config enable row level security;
insert into private.nft_config (id) values (true) on conflict do nothing;

-- когда подарок достался нынешнему владельцу (для правила 14 дней)
alter table public.gifts add column if not exists got_at timestamptz;
update public.gifts set got_at = coalesce(upgraded_at, created_at) where got_at is null;
create or replace function private.gift_got_at() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.to_id is distinct from old.to_id then new.got_at := now(); end if;
  return new;
end $$;
drop trigger if exists gifts_got_at on public.gifts;
create trigger gifts_got_at before insert or update of to_id on public.gifts for each row execute function private.gift_got_at();

-- NFT, которые хоть раз выводились в блокчейн
create table if not exists public.nft_chain (
  id bigserial primary key,
  kind text not null check (kind in ('gift', 'user', 'num')),
  ref text not null,                 -- id подарка, юзернейм или номер
  item_index bigint unique,
  item_addr text,
  status text not null check (status in ('minting', 'onchain', 'moving', 'home')),
  dest text,                         -- куда выведен
  updated_at timestamptz not null default now(),
  unique (kind, ref)
);
alter table public.nft_chain enable row level security;
drop policy if exists nft_chain_read on public.nft_chain;
create policy nft_chain_read on public.nft_chain for select to authenticated using (true);

create table if not exists public.nft_orders (
  id bigserial primary key,
  code text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  op text not null check (op in ('out', 'back')),
  chain_id bigint references public.nft_chain (id),
  kind text not null, ref text not null,
  dest text,
  external boolean not null default false,
  fee_nano bigint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'done', 'failed', 'expired')),
  tx text unique,
  note text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.nft_orders enable row level security;
drop policy if exists nft_orders_own on public.nft_orders;
create policy nft_orders_own on public.nft_orders for select to authenticated using (user_id = (select auth.uid()));
create index if not exists nft_orders_pending on public.nft_orders (status) where status in ('pending', 'paid');

-- владелец NFT в Mestario и когда он его получил
create or replace function private.nft_holder(p_kind text, p_ref text, out owner uuid, out got timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind = 'gift' then
    select g.to_id, coalesce(g.got_at, g.created_at) into owner, got from public.gifts g
     where g.id = p_ref::bigint and g.nft_number is not null and g.sold_at is null;
  elsif p_kind = 'user' then
    select u.owner_id, u.granted_at into owner, got from public.collectible_usernames u where u.username = p_ref;
  elsif p_kind = 'num' then
    select n.owner_id, n.granted_at into owner, got from public.collectible_numbers n where n.number = p_ref;
  end if;
end $$;

-- NFT в блокчейне (или выводится прямо сейчас) — внутри Mestario с ним ничего делать нельзя
create or replace function private.nft_locked(p_kind text, p_ref text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.nft_chain c where c.kind = p_kind and c.ref = p_ref and c.status in ('minting', 'onchain', 'moving'))
      or exists (select 1 from public.nft_orders o where o.kind = p_kind and o.ref = p_ref and o.op = 'out' and o.status = 'paid');
$$;
create or replace function private.nft_lock_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; r text;
begin
  if current_setting('mestario.nft_return', true) = '1' then return coalesce(new, old); end if;   -- возврат из блокчейна
  if tg_table_name = 'gifts' then k := 'gift'; r := coalesce(old.id, new.id)::text;
  elsif tg_table_name = 'collectible_usernames' then k := 'user'; r := coalesce(old.username, new.username);
  elsif tg_table_name = 'collectible_numbers' then k := 'num'; r := coalesce(old.number, new.number);
  elsif tg_table_name = 'nft_listings' then
    k := case when new.gift_id is not null then 'gift' when new.number is not null then 'num' else 'user' end;
    r := coalesce(new.gift_id::text, new.number, new.username);
  elsif tg_table_name = 'gift_auctions' then k := 'gift'; r := new.gift_id::text;
  end if;
  if r is not null and private.nft_locked(k, r) then raise exception 'nft on chain'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists nft_lock on public.gifts;
create trigger nft_lock before update of to_id, sold_at, nft_number or delete on public.gifts for each row execute function private.nft_lock_guard();
drop trigger if exists nft_lock on public.collectible_usernames;
create trigger nft_lock before update of owner_id or delete on public.collectible_usernames for each row execute function private.nft_lock_guard();
drop trigger if exists nft_lock on public.collectible_numbers;
create trigger nft_lock before update of owner_id or delete on public.collectible_numbers for each row execute function private.nft_lock_guard();
drop trigger if exists nft_lock on public.nft_listings;
create trigger nft_lock before insert on public.nft_listings for each row execute function private.nft_lock_guard();
drop trigger if exists nft_lock on public.gift_auctions;
create trigger nft_lock before insert on public.gift_auctions for each row execute function private.nft_lock_guard();

create or replace function private.nft_code() returns text language plpgsql volatile set search_path = '' as $$
declare abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; c text; i int;
begin
  loop
    b := extensions.gen_random_bytes(6); c := 'NFT-';
    for i in 0..5 loop c := c || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.nft_orders o where o.code = c);
  end loop;
  return c;
end $$;

-- что показать в кошельке
create or replace function public.nft_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'on', coalesce(c.deployed, false), 'minter', c.minter, 'collection', c.collection, 'fee', c.fee_nano::text,
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', o.code, 'op', o.op, 'kind', o.kind, 'ref', o.ref, 'dest', o.dest,
                         'status', o.status, 'created_at', o.created_at, 'note', o.note) order by o.id desc)
                        from public.nft_orders o where o.user_id = auth.uid() and o.created_at > now() - interval '7 days'), '[]'::jsonb))
  from private.nft_config c;
$$;
revoke all on function public.nft_info() from public, anon;
grant execute on function public.nft_info() to authenticated;

-- заказ на вывод одного NFT в блокчейн
create or replace function public.nft_out_order(p_kind text, p_ref text, p_dest text, p_external boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c private.nft_config; h record; mine text; v_code text; ch public.nft_chain;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into c from private.nft_config;
  if not c.deployed then raise exception 'nft off'; end if;
  if p_kind not in ('gift', 'user', 'num') then raise exception 'bad kind'; end if;
  select * into h from private.nft_holder(p_kind, p_ref);
  if h.owner is distinct from me then raise exception 'not yours'; end if;
  select * into ch from public.nft_chain where kind = p_kind and ref = p_ref;
  if found and ch.status <> 'home' then raise exception 'already on chain'; end if;
  if exists (select 1 from public.nft_listings where status = 'open'
             and ((p_kind = 'gift' and gift_id::text = p_ref) or (p_kind = 'num' and number = p_ref) or (p_kind = 'user' and username = p_ref))) then
    raise exception 'listed';
  end if;
  if p_kind = 'gift' and exists (select 1 from public.gift_auctions where gift_id::text = p_ref and status = 'open') then raise exception 'on auction'; end if;
  -- по одному за раз
  if exists (select 1 from public.nft_orders where user_id = me and op = 'out' and status in ('pending', 'paid') and created_at > now() - interval '1 hour') then
    raise exception 'one at a time';
  end if;
  select address into mine from public.ton_accounts where user_id = me;
  if coalesce(p_dest, '') !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then raise exception 'bad address'; end if;
  if not p_external then
    if mine is null or substr(mine, 3) <> substr(p_dest, 3) then raise exception 'not mestario wallet'; end if;
  elsif h.got is not null and h.got > now() - interval '14 days' then
    raise exception 'hold until %', to_char(h.got + interval '14 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  update public.nft_orders set status = 'expired' where user_id = me and op = 'out' and status = 'pending';
  v_code := private.nft_code();
  insert into public.nft_orders (code, user_id, op, chain_id, kind, ref, dest, external, fee_nano)
  values (v_code, me, 'out', ch.id, p_kind, p_ref, p_dest, p_external, c.fee_nano);
  return jsonb_build_object('code', v_code, 'pay_to', c.minter, 'fee', c.fee_nano::text, 'expires_at', now() + interval '1 hour');
end $$;
revoke all on function public.nft_out_order(text, text, text, boolean) from public, anon;
grant execute on function public.nft_out_order(text, text, text, boolean) to authenticated;

-- заказ на возврат NFT из блокчейна в Mestario (вернуть может любой, у кого он сейчас)
create or replace function public.nft_back_order(p_kind text, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c private.nft_config; ch public.nft_chain; v_code text;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into c from private.nft_config;
  select * into ch from public.nft_chain where kind = p_kind and ref = p_ref;
  if not found or ch.status <> 'onchain' then raise exception 'not on chain'; end if;
  update public.nft_orders set status = 'expired' where user_id = me and op = 'back' and status = 'pending' and chain_id = ch.id;
  v_code := private.nft_code();
  insert into public.nft_orders (code, user_id, op, chain_id, kind, ref) values (v_code, me, 'back', ch.id, p_kind, p_ref);
  return jsonb_build_object('code', v_code, 'to', c.minter, 'item', ch.item_addr);
end $$;
revoke all on function public.nft_back_order(text, text) from public, anon;
grant execute on function public.nft_back_order(text, text) to authenticated;

-- ===== для функции nft (service_role) =====
create or replace function public.nft_srv_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cfg', to_jsonb(c),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('chain', to_jsonb(ch)) order by o.id)
       from public.nft_orders o left join public.nft_chain ch on ch.id = o.chain_id
       where (o.status = 'pending' and o.created_at > now() - interval '3 days') or o.status = 'paid'), '[]'::jsonb))
  from private.nft_config c;
$$;
create or replace function public.nft_srv_config(p_minter text, p_collection text, p_deployed boolean)
returns void language sql security definer set search_path = '' as $$
  update private.nft_config set minter = coalesce(p_minter, minter), collection = coalesce(p_collection, collection),
    deployed = coalesce(p_deployed, deployed) where id;
$$;
-- ключ служебного кошелька: кладём один раз, читает только функция nft
create or replace function public.nft_srv_key(p_hex text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'nft_minter_key';
  if v is null and p_hex is not null then
    perform vault.create_secret(p_hex, 'nft_minter_key', 'Mestario NFT minter wallet key');
    v := p_hex;
  end if;
  return v;
end $$;
-- оплата вывода найдена: закрепляем номер NFT в коллекции и блокируем его внутри Mestario
create or replace function public.nft_srv_paid(p_code text, p_tx text, p_nano bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.nft_orders; ch public.nft_chain; h record; idx bigint;
begin
  select * into o from public.nft_orders where code = p_code and op = 'out' for update;
  if not found or o.status <> 'pending' then return null; end if;
  if exists (select 1 from public.nft_orders where tx = p_tx) then return null; end if;
  if p_nano < o.fee_nano then
    update public.nft_orders set status = 'failed', tx = p_tx, note = 'short', done_at = now() where id = o.id;
    return null;
  end if;
  select * into h from private.nft_holder(o.kind, o.ref);
  if h.owner is distinct from o.user_id or exists (select 1 from public.nft_chain where kind = o.kind and ref = o.ref and status <> 'home') then
    update public.nft_orders set status = 'failed', tx = p_tx, note = 'not owner', done_at = now() where id = o.id;
    return null;
  end if;
  select * into ch from public.nft_chain where kind = o.kind and ref = o.ref for update;
  if not found then
    update private.nft_config set next_index = next_index + 1 where id returning next_index - 1 into idx;
    insert into public.nft_chain (kind, ref, item_index, status, dest) values (o.kind, o.ref, idx, 'minting', o.dest) returning * into ch;
  else
    update public.nft_chain set status = 'moving', dest = o.dest, updated_at = now() where id = ch.id returning * into ch;
  end if;
  update public.nft_orders set status = 'paid', tx = p_tx, chain_id = ch.id where id = o.id;
  return jsonb_build_object('order', o.id, 'chain', to_jsonb(ch));
end $$;
create or replace function public.nft_srv_done(p_order bigint, p_item_addr text, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.nft_orders;
begin
  select * into o from public.nft_orders where id = p_order for update;
  if not found or o.status <> 'paid' then return; end if;
  if p_ok then
    update public.nft_chain set status = 'onchain', item_addr = coalesce(p_item_addr, item_addr), dest = o.dest, updated_at = now() where id = o.chain_id;
    update public.nft_orders set status = 'done', done_at = now() where id = o.id;
  else
    -- не получилось: NFT снова свободен в Mestario (взнос за сеть разбираем вручную — см. note)
    update public.nft_orders set status = 'failed', note = left(p_note, 200), done_at = now(),
      chain_id = case when (select item_addr from public.nft_chain where id = o.chain_id) is null then null else chain_id end where id = o.id;
    delete from public.nft_chain c where c.id = o.chain_id and c.item_addr is null
      and not exists (select 1 from public.nft_orders x where x.chain_id = c.id);
    update public.nft_chain set status = 'home', updated_at = now() where id = o.chain_id and status in ('minting', 'moving');
  end if;
end $$;
-- NFT вернули на служебный кошелёк с кодом: снова обычный, владелец в Mestario — тот, кто вернул
create or replace function public.nft_srv_returned(p_code text, p_item_addr text, p_tx text) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.nft_orders; ch public.nft_chain; h record;
begin
  select * into o from public.nft_orders where code = p_code and op = 'back' for update;
  if not found or o.status <> 'pending' then return 'unknown'; end if;
  select * into ch from public.nft_chain where id = o.chain_id for update;
  if ch.item_addr is null or substr(ch.item_addr, 3) <> substr(p_item_addr, 3) then return 'wrong item'; end if;
  if exists (select 1 from public.nft_orders where tx = p_tx) then return 'tx used'; end if;
  perform set_config('mestario.nft_return', '1', true);
  update public.nft_chain set status = 'home', dest = null, updated_at = now() where id = ch.id;
  select * into h from private.nft_holder(ch.kind, ch.ref);
  if h.owner is distinct from o.user_id then
    if ch.kind = 'gift' then perform private.move_gift(ch.ref::bigint, h.owner, o.user_id);
    elsif ch.kind = 'user' then update public.collectible_usernames set owner_id = o.user_id, granted_at = now() where username = ch.ref;
    else update public.collectible_numbers set owner_id = o.user_id, granted_at = now() where number = ch.ref;
    end if;
  end if;
  perform set_config('mestario.nft_return', '', true);
  update public.nft_orders set status = 'done', tx = p_tx, done_at = now() where id = o.id;
  return 'ok';
end $$;
-- данные для карточки NFT (картинка и описание в Tonkeeper)
create or replace function public.nft_srv_meta(p_kind text, p_ref text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'gift' then (select jsonb_build_object('type', t.name, 'type_art', t.art, 'emoji', coalesce(m.emoji, t.emoji), 'number', g.nft_number,
                        'model', m.name, 'model_art', m.art, 'backdrop', b.name, 'c1', b.c1, 'c2', b.c2)
                      from public.gifts g join public.gift_types t on t.id = g.type_id
                      left join public.gift_models m on m.id = g.nft_model left join public.gift_backdrops b on b.id = g.nft_backdrop
                      where g.id = p_ref::bigint and g.nft_number is not null)
    when 'user' then (select jsonb_build_object('username', username) from public.collectible_usernames where username = p_ref)
    when 'num' then (select jsonb_build_object('number', number) from public.collectible_numbers where number = p_ref)
  end
  where exists (select 1 from public.nft_chain c where c.kind = p_kind and c.ref = p_ref);
$$;
do $$ declare f text; begin
  foreach f in array array['nft_srv_state()', 'nft_srv_config(text,text,boolean)', 'nft_srv_key(text)', 'nft_srv_paid(text,text,bigint)',
                           'nft_srv_done(bigint,text,boolean,text)', 'nft_srv_returned(text,text,text)', 'nft_srv_meta(text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
end $$;

-- раз в минуту, пока есть заказы, — функция nft ищет оплаты и возвраты
create or replace function private.nft_poll() returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.nft_orders where status = 'paid' or (status = 'pending' and created_at > now() - interval '3 days')) then
    perform net.http_post(url := 'https://zgjptlyhflfwbnmzpdsa.supabase.co/functions/v1/nft',
                          body := '{"action": "scan"}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 60000);
  end if;
end $$;
select cron.unschedule('nft-poll') where exists (select 1 from cron.job where jobname = 'nft-poll');
select cron.schedule('nft-poll', '* * * * *', 'select private.nft_poll()');
commit;
