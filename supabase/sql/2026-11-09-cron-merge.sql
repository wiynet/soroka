-- пять ежеминутных задач — одной: одна сессия в минуту вместо пяти; ошибка одной части не мешает остальным
create or replace function private.minute_tick() returns void
 language plpgsql security definer set search_path to ''
as $function$
begin
  begin perform private.send_due_scheduled(); exception when others then raise warning 'send_due_scheduled: %', sqlerrm; end;
  begin perform private.expire_messages(); exception when others then raise warning 'expire_messages: %', sqlerrm; end;
  begin perform private.settle_due_gift_auctions(); exception when others then raise warning 'settle_due_gift_auctions: %', sqlerrm; end;
  begin perform private.settle_due_giveaways(); exception when others then raise warning 'settle_due_giveaways: %', sqlerrm; end;
  begin perform private.ton_poll(); exception when others then raise warning 'ton_poll: %', sqlerrm; end;
end $function$;
revoke all on function private.minute_tick() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('expire-messages','settle-gift-auctions','settle-giveaways','send-scheduled','ton-check');
select cron.schedule('minute-tick', '* * * * *', 'select private.minute_tick()');
