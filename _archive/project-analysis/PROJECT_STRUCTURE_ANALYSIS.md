# Анализ структуры проекта ManicBot

Файл сгенерирован автоматически 2026-03-23T23:27:49.204Z после полного прохода по source-деревьям репозитория и ручной проверки ключевых entrypoints, схемы данных, webhook-роутинга, billing, tenancy и admin-app.

## План разбора

1. Определить реальные приложения внутри репозитория и их назначение.
2. Разложить runtime на пользовательские поверхности, входные точки и хранилища.
3. Отдельно разобрать внутренности Worker-ядра и Next.js admin-app.
4. Зафиксировать фактическую модель данных: D1, KV и их зоны ответственности.
5. Подсветить архитектурные расхождения между документацией, SQL-схемой и admin-app schema.
6. Сохранить результаты в масштабируемых артефактах для Miro и последующих ревизий.

## 1. Что лежит в репозитории

| Package | Назначение | Файлы | LOC |
|---|---:|---:|---:|
| `manicbot/src` | Worker backend, Telegram, billing, AI, multi-tenant runtime | 101 | 13879 |
| `manicbot/test` | Unit/integration coverage для backend | 39 | 5190 |
| `manicbot/admin-app/src` | Next.js God Mode / tRPC / D1 console | 41 | 4434 |
| `manicbot-analysis/src` | Отдельный визуальный аналитический фронтенд | 67 | 6255 |
| `manicbot-landing/src` | Маркетинговый лендинг | 7 | 504 |

### Быстрый вывод

- Это не один проект, а связка из как минимум четырёх приложений и набора исторических/аналитических артефактов.
- Реальное ядро системы живёт в `manicbot/src`: именно этот код обслуживает Telegram webhook, Stripe webhook, cron, landing proxy, HTML admin и Google OAuth callbacks.
- `manicbot/admin-app` — это отдельная Next.js mini-app консоль над той же D1 базой, но по факту сейчас она ближе к platform-level “God Mode”, чем к self-service кабинету владельца салона.
- `manicbot-landing` — отдельный маркетинговый сайт, который Worker проксирует на корневом домене через `LANDING_URL`.
- `manicbot-analysis` — самостоятельный Vite frontend, похожий на презентационный/аудиторский интерфейс, а не на часть production runtime.

## 2. Фактическая архитектура по коду

### Пользовательские поверхности

- Telegram клиенты, мастера, владельцы салонов и platform admin взаимодействуют с системой через Telegram Bot API.
- Cloudflare Worker в `manicbot/src/worker.js` выступает единым edge gateway: принимает webhook-и, крутит cron, отдаёт HTML admin, проксирует landing и завершает Google OAuth flow.
- Отдельная mini-app консоль в `manicbot/admin-app` работает через Next.js App Router, tRPC и D1.
- Есть две разные админские поверхности:
  - HTML-эндпоинты в самом Worker (`/admin`, `/admin/billing`, CSV export, `/setup`, `/admin/provision`, миграции).
  - Telegram Mini App / Next.js консоль в `manicbot/admin-app`.

### Основные runtime entrypoints

- `manicbot/src/worker.js`:
  - `POST /webhook/:botId` и `POST /webhook`
  - `POST /stripe/webhook`
  - `GET /admin`, `/admin/billing`, `/admin/export/*`
  - `GET /setup`, `/remove-webhook`
  - `GET /google/connect`, `/google/callback`, `/google/select`, `POST /google/webhook`
  - `GET /calendar/:aptId.ics`
  - `scheduled()` для cron по всем tenant-ам
- `manicbot/admin-app/src/app/api/trpc/[trpc]/route.ts`: единая server boundary для Next.js mini-app.

### Где находится orchestration

- `worker.js` — главный orchestrator инфраструктуры.
- `handlers/message.js` и `handlers/callback.js` — главный orchestration layer пользовательских сценариев.
- `services/google-calendar-oauth.js` — отдельный большой subsystem внутри backend-а.
- `admin-app/src/server/api/root.ts` и `server/api/trpc.ts` — orchestration слой mini-app.

## 3. Внутренности Worker backend

### Слои внутри `manicbot/src`

- `handlers/` — message/callback/cron orchestration.
- `services/` — предметная логика записи, пользователей, state, chat, каталогов, календаря.
- `tenant/` — registry tenant-ов и bot mapping.
- `billing/` — Stripe config, checkout/portal, lifecycle, webhook storage.
- `support/` и `roles/` — платформенные и tenant-level support/roles.
- `ui/` — генерация Telegram screens, клавиатур и административных меню.
- `utils/` — D1/KV/security/date/helpers/ICS.
- `i18n/` — языковые словари, сейчас уже разложенные по папкам и namespace-ам.

