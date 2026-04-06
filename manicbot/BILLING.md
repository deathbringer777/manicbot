# ManicBot — Биллинг и подписки

## Планы

| План   | Цена       | Мастера | ИИ-чат | Тикеты поддержки | Календарь | White Label |
|--------|------------|---------|---------|------------------|-----------|-------------|
| Start  | 45 zł/мес  | 1       | ✗       | ✗                | ✗         | ✗           |
| Pro    | 60 zł/мес  | 5       | ✓       | ✓                | ✓         | ✗           |
| MAX    | 90 zł/мес  | ∞       | ✓       | ✓                | ✓         | ✓           |

Лимиты по планам задаются в `src/billing/config.js` (константа `PLAN_LIMITS`).

---

## Состояния billing_status

Поле `billing_status` в таблице D1 `tenants`:

| Статус         | Описание                                  | Доступ к функциям             |
|----------------|-------------------------------------------|-------------------------------|
| `trialing`     | Пробный период (7 дней после регистрации) | Полный доступ по плану        |
| `active`       | Активная подписка                         | Полный доступ по плану        |
| `grace_period` | Платёж не прошёл, ожидание (7 дней)       | Только запись (`booking`)     |
| `past_due`     | Stripe: просроченный платёж               | По плану (до перехода в grace)|
| `inactive`     | Trial истёк или подписка не создана       | Всё заблокировано             |
| `canceled`     | Явная отмена подписки                     | Всё заблокировано             |

Проверка доступа к функциям: `canUse(ctx, feature)` в `src/billing/features.js`.
Возможные значения feature: `booking`, `ai`, `calendar`, `tickets`, `white_label`.

---

## Жизненный цикл

```
Регистрация → trialing (7 дней)
                │
                ├─ оплачена подписка (Stripe Checkout)
                │         ↓
                │       active ◄─────────────────────────────┐
                │         │                                   │
                │         │ payment_failed (Stripe webhook)   │ invoice.payment_succeeded
                │         ↓                                   │
                │   grace_period (7 дней: только booking)     │
                │         │                                   │
                │         │ grace истёк (cron */15 мин)       │
                │         ↓                                   │
                └──────► inactive ◄── отмена подписки (canceled)
```

**Cron-задача** (`handlers/cron.js`) каждые 15 минут:
- Вызывает `checkBillingExpiry()` (`billing/lifecycle.js`)
- Переводит `trialing` → `inactive` при истёкшем `trial_ends_at`
- Переводит `grace_period` → `inactive` при истёкшем `grace_ends_at`

---

## Переменные окружения Stripe

| Секрет                        | Описание                                   |
|-------------------------------|--------------------------------------------|
| `STRIPE_SECRET_KEY`           | `sk_live_...` или `sk_test_...`            |
| `STRIPE_WEBHOOK_SECRET`       | `whsec_...` (из Stripe Dashboard)          |
| `STRIPE_PRICE_START_MONTHLY`  | `price_...` для плана Start                |
| `STRIPE_PRICE_PRO_MONTHLY`    | `price_...` для плана Pro                  |
| `STRIPE_PRICE_MAX_MONTHLY`    | `price_...` для плана MAX                  |
| `APP_BASE_URL`                | `https://manicbot.com` (redirect после оплаты) |

Быстрая настройка: `cd manicbot && ./scripts/setup-stripe-secrets.sh`

---

## Stripe события → действия

| Событие Stripe                       | Действие в ManicBot                                      |
|--------------------------------------|----------------------------------------------------------|
| `checkout.session.completed`         | `billing_status=active`, customer_id → D1 `stripe_customers` |
| `customer.subscription.updated`      | Синхронизация плана, статуса, `current_period_end`       |
| `customer.subscription.deleted`      | `billing_status=inactive`                                |
| `invoice.payment_failed`             | `billing_status=grace_period`, `grace_ends_at=now+7дней` |
| `invoice.payment_succeeded`          | `billing_status=active` (если был grace_period)          |

Обработчик: `src/billing/webhooks.js` → `handleStripeWebhook()`.
Запись биллинга в D1: `src/billing/storage.js` → `updateTenantBilling()`.

---

## Полезные функции

| Функция                      | Файл                         | Описание                              |
|------------------------------|------------------------------|---------------------------------------|
| `canUse(ctx, feature)`       | `billing/features.js`        | Разрешена ли функция для тенанта      |
| `getMastersLimit(ctx)`       | `billing/features.js`        | Максимум мастеров по плану            |
| `isTrialing(ctx)`            | `billing/features.js`        | Тенант на триале?                     |
| `isGracePeriod(ctx)`         | `billing/features.js`        | Тенант в grace_period?                |
| `isInactive(ctx)`            | `billing/features.js`        | Тенант заблокирован?                  |
| `trialRemainingDays(ctx)`    | `billing/features.js`        | Дней до конца триала                  |
| `graceRemainingDays(ctx)`    | `billing/features.js`        | Дней до конца grace_period            |
| `checkBillingExpiry(ctx)`    | `billing/lifecycle.js`       | Проверка и переход статусов (cron)    |
| `updateTenantBilling(ctx, …)`| `billing/storage.js`         | Обновление billing в D1               |
