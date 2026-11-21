begin;
-- ============================================================================
-- Конфиденциальность, 2026-11-21.
--  * кто может мне писать: все или только контакты;
--  * платные сообщения: незнакомые платят N Mest за каждое сообщение, деньги получаю я;
--  * кто может звонить: все, контакты или никто;
--  * кто может добавлять в группы: все или контакты.
-- «Контакт» — человек из моего списка контактов, или тот, кому я уже писал сам в личке.
-- Админы Mestario (поддержка) проходят всегда.
-- Деньги списываются только через paid_prepay — его вызывает приложение после подтверждения;
-- сама вставка сообщения ничего не списывает, а лишь тратит заранее оплаченное.
-- ============================================================================

create table if not exists private.privacy (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  msg_who    text not null default 'all' check (msg_who in ('all', 'contacts')),
  msg_price  int  not null default 0 check (msg_price between 0 and 10000),
  call_who   text not null default 'all' check (call_who in ('all', 'contacts', 'nobody')),
  group_who  text not null default 'all' check (group_who in ('all', 'contacts')),
  updated_at timestamptz not null default now()
);
-- оплаченные, но ещё не отправленные сообщения: кто, в какой личке, сколько
create table if not exists private.paid_credits (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  n       int  not null default 0 check (n >= 0),
  primary key (chat_id, user_id)
);

-- other — «свой» для owner?
create or replace function private.privacy_known(owner uuid, other uuid)
 returns boolean language sql stable security definer set search_path = '' as $$
  select other = owner
      or exists (select 1 from public.contacts ct where ct.owner_id = owner and ct.user_id = other)
      or exists (select 1 from public.profiles p where p.id = other and (p.is_admin or p.is_chief))
      or exists (select 1 from public.chats c join public.messages m on m.chat_id = c.id
                  where c.direct_key = least(owner::text, other::text) || ':' || greatest(owner::text, other::text)
                    and m.sender_id = owner);
$$;

-- разрешает ли owner человеку other звонить ('call') или добавлять в группы ('group')
create or replace function private.privacy_allows(owner uuid, other uuid, what text)
 returns boolean language plpgsql stable security definer set search_path = '' as $$
declare pr private.privacy;
begin
  if owner is null or other is null or owner = other then return true; end if;
  select * into pr from private.privacy where user_id = owner;
  if not found then return true; end if;
  if what = 'call' then
    return pr.call_who = 'all' or (pr.call_who = 'contacts' and private.privacy_known(owner, other));
  elsif what = 'group' then
    return pr.group_who = 'all' or private.privacy_known(owner, other);
  end if;
  return true;
end $$;

-- проверка при каждом сообщении в личку; без настроек у получателя — сразу выходим
create or replace function private.messages_privacy()
 returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; me uuid := new.sender_id; you uuid; pr private.privacy;
begin
  if new.call_id is not null or new.gift_id is not null or me is null then return new; end if;
  select direct_key into k from public.chats where id = new.chat_id;
  if k is null then return new; end if;
  you := case when split_part(k, ':', 1) = me::text then split_part(k, ':', 2)::uuid else split_part(k, ':', 1)::uuid end;
  if you = me then return new; end if;
  select * into pr from private.privacy where user_id = you;
  if not found or (pr.msg_who = 'all' and pr.msg_price = 0) then return new; end if;
  if private.privacy_known(you, me) then return new; end if;
  if pr.msg_who = 'contacts' then raise exception 'privacy' using errcode = '42501'; end if;
  update private.paid_credits set n = n - 1 where chat_id = new.chat_id and user_id = me and n > 0;
  if not found then raise exception 'paid:%', pr.msg_price using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists messages_privacy on public.messages;
create trigger messages_privacy before insert on public.messages for each row execute function private.messages_privacy();

-- мои настройки
create or replace function public.privacy_get()
 returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('msg_who', coalesce(pr.msg_who, 'all'), 'msg_price', coalesce(pr.msg_price, 0),
                            'call_who', coalesce(pr.call_who, 'all'), 'group_who', coalesce(pr.group_who, 'all'))
    from (select 1) one left join private.privacy pr on pr.user_id = (select auth.uid())
   where (select auth.uid()) is not null;
$$;

create or replace function public.privacy_set(p_msg_who text, p_msg_price int, p_call_who text, p_group_who text)
 returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if p_msg_who not in ('all', 'contacts') or p_call_who not in ('all', 'contacts', 'nobody') or p_group_who not in ('all', 'contacts')
     or coalesce(p_msg_price, 0) not between 0 and 10000 then raise exception 'bad value'; end if;
  insert into private.privacy (user_id, msg_who, msg_price, call_who, group_who)
  values (me, p_msg_who, coalesce(p_msg_price, 0), p_call_who, p_group_who)
  on conflict (user_id) do update set msg_who = excluded.msg_who, msg_price = excluded.msg_price,
    call_who = excluded.call_who, group_who = excluded.group_who, updated_at = now();
  return public.privacy_get();
end $$;

-- что мне можно с этим человеком: писать (бесплатно / платно / нельзя), звонить
create or replace function public.privacy_peer(p_user uuid)
 returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); pr private.privacy; known boolean; cid uuid; cr int := 0; msg text := 'ok';
