# Настройка Stripe для ManicBot

## 0. Где взять ключи в Stripe Dashboard

- **Developers → API keys** (как на твоём скриншоте):
  - **Secret key** (Standard keys) — нажми **Reveal live key** и скопируй. Это и есть `STRIPE_SECRET_KEY` (никому не отправляй, только в `wrangler secret put`).
  - Для тестов можно включить **Test mode** (переключатель справа) и использовать тестовый Secret key (`sk_test_...`).
- **Publishable key** (`pk_live_...` / `pk_test_...`) — если позже понадобится для клиентской оплаты, храни в переменных (не секрет).

## 1. Секреты воркера (обязательно)

Запусти скрипт — он по очереди запросит все нужные значения. Подставь свои данные когда попросит:

```bash
cd manicbot
chmod +x scripts/setup-stripe-secrets.sh
./scripts/setup-stripe-secrets.sh
```

Или вручную:

```bash
cd manicbot
npx wrangler secret put STRIPE_SECRET_KEY      # Секретный ключ из Stripe (sk_live_... или rk_live_...)
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # Signing secret из Stripe после создания webhook
npx wrangler secret put APP_BASE_URL           # URL воркера, напр. https://manicbot.ТВОЙ_СУБДОМЕН.workers.dev
```

Опционально (если используешь подписки по планам):

```bash
npx wrangler secret put STRIPE_PRICE_START_MONTHLY   # price_xxx из Stripe
npx wrangler secret put STRIPE_PRICE_PRO_MONTHLY
npx wrangler secret put STRIPE_PRICE_MAX_MONTHLY
```

## 2. Webhook в Stripe Dashboard

1. Открой [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. **Add endpoint**.
3. **Endpoint URL:** `https://manicbot.ТВОЙ_СУБДОМЕН.workers.dev/stripe/webhook`
4. **Events to send:** выбери:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Сохрани. Скопируй **Signing secret** (whsec_...) и сохрани в секрет воркера:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## 3. Продукты и цены (для подписок)

В [Stripe Dashboard → Products](https://dashboard.stripe.com/products) создай продукты и цены (рекуррентные, ежемесячные). Скопируй **Price ID** (price_...) и задай секреты:

- `STRIPE_PRICE_START_MONTHLY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_MAX_MONTHLY`

## 4. APP_BASE_URL

Должен совпадать с URL воркера, чтобы ссылки на оплату и success-страница работали. Пример:

```
https://manicbot.vdovin-kyrylo.workers.dev
```

Задаётся через секрет или в `wrangler.toml` в `[vars]`.

## 5. Проверка

- Админ бота: **Управление** → **💳 Подписка и оплата** — меню биллинга.
- Платформа: в браузере открой `/admin` (с Basic-auth), затем ссылка **💳 Billing (all tenants)**.

После изменения секретов передеплой не нужен — они подхватываются при следующем запросе.
