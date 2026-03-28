# ManicBot

**Мультитенантный Telegram-бот для записи в маникюрные салоны**

Один Cloudflare Worker обслуживает неограниченное количество ботов — по одному на каждый салон. Клиент пишет в Telegram → бот обрабатывает запись, отвечает через ИИ, уведомляет мастера и управляет расписанием.

---

## Возможности

- **Онлайн-запись** — выбор услуги, мастера, даты и времени прямо в Telegram
- **ИИ-ассистент** — Workers AI (Llama) ведёт свободный диалог и понимает намерения клиента
- **Роли** — system_admin / technical_support / support / tenant_owner / master / client
- **Мультитенантность** — D1 (основной реестр тенантов и ботов) + KV для состояния; префикс `t:{tenantId}:*`; legacy-режим `b:{botId}:*` при одном `BOT_TOKEN`
- **Омниканал** — WhatsApp / Instagram (Meta webhooks) через общий `handlers/inbound.js` → те же `onMsg` / `onCb`, что и Telegram
- **Биллинг** — Stripe Checkout и Portal, три тарифа (Start / Pro / Studio)
- **Поддержка** — тикеты клиент↔мастер и платформенные тикеты клиент↔агент поддержки
- **Уведомления** — cron каждые 15 мин, напоминания о записях
- **Календарь** — ICS-файл для каждой записи
- **Интерфейс на 4 языках** — RU, UA, EN, PL
- **Панели управления** — HTML-админка для тенанта, sysadmin-панель для платформы
- **CSV-экспорт** — клиенты и записи

---

## Стек

| Слой | Технология |
|---|---|
| Runtime | Cloudflare Workers |
| Хранилище | Cloudflare D1 (SQL) + KV |
| ИИ | Cloudflare Workers AI (REST, `@cf/meta/llama-3.1-8b-instruct`) |
| Биллинг | Stripe API |
| Мессенджер | Telegram Bot API |
| Тесты | Vitest 4.x + `@cloudflare/vitest-pool-workers` (Worker ~826 тестов); admin-app — отдельный Vitest |
| Deploy | Wrangler 4.x → `manicbot.com` |

---

## Структура

```
manicbot/
├── src/
│   ├── worker.js              # Точка входа: оркестрация fetch + scheduled (cron)
│   ├── http/                  # Обработчики маршрутов (Stripe, admin, Google, webhooks TG/Meta, лендинг)
│   ├── config.js              # Константы: CB, STEP, DEFAULT_SVC, buildCtx
│   ├── telegram.js            # send(), api() — Telegram Bot API
│   ├── ai.js                  # Промпт, теги [BOOK:…], runWorkersAI, executeAIAction
│   ├── i18n.js                # Строки RU / UA / EN / PL
│   ├── patterns.js            # Паттерны фраз (отмена, прайс, консультант)
│   ├── notifications.js       # Уведомления мастеру/админу
│   │
│   ├── tenant/                # Мультитенантность
│   │   ├── storage.js         # tenant:*, bot:*, botmap:*, listTenantIds
│   │   ├── resolver.js        # resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx
│   │   └── migration.js       # Миграция b: → t:default:
│   │
│   ├── roles/
│   │   └── roles.js           # getPlatformRole, getTenantRole, resolveRole, support agents
│   │
│   ├── admin/
│   │   ├── provisioning.js    # createTenant, registerBot, setTenantOwner, addMaster
│   │   └── seed.js            # Сид: 2 салона + услуги + мастер
│   │
│   ├── billing/
│   │   ├── config.js          # Stripe keys, price IDs
│   │   ├── stripe.js          # Checkout, Portal, getSubscription
│   │   ├── storage.js         # updateTenantBilling, stripe_customer:*
│   │   └── webhooks.js        # verifyStripeSignature, handleStripeWebhook
│   │
│   ├── support/
│   │   └── tickets.js         # Платформенные тикеты: create, claim, routing
│   │
│   ├── services/
│   │   ├── users.js           # getRole, isAdmin, isMaster, upsertUserFromTelegram
│   │   ├── state.js           # getState, setState, clearState, checkRateLimit
│   │   ├── chat.js            # getLang, setLang, getChatHistory
│   │   ├── services.js        # loadServices, saveServices, about
│   │   ├── appointments.js    # getApts, cancelApt, слоты
│   │   ├── tickets.js         # Консультант в салоне (мастер↔клиент)
│   │   └── calendar.js        # ICS-генерация
│   │
│   ├── handlers/
│   │   ├── message.js         # onMsg: команды, шаги диалога, ИИ
│   │   ├── callback.js        # onCb: inline-кнопки (запись, админка, тикеты)
│   │   ├── inbound.js         # Омниканал: нормализация WA/IG → onMsg/onCb
│   │   └── cron.js            # handleCron: напоминания о записях
│   ├── channels/              # Адаптеры Meta, Telegram bridge, ui-renderer
│   │
│   └── ui/
│       ├── screens.js         # welcome, prices, contacts, catalog, myApts
│       ├── booking.js         # Запись по шагам
│       ├── admin.js           # Панель тенанта: записи, клиенты, мастера
│       ├── sysadmin.js        # Панель платформы: тенанты, боты, поддержка
│       ├── billing.js         # Stripe Checkout / Portal
│       └── keyboards.js       # mainKb, svcKb
│
├── test/                      # Vitest тесты
├── scripts/
│   ├── run-migrate.js         # Скрипт миграции b: → t:
│   ├── check-schema-tables.mjs # Сверка имён таблиц schema.sql ↔ Drizzle (npm run check-schema)
│   └── setup-stripe-secrets.sh
├── admin-app/                 # Telegram Mini App (Next.js + tRPC + Drizzle) → Cloudflare Pages
├── wrangler.toml              # Worker config: KV, AI binding, cron, routes
└── package.json
```

