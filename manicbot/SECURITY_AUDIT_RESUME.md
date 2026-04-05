# Резюме: аудит безопасности и исправления (без деплоя)

**Дата:** 2026-03-13  
**Проект:** manicbot (Cloudflare Worker)

---

## Что проверено

- **Секреты:** не хардкодятся, берутся из `env`/wrangler secrets; `ADMIN_CREDENTIALS.md` в `.gitignore`.
- **Аутентификация:** админ-маршруты (`/admin`, `/admin/billing`, `/admin/export/*`) защищены Basic Auth через `checkAdmin`; миграция/seed — через `?key=ADMIN_KEY`; вебхук Telegram — через `X-Telegram-Bot-Api-Secret-Token`; сравнение секретов через `timingSafeEqual`.
- **XSS:** пользовательские данные в HTML/Telegram и в админке проходят через `escHtml`.
- **JSON:** в `billing/webhooks.js` и `telegram.js` парсинг обёрнут в try/catch, ошибки не приводят к утечке.
- **Маршруты:** `/calendar/<id>` проверяет формат `aptId`; экспорт CSV — по фиксированным именам файлов.

---

## Что исправлено

### 1. Безопасность: маршрут экспорта `/admin/export/*`

- **Проблема:** при запросе вида `/admin/export/любой_файл` (не `clients.csv` / `appointments.csv`) обработчик не возвращал ответ, запрос «проваливался» дальше и в итоге давал 404 только в конце. Лишняя логика и неочевидное поведение.
- **Исправление:** после проверки `file === 'clients.csv'` и `file === 'appointments.csv'` добавлен явный `return new Response('Not Found', { status: 404 })` для любого другого имени файла в `/admin/export/`.
- **Файл:** `src/worker.js`.

### 2. Безопасность: экранирование в `escHtml`

- **Проблема:** в `escHtml` не экранировалась одинарная кавычка `'`, что при использовании в атрибутах HTML могло способствовать XSS.
- **Исправление:** добавлено экранирование `'` → `&#39;`.
- **Файл:** `src/utils/helpers.js`.
- **Тест:** в `test/helpers.test.js` добавлена проверка `escHtml("'apos'") === '&#39;apos&#39;'`.

### 3. Telegram webhook: секрет (2026-03-29, пересмотрено 2026-03-29)

- **Проблема A:** при пустом секрете в контексте и пустом заголовке сравнение давало «совпадение»; запросы проходили без аутентификации.
- **Исправление A (первичное — было отменено):** возврат 500 при пустом `WEBHOOK_SECRET`. **Вызвало регрессию** — боты, зарегистрированные без `secret_token`, перестали отвечать.
- **Исправление B (финальное):** если `WEBHOOK_SECRET` задан и непустой — строгое сравнение через `timingSafeEqual`, иначе (пустой/null) — запрос проходит с предупреждением в лог `[telegram-webhook] WEBHOOK_SECRET not set...`. Обратная совместимость сохранена.
- **Файлы:** `src/http/telegramWebhookHttp.js`, `test/telegram-webhook-http.test.js`.

### 4. Meta hub verify: сравнение токена (2026-03-29)

- **Проблема:** `hub.verify_token` сравнивался с `===` (не constant-time).
- **Исправление:** `timingSafeEqual(token, storedVerifyToken)` при непустых токенах.
- **Файл:** `src/channels/meta-verify.js`.

### 5. Meta signature verify: портируемость (2026-03-29)

- **Проблема:** `verifyMetaSignature` использовал `crypto.subtle.timingSafeEqual` — Cloudflare Workers extension, в Node.js/тестах отсутствует (требовал polyfill в тестах).
- **Исправление:** заменено на `timingSafeEqual(hex, expected)` из `../utils/security.js` (уже импортирован). Polyfill из `test/meta-verify.test.js` удалён.
- **Файлы:** `src/channels/meta-verify.js`, `test/meta-verify.test.js`.

---

## Что не менялось (всё в порядке)

- Секреты только из окружения, не из кода.
- Rate limit в обработчике сообщений.
- Валидация `chat_id`, шагов сценариев, Stripe webhook signature.
- Токены ботов при наличии `BOT_ENCRYPTION_KEY` хранятся в KV в зашифрованном виде.

---

## Конфликты и ошибки

- Явных конфликтов (дублирование логики, противоречащих веток) не найдено.
- Критичных ошибок (необработанных исключений в ключевых путях, утечек секретов) не выявлено.

