# Мульти-бот: салоны + мастера

**Важно:** если токены светились в чате — в @BotFather нажми «Revoke current token» и в секреты вставь уже **новый** токен.

## Секреты в Cloudflare (Wrangler)

Токены **никогда** не хранить в коде. Только в Secrets.

```bash
# Обязательные
wrangler secret put ADMIN_KEY
wrangler secret put WEBHOOK_SECRET

# Салоны
wrangler secret put BOT_TOKEN_SALON1
wrangler secret put BOT_TOKEN_SALON2

# Мастера
wrangler secret put BOT_TOKEN_MASTER1
wrangler secret put BOT_TOKEN_MASTER2

# Для админки и крона — любой один токен (например salon1)
wrangler secret put BOT_TOKEN
```

## Webhook для каждого бота

После деплоя один раз открой в браузере (подставь домен и ADMIN_KEY):

| Бот | URL |
|-----|-----|
| Салон 1 | `https://ТВОЙ_WORKER.workers.dev/setup/salon1?key=ТВОЙ_ADMIN_KEY` |
| Салон 2 | `https://ТВОЙ_WORKER.workers.dev/setup/salon2?key=ТВОЙ_ADMIN_KEY` |
| Мастер 1 | `https://ТВОЙ_WORKER.workers.dev/setup/master1?key=ТВОЙ_ADMIN_KEY` |
| Мастер 2 | `https://ТВОЙ_WORKER.workers.dev/setup/master2?key=ТВОЙ_ADMIN_KEY` |

Telegram будет слать обновления на `.../webhook/salon1`, `.../webhook/salon2`, `.../webhook/master1`, `.../webhook/master2`.

## Данные

У каждого бота свой тенант в KV:

- **salon1** → `tenant:salon1:...`
- **salon2** → `tenant:salon2:...`
- **master1** → `tenant:master1:...`
- **master2** → `tenant:master2:...`

Юзеры и записи между ними не пересекаются. Конфиг (адрес, услуги) пока общий; свои конфиги можно позже положить в KV: `tenant:master1:config`, `tenant:master2:config` и т.д.

## Крон (напоминания)

Сейчас напоминания крутятся только для одного тенанта — того, чей токен записан в **BOT_TOKEN**. Обычно ставят туда токен первого бота (salon1). Чтобы напоминания работали и для salon2, потом можно доработать cron по списку ботов.