begin
  if me is null then return null; end if;
  select * into pr from private.privacy where user_id = p_user;
  if not found or p_user = me then return jsonb_build_object('msg', 'ok', 'price', 0, 'credits', 0, 'call', true); end if;
  known := private.privacy_known(p_user, me);
  if not known then
    if pr.msg_who = 'contacts' then msg := 'contacts'; elsif pr.msg_price > 0 then msg := 'paid'; end if;
  end if;
  select id into cid from public.chats where direct_key = least(me::text, p_user::text) || ':' || greatest(me::text, p_user::text);
  if cid is not null then select n into cr from private.paid_credits where chat_id = cid and user_id = me; end if;
  return jsonb_build_object('msg', msg, 'price', case when msg = 'paid' then pr.msg_price else 0 end, 'credits', coalesce(cr, 0),
                            'call', private.privacy_allows(p_user, me, 'call'));
end $$;

-- оплатить p_count сообщений в личку: Mest сразу уходят получателю
create or replace function public.paid_prepay(p_chat uuid, p_count int default 1)
 returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); k text; you uuid; pr private.privacy; cost bigint; nb bigint; cr int; nm text;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if coalesce(p_count, 0) not between 1 and 20 then raise exception 'bad count'; end if;
  select direct_key into k from public.chats where id = p_chat;
  if k is null or not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = me and left_at is null) then raise exception 'not allowed'; end if;
  you := case when split_part(k, ':', 1) = me::text then split_part(k, ':', 2)::uuid else split_part(k, ':', 1)::uuid end;
  select * into pr from private.privacy where user_id = you;
  if not found or pr.msg_who <> 'all' or pr.msg_price <= 0 or private.privacy_known(you, me) then raise exception 'not paid'; end if;
  if private.blocks_me(you) then raise exception 'blocked'; end if;
  cost := pr.msg_price::bigint * p_count;
  select display_name into nm from public.profiles where id = me;
  nb := private.spend(me, cost, 'Платные сообщения');
  perform private.credit(you, cost, left('Платные сообщения от ' || coalesce(nm, 'пользователя'), 200));
  insert into private.paid_credits (chat_id, user_id, n) values (p_chat, me, p_count)
  on conflict (chat_id, user_id) do update set n = private.paid_credits.n + excluded.n
  returning n into cr;
  return jsonb_build_object('credits', cr, 'balance', nb, 'spent', cost);
end $$;

-- кого из списка нельзя добавить в группу (чтобы приложение сказало об этом)
create or replace function public.privacy_group_check(p_users uuid[])
 returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u), '{}') from unnest(coalesce(p_users, '{}')) u
   where (select auth.uid()) is not null and not private.privacy_allows(u, (select auth.uid()), 'group');
$$;

-- звонки, приглашения в голосовой чат, добавление в группы — уважают настройки
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.call_start(uuid)'::regprocedure);
  if position('privacy_allows' in d) = 0 then
    if position('  if (select count(*) from public.calls where caller = me' in d) = 0 then raise exception 'call_start anchor'; end if;
    execute replace(d, '  if (select count(*) from public.calls where caller = me',
      E'  if not private.privacy_allows(you, me, ''call'') then raise exception ''privacy''; end if;\n  if (select count(*) from public.calls where caller = me');
  end if;

  d := pg_get_functiondef('public.vc_invite(uuid,uuid[])'::regprocedure);
  if position('privacy_allows' in d) = 0 then
    if position('    continue when exists (select 1 from public.user_blocks b' in d) = 0 then raise exception 'vc_invite anchor'; end if;
    execute replace(d, '    continue when exists (select 1 from public.user_blocks b',
      E'    continue when not private.privacy_allows(u, me, ''call'');\n    continue when exists (select 1 from public.user_blocks b');
  end if;

  d := pg_get_functiondef('public.create_group(text,uuid[])'::regprocedure);
  if position('privacy_allows' in d) = 0 then
    if position('where p.id = me or p.id = any (coalesce(p_members, ''{}''::uuid[]));' in d) = 0 then raise exception 'create_group anchor'; end if;
    execute replace(d, 'where p.id = me or p.id = any (coalesce(p_members, ''{}''::uuid[]));',
      'where p.id = me or (p.id = any (coalesce(p_members, ''{}''::uuid[])) and private.privacy_allows(p.id, me, ''group''));');
  end if;

  d := pg_get_functiondef('public.add_group_members(uuid,uuid[])'::regprocedure);
  if position('privacy_allows' in d) = 0 then
    if position('where p.id = any (coalesce(p_members, ''{}''::uuid[]))' in d) = 0 then raise exception 'add_group_members anchor'; end if;
    execute replace(d, 'where p.id = any (coalesce(p_members, ''{}''::uuid[]))',
      'where p.id = any (coalesce(p_members, ''{}''::uuid[])) and private.privacy_allows(p.id, (select auth.uid()), ''group'')');
  end if;
end $do$;

revoke all on function private.privacy_known(uuid, uuid), private.privacy_allows(uuid, uuid, text), private.messages_privacy() from public, anon, authenticated;
revoke all on function public.privacy_get(), public.privacy_set(text, int, text, text), public.privacy_peer(uuid),
  public.paid_prepay(uuid, int), public.privacy_group_check(uuid[]) from public, anon;
grant execute on function public.privacy_get(), public.privacy_set(text, int, text, text), public.privacy_peer(uuid),
  public.paid_prepay(uuid, int), public.privacy_group_check(uuid[]) to authenticated;
commit;
