begin;
-- ============================================================================
-- Встроенные покупки Apple (App Store), 2026-11-21.
-- В приложении для iPhone Mest продаются только через покупки Apple. Телефон присылает подписанную
-- Apple покупку, функция iap-apple проверяет подпись и вызывает iap_apple_credit (только service_role).
-- Одна покупка Apple (transaction_id) зачисляется один раз.
-- ============================================================================
create table if not exists private.iap_products (
  product_id text primary key,
  mest       int  not null check (mest > 0),
  active     boolean not null default true,
  sort       int  not null default 0
);
insert into private.iap_products (product_id, mest, sort) values
  ('top.mestario.mest100', 100, 1), ('top.mestario.mest500', 500, 2), ('top.mestario.mest1000', 1000, 3),
  ('top.mestario.mest2500', 2500, 4), ('top.mestario.mest5000', 5000, 5)
on conflict (product_id) do nothing;

create table if not exists private.iap_purchases (
  transaction_id          text primary key,
  original_transaction_id text,
  user_id                 uuid references public.profiles (id) on delete set null,
  product_id              text not null,
  mest                    int  not null,
  environment             text not null,
  purchased_at            timestamptz,
  created_at              timestamptz not null default now(),
  revoked_at              timestamptz
);
create index if not exists iap_purchases_user on private.iap_purchases (user_id, created_at desc);

-- что продаётся: приложение берёт отсюда номера товаров и сколько Mest в каждом (цены показывает сам App Store)
create or replace function public.iap_products()
 returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', product_id, 'mest', mest) order by sort, mest), '[]'::jsonb)
    from private.iap_products where active and (select auth.uid()) is not null;
$$;

create or replace function public.iap_apple_credit(p_user uuid, p_tx text, p_orig text, p_product text, p_env text, p_purchased timestamptz)
 returns jsonb language plpgsql security definer set search_path = '' as $$
declare m int; ins text; nb bigint;
begin
  if p_user is null or coalesce(p_tx, '') = '' then raise exception 'bad request'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'no user'; end if;
  select mest into m from private.iap_products where product_id = p_product;
  if m is null then raise exception 'unknown product'; end if;
  insert into private.iap_purchases (transaction_id, original_transaction_id, user_id, product_id, mest, environment, purchased_at)
  values (p_tx, p_orig, p_user, p_product, m, coalesce(p_env, 'Production'), p_purchased)
  on conflict (transaction_id) do nothing
  returning transaction_id into ins;
  if ins is null then
    -- эту покупку уже зачислили (повторная отправка с телефона) — второй раз не начисляем
    select balance into nb from public.wallets where user_id = p_user;
    return jsonb_build_object('credited', 0, 'already', true, 'balance', coalesce(nb, 0));
  end if;
  nb := private.credit(p_user, m, 'Покупка Mest в App Store');
  return jsonb_build_object('credited', m, 'already', false, 'balance', nb);
end $$;

revoke all on function public.iap_products() from public, anon;
grant execute on function public.iap_products() to authenticated;
revoke all on function public.iap_apple_credit(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.iap_apple_credit(uuid, text, text, text, text, timestamptz) to service_role;
commit;
