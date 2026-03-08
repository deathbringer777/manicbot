# Анализ и деплой

## План

1. **Анализ кода** — проверка worker.js и src/* на ошибки и согласованность.
2. **Исправления** — правки, мешающие работе.
3. **Деплой** — wrangler.toml в корне, npm install, wrangler deploy.

---

## Что сделано

### Анализ

- **Webhook:** `/webhook` и `/webhook/:botId` — путь парсится, токен берётся из `getBotToken(env, botId)`, контекст собирается с нужным tenantId.
- **Остальные роуты** (/, /admin, /setup, cron) используют `buildCtxWithTenant(env)` и требуют хотя бы один токен. Раньше обязательным был только `BOT_TOKEN` — при его отсутствии падали даже / и /admin.

### Исправление

- **Default token:** для маршрутов без бота (админка, лендинг, крон) теперь используется первый доступный токен: `BOT_TOKEN` → `BOT_TOKEN_SALON1` → `BOT_TOKEN_SALON2` → `BOT_TOKEN_MASTER1` → `BOT_TOKEN_MASTER2`. Можно не задавать `BOT_TOKEN`, если задан хотя бы один из ботов.

### Деплой

- В **корне** добавлены:
  - `wrangler.toml` — main = `worker.js`, KV binding MANICBOT, cron */15 * * * *
  - `package.json` — скрипты `deploy` и `dev`, зависимость wrangler
- Выполнены: `npm install`, `npx wrangler deploy`.

---

## Результат

- **URL воркера:** https://manicbot.vdovin-kyrylo.workers.dev
- **Cron:** раз в 15 минут (напоминания и очистка для default tenant).

Секреты (ADMIN_KEY, WEBHOOK_SECRET, BOT_TOKEN_SALON1, BOT_TOKEN_SALON2, BOT_TOKEN_MASTER1, BOT_TOKEN_MASTER2) нужно задать в Dashboard или через `wrangler secret put ...`. После этого один раз вызвать setup для каждого бота (см. MULTI_BOT_SETUP.md).
