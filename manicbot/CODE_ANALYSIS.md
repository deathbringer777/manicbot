# Анализ кода ManicBot — мультитенантность, конфликты, деплой

## 1. Структура и точка входа

| Файл | Назначение |
|------|------------|
| **src/worker.js** | **Актуальная точка входа** (wrangler.toml: `main = "src/worker.js"`). Роутинг, webhook, Stripe, admin, cron. |
| **archive/worker.legacy.js** | Устаревший монолит (перенесён из корня). При деплое не используется. |

---

## 2. Мультитенантность — как устроено

### 2.1 Роутинг контекста (`getCtx`)

- **POST `/webhook/{botId}`** → `resolveTenantFromBotId(kv, botId)` → `buildTenantCtx(env, resolved)`. Контекст с `prefix = t:{tenantId}:`, `ctx.tenantId`, `ctx.tenant`, `ctx.bot`, `ctx.globalKv`.
- **Остальные запросы** (GET /setup, /admin, POST /webhook без botId):
  - Если есть `env.BOT_TOKEN` и миграция выполнена (`isMigrationDone`) → тот же tenant по `botId` из токена → `buildTenantCtx`.
  - Иначе → `buildLegacyCtx(env)`: один бот из env, `prefix = b:{botId}:`, `tenantId: null`, `tenant: null`, `bot` из env.
- Если `getCtx` вернул `null` и путь не `/` и не `/admin/migrate` → fallback `buildCtx(env)` из `config.js` (без `tenantId`, `tenant`, `bot`, `globalKv`). Используется редко (например, неизвестный botId в webhook).

### 2.2 KV-ключи

- **Глобальные (без префикса тенанта):** `tenant:{id}`, `bot:{botId}`, `botmap:{botId}`, `migration:v1:done`, `stripe:evt:*`, `stripe_customer:*`, `tenant_sub_by_sub:*`.
- **В рамках тенанта:** все вызовы идут через `ctx.prefix`:
  - после миграции: `t:{tenantId}:...` (например `t:default:lang:123`, `t:default:ap:...`);
  - до миграции (legacy): `b:{botId}:...`.

Все операции `kvGet`/`kvPut`/`kvDel`/`kvListAll` используют `ctx.prefix`, поэтому данные тенантов изолированы.

### 2.3 Cron (scheduled)

- Берётся список тенантов: `listTenantIds(kv)`.
- Для каждого тенанта вызывается `handleCron(ctx)` с контекстом этого тенанта (через первого бота тенанта). Fallback: если тенантов нет — один вызов `handleCron(ctx)` с `buildLegacyCtx(env)` при наличии `BOT_TOKEN` и `WEBHOOK_SECRET`, иначе `buildCtx(env)`.

### 2.4 Stripe webhook

- Один endpoint **POST `/stripe/webhook`** для всех тенантов.
- По `metadata.tenantId`, `customer` → tenant, обновление полей биллинга в `tenant:{tenantId}`.
- Идемпотентность по `stripe:evt:{eventId}`.

### 2.5 Админка

- **GET /admin** — данные **текущего** контекста (один тенант при запросе через одного бота).
- **GET /admin/billing** — список **всех** тенантов и их биллинг (platform-level).
- **GET /admin/migrate?key=...** — запуск миграции (создание `default` tenant + бот, копирование `b:{botId}:*` → `t:default:*`).

---

## 3. Обнаруженные проблемы и конфликты

### 3.1 Два способа «legacy» контекста

- **buildLegacyCtx** (tenant/resolver.js): возвращает `tenantId: null`, `tenant: null`, `bot: { botId, botToken, webhookSecret }`, `globalKv: env.MANICBOT`.
- **buildCtx** (config.js): возвращает объект без полей `tenantId`, `tenant`, `bot`, `globalKv`.

**Риск:** код, который обращается к `ctx.tenant` / `ctx.globalKv` без optional chaining, может сломаться при fallback на `buildCtx`. Сейчас в коде везде используются `ctx.tenantId`, `ctx.tenant?.name`, `ctx.bot?.botId`, `ctx.globalKv` с проверками, так что текущее использование безопасно. Рекомендация: в fallback в worker.js по возможности использовать `buildLegacyCtx(env)` вместо `buildCtx(env)`, чтобы форма контекста была единой (тогда для запросов без «своего» бота можно оставить только явный buildCtx там, где тенант не нужен).

### 3.2 kvListAll без префикса

- **Было:** при вызове `kvListAll(ctx, {})` (без `prefix`) список запрашивался без `ctx.prefix` — т.е. по всему KV (утечка данных между тенантами).
- **Исправлено:** в `src/utils/kv.js` список всегда ограничивается префиксом: если `opts.prefix` не передан, используется `ctx.prefix`, так что листинг всегда в рамках одного тенанта/бота.

### 3.3 Webhook secret по тенанту

