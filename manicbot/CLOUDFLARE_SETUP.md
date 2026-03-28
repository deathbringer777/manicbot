# Проверка настройки Cloudflare для ManicBot

Если AI не отвечает в боте (всегда «Не понимаю») или не приходят уведомления о консультанте — проверь по шагам.

## 0. D1 База данных (обязательно при первом деплое)

ManicBot использует **Cloudflare D1** (SQL) для хранения тенантов, мастеров, записей и ролей.

### Создать базу данных:
```bash
cd manicbot
npx wrangler d1 create manicbot-db
```

Скопируй `database_id` из вывода в `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "manicbot-db"
database_id = "ТВОЙ-ID"
```

### Инициализировать схему:
```bash
npx wrangler d1 execute manicbot-db --remote --file src/db/schema.sql
```

### Проверить:
```bash
npx wrangler d1 execute manicbot-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```
Должно вернуть порядка **20+** таблиц (в т.ч. `channel_configs`, `conversations`, `message_windows` для омниканала). После изменений в `migrations/` и `schema.sql` синхронизируй Drizzle (`admin-app/src/server/db/schema.ts`) и прогоняй **`npm run check-schema`** в каталоге `manicbot/`.

### Существующие данные (если была KV-только установка):
Если у тебя уже работает бот с KV-хранилищем, выполни миграцию данных — см. **MIGRATION.md**.

---

## 1. Workers AI по API-токену (рекомендуется)

Если binding не срабатывает, подключи вызов через REST API по токену:

1. В дашборде: **Build → AI → Workers AI** — скопируй **Account ID** и нажми **Create a Workers AI API Token** (права Read + Edit).
2. В проекте задай секреты воркеру:
   ```bash
   cd manicbot
   wrangler secret put WORKERS_AI_API_TOKEN
   # вставь токен когда попросит
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   # вставь Account ID (например 07dbabce20f0e9f375a020b5314d5427)
   ```
3. Задеплой: `npm run deploy`.

Код сначала пробует REST по токену; если токен и Account ID заданы — binding не используется для AI.

## 2. Workers AI включён

- Зайди в **Cloudflare Dashboard** → **Build** → **AI** → **Workers AI**.
- Страница должна открываться без ошибок. Если продукт не включён — включи его для аккаунта.
- На бесплатном плане даётся лимит Neurons в день; при превышении запросы могут падать.

## 3. Binding AI у воркера

- **Workers & Pages** → выбери воркер **manicbot** → **Settings** → **Variables**.
- В блоке **Bindings** должна быть привязка **AI** (тип Workers AI). Она добавляется из `wrangler.toml` при `wrangler deploy`.
- Если binding нет — выполни ещё раз `npm run deploy` из папки `manicbot`.

## 4. Модель

В коде используются:

- основная: `@cf/openai/gpt-oss-120b`;
- запасная: `@cf/meta/llama-3.1-8b-instruct`.

Если основная модель недоступна в твоём аккаунте/регионе, ответы пойдут через запасную.

## 5. Уведомления «Подключить консультанта»

Чтобы при нажатии кнопки «Подключить консультанта» кто-то получал уведомление:

- В боте должен быть **зарегистрирован админ** (команда `/admin YOUR_ADMIN_KEY`) и/или добавлены **мастера** в админ-панели.
- Опционально: в настройках воркера задай переменную **ADMIN_CHAT_ID** (числовой Telegram chat_id), тогда уведомления будут приходить и туда. Этот же пользователь считается **создателем платформы**: у него полный доступ к панели платформы (/panel — Салоны, Регистрация бота, Агенты поддержки), все кнопки работают без команды /sysadmin.

## 6. Логи при ошибках AI

- **Workers & Pages** → **manicbot** → **Logs** (Real-time logs или Analytics).
- В логах ищи строки `Workers AI error:` или `Workers AI run ... error:` — по ним можно понять, падает ли вызов модели и с какой ошибкой.

## 7. Stripe (подписки и оплата)