---

## Рекомендации на будущее

- Периодически обновлять зависимости (`npm update`, проверка wrangler/vitest).
- Не коммитить `ADMIN_CREDENTIALS.md` и `.dev.vars` (уже в `.gitignore`).
- При добавлении новых админ-маршрутов защищать их через `checkAdmin(request, ctx.ADMIN_KEY)`.

---

---

## Дополнение: исправления 2026-03-29 (задеплоены)

### 5. Admin-app: D1 binding и ADMIN_CHAT_ID в Pages

- **Проблема:** Cloudflare Pages проект `admin-app` не имел привязки к D1 и переменной `ADMIN_CHAT_ID` → при открытии мини-апп все получали экран «Forbidden» вместо своих дашбордов.
- **Исправление:** `ADMIN_CHAT_ID` задан через `wrangler pages secret put`; Pages пересобрана с `--branch main` — D1 binding подтянулся из `wrangler.toml`.

### 6. Instagram: нет валидного Page Access Token

- **Проблема:** `INSTAGRAM_ACCESS_TOKEN` в Cloudflare secrets содержал IGAA-токен (Instagram user token), непригодный для вызовов `POST /{page-id}/messages`. Graph API возвращает код 190 «Cannot parse access token».
- **Исправление:** добавлен защищённый endpoint `POST /admin/ig-token?key=ADMIN_KEY` для валидации и сохранения EAA Page Access Token в D1. **Требует действия:** сгенерировать Facebook Page Access Token (EAA…) через Graph API Explorer и залить через этот endpoint.

### 7. Admin Worker: endpoint `/admin/ig-token`

- Принимает `{ token, tenantId }`, валидирует через `GET /v21.0/me`, сохраняет plaintext EAA в `channel_configs.token_encrypted`.
- Защищён через `timingSafeEqual(key, ADMIN_KEY)`.

**Все изменения задеплоены:** Worker `17b4db51`, Pages `2467d47b`.

---

## Дополнение: исправления 2026-03-29 #2 (Instagram, выполнено)

### 8. Instagram: неверный page_id в D1 + отсутствие токена с permissions

- **Проблема A:** `channel_configs.config.page_id` содержал `25881183448226493` (несуществующий ID) вместо реального Facebook Page ID `1008301152373103`. Resolver не мог смаппировать входящий вебхук `entry.id` → тенант.
- **Проблема Б:** Сохранённый в D1 токен отсутствовал (NULL). EAA-токен из env INSTAGRAM_ACCESS_TOKEN также был IGAA и не работал для messaging.
- **Исправление:**
  1. `channel_configs.config` обновлён: `page_id=1008301152373103`, добавлены `ig_account_id=17841437566398676`, `instagram_business_id=25881183448226493` (через `wrangler d1 execute`).
  2. Получен Facebook Page Access Token (EAA…, с разрешениями `pages_messaging` + `instagram_manage_messages`) через Graph API Explorer → `POST /admin/ig-token` → сохранён в `channel_configs.token_encrypted` тенанта `t_1c305v2g5011`.
  3. Валидация: токен успешно вызывает `GET /1008301152373103/conversations?platform=instagram` — возвращает реальные переписки.
- **Статус:** Instagram-бот должен отвечать на DM.

### Текущее состояние D1 (channel_configs, instagram)

| Поле | Значение |
|------|---------|
| `tenant_id` | `t_1c305v2g5011` |
| `page_id` | `1008301152373103` |
| `ig_account_id` | `17841437566398676` |
| `instagram_business_id` | `25881183448226493` |
| `token_encrypted` | EAA… (plaintext Page Access Token) |
| `updated_at` | 1774791034 |

---

## Дополнение: исправления 2026-03-29 #3 (аудит кодовой базы)

### 9. timingSafeEqual: утечка длины через ранний return

- **Проблема:** `if (ta.length !== tb.length) return false;` в `src/utils/security.js` — ранний выход утекает длину сравниваемых строк через timing (атака по времени ответа).
- **Исправление:** убран ранний return; длина XOR-ится в `diff`, цикл всегда проходит `max(ta.length, tb.length)` итераций.
- **Файл:** `src/utils/security.js:5-13`.

### 10. timingSafeEqualLowerHex: та же проблема

- **Проблема:** локальная функция в `src/billing/webhooks.js` имела такой же ранний return.
- **Исправление:** применена та же техника — XOR длин в diff, цикл до maxLen.
- **Файл:** `src/billing/webhooks.js:17-25`.

