# Мульти-бот: салоны + мастера

Актуальная схема: **D1** (`tenants`, `bots`) + webhook **`POST /webhook/{botId}`** (numeric bot id из токена). Демо-самопровижининг при секретах `BOT_TOKEN_SALON*` см. `src/http/demoBots.js`. Полная картина — **[CLAUDE.md](CLAUDE.md)**.

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

После деплоя для **каждого** бота вызови `setWebhook` на URL с **числовым** `botId` (первые цифры до `:` в токене), например:

`https://manicbot.com/webhook/123456789`

Служебный эндпоинт **`GET /setup?key=ADMIN_KEY`** (см. `adminPanelHttp.js`) выставляет webhook для текущего контекста (`BOT_TOKEN` или бот из D1). Массовая выдача: **`POST /admin/provision?key=...`**.

## Данные

У каждого салона свой **`tenant_id`** в D1; KV-префикс для рантайма: **`t:{tenantId}:*`**. Записи и пользователи изолированы по `tenant_id` в SQL.

## Крон (напоминания)

Сейчас напоминания крутятся только для одного тенанта — того, чей токен записан в **BOT_TOKEN**. Обычно ставят туда токен первого бота (salon1). Чтобы напоминания работали и для salon2, потом можно доработать cron по списку ботов.
