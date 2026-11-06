-- вложения: до 20 МБ всем, до 100 МБ с премиумом (и админам, ботам)
update storage.buckets set file_size_limit = 104857600 where id = 'attachments';

create or replace function private.check_file_size() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
begin
  if new.file_size is not null and new.file_size > 20971520
     and not private.is_premium(new.sender_id)
     and not exists (select 1 from public.profiles where id = new.sender_id and (is_admin or is_bot)) then
    raise exception 'file too big: over 20 MB needs premium';
  end if;
  if new.file_size is not null and new.file_size > 104857600 then raise exception 'file too big'; end if;
  return new;
end $function$;
revoke all on function private.check_file_size() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'messages_file_size' and tgrelid = 'public.messages'::regclass) then
    create trigger messages_file_size before insert on public.messages for each row execute function private.check_file_size();
  end if;
end $$;