---

## Архитектура данных

**D1** — записи, пользователи, тенанты, боты, роли, биллинг, каналы, `conversations` и т.д. (см. `src/db/schema.sql` и `admin-app/src/server/db/schema.ts`; после миграций запускайте `npm run check-schema`).

**KV** (`MANICBOT`) — эфемерное состояние, блокировки, шифрованные токены, история для ИИ. Ключи:

**Глобальные:**
- `tenant:{tenantId}` — документ тенанта (plan, billing, stripeCustomerId)
- `bot:{botId}` — документ бота (tenantId, webhookSecret, encryptedToken)
- `role:{chatId}` — платформенная роль: `system_admin` / `support`
- `ticket:{ticketId}` — платформенный тикет поддержки

**Тенантные** (префикс `t:{tenantId}:`)
- `cfg:svc_list` — услуги салона
- `u:{chatId}` — профиль клиента
- `master:{chatId}` — профиль мастера
- `ap:{aptId}` — запись на приём
- `state:{chatId}` — текущий шаг диалога
- `role:{chatId}` — роль внутри тенанта (tenant_owner / master)

---

## Роли

| Роль | Область | Права |
|---|---|---|
| `system_admin` | Платформа | Полный доступ ко всему |
| `technical_support` | Платформа | Техподдержка платформы (Mini App + те же God Mode API, что у `support`, через `platform_roles`) |
| `support` | Платформа | Агенты поддержки, тикеты |
| `tenant_owner` | Тенант | Управление салоном, мастерами, биллинг |
| `master` | Тенант | Расписание, записи клиентов |
| `client` | Тенант | Запись, просмотр своих записей |

---

## Маршруты Worker

Реализация разнесена по `src/http/*.js` (см. [CLAUDE.md](CLAUDE.md) — таблица модулей).

