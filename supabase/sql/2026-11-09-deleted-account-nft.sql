-- удалённый аккаунт: его NFT-юзернеймы и NFT-номера удаляются совсем (не освобождаются для покупки);
-- обычный юзернейм освобождается заменой на deleted_… (как и раньше)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.delete_my_account(text)'::regprocedure);
  d := replace(d, $r$  update public.collectible_usernames set owner_id = null where owner_id = me;$r$,
$r$  delete from public.nft_listings where status <> 'open' and (username in (select username from public.collectible_usernames where owner_id = me)
                                                             or number in (select number from public.collectible_numbers where owner_id = me));
  delete from public.collectible_usernames where owner_id = me;
  delete from public.collectible_numbers where owner_id = me;$r$);
  if position('delete from public.collectible_usernames' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
