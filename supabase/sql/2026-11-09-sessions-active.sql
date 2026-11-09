-- Устройства: в списке только живые сеансы — есть действующий ключ входа и устройство заходило за последние 7 дней.
-- Выход теперь по-настоящему закрывает сеанс на сервере (end_my_session), даже если ключ доступа успел истечь.
create or replace function public.my_sessions()
 returns table(id uuid, created_at timestamptz, active_at timestamptz, user_agent text, ip text, current boolean, can_kick boolean)
 language sql stable security definer set search_path to ''
as $function$
  with me as (
    select (select auth.uid()) as uid, nullif((select auth.jwt()) ->> 'session_id', '')::uuid as sid
  ), cur as (
    select s.created_at from auth.sessions s, me where s.id = me.sid and s.user_id = me.uid
  ), ss as (
    select s.*, greatest(s.created_at, coalesce(s.refreshed_at at time zone 'utc', s.created_at), coalesce(s.updated_at, s.created_at)) as act
      from auth.sessions s, me
     where s.user_id = me.uid and me.uid is not null and (s.not_after is null or s.not_after > now())
  )
  select s.id, s.created_at, s.act, s.user_agent, host(s.ip), s.id = me.sid,
         s.id <> me.sid and exists (select 1 from cur) and (s.created_at > (select created_at from cur) or s.act < now() - interval '30 days')
    from ss s, me
   where s.id = me.sid
      or (s.act > now() - interval '7 days'
          and exists (select 1 from auth.refresh_tokens r where r.session_id = s.id and not r.revoked))
   order by (s.id = me.sid) desc, 3 desc
   limit 50;
$function$;

create or replace function public.end_my_session()
 returns void language plpgsql security definer set search_path to ''
as $function$
declare sid uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid; me uuid := (select auth.uid());
begin
  if me is null or sid is null then return; end if;
  delete from auth.sessions where id = sid and user_id = me;
end $function$;
revoke all on function public.end_my_session() from public, anon;
grant execute on function public.end_my_session() to authenticated;
