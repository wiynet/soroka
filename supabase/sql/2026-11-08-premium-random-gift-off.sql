-- по решению владельца (2026-11-08): премиум больше не получает случайные подарки
create or replace function public.claim_premium_gift()
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  raise exception 'disabled';
end;
$function$;