### 11. dbRun: нет обработки ошибок (в отличие от dbGet/dbAll)

- **Проблема:** `dbGet`/`dbAll` имеют try/catch + лог, но `dbRun` бросал ошибку напрямую. В `inbound.js` функции `updateMessageWindow`, `upsertChannelIdentity`, `upsertConversation` вызывались fire-and-forget без try/catch.
- **Исправление:** добавлена `dbRunSafe()` в `src/utils/db.js` — ловит ошибки, логирует, возвращает `{ ok, error }`. Callers в `inbound.js` переведены на `dbRunSafe`.
- **Файлы:** `src/utils/db.js`, `src/handlers/inbound.js`.

### 12. Тихое поглощение ошибок в inbound.js

- **Проблема:** `Promise.all(sideEffects).catch(() => {})` полностью скрывал ошибки side-effect операций (message_window, conversations, channel_identities).
- **Исправление:** `.catch(e => console.error('[inbound] side-effect batch error:', e.message))`.
- **Файл:** `src/handlers/inbound.js:54`.

### 13. JSON.parse без try/catch в salon router (admin-app)

- **Проблема:** `JSON.parse(tenantRow[0].salon)` (строки 90 и 211) в `salon.ts` мог крашнуть запрос при повреждённых данных в D1.
- **Исправление:** обёрнут в try/catch с fallback `{}`.
- **Файл:** `admin-app/src/server/api/routers/salon.ts`.

### 14. Google OAuth callback: unhandled throw

- **Проблема:** `await exchangeCodeForTokens(ctx, code)` в `handleGoogleCallback` мог бросить исключение — Handler крашил с 500 без user-friendly ошибки.
- **Исправление:** обёрнут в try/catch, возвращает `Response('Google token exchange failed.', { status: 500 })`.
- **Файл:** `src/services/google-calendar-oauth.js:647`.

### 15. Предупреждение о plaintext Meta токенах

- **Добавлено:** `console.warn` при использовании plaintext (незашифрованного) Meta access token — напоминание настроить `BOT_ENCRYPTION_KEY`.
- **Файл:** `src/channels/resolver.js`.

### 16. Предупреждение о масштабировании channel resolution

- **Добавлено:** `console.warn` в `resolveTenantFromWhatsApp/Instagram` при количестве строк > 50 — сигнал добавить индекс `channel_external_id`.
- **Файл:** `src/channels/resolver.js`.

---

## Исправления 2026-04-05

### 17. AI Prompt Injection Sanitization

**Файл:** `src/ai.js`

- Добавлена функция `sanitizeUserInput()` — нейтрализует action-теги (`[TAG]` -> `(TAG)`) в пользовательском вводе перед отправкой в LLM
- Добавлена функция `validateActionParams()` — валидирует формат дат (YYYY-MM-DD) и времени (HH:MM) в тегах, извлечённых из AI ответа
- Добавлена security note в системный промпт AI: инструкция игнорировать текст в квадратных скобках от пользователя
- `validateActionParams` интегрирован в `handlers/message.js` — malformed теги логируются и пропускаются

### 18. BOT_ENCRYPTION_KEY Enforcement

**Файлы:** `src/worker.js`, `src/channels/resolver.js`, `src/services/google-calendar-oauth.js`

- `validateSecurityConfig(env)` в worker.js — при старте логирует `[SECURITY]` warnings если BOT_ENCRYPTION_KEY не установлен, META_APP_SECRET отсутствует при настроенных Meta каналах, ADMIN_KEY слишком короткий
- `getChannelConfig()` в resolver.js — если BOT_ENCRYPTION_KEY **установлен** но decrypt не удался, возвращает `null` (не plaintext fallback). Plaintext fallback разрешён только при отсутствии ключа
- `getTokenEncryptionKey()` — логирует warning при fallback на ADMIN_KEY

### 19. Google Calendar Sync Exponential Backoff

**Файлы:** `src/handlers/cron.js`, `migrations/0010_google_sync_backoff.sql`

- `MAX_SYNC_PER_CRON = 10` — ограничение sync-операций за один cron run
- Exponential backoff: `15мин * 2^retries`, максимум 24 часа
- После 5 неудачных попыток — permanent failure (лог, без повторов)
- Новые колонки в `appointments`: `sync_retries`, `sync_retry_after`, `sync_last_error`
