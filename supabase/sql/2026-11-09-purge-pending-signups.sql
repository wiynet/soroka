-- Незаконченные регистрации удаляются сами.
-- «Незаконченная» — есть запись почты и пароля (auth.users), но нет аккаунта Mestario (profiles): код из письма не ввели.
-- Удаляем, если 2 минуты не было никаких действий (регистрация, вход, запрос кода)
-- и нет «устройства» — живого входа по коду или через Google (тогда человек сейчас выбирает юзернейм; ждём до 30 минут).
-- Запускается каждую минуту из private.minute_tick.
create or replace function private.purge_pending_signups() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select u.id from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
      and greatest(u.created_at, coalesce(u.last_sign_in_at, '-infinity'), coalesce(u.recovery_sent_at, '-infinity'),
                   coalesce(u.confirmation_sent_at, '-infinity')) < now() - interval '2 minutes'
      and not exists (select 1 from auth.sessions s join auth.mfa_amr_claims c on c.session_id = s.id
                      where s.user_id = u.id and c.authentication_method <> 'password'
                        and greatest(s.created_at, s.updated_at) > now() - interval '30 minutes')
    limit 200
  loop
    begin
      delete from auth.users where id = r.id;
      n := n + 1;
    exception when others then raise warning 'purge_pending_signups %: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.purge_pending_signups() from public, anon, authenticated;

create or replace function private.minute_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin perform private.send_due_scheduled(); exception when others then raise warning 'send_due_scheduled: %', sqlerrm; end;
  begin perform private.expire_messages(); exception when others then raise warning 'expire_messages: %', sqlerrm; end;
  begin perform private.settle_due_gift_auctions(); exception when others then raise warning 'settle_due_gift_auctions: %', sqlerrm; end;
  begin perform private.settle_due_giveaways(); exception when others then raise warning 'settle_due_giveaways: %', sqlerrm; end;
  begin perform private.ton_poll(); exception when others then raise warning 'ton_poll: %', sqlerrm; end;
  begin perform private.purge_pending_signups(); exception when others then raise warning 'purge_pending_signups: %', sqlerrm; end;
end $$;
