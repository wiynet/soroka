# Шаблоны писем Mestario для Supabase

Supabase → Authentication → Emails → Templates. Для каждого письма: вставьте **Subject** и замените **Body** целиком на код ниже, затем **Save**.


## Confirm sign up

**Subject:** `Подтвердите почту в Mestario`

**Body:**

```html
<div style="background:#f3f5f6;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#131c22">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #d6dee2">
    <tr><td style="padding:28px 28px 8px;text-align:center">
      <img src="https://mestario.lol/icon-192.png" width="52" height="52" alt="Mestario" style="border-radius:14px;display:inline-block">
      <div style="font-size:20px;font-weight:700;margin-top:10px">Ваш код для регистрации</div>
      <div style="font-size:15px;line-height:1.5;color:#5d6b74;margin-top:8px">Введите этот код на странице регистрации Mestario — и аккаунт готов.</div>
    </td></tr>
    <tr><td style="padding:18px 28px 14px;text-align:center">
      <div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:8px;background:#e9eef0;border-radius:14px;padding:14px 18px 14px 26px;font-family:'SF Mono',Menlo,Consolas,monospace">{{ .Token }}</div>
      <div style="font-size:13px;color:#8c9ba5;margin-top:8px">Код действует 1 час</div>
    </td></tr>
    <tr><td style="padding:4px 28px 8px;text-align:center">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0b7284;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Или подтвердить по ссылке</a>
    </td></tr>
    <tr><td style="padding:16px 28px 26px;text-align:center;font-size:13px;line-height:1.5;color:#8c9ba5">Если вы не регистрировались в Mestario, просто проигнорируйте это письмо.</td></tr>
  </table>
  <div style="text-align:center;font-size:12px;color:#8c9ba5;margin-top:14px">Mestario · <a href="https://mestario.lol" style="color:#8c9ba5">mestario.lol</a></div>
</div>
```


## Magic link or OTP

**Subject:** `Код для входа в Mestario`

**Body:**

```html
<div style="background:#f3f5f6;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#131c22">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #d6dee2">
    <tr><td style="padding:28px 28px 8px;text-align:center">
      <img src="https://mestario.lol/icon-192.png" width="52" height="52" alt="Mestario" style="border-radius:14px;display:inline-block">
      <div style="font-size:20px;font-weight:700;margin-top:10px">Код для входа</div>
      <div style="font-size:15px;line-height:1.5;color:#5d6b74;margin-top:8px">Кто-то (надеемся, вы) входит в ваш аккаунт Mestario. Введите этот код, чтобы завершить вход.</div>
    </td></tr>
    <tr><td style="padding:18px 28px 14px;text-align:center">
      <div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:8px;background:#e9eef0;border-radius:14px;padding:14px 18px 14px 26px;font-family:'SF Mono',Menlo,Consolas,monospace">{{ .Token }}</div>
      <div style="font-size:13px;color:#8c9ba5;margin-top:8px">Код действует 1 час</div>
    </td></tr>
    <tr><td style="padding:4px 28px 8px;text-align:center">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0b7284;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Или войти по ссылке</a>
    </td></tr>
    <tr><td style="padding:16px 28px 26px;text-align:center;font-size:13px;line-height:1.5;color:#8c9ba5">Если это были не вы — смените пароль в «Настройки → Безопасность». Без этого кода в аккаунт не войти.</td></tr>
  </table>
  <div style="text-align:center;font-size:12px;color:#8c9ba5;margin-top:14px">Mestario · <a href="https://mestario.lol" style="color:#8c9ba5">mestario.lol</a></div>
</div>
```


## Reset password

**Subject:** `Новый пароль для Mestario`

**Body:**

```html
<div style="background:#f3f5f6;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#131c22">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #d6dee2">
    <tr><td style="padding:28px 28px 8px;text-align:center">
      <img src="https://mestario.lol/icon-192.png" width="52" height="52" alt="Mestario" style="border-radius:14px;display:inline-block">
      <div style="font-size:20px;font-weight:700;margin-top:10px">Смена пароля</div>
      <div style="font-size:15px;line-height:1.5;color:#5d6b74;margin-top:8px">Нажмите кнопку ниже, чтобы придумать новый пароль. Ссылка работает один раз.</div>
    </td></tr>
    <tr><td style="padding:4px 28px 8px;text-align:center">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0b7284;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Задать новый пароль</a>
    </td></tr>
    <tr><td style="padding:16px 28px 26px;text-align:center;font-size:13px;line-height:1.5;color:#8c9ba5">Если вы не просили сменить пароль, ничего делать не нужно — пароль останется прежним.</td></tr>
  </table>
  <div style="text-align:center;font-size:12px;color:#8c9ba5;margin-top:14px">Mestario · <a href="https://mestario.lol" style="color:#8c9ba5">mestario.lol</a></div>
</div>
```


## Change email address

**Subject:** `Подтвердите новую почту в Mestario`

**Body:**

```html
<div style="background:#f3f5f6;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#131c22">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:18px;border:1px solid #d6dee2">
    <tr><td style="padding:28px 28px 8px;text-align:center">
      <img src="https://mestario.lol/icon-192.png" width="52" height="52" alt="Mestario" style="border-radius:14px;display:inline-block">
      <div style="font-size:20px;font-weight:700;margin-top:10px">Подтвердите новую почту</div>
      <div style="font-size:15px;line-height:1.5;color:#5d6b74;margin-top:8px">Вы меняете почту аккаунта Mestario на {{ .NewEmail }}. Подтвердите, что это вы.</div>
    </td></tr>
    <tr><td style="padding:18px 28px 14px;text-align:center">
      <div style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:8px;background:#e9eef0;border-radius:14px;padding:14px 18px 14px 26px;font-family:'SF Mono',Menlo,Consolas,monospace">{{ .Token }}</div>
      <div style="font-size:13px;color:#8c9ba5;margin-top:8px">Код действует 1 час</div>
    </td></tr>
    <tr><td style="padding:4px 28px 8px;text-align:center">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0b7284;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">Подтвердить новую почту</a>
    </td></tr>
    <tr><td style="padding:16px 28px 26px;text-align:center;font-size:13px;line-height:1.5;color:#8c9ba5">Если вы не меняли почту — смените пароль в «Настройки → Безопасность».</td></tr>
  </table>
  <div style="text-align:center;font-size:12px;color:#8c9ba5;margin-top:14px">Mestario · <a href="https://mestario.lol" style="color:#8c9ba5">mestario.lol</a></div>
</div>
```
