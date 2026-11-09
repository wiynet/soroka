-- «Что нового»: срок показа, правка и удаление (только админы сайта)
alter table public.whats_new add column if not exists expires_at timestamptz;

create or replace function public.whats_new_pending()
 returns setof public.whats_new language sql stable security definer set search_path to ''
as $function$
  select w.* from public.whats_new w
   where (select auth.uid()) is not null
     and (w.expires_at is null or w.expires_at > now())
     and w.id > coalesce((select last_id from private.whats_new_seen where user_id = (select auth.uid())), 0)
   order by w.id desc limit 1;
$function$;

drop function if exists public.whats_new_publish(text, text, text[]);
create or replace function public.whats_new_publish(p_title text, p_body text, p_images text[], p_expires timestamptz default null)
 returns bigint language plpgsql security definer set search_path to ''
as $function$
declare me uuid := (select auth.uid()); nid bigint; x text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if coalesce(array_length(p_images, 1), 0) > 8 then raise exception 'too many images'; end if;
  foreach x in array coalesce(p_images, '{}') loop
    if x !~ ('^' || me::text || '/news-[0-9]{10,16}\.(webp|jpg|png)$') then raise exception 'bad image'; end if;
  end loop;
  if p_expires is not null and p_expires <= now() then raise exception 'bad expiry'; end if;
  insert into public.whats_new (title, body, images, created_by, expires_at)
    values (btrim(p_title), btrim(coalesce(p_body, '')), coalesce(p_images, '{}'), me, p_expires) returning id into nid;
  insert into private.whats_new_seen (user_id, last_id) values (me, nid)
    on conflict (user_id) do update set last_id = greatest(private.whats_new_seen.last_id, nid), seen_at = now();
  return nid;
end $function$;

create or replace function public.whats_new_update(p_id bigint, p_title text, p_body text, p_images text[], p_expires timestamptz)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare me uuid := (select auth.uid()); old_imgs text[]; x text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select images into old_imgs from public.whats_new where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'bad title'; end if;
  if coalesce(array_length(p_images, 1), 0) > 8 then raise exception 'too many images'; end if;
  foreach x in array coalesce(p_images, '{}') loop   -- свои новые фото или фото, которые уже были в этом обновлении
    if not (x = any(coalesce(old_imgs, '{}')) or x ~ ('^' || me::text || '/news-[0-9]{10,16}\.(webp|jpg|png)$')) then raise exception 'bad image'; end if;
  end loop;
  update public.whats_new set title = btrim(p_title), body = btrim(coalesce(p_body, '')), images = coalesce(p_images, '{}'), expires_at = p_expires
   where id = p_id;
end $function$;

create or replace function public.whats_new_delete(p_id bigint)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from public.whats_new where id = p_id;
  if not found then raise exception 'not found'; end if;
end $function$;

revoke all on function public.whats_new_publish(text, text, text[], timestamptz) from public, anon;
revoke all on function public.whats_new_update(bigint, text, text, text[], timestamptz) from public, anon;
revoke all on function public.whats_new_delete(bigint) from public, anon;
grant execute on function public.whats_new_publish(text, text, text[], timestamptz) to authenticated;
grant execute on function public.whats_new_update(bigint, text, text, text[], timestamptz) to authenticated;
grant execute on function public.whats_new_delete(bigint) to authenticated;