### Главные hotspot-модули по связанности

- `manicbot/src/handlers/message.js` — 27 внутренних импортов
- `manicbot/src/handlers/callback.js` — 25 внутренних импортов
- `manicbot/src/worker.js` — 19 внутренних импортов
- `manicbot/src/ui/admin.js` — 13 внутренних импортов
- `manicbot/src/ai.js` — 12 внутренних импортов
- `manicbot/src/i18n/en/index.js` — 12 внутренних импортов
- `manicbot/src/i18n/pl/index.js` — 12 внутренних импортов
- `manicbot/src/i18n/ru/index.js` — 12 внутренних импортов

### Крупнейшие файлы backend-а

- `manicbot/src/handlers/callback.js` — 1337 LOC
- `manicbot/src/handlers/message.js` — 1222 LOC
- `manicbot/src/services/google-calendar-oauth.js` — 1013 LOC
- `manicbot/src/worker.js` — 625 LOC
- `manicbot/src/i18n/ru.js` — 438 LOC
- `manicbot/src/i18n/pl.js` — 435 LOC
- `manicbot/src/ai.js` — 434 LOC
- `manicbot/src/i18n/en.js` — 434 LOC

### Что это значит архитектурно

- Основной контроль потока сосредоточен в двух очень больших обработчиках: `message.js` и `callback.js`.
- `worker.js` уже не “тонкая точка входа”, а настоящий edge gateway со смешанной ответственностью.
- `google-calendar-oauth.js` — отдельный крупный subsystem со своей динамической схемой БД, OAuth session storage и watch renewal.
- UI-слой Telegram находится внутри backend-а и сильно связан с orchestration code, поэтому сценарии размазаны между `handlers/*`, `ui/*`, `notifications.js` и `ai.js`.

## 4. Admin-app: что это на самом деле

### Состав

- App Router pages в `src/app/*`
- tRPC routers в `src/server/api/routers/*`
- Drizzle schema в `src/server/db/schema.ts`
- Telegram init-data verification в `src/server/auth/telegram.ts`
- UI shell и mobile/desktop navigation в `src/components/layout/Shell.tsx`

### Крупнейшие файлы admin-app

- `manicbot/admin-app/src/app/tenants/TenantsPageClient.tsx` — 476 LOC
- `manicbot/admin-app/src/app/users/UsersPageClient.tsx` — 417 LOC
- `manicbot/admin-app/src/app/appointments/AppointmentsPageClient.tsx` — 311 LOC
- `manicbot/admin-app/src/app/settings/SettingsPageClient.tsx` — 257 LOC
- `manicbot/admin-app/src/server/api/routers/provisioning.ts` — 229 LOC
- `manicbot/admin-app/src/app/agents/AgentsPageClient.tsx` — 223 LOC

### Hotspots по связанности

- `manicbot/admin-app/src/server/api/root.ts` — 10 внутренних импортов
- `manicbot/admin-app/src/app/DashboardClient.tsx` — 3 внутренних импортов
- `manicbot/admin-app/src/app/api/trpc/[trpc]/route.ts` — 3 внутренних импортов
- `manicbot/admin-app/src/app/layout.tsx` — 3 внутренних импортов
- `manicbot/admin-app/src/server/api/trpc.ts` — 3 внутренних импортов
- `manicbot/admin-app/src/trpc/server.ts` — 3 внутренних импортов
- `manicbot/admin-app/src/app/agents/AgentsPageClient.tsx` — 2 внутренних импортов
- `manicbot/admin-app/src/app/appointments/AppointmentsPageClient.tsx` — 2 внутренних импортов

### Фактическая роль mini-app

- По названию и части документации это выглядит как “admin dashboard для владельца салона”.
- По коду это сейчас platform console:
  - `TelegramGate.tsx` пропускает только жёстко захардкоженный `CREATOR_ID`.
  - `adminProcedure` в `server/api/trpc.ts` тоже привязан к creator ID и platform roles.
  - В интерфейсе основной акцент на tenants, agents, users, platform billing и system health.
- Вывод: Next.js app сейчас ближе к God Mode для платформы, а не к tenant-owner panel.

## 5. Хранилища и модель данных

### Реальный storage model: гибрид D1 + KV

- D1:
  - tenants, bots, appointments, users, masters, services, tenant_config
  - platform_roles, support_agents, tenant_support_agents
  - platform_tickets, platform_ticket_messages, stripe_customers
  - runtime-created Google tables: `google_integrations`, `google_busy_blocks`
