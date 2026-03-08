# Multi-Tenant SaaS Refactor — Analysis & Plan

## 1. Выдержка из промптов

### Multi-Tenant SaaS Refactor
- **Цель:** один бэкенд для многих салонов/мастеров; изоляция по tenant; только system admin добавляет салоны и мастеров.
- **Ключевое:** tenantId, tenant-scoped storage (`t:{tenantId}:*`), tenant resolver, строгая модель ролей (system_admin, salon owner, master, client).

### Support Ticket System (режим тикета)
- Тикеты между клиентами/мастерами/салонами и админом/поддержкой.
- Жизненный цикл: new → claimed → resolved/closed.
- Рассылка всем support-агентам; first-to-claim (race-safe); роутинг сообщений клиент ↔ агент.

### MASTER PROMPT — Platform
- Реестр ботов, реестр тенантов, биллинг на тенант, роли (system_admin, support, tenant_owner, master, client).
- Webhook: `/webhook/{botId}`, роут по botId → tenant.
- Stripe: подписки, checkout, webhooks, customer portal; при неактивной подписке — данные сохраняем, новые записи блокируем.

---

## 2. Текущее состояние (аудит)

| Область | Сейчас | Проблема |
|--------|--------|----------|
| **Точка входа** | `src/worker.js`, один fetch + scheduled | Один webhook `/webhook`, один BOT_TOKEN |
| **Контекст** | `ctx = { TG, kv, prefix: "b:{botId}:", ADMIN_KEY, WEBHOOK_SECRET }` | Нет tenantId, нет tenant, нет bot record |
| **KV ключи** | `ctx.prefix + key` (lang:*, st:*, u:*, ap:*, all:*, lock:*, master:*, ticket:*) | Глобальные в рамках одного бота, не изолированы по тенанту |
| **Роли** | Фактически: админ по ADMIN_KEY + master list в KV | Нет иерархии system_admin / support / tenant_owner / master / client |
| **Тикеты** | `ticket:{clientCid}`, `ticket_master:{masterCid}` — связка клиент↔мастер (консультация) | Нет платформенных support-тикетов с claim и рассылкой |
| **Биллинг** | Нет | Нужен Stripe: план, checkout, webhooks, меню для owner |
| **Cron** | Один handleCron(ctx) по одному ctx | Нужен перебор активных тенантов |

**Итог:** проект уже модульный (config, handlers, services, ui, utils), но полностью single-tenant и single-bot. Все операции нужно перевести на tenant-scoped контекст и добавить реестры tenant/bot, роли, тикеты поддержки и Stripe.

---

## 3. Целевая архитектура (кратко)

- **tenantId** — стабильный идентификатор тенанта (default после миграции).
- **Bot registry:** `bot:{botId}` → { tenantId, tokenRef, webhookSecret, ... }, `botmap:{botId}` → tenantId.
- **Tenant-scoped keys:** `t:{tenantId}:lang:{chatId}`, `t:{tenantId}:st:{chatId}`, `t:{tenantId}:ap:{id}`, и т.д.
- **Роли:** platform `role:{chatId}` (system_admin, support), tenant `t:{tenantId}:role:{chatId}` (tenant_owner, master), иначе client.
- **Тикеты поддержки:** `ticket:{ticketId}` с tenantId, clientChatId, status, claimedBy; индексы tickets:open, tickets:agent:{chatId}, t:{tenantId}:tickets:client:{chatId}.
- **Webhook:** POST `/webhook/{botId}` → resolve bot → tenant → ctx с tGet/tPut/tDel.
- **Миграция:** GET/POST `/admin/migrate?key=ADMIN_KEY` — создать tenant:default, bot record, переложить ключи в `t:default:*`.

---

## 4. Пошаговый план реализации

1. **Phase 1 — Multi-tenant foundation**  
   Модули: `tenant/storage.js`, `tenant/resolver.js`, `tenant/migration.js`. Модель tenant и bot в KV. Обёртки `tGet/tPut/tDel` в ctx. Смена webhook на `/webhook/{botId}` и резолв тенанта по botId. Миграция: default tenant + переключение ключей.

