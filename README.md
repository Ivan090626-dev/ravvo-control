# Sentinel — Telegram-бот и веб-панель

## Быстрый запуск на macOS

```bash
cd ~/Downloads/sentinel-telegram-suite
cp .env.example .env
open -e .env
```

В `.env` вставьте токен от BotFather, задайте пароль и JWT_SECRET длиной от 24 символов. Затем:

```bash
npm install --cache ./npm-cache
npm run setup
npm run dev
```

Панель: http://localhost:5173

## Подключение к Telegram

1. Создайте бота через @BotFather.
2. В BotFather выполните `/setprivacy` → Disable.
3. Добавьте бота в группу и назначьте администратором.
4. Разрешите удалять сообщения, банить и ограничивать участников.
5. Отправьте в группе `/start` или `/help` — группа появится в панели.

## Команды

- `/ban [@username|id] 15m причина`;
- `/mute [@username|id] 1h причина`, `/unmute`;
- `/kick`, `/delete` ответом;
- `/role give/remove [user] owner|moderator|editor`;
- `/rules`, `/setrules текст`, `/announce текст`.

Время: `s`, `m`, `h`, `d`, `w`. Временные наказания хранятся в SQLite и автоматически снимаются после перезапуска. Для пользователя надёжнее использовать reply или Telegram ID.
