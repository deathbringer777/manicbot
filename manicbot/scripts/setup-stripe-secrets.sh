#!/usr/bin/env bash
# Поочерёдно запрашивает секреты Stripe для воркера ManicBot.
# Запуск из корня проекта: cd manicbot && ./scripts/setup-stripe-secrets.sh
# Значения не попадают в репозиторий — только в Cloudflare.

set -e
cd "$(dirname "$0")/.."

echo "=== Stripe: настройка секретов manicbot ==="
echo ""

echo "1/3 STRIPE_SECRET_KEY"
echo "   (Stripe Dashboard → Developers → API keys → Secret key)"
npx wrangler secret put STRIPE_SECRET_KEY

echo ""
echo "2/3 STRIPE_WEBHOOK_SECRET"
echo "   (Stripe Dashboard → Webhooks → [endpoint] → Signing secret, whsec_...)"
npx wrangler secret put STRIPE_WEBHOOK_SECRET

echo ""
echo "3/3 APP_BASE_URL"
echo "   (URL воркера, напр. https://manicbot.ТВОЙ_СУБДОМЕН.workers.dev)"
npx wrangler secret put APP_BASE_URL

echo ""
echo "Готово. Опционально задай цены подписок:"
echo "  npx wrangler secret put STRIPE_PRICE_START_MONTHLY"
echo "  npx wrangler secret put STRIPE_PRICE_PRO_MONTHLY"
echo "  npx wrangler secret put STRIPE_PRICE_MAX_MONTHLY"
echo ""
echo "Подробнее: STRIPE_SETUP.md"
