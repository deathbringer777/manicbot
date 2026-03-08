#!/usr/bin/env bash
# По очереди запрашивает каждый секрет. Запуск: ./scripts/setup-secrets.sh
# Или: bash scripts/setup-secrets.sh
set -e
cd "$(dirname "$0")/.."

echo "Вводи значение когда wrangler спросит. Ctrl+C чтобы пропустить секрет."
echo ""

echo "=== ADMIN_KEY (ключ для /admin и ?key= в /setup) ==="
npx wrangler secret put ADMIN_KEY

echo ""
echo "=== WEBHOOK_SECRET (один на всех ботов, любая случайная строка) ==="
npx wrangler secret put WEBHOOK_SECRET

echo ""
echo "=== BOT_TOKEN_SALON1 (токен manic_salon1bot) ==="
npx wrangler secret put BOT_TOKEN_SALON1

echo ""
echo "=== BOT_TOKEN_SALON2 (токен manic_salon2bot) ==="
npx wrangler secret put BOT_TOKEN_SALON2

echo ""
echo "=== BOT_TOKEN_MASTER1 (токен manic_master1bot) ==="
npx wrangler secret put BOT_TOKEN_MASTER1

echo ""
echo "=== BOT_TOKEN_MASTER2 (токен manic_master2bot) ==="
npx wrangler secret put BOT_TOKEN_MASTER2

echo ""
echo "=== BOT_TOKEN (для крона/админки — можно тот же что BOT_TOKEN_SALON1) ==="
npx wrangler secret put BOT_TOKEN

echo ""
echo "Готово. Секреты заданы."
