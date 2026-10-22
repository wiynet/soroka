# Mestario для Android

Настоящее Android-приложение: все файлы интерфейса (index.html, en.js, картинки) лежат внутри APK,
сервер — тот же Supabase. Собирается автоматически на GitHub (файл `.github/workflows/android.yml`)
при каждом изменении `index.html`, `en.js` или этой папки.

Скачать последнюю сборку: https://github.com/wiynet/soroka/releases/latest/download/Mestario.apk

Подпись: если в настройках репозитория (Settings → Secrets and variables → Actions) добавлены секреты
`ANDROID_KEYSTORE_B64` (keystore в base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
APK подписывается этим ключом и обновляется поверх старого. Без них — отладочной подписью
(тогда перед установкой новой сборки старую нужно удалить). Ключ и пароли в репозиторий не кладём.

Сборки APK запускаются при изменениях в app/ или в workflow; интерфейс приложение подтягивает с сайта само.
