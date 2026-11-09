-- Приглашения в звонок: голосовой (и видео-) чат теперь можно начать и в личном чате,
-- а позвать в него людей не из этого чата. Приглашённый получает звонок в личный канал и может зайти.
create table if not exists private.vc_invites (
  vc_id uuid not null references public.voice_chats(id) on delete cascade,
  user_id uuid not null,
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (vc_id, user_id)
);

-- можно ли мне в голосовой чат этого чата: участник чата или есть свежее приглашение в идущий там звонок
create or replace function private.vc_allowed(p_chat uuid) returns boolean
 language sql stable security definer set search_path to ''
as $function$
  select private.is_chat_member(p_chat) or exists (
    select 1 from private.vc_invites i join public.voice_chats v on v.id = i.vc_id
     where v.chat_id = p_chat and v.ended_at is null and i.user_id = (select auth.uid()) and i.created_at > now() - interval '6 hours')
$function$;

create or replace function public.vc_join(p_chat uuid, p_dev text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare me uuid := (select auth.uid()); c public.chats; v uuid; can_speak boolean; n int;
begin
  if me is null or private.is_banned() or not private.vc_allowed(p_chat) then raise exception 'not allowed'; end if;
  if p_dev !~ '^[A-Za-z0-9_-]{6,64}$' then raise exception 'bad device'; end if;
  select * into c from public.chats where id = p_chat;
  if not found or c.deleted_at is not null then raise exception 'not allowed'; end if;
  select id into v from public.voice_chats where chat_id = p_chat and ended_at is null;
  if v is not null and private.vc_tidy(v) = 0 then v := null; end if;
  if v is null then
    if not private.is_chat_member(p_chat) then raise exception 'not allowed'; end if;   -- начать звонок может только участник чата
    can_speak := not c.is_channel or c.created_by = me or exists (select 1 from public.chat_members where chat_id = p_chat and user_id = me and is_admin);
    if c.is_channel and not can_speak then raise exception 'not started'; end if;
    insert into public.voice_chats (chat_id, started_by) values (p_chat, me) returning id into v;
  end if;
  if (select count(*) from private.voice_participants where vc_id = v and device <> p_dev) >= 12 then raise exception 'full'; end if;
  insert into private.voice_participants (vc_id, user_id, device) values (v, me, p_dev)
  on conflict (vc_id, device) do update set last_seen = now(), user_id = excluded.user_id;
  n := private.vc_tidy(v);
  can_speak := not c.is_channel or c.created_by = me or exists (select 1 from public.chat_members where chat_id = p_chat and user_id = me and is_admin);
  return jsonb_build_object('id', v, 'speak', can_speak, 'members', n, 'group', c.is_group,
    'ice', coalesce((select ice from private.call_config limit 1), '[]'::jsonb));
end $function$;

create or replace function public.vc_state(p_chat uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v uuid; n int;
begin
  if not private.vc_allowed(p_chat) then return null; end if;
  select id into v from public.voice_chats where chat_id = p_chat and ended_at is null;
  if v is null then return jsonb_build_object('active', false); end if;
  n := private.vc_tidy(v);
  if n = 0 then return jsonb_build_object('active', false); end if;
  return jsonb_build_object('active', true, 'id', v, 'members', n);
end $function$;

-- позвать людей в идущий звонок: звать может тот, кто сейчас в нём; не больше 10 за раз
create or replace function public.vc_invite(p_vc uuid, p_users uuid[])
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare me uuid := (select auth.uid()); v public.voice_chats; c public.chats; u uuid; n int := 0; who jsonb; title text;
begin
  if me is null or private.is_banned() then raise exception 'not allowed'; end if;
  select * into v from public.voice_chats where id = p_vc and ended_at is null;
  if not found or not exists (select 1 from private.voice_participants where vc_id = p_vc and user_id = me) then raise exception 'not allowed'; end if;
  if coalesce(array_length(p_users, 1), 0) > 10 then raise exception 'too many'; end if;
  select * into c from public.chats where id = v.chat_id;
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'avatar_path', p.avatar_path) into who from public.profiles p where p.id = me;
  title := case when c.is_group then c.title else null end;
  foreach u in array coalesce(p_users, '{}') loop
    continue when u = me;
    continue when not exists (select 1 from public.profiles p where p.id = u and p.banned_at is null and p.deleted_at is null and not coalesce(p.is_bot, false));
    continue when exists (select 1 from public.user_blocks b where (b.blocker_id = u and b.blocked_id = me) or (b.blocker_id = me and b.blocked_id = u));
    insert into private.vc_invites (vc_id, user_id, invited_by) values (p_vc, u, me)
      on conflict (vc_id, user_id) do update set created_at = now(), invited_by = me;
    perform realtime.send(jsonb_build_object('table', 'vc_invite', 'eventType', 'INSERT', 'new',
      jsonb_build_object('vc', p_vc, 'chat', v.chat_id, 'group', c.is_group, 'title', title, 'from', who)), 'vc_invite', 'u:' || u::text, true);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.vc_invite(uuid, uuid[]) from public, anon;
grant execute on function public.vc_invite(uuid, uuid[]) to authenticated;

-- кто сейчас в звонке (для приглашённых не из чата: имена и аватарки)
create or replace function public.vc_people(p_vc uuid)
 returns table(id uuid, display_name text, username text, avatar_path text)
 language sql stable security definer set search_path to ''
as $function$
  select p.id, p.display_name, p.username, p.avatar_path
    from public.profiles p
   where p.id in (select user_id from private.voice_participants where vc_id = p_vc)
     and exists (select 1 from public.voice_chats v where v.id = p_vc and private.vc_allowed(v.chat_id));
$function$;
revoke all on function public.vc_people(uuid) from public, anon;
grant execute on function public.vc_people(uuid) to authenticated;