2. **Phase 2 — Role system**  
   `roles/roles.js`: resolveRole(kv, tenantId, chatId). Хранение platform/tenant roles и support:agents. Команды админа: create_tenant, register_bot, bind_bot, set_owner, add_master, add_support и т.д. Приглашения по username (invite:{tenantId}:username).

3. **Phase 3 — Master + Owner UX**  
   Команда /master, панель мастера (сегодня/завтра). Панель owner: записи, клиенты, отмена, биллинг, поддержка. Клавиатура в зависимости от роли (Support, Master Panel, Management, Billing).

4. **Phase 4 — Support ticket system**  
   Создание тикета клиентом, индексы, broadcast поддержке, claim (lock + race-safe), роутинг сообщений клиент ↔ агент, /tickets для агента, админ: просмотр/переприсвоение/закрытие.

5. **Phase 5 — Stripe billing**  
   Поля биллинга в tenant. Webhook Stripe, checkout session, меню биллинга для owner. Ограничение записей при неактивной подписке.

6. **Phase 6 — Multi-tenant cron**  
   Список активных тенантов, для каждого — напоминания и очистка в рамках тенанта.

7. **Phase 7 — Tests**  
   vitest: изоляция тенантов, роли, бронирование, тикеты (claim), биллинг (webhook), миграция.

8. **Phase 8 — Audit, commit, push, deploy**  
   Финальный просмотр, `npm test`, коммит в main, push, `wrangler deploy`.

---

## 5. Новые секреты/переменные

- `BOT_ENCRYPTION_KEY` — шифрование токенов ботов в KV.
- `SYSTEM_ADMIN_CHAT_ID` — chat_id главного админа (опционально для проверки команд).
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `APP_BASE_URL`.

---

## 7. Финальный аудит (после реализации)

**Сделано:**
- **Phase 1:** Tenant + bot storage (`tenant/storage.js`), resolver (`tenant/resolver.js`), migration (`tenant/migration.js`). Webhook `/webhook` и `/webhook/{botId}`. Контекст с `prefix = t:{tenantId}:` после миграции. Endpoint `/admin/migrate?key=ADMIN_KEY`.
- **Phase 2:** Роли в `roles/roles.js`: resolveRole(globalKv, ctx, chatId), platform/tenant roles, support:agents. getRole в users.js использует resolveRole при наличии globalKv. Admin provisioning в `admin/provisioning.js`.
- **Phase 3:** mainKb(lg, role) с кнопками Support, Master Panel, Management. showWelcome передаёт role в mainKb.
- **Phase 4:** Support ticket system в `support/tickets.js`: createTicket, claimTicket (race-safe lock), broadcast поддержке. CB.SUPPORT → step support_msg → создание тикета и рассылка агентам. Claim по callback tk:ticketId.
- **Phase 5:** Stripe webhook POST `/stripe/webhook`: верификация подписи, идемпотентность по event id, заглушка обработки checkout.session.completed.
- **Phase 6:** Cron: listTenantIds → для каждого tenant получаем бота, строим tenant ctx, вызываем handleCron(ctx). Fallback на один buildCtx при отсутствии тенантов.
- **Тесты:** test/tenant.test.js — tenant storage, botmap, listTenantIds, getBotIdsByTenantId, migration идемпотентность.

**Остаётся (опционально):**
- Полный Stripe: checkout session creation, billing menu в Telegram, gating записей по billingStatus.
- Роутинг сообщений поддержки: пересылка ответа агента клиенту (сейчас только claim и уведомление).
- Admin Telegram-команды: /admin_create_tenant, /admin_add_support и т.д. (провизионинг уже в коде, нужна привязка к командам).

**Готовность:** MVP multi-tenant foundation готов. Миграция переводит текущие данные в `t:default:`. После вызова `/admin/migrate` и перенастройки webhook на `/webhook/{botId}` бот работает в режиме одного тенанта (default).

---

## 6. Риски и ограничения

- **Telegram:** по username/phone нельзя однозначно получить chat_id до взаимодействия с ботом — используем pending invitations с активацией при первом входе.
- **Миграция:** выполнять один раз; идемпотентность по флагу `migration:v1:done`.
- **Обратная совместимость:** после миграции единственный текущий бот работает как tenant `default` с теми же данными.