```
POST /stripe/webhook       → Stripe
GET  /stripe/success       → страница успешной оплаты
GET|POST /webhook/wa       → WhatsApp Cloud API (verify + HMAC)
GET|POST /webhook/ig       → Instagram Messaging (verify + HMAC)
POST /webhook/:botId       → Telegram (реестр бота в D1)
POST /webhook              → Telegram legacy (env BOT_TOKEN); при REQUIRE_WEBHOOK_BOT_ID=1 + D1 → 403
GET  /admin/migrate*       → миграции (ADMIN_KEY)
POST /admin/provision      → массовая выдача ботов (ADMIN_KEY; ошибки без stack в JSON)
GET  /google/*             → OAuth календаря
GET  /admin, /admin/billing, /admin/export/* → HTML + CSV (Basic Auth)
GET  /calendar/:id[.ics]   → ICS
GET  /setup, /remove-webhook → Telegram webhook (ADMIN_KEY)
… плюс прокси лендинга на LANDING_URL для выбранных GET-путей
```

Cron: `*/15 * * * *` → `handleCron` по каждому тенанту (D1) или legacy-контекст

---

## Быстрый старт

### Требования
- Node.js 18+ (через nvm)
- Аккаунт Cloudflare с Workers и KV
- Telegram Bot Token
- Stripe аккаунт (для биллинга)

### Установка и деплой

```bash
cd manicbot
npm install

# Настроить секреты
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put ADMIN_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put WORKERS_AI_API_TOKEN

# Задеплоить
npx wrangler deploy

# Зарегистрировать webhook бота
curl "https://manicbot.com/setup?key=YOUR_ADMIN_KEY"
```

### Тесты

```bash
cd manicbot && npm test && npm run check-schema
cd manicbot/admin-app && npm run typecheck && npm test
```

### Регистрация нового тенанта (салона)

1. Открыть sysadmin-панель в Telegram: `/sysadmin YOUR_ADMIN_KEY`
2. Зарегистрировать бота → ввести токен бота
3. Назначить владельца тенанта: `/grant_owner @username`

---

## Переменные окружения

| Переменная | Описание |
|---|---|
| `MANICBOT` | KV namespace binding |
| `BOT_TOKEN` | Telegram Bot Token (legacy/fallback) |
| `WEBHOOK_SECRET` | Секрет вебхука Telegram |
| `ADMIN_KEY` | Ключ для /sysadmin и служебных эндпоинтов |
| `ADMIN_CHAT_ID` | Telegram chat_id создателя платформы |
| `WORKERS_AI_API_TOKEN` | Токен для Workers AI REST API |
| `CLOUDFLARE_ACCOUNT_ID` | Аккаунт Cloudflare (Workers AI) |
| `STRIPE_SECRET_KEY` | Stripe API ключ |
| `STRIPE_WEBHOOK_SECRET` | Секрет для верификации Stripe webhooks |
| `STRIPE_PRICE_START_MONTHLY` | Stripe Price ID тарифа Start |
| `STRIPE_PRICE_PRO_MONTHLY` | Stripe Price ID тарифа Pro |
| `STRIPE_PRICE_STUDIO_MONTHLY` | Stripe Price ID тарифа Studio |
| `APP_BASE_URL` | Публичный URL воркера (`https://manicbot.com`) |
| `BOT_ENCRYPTION_KEY` | Опционально: шифрование токенов ботов в D1/KV |
| `REQUIRE_WEBHOOK_BOT_ID` | Опционально: `"1"` — запретить legacy `POST /webhook` без `botId`, если привязан D1 |
| `META_APP_SECRET`, `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG` | Для Meta webhooks (см. `wrangler` / dashboard) |

---

## Документация

- [`CLAUDE.md`](CLAUDE.md) — эталон архитектуры для разработки (Worker, Mini App, роли, деплой)
- [`ARCHITECTURE.md`](manicbot/ARCHITECTURE.md) — детальная карта модулей и потоки данных
- [`BOT_GUIDE.md`](manicbot/BOT_GUIDE.md) — руководство пользователя бота
- [`CLOUDFLARE_SETUP.md`](manicbot/CLOUDFLARE_SETUP.md) — настройка Cloudflare
- [`STRIPE_SETUP.md`](manicbot/STRIPE_SETUP.md) — настройка биллинга
- [`MIGRATION.md`](manicbot/MIGRATION.md) — миграция с legacy на мультитенант
- [`SEED_TEST_DATA.md`](manicbot/SEED_TEST_DATA.md) — тестовые данные

---

## Лицензия

Private — все права защищены.
