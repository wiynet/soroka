-- Аккаунт в Mestario (строка profiles) создаётся только после кода из письма.
-- signUp с паролем сразу выдаёт вход (в Supabase выключено «Confirm email»), и раньше проверка кода была только на сайте:
-- через API можно было создать профиль без подтверждения почты. Теперь сервер не даёт создать свой профиль,
-- если вход выполнен только паролем (в токене amr нет otp / magiclink / oauth). Боты и служебные вставки не затронуты.
create or replace function private.profile_needs_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j jsonb := auth.jwt();
begin
  if j is null or coalesce(j->>'role', '') <> 'authenticated' or new.id is distinct from auth.uid() then return new; end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j->'amr') = 'array' then j->'amr' else '[]'::jsonb end) a
             where coalesce(a->>'method', '') not in ('', 'password')) then
    return new;
  end if;
  raise exception 'email code required' using errcode = '42501';
end $$;
drop trigger if exists profiles_need_code on public.profiles;
create trigger profiles_need_code before insert on public.profiles
  for each row when (not new.is_bot) execute function private.profile_needs_code();
