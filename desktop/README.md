# Mestario для Windows

Electron-обёртка: окно открывает сайт Mestario, без интернета — встроенную копию интерфейса из `www/`.
Собирается GitHub Actions (`.github/workflows/windows.yml`) при изменениях в `desktop/` или в самом workflow:
в выпуск `windows-N` кладутся `Mestario-Setup.exe` (установщик) и `Mestario.exe` (без установки).
Выпуск не помечается «последним», чтобы ссылка releases/latest/download/Mestario.apk продолжала вести на APK.