- KV:
  - `bottoken:*` для bot token-ов
  - `gcal:oauth:*` для OAuth session state
  - `stripe:evt:*` для Stripe idempotency
  - `tktlock:*` для claim race lock support ticket-ов
  - tenant-prefixed state/legacy data в fallback path: `state:*`, `ap:*`, `all:*`, `d:*`, `ua:*` и т.д.

### Важный вывод

- README и часть старых документов описывают систему как KV-first.
- Фактический код уже D1-first для business entities, но KV всё ещё играет важную инфраструктурную роль.
- То есть migration на D1 не завершена как “полный отказ от KV”; система работает в гибридном режиме.

## 6. Ключевые бизнес-потоки

### Запись клиента

1. Клиент пишет в Telegram.
2. Telegram вызывает `/webhook/:botId`.
3. Worker строит tenant context через `tenant/resolver.js`.
4. `handlers/message.js` или `handlers/callback.js` запускает сценарий.
5. `services/appointments.js` создаёт/читает запись.
6. `notifications.js` уведомляет мастера/админа.
7. При подтверждении создаются ICS и при наличии интеграции синхронизируется Google Calendar.

### Cron

1. `scheduled()` в Worker получает список tenant-ов из D1.
2. Для каждого tenant-а поднимается tenant context через первый bot этого tenant-а.
3. `handlers/cron.js` проверяет billing expiry, шлёт reminders, retry calendar sync и чистит старые appointments.

### Биллинг

1. Checkout/Portal инициируется из backend или UI.
2. Stripe вызывает `/stripe/webhook`.
3. `billing/webhooks.js` проверяет подпись, использует KV для idempotency и обновляет `tenants` / `stripe_customers` в D1.
4. Feature gating дальше применяется в handlers через `billing/features.js`.

### Mini-app admin flow

1. Telegram WebApp initData попадает в заголовок `x-telegram-init-data`.
2. `server/auth/telegram.ts` валидирует подпись.
3. `adminProcedure` в tRPC решает, есть ли доступ.
4. Router-ы читают и мутируют D1 напрямую через Drizzle.

## 7. Архитектурные расхождения и зоны риска

### Документация отстаёт от кода

- Корневой `README.md` всё ещё описывает KV-first модель как основной источник правды.
- `MULTI_BOT_SETUP.md` опирается на устаревшую схему tenant keys и старые setup URL.
- `manicbot/admin-app/README.md` — почти чистый template README, не отражающий реальную mini-app.

### Есть drift между worker SQL и admin-app Drizzle schema

- `services`: в SQL колонка `sort_order`, в Drizzle — `order`.
- `masters`: SQL и Drizzle описывают разные поля и semantics.
- `platform_tickets` и `platform_ticket_messages`: структура в worker и admin-app не совпадает по именам полей и модели.
- `support_agents.type`: worker ожидает `technical`, admin-app пишет `technical_support`.
- `tenant_roles`: SQL ожидает `created_at`, admin-app schema и mutation layer работают иначе.
- `billingStatus`: mini-app использует `grace`, backend — `grace_period`.
- `platform roles`: mini-app оперирует `admin/owner`, Worker — `system_admin/tenant_owner`.

### Есть две разные “админки”

- Worker HTML admin — tenant-scoped basic-auth surface.
- Next.js mini-app — platform-focused surface.
- Для понимания проекта это важно: это не “одна админка в двух формах”, а две параллельные operational surfaces.

## 8. Что читать в первую очередь

1. `manicbot/src/worker.js`
2. `manicbot/src/tenant/resolver.js`
3. `manicbot/src/handlers/message.js`
4. `manicbot/src/handlers/callback.js`
5. `manicbot/src/services/appointments.js`
6. `manicbot/src/services/users.js`
7. `manicbot/src/services/google-calendar-oauth.js`
8. `manicbot/src/db/schema.sql`
9. `manicbot/admin-app/src/server/api/root.ts`
10. `manicbot/admin-app/src/server/db/schema.ts`

## 9. Что именно я приложил рядом

- `PROJECT_STRUCTURE_BOARD.svg` — большая векторная board-style схема для импорта в Miro.
- `PROJECT_STRUCTURE_MAP.mmd` — Mermaid-версия центральной архитектуры.
- `project-metrics.json` — численные метрики по пакетам, hotspot-ам и тестам.

## 10. Как использовать в Miro

1. Загрузите `PROJECT_STRUCTURE_BOARD.svg` как обычный файл на board.
2. Увеличивайте отдельные панели: runtime, worker internals, data model, flows, risks.
3. Если захотите править связи уже в Miro через Mermaid-плагин, используйте `PROJECT_STRUCTURE_MAP.mmd` как исходник.

