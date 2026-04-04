# FIX-05: Обязательное шифрование токенов (HIGH)

## Проблема

`BOT_ENCRYPTION_KEY` опционален. Когда он не установлен или дешифровка не удаётся:

1. **Meta-токены** (`manicbot/src/channels/resolver.js:24-28`): `isLikelyPlaintextMetaChannelToken()` проверяет формат и использует plaintext-токен, логируя предупреждение:
   ```
   SECURITY: Using plaintext Meta token for tenant ...
   ```

2. **Google OAuth токены** (`manicbot/src/services/google-calendar-oauth.js`): `getTokenEncryptionKey()` fallback на `ADMIN_KEY` если `BOT_ENCRYPTION_KEY` не установлен — слабее, т.к. ADMIN_KEY используется для HTTP-аутентификации и может быть скомпрометирован.

3. **Telegram Bot токены** (`manicbot/src/tenant/storage.js`): `getBotToken()` после фикса инвертированной проверки (2026-03-29) корректно обрабатывает шифрование, но при отсутствии ключа токены хранятся в plaintext.

## Затронутые файлы

- `manicbot/src/channels/resolver.js` — `isLikelyPlaintextMetaChannelToken()`
- `manicbot/src/services/google-calendar-oauth.js` — `getTokenEncryptionKey()`
- `manicbot/src/tenant/storage.js` — `getBotToken()`
- `manicbot/src/worker.js` — startup validation

## Предложенное решение

### Фаза 1: Обязательная проверка при старте (немедленно)

```javascript
// worker.js — в начале fetch handler:
function validateSecurityConfig(env) {
  const warnings = [];

  if (!env.BOT_ENCRYPTION_KEY) {
    warnings.push('BOT_ENCRYPTION_KEY not set — tokens stored in plaintext in D1');
  }
  if (!env.META_APP_SECRET && (env.META_VERIFY_TOKEN_WA || env.META_VERIFY_TOKEN_IG)) {
    warnings.push('META_APP_SECRET not set but Meta channels configured — webhooks unverified');
  }
  if (env.ADMIN_KEY && env.ADMIN_KEY.length < 32) {
    warnings.push('ADMIN_KEY too short (< 32 chars) — brute force risk');
  }

  for (const w of warnings) {
    console.warn(`[SECURITY] ${w}`);
  }

  return warnings;
}
```

### Фаза 2: Миграция plaintext → encrypted (при деплое)

```javascript
// scripts/encrypt-tokens.mjs — одноразовый скрипт:
import { encryptToken } from '../src/utils/security.js';

async function migrateTokens(db, encryptionKey) {
  // 1. Telegram bot tokens
  const bots = await db.prepare('SELECT bot_id, token_encrypted FROM bots WHERE token_encrypted IS NOT NULL').all();
  for (const bot of bots.results) {
    if (bot.token_encrypted.includes(':')) {
      // Похоже на plaintext Telegram token (формат: 12345:ABCdef...)
      const encrypted = await encryptToken(bot.token_encrypted, encryptionKey);
      await db.prepare('UPDATE bots SET token_encrypted = ? WHERE bot_id = ?')
        .bind(encrypted, bot.bot_id).run();
      console.log(`Encrypted bot token: ${bot.bot_id}`);
    }
  }

  // 2. Meta channel tokens
  const channels = await db.prepare('SELECT id, token_encrypted FROM channel_configs WHERE token_encrypted IS NOT NULL').all();
  for (const ch of channels.results) {
    if (ch.token_encrypted.startsWith('EAA') || ch.token_encrypted.startsWith('IGAA')) {
      const encrypted = await encryptToken(ch.token_encrypted, encryptionKey);
      await db.prepare('UPDATE channel_configs SET token_encrypted = ? WHERE id = ?')
        .bind(encrypted, ch.id).run();
      console.log(`Encrypted channel token: ${ch.id}`);
    }
  }
}
```

### Фаза 3: Убрать plaintext fallback (после миграции)

```javascript
// resolver.js — убрать isLikelyPlaintextMetaChannelToken():
// УДАЛИТЬ функцию isLikelyPlaintextMetaChannelToken
// Заменить использование на:
if (!decrypted) {
  console.error(`[channel] Failed to decrypt token for tenant ${tenantId}. Run encrypt-tokens migration.`);
  return null; // Не использовать plaintext
}
```

### Фаза 4: CI-проверка (долгосрочно)

```bash
# В deploy.yml — после deploy:
- name: Verify encryption
  run: |
    # Проверить что BOT_ENCRYPTION_KEY установлен
    wrangler secret list | grep BOT_ENCRYPTION_KEY || (echo "ERROR: BOT_ENCRYPTION_KEY not set" && exit 1)
```

## Порядок внедрения

1. Фаза 1 — сразу (только логирование, не ломает ничего)
2. Фаза 2 — перед следующим деплоем (одноразовая миграция)
3. Фаза 3 — после подтверждения что все токены зашифрованы
4. Фаза 4 — после стабилизации

## Effort

- Фаза 1: 10 мин
- Фаза 2: 30 мин
- Фаза 3: 15 мин
- Фаза 4: 10 мин
- **Итого: ~1 час**
