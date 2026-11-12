-- Перевод тому, у кого ещё нет кошелька («чек»).
-- Отправитель на своём устройстве создаёт временный кошелёк, переводит туда деньги (+ запас на комиссию, чтобы получатель
-- получил ровно сумму) и сохраняет его ключ здесь. Получатель нажимает «Получить», создаёт свой кошелёк — и его устройство
-- перекладывает всё с временного кошелька на его адрес. Пока не забрал, отправитель может вернуть деньги себе.
-- Ключ видят только отправитель и получатель (через функции ниже); у временного кошелька только эта сумма.
create table if not exists private.ton_cheques (
  id bigserial primary key,
  chat_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  temp_addr text not null check (temp_addr ~ '^[EU]Q[A-Za-z0-9_-]{46}$'),
  secret text not null check (length(secret) between 100 and 400),
  cur text not null check (cur in ('TON', 'USDT')),
  amt text not null,
  status text not null default 'sent' check (status in ('sent', 'claimed', 'refunded')),
  done_to text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists ton_cheques_recipient on private.ton_cheques (recipient_id, status);

-- карточка в чате: pay.chq — номер чека
create or replace function private.messages_pay_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if new.pay is null then return new; end if;
  select address into a from public.ton_accounts where user_id = new.sender_id;
  if a is null then raise exception 'no ton wallet'; end if;
  if coalesce(new.pay->>'cur', '') not in ('TON', 'USDT') or coalesce(new.pay->>'amt', '') !~ '^[0-9]{1,12}(\.[0-9]{1,9})?$'
     or coalesce(new.pay->>'to', '') !~ '^[EU]Q[A-Za-z0-9_-]{46}$' then
    raise exception 'bad pay';
  end if;
  -- чек ставит только функция ton_cheque_create (она выставляет флаг сессии)
  if new.pay ? 'chq' and coalesce(current_setting('mestario.cheque', true), '') <> (new.pay->>'chq') then raise exception 'bad pay'; end if;
  new.pay := jsonb_build_object('v', 1, 'cur', new.pay->>'cur', 'amt', new.pay->>'amt', 'to', new.pay->>'to', 'from', a,
                                'at', (extract(epoch from now()) * 1000)::bigint,
                                'cmt', left(coalesce(new.pay->>'cmt', ''), 120))
            || case when new.pay ? 'chq' then jsonb_build_object('chq', (new.pay->>'chq')::bigint) else '{}'::jsonb end;
  return new;
end $$;

create or replace function public.ton_cheque_create(p_chat uuid, p_to uuid, p_temp text, p_secret text, p_cur text, p_amt text, p_cmt text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid bigint; m public.messages;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  if not private.is_chat_member(p_chat) or not private.can_post(p_chat) then raise exception 'cannot post'; end if;
  if not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_to) or p_to = me then raise exception 'bad recipient'; end if;
  if p_amt !~ '^[0-9]{1,12}(\.[0-9]{1,9})?$' then raise exception 'bad amount'; end if;
  insert into private.ton_cheques (chat_id, sender_id, recipient_id, temp_addr, secret, cur, amt)
  values (p_chat, me, p_to, p_temp, p_secret, p_cur, p_amt) returning id into cid;
  perform set_config('mestario.cheque', cid::text, true);
  insert into public.messages (chat_id, sender_id, body, pay)
  values (p_chat, me, '💎 ' || p_amt || ' ' || p_cur,
          jsonb_build_object('cur', p_cur, 'amt', p_amt, 'to', p_temp, 'cmt', left(coalesce(p_cmt, ''), 120), 'chq', cid))
  returning * into m;
  perform set_config('mestario.cheque', '', true);
  return to_jsonb(m);
end $$;

-- статус чека (для карточки) — участникам чата
create or replace function public.ton_cheque_info(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', c.status, 'done_at', c.done_at, 'mine', c.sender_id = auth.uid(), 'for_me', c.recipient_id = auth.uid())
  from private.ton_cheques c where c.id = p_id and private.is_chat_member(c.chat_id)
$$;

-- ключ временного кошелька — только получателю (забрать) или отправителю (вернуть), пока чек не закрыт
create or replace function public.ton_cheque_take(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('secret', c.secret, 'temp', c.temp_addr, 'cur', c.cur, 'amt', c.amt, 'role', case when c.recipient_id = auth.uid() then 'recipient' else 'sender' end)
  from private.ton_cheques c
  where c.id = p_id and c.status = 'sent' and auth.uid() in (c.recipient_id, c.sender_id)
$$;

create or replace function public.ton_cheque_done(p_id bigint, p_to text) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c private.ton_cheques;
begin
  select * into c from private.ton_cheques where id = p_id for update;
  if not found or me not in (c.recipient_id, c.sender_id) then raise exception 'not allowed'; end if;
  if c.status <> 'sent' then return c.status; end if;
  update private.ton_cheques set status = case when me = c.recipient_id then 'claimed' else 'refunded' end,
    done_to = p_to, done_at = now() where id = p_id;
  return case when me = c.recipient_id then 'claimed' else 'refunded' end;
end $$;

revoke all on function public.ton_cheque_create(uuid, uuid, text, text, text, text, text), public.ton_cheque_info(bigint),
  public.ton_cheque_take(bigint), public.ton_cheque_done(bigint, text) from public, anon;
grant execute on function public.ton_cheque_create(uuid, uuid, text, text, text, text, text), public.ton_cheque_info(bigint),
  public.ton_cheque_take(bigint), public.ton_cheque_done(bigint, text) to authenticated;
