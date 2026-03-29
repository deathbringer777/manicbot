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

### 3. Telegram webhook: пустой `WEBHOOK_SECRET` (2026-03-29)

- **Проблема:** при пустом секрете в контексте и пустом заголовке `X-Telegram-Bot-Api-Secret-Token` сравнение давало «совпадение»; запросы проходили без настоящей аутентификации. Пустой секрет в D1 для бота также давал неочевидное поведение.
- **Исправление:** если `WEBHOOK_SECRET` отсутствует или пустая строка — ответ **500** и лог `[telegram-webhook] WEBHOOK_SECRET missing...`; иначе проверка через `timingSafeEqual` как раньше.
- **Файлы:** `src/http/telegramWebhookHttp.js`, `test/telegram-webhook-http.test.js`.

### 4. Meta hub verify: сравнение токена (2026-03-29)

- **Проблема:** `hub.verify_token` сравнивался с `===` (не constant-time для строк одинаковой длины).
- **Исправление:** `timingSafeEqual(token, storedVerifyToken)` при непустых токенах (условие `token && storedVerifyToken` сохранено).
- **Файл:** `src/channels/meta-verify.js`.

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