- В мультитенанте у каждого бота свой `webhookSecret` (хранится в `bot` в KV). Проверка в worker: `timingSafeEqual(secret, ctx.WEBHOOK_SECRET)`. Для `/webhook/{botId}` контекст строится по боту, поэтому используется правильный секрет. Конфликта нет.

### 3.4 Setup URL для мультитенанта

- В `/setup` webhook выставляется как `url.origin + '/webhook/' + botId`. После миграции нужно перенастроить webhook в Telegram на `https://<worker>/webhook/<botId>`, иначе запросы пойдут на старый путь. Это описано в шагах деплоя ниже.

---

## 4. Зависимости и окружение

- **Секреты:** `BOT_TOKEN`, `ADMIN_KEY`, `WEBHOOK_SECRET` — обязательны для legacy и для миграции.
- **Опционально:** `BOT_ENCRYPTION_KEY` (шифрование токенов ботов в KV), `ADMIN_CHAT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*_MONTHLY`, `APP_BASE_URL`, `CLOUDFLARE_ACCOUNT_ID`, `WORKERS_AI_API_TOKEN`.
- **wrangler.toml:** `vars.APP_BASE_URL` может быть пустым; для Stripe checkout лучше задать `APP_BASE_URL` (или секрет).

---

## 5. Тесты

- **test/tenant.test.js** — tenant storage, botmap, listTenantIds, getBotIdsByTenantId, миграция (идемпотентность).
- **test/tenant-resolver.test.js** — resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx, isMigrationDone (mock KV).
- **test/billing-webhooks.test.js** — проверка подписи Stripe, идемпотентность, обработка checkout.session.completed (mock KV).
- **test/kv.test.js** — kvPut/kvGet/kvListAll/kvDel, листинг всегда в рамках ctx.prefix.
- **test/config.test.js** — buildCtx, константы (CB, STEP, VALID_LANGS, WORK, TIMEZONE).
- **test/date.test.js**, **test/patterns.test.js**, **test/ics.test.js**, **test/helpers.test.js**, **test/security.test.js**.

Запуск: `npm run test`.

---

## 6. Деплой рабочей мультитенантной версии

### 6.1 Чек-лист перед деплоем

1. **Точка входа:** в `wrangler.toml` указано `main = "src/worker.js"` (не корневой `worker.js`).
2. **KV:** создан namespace и привязан как `MANICBOT` (id в wrangler.toml).
3. **Секреты:** выставлены `BOT_TOKEN`, `ADMIN_KEY`, `WEBHOOK_SECRET`. Для Stripe — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, при необходимости цены и `APP_BASE_URL`.
4. **Миграция:** выполнить один раз после первого деплоя:  
   `GET https://<worker-url>/admin/migrate?key=<ADMIN_KEY>`  
   Ответ: `{ "ok": true, "copied": N, "message": "..." }` или `{ "ok": true, "skipped": true }` если уже выполнена.
5. **Webhook Telegram:** после миграции обновить webhook на  
   `https://<worker-url>/webhook/<botId>`  
   через `/setup?key=<ADMIN_KEY>` (worker сам вернёт нужный URL в ответе) или вручную через BotFather/API.
6. **Cron:** в wrangler задан триггер (например `*/15 * * * *`) — напоминания и очистка по каждому тенанту.
7. **Stripe:** в Dashboard настроен webhook на `https://<worker-url>/stripe/webhook`, подписанный тем же `STRIPE_WEBHOOK_SECRET`.

### 6.2 Команды

```bash
cd manicbot
npm ci
npm run test
wrangler deploy
# После деплоя:
# 1) Открыть https://<worker>/admin/migrate?key=YOUR_ADMIN_KEY
# 2) Открыть https://<worker>/setup?key=YOUR_ADMIN_KEY и при необходимости обновить webhook
```

### 6.3 Добавление второго тенанта (вручную)

Сейчас создание тенантов и привязка ботов заложены в коде (миграция создаёт один `default`), но добавление новых тенантов через UI/команды не реализовано. Для второго тенанта нужно либо:

- расширить админку/API (создание tenant, регистрация бота, запись в `tenant:*`, `bot:*`, `botmap:*`),  
либо  
- временно положить ключи в KV вручную (по образцу `tenant/storage.js` и `tenant/migration.js`), затем выставлять webhook на `/webhook/<newBotId>`.

---

## 7. Краткий итог

- **Активный код:** `src/worker.js` и модули в `src/`. Корневой `worker.js` не используется при деплое.
- **Мультитенантность:** реализована через tenant/bot registry, префиксы `t:{tenantId}:`, один webhook по пути `/webhook/{botId}`, общий Stripe webhook и мультитенантный cron.
- **Конфликты:** устранён риск утечки данных в `kvListAll` при отсутствии префикса; два типа legacy-контекста не ломают текущий код, но можно унифицировать fallback на `buildLegacyCtx`.
- **Деплой с рабочим мультитенантом:** деплой из `src/worker.js`, выполнение миграции, перенастройка webhook на `/webhook/<botId>` и при необходимости настройка Stripe и cron.
