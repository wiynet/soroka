-- 2026-11-06: касса TON, тираж коллекции, маска, админ @user, коды входа от @mestario
-- 1) касса TON: новый адрес. Неоплаченные заказы, у которых адрес не записан, остаются на старом — поздний перевод на него всё равно зачтётся
update public.ton_orders set pay_to = (select address from private.ton_config limit 1) where status = 'pending' and pay_to is null;
update private.ton_config set address = 'UQAOd58BWfTt7cBc4_cM_u3RAOXf5KfkjoTYCdk51LoajnDD';

-- 2) тираж всех подарков коллекции Mestario — 15 000
update public.gift_types set supply = 15000 where id like 'm\_%';
-- 3) маска больше не продаётся
update public.gift_types set hidden = true where id = 'm_mask';
-- 9) старые подарки убираем из магазина
update public.gift_types set hidden = true where id not like 'm\_%';

-- 5) @user больше не админ
update public.profiles set is_admin = false, is_chief = false where username = 'user';

-- 6) коды для входа приходят от @mestario
update private.system_accounts set user_id = (select id from public.profiles where username = 'mestario') where key = 'login_bot'
  and exists (select 1 from public.profiles where username = 'mestario');