Полная настройка: **STRIPE_SETUP.md**. Кратко: задай секреты (один запуск скрипта):

```bash
cd manicbot && chmod +x scripts/setup-stripe-secrets.sh && ./scripts/setup-stripe-secrets.sh
```

По запросу подставь: Stripe Secret key, Webhook signing secret, URL воркера (APP_BASE_URL). В Stripe Dashboard добавь webhook на `https://ТВОЙ_ВОРКЕР.workers.dev/stripe/webhook`.

## 8. Краткий чеклист

| Проверка | Где смотреть |
|----------|----------------|
| D1 создана и схема залита | `wrangler d1 execute manicbot-db --remote --file src/db/schema.sql` |
| Workers AI включён | Build → AI → Workers AI |
| У воркера есть binding AI | Workers → manicbot → Settings → Variables → Bindings |
| У воркера есть binding DB | Workers → manicbot → Settings → Variables → Bindings → D1 |
| Деплой после изменений | `npm run deploy` в папке manicbot |
| Админ/мастера для уведомлений | Бот: /admin, панель мастера |
| Ошибки AI | Workers → manicbot → Logs |
| Stripe (биллинг) | STRIPE_SETUP.md, scripts/setup-stripe-secrets.sh |

## 9. Мультитенантность: деплой с одним рабочим тенантом

Точка входа — **src/worker.js** (в `wrangler.toml` указано `main = "src/worker.js"`). Корневой `worker.js` при деплое не используется.

После первого деплоя нужно один раз выполнить миграцию и перенастроить webhook:

1. **Миграция** (создаёт тенант `default` и переносит данные с префикса бота на `t:default:`):
   ```
   GET https://ТВОЙ_ВОРКЕР.workers.dev/admin/migrate?key=ТВОЙ_ADMIN_KEY
   ```
   В ответе должно быть `"ok": true` и `"copied": N` (или `"skipped": true`, если миграция уже была).

2. **Webhook для Telegram** после миграции должен указывать на путь с `botId`:
   ```
   https://ТВОЙ_ВОРКЕР.workers.dev/webhook/BOT_ID
   ```
   (BOT_ID — первая часть токена бота, до двоеточия.) Проще всего открыть:
   ```
   https://ТВОЙ_ВОРКЕР.workers.dev/setup?key=ТВОЙ_ADMIN_KEY
   ```
   В ответе будет нужный URL webhook — скопируй его и при необходимости обнови в настройках бота (BotFather / setWebhook).

3. **Cron** уже настроен в wrangler (`*/15 * * * *`): напоминания и очистка выполняются по каждому тенанту.

Подробный разбор кода и конфликтов — в **CODE_ANALYSIS.md**.

---

## Mini App (Pages): Instagram / WhatsApp — подсказки в интерфейсе

Чтобы во вкладке **Channels** отображались те же **Verify Token** и базовый URL вебхука, что использует Worker:

| Переменная (Cloudflare Pages → Settings → Variables) | Назначение |
|------------------------------------------------------|------------|
| `WORKER_PUBLIC_URL` | Публичный URL Worker, например `https://manicbot.com` (без `/` в конце) |
| `META_VERIFY_TOKEN_WA` | То же значение, что в `wrangler secret put META_VERIFY_TOKEN_WA` |
| `META_VERIFY_TOKEN_IG` | То же значение, что в `wrangler secret put META_VERIFY_TOKEN_IG` |

Инструкция для клиентов салона: **META_CHANNELS_SETUP.md**.

**CLI (альтернатива полям в UI Pages):** из каталога с установленным `wrangler` и авторизацией в аккаунт Cloudflare:

```bash
cd manicbot/admin-app
npx wrangler pages secret put WORKER_PUBLIC_URL --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_WA --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_IG --project-name=admin-app
```

Подставь те же значения, что заданы у Worker (`wrangler secret put META_VERIFY_TOKEN_WA` и т.д.). После изменения секретов сделай новый деплой Pages (push в `main` или ручной `pages deploy`).
