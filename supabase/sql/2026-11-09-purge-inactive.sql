-- удаление аккаунта администрацией (например, за неактивность): то же, что «Удалить аккаунт» в настройках,
-- но без пароля; незавершённые сделки должны быть закрыты заранее
create or replace function private.purge_account(me uuid, p_reason text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare pr public.profiles; c record; heir uuid;
begin
  select * into pr from public.profiles where id = me for update;
  if not found or pr.deleted_at is not null or pr.is_chief or pr.is_admin or pr.is_bot then return; end if;
  if exists (select 1 from public.gift_auctions where status = 'open' and (seller_id = me or top_bidder = me))
     or exists (select 1 from public.nft_listings where status = 'open' and seller_id = me)
     or exists (select 1 from public.nft_offers where status = 'pending' and bidder_id = me)
     or exists (select 1 from public.giveaways where status = 'open' and creator_id = me) then
    raise exception 'open deals %', me;
  end if;
  for c in select id from public.chats where is_group and created_by = me and deleted_at is null loop
    heir := null;
    select m.user_id into heir from public.chat_members m join public.profiles p on p.id = m.user_id and p.banned_at is null
     where m.chat_id = c.id and m.user_id <> me and m.left_at is null order by m.is_admin desc, m.joined_at limit 1;
    if heir is not null then
      update public.chats set created_by = heir where id = c.id;
      update public.chat_members set is_admin = true where chat_id = c.id and user_id = heir;
    else
      update public.chats set deleted_at = now(), is_private = true, username = null, invite_code = null, pinned_message = null,
             last_message_text = null, last_message_sender = null where id = c.id;
      update public.messages set deleted_at = now() where chat_id = c.id and deleted_at is null;
    end if;
  end loop;
  update public.chat_members m set left_at = now(), is_admin = false
    from public.chats ch where ch.id = m.chat_id and ch.is_group and m.user_id = me and m.left_at is null;
  update public.stories set deleted_at = now() where user_id = me and deleted_at is null;
  update public.push_subscriptions set enabled = false where user_id = me;
  delete from public.nft_listings where status <> 'open' and (username in (select username from public.collectible_usernames where owner_id = me)
                                                           or number in (select number from public.collectible_numbers where owner_id = me));
  delete from public.collectible_usernames where owner_id = me;
  delete from public.collectible_numbers where owner_id = me;
  update public.support_tickets set status = 'closed' where user_id = me and status = 'open';
  update public.profiles
     set username = 'deleted_' || substr(md5(random()::text || me::text), 1, 16), display_name = 'Удалённый аккаунт',
         avatar_path = null, bio = '', verified = false, premium_until = null, name_hue = null, is_admin = false,
         worn_gift = null, worn_type = null, worn_model = null, worn_backdrop = null, worn_number = null,
         pinned_chat = null, profile_bg = null, hide_seen = true, last_seen_at = null,
         banned_at = now(), ban_reason = p_reason, deleted_at = now()
   where id = me;
  update auth.sessions set not_after = now() where user_id = me;
  update auth.refresh_tokens set revoked = true where user_id = me::text;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', 'deleted+' || me::text || '@deleted.invalid')
   where user_id = me;
  update auth.users
     set email = 'deleted+' || me::text || '@deleted.invalid', encrypted_password = null, phone = null,
         raw_user_meta_data = '{}'::jsonb, email_change = '', banned_until = 'infinity'
   where id = me;
end $function$;
revoke all on function private.purge_account(uuid, text) from public, anon, authenticated;
