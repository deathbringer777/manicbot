#!/usr/bin/env bash
# Usage: ./scripts/update-demo-bot-tokens.sh SALON1_TOKEN SALON2_TOKEN MASTER1_TOKEN MASTER2_TOKEN
# Run this after revoking the old tokens via @BotFather and getting 4 new tokens.
#
# Example:
#   ./scripts/update-demo-bot-tokens.sh \
#     "8613882748:AAFnew..." \
#     "8742175386:AAGnew..." \
#     "8621333011:AAFnew..." \
#     "8669878808:AAGnew..."

set -euo pipefail

if [ $# -ne 4 ]; then
  echo "Usage: $0 SALON1_TOKEN SALON2_TOKEN MASTER1_TOKEN MASTER2_TOKEN"
  exit 1
fi

SALON1_TOKEN="$1"
SALON2_TOKEN="$2"
MASTER1_TOKEN="$3"
MASTER2_TOKEN="$4"

# Extract bot IDs from tokens (format: <id>:<hash>)
SALON1_ID="${SALON1_TOKEN%%:*}"
SALON2_ID="${SALON2_TOKEN%%:*}"
MASTER1_ID="${MASTER1_TOKEN%%:*}"
MASTER2_ID="${MASTER2_TOKEN%%:*}"

# Escape single quotes in token values via SQL single-quote doubling ('' inside '...').
# Defence-in-depth: Telegram tokens are alphanumeric + ':' / '_' / '-' in practice, but
# never embed untrusted values into a SQL string without escaping.
SALON1_TOKEN_ESC="${SALON1_TOKEN//\'/\'\'}"
SALON2_TOKEN_ESC="${SALON2_TOKEN//\'/\'\'}"
MASTER1_TOKEN_ESC="${MASTER1_TOKEN//\'/\'\'}"
MASTER2_TOKEN_ESC="${MASTER2_TOKEN//\'/\'\'}"
SALON1_ID_ESC="${SALON1_ID//\'/\'\'}"
SALON2_ID_ESC="${SALON2_ID//\'/\'\'}"
MASTER1_ID_ESC="${MASTER1_ID//\'/\'\'}"
MASTER2_ID_ESC="${MASTER2_ID//\'/\'\'}"

echo "Updating D1 tokens..."
npx wrangler d1 execute manicbot-db --remote --command "
  UPDATE bots SET token_encrypted = '$SALON1_TOKEN_ESC', bot_id = '$SALON1_ID_ESC', updated_at = strftime('%s','now') WHERE tenant_id = 't_salon1';
  UPDATE bots SET token_encrypted = '$SALON2_TOKEN_ESC', bot_id = '$SALON2_ID_ESC', updated_at = strftime('%s','now') WHERE tenant_id = 't_salon2';
  UPDATE bots SET token_encrypted = '$MASTER1_TOKEN_ESC', bot_id = '$MASTER1_ID_ESC', updated_at = strftime('%s','now') WHERE tenant_id = 't_master1';
  UPDATE bots SET token_encrypted = '$MASTER2_TOKEN_ESC', bot_id = '$MASTER2_ID_ESC', updated_at = strftime('%s','now') WHERE tenant_id = 't_master2';
"

echo ""
echo "Re-registering webhooks with new tokens..."

WORKER_URL="https://manicbot.com"

for entry in \
  "${SALON1_ID}:${SALON1_TOKEN}:t_salon1:wh_t_salon1_auto" \
  "${SALON2_ID}:${SALON2_TOKEN}:t_salon2:wh_t_salon2_auto" \
  "${MASTER1_ID}:${MASTER1_TOKEN}:t_master1:wh_t_master1_auto" \
  "${MASTER2_ID}:${MASTER2_TOKEN}:t_master2:wh_t_master2_auto"
do
  IFS=':' read -r bid tok tid whs <<< "$entry"
  echo "  Setting webhook for bot $bid ($tid)..."
  curl -s "https://api.telegram.org/bot${tok}/setWebhook" \
    -d "url=${WORKER_URL}/webhook/${bid}" \
    -d "secret_token=${whs}" \
    -d "allowed_updates=[\"message\",\"callback_query\",\"my_chat_member\"]" | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✅' if r.get('ok') else '  ❌ ' + str(r))"
done

echo ""
echo "✅ Done. Also update the env vars in provision-bots.js (BOT_TOKEN_SALON1 etc.) or Cloudflare secrets."
echo "If BOT_ENCRYPTION_KEY is set, re-seed with: npm run seed:test-accounts"
