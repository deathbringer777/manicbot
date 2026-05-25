# Pre-launch blockers — отчёт о ремедиации

**Когда:** 2026-05-25 → 2026-05-26
**Ветка:** `claude/trusting-merkle-ca4dcb` (5 атомарных коммитов поверх `main` ~ `1449c31`)
**Что:** все 5 блокеров перед запуском платной рекламы закрыты
**Тесты:** Worker 2644/2644 ✓ · Admin-app 4903/4903 + 7 skipped ✓ · TypeScript clean ✓ · D1 schema parity 91 таблиц ✓

---

## Коммиты (порядок мерджа в `main`)

| # | SHA | Тема |
|---|-----|------|
| 1 | `7940dc6` | `feat(backup)`: D1 → R2 backup pipeline + restore runbook |
| 2 | `0387441` | `feat(deliverability)`: DMARC rua= + verify-deliverability script |
| 3 | `0d2ff84` | `fix(dedup)`: atomic webhook dedup via D1 UNIQUE constraint |
| 4 | `c0102ec` | `fix(security)`: email injection defence via user.name sanitization |
| 5 | `b5b593b` | `feat(analytics)`: pre-launch funnel events + God Mode dashboard |

Зависимости между коммитами: 3 и 5 добавляют миграции (0088, 0089), которые надо применить в проде до деплоя Worker'а. Остальные — чистый код / DNS.

---

## Блокер 1 — Бэкапы D1 → R2 ([7940dc6](https://github.com/anywhere))

**Что было сломано:** одна D1, ноль бэкапов. Single point of catastrophic failure. Если оператор случайно удалит таблицу — бизнесу хана.

**Что починено:** каждые 6 часов Worker `scheduled()` дампит всю D1 в gzipped NDJSON и кладёт в R2-бакет `manicbot-archive`:

- `backups/daily/<ISO-timestamp>.ndjson.gz` — храним 30 дней
- `backups/weekly/<year-Wweek>.ndjson.gz` — храним 365 дней (первый daily-снапшот каждой ISO-недели «промотируется» сюда)
- Аудит-лог в новой таблице `d1_backup_log` (миграция `0088`)
- Restore-команда: `cd manicbot/ && node scripts/restore-d1.mjs --latest`
- Полный ранбук на русском: [`manicbot/docs/runbooks/d1-restore.md`](../manicbot/docs/runbooks/d1-restore.md)

**Как проверить за 30 секунд:**

```bash
# В рабочей директории /Users/vdovin/Desktop/Manicbot_com/manicbot
node scripts/restore-d1.mjs --list
# Должны увидеть backups/daily/2026-05-26T*.ndjson.gz (после первого срабатывания cron)

# Или ткни в /system → проверь что в логах есть worker.d1Backup
wrangler tail --format pretty | grep d1Backup
```

**Что делать в 3 ночи если D1 упала:** открыть [`docs/runbooks/d1-restore.md`](../manicbot/docs/runbooks/d1-restore.md). Команда `node scripts/restore-d1.mjs --latest` восстанавливает последний бэкап одной кнопкой.

**Деплой:**

1. **Применить миграцию 0088:** `wrangler d1 migrations apply manicbot-db --remote`
2. **Деплой Worker:** `cd manicbot && npx wrangler deploy`
3. **Подождать первого срабатывания cron** (≤15 минут). В Worker логах должна появиться запись `worker.d1Backup { key: 'backups/daily/...', rows: N }`
4. **Проверить R2:** `npx wrangler r2 object list manicbot-archive --prefix backups/` — должен быть хотя бы один новый объект

---

## Блокер 2 — DMARC `rua=` + deliverability verifier ([0387441](https://github.com/anywhere))

**Что было сломано:** DMARC, SPF, DKIM уже в DNS работали, но без `rua=` мы не видели, что отклоняется. Если новый сервис (CRM, новый transactional) начнёт слать под manicbot.com — узнаем из жалоб клиентов, не из отчётов.

**Что починено:**

- Перепиcан [`manicbot/docs/dns/DMARC.md`](../manicbot/docs/dns/DMARC.md): operator-первая инструкция на русском с точными шагами в Cloudflare DNS dashboard
- Новый скрипт [`manicbot/scripts/verify-deliverability.mjs`](../manicbot/scripts/verify-deliverability.mjs): проверяет SPF/DKIM/DMARC через `dig`, опционально отправляет тестовое письмо через Resend и показывает PASS/WARN/FAIL
- Test coverage: 16 unit-тестов на парсеры в [`test/deliverability-logic.test.js`](../manicbot/test/deliverability-logic.test.js)

**Как проверить за 30 секунд:**

```bash
cd manicbot/
node scripts/verify-deliverability.mjs
```

До правки DNS вернёт `WARN — no rua`. После правки → `PASS`.

**Что делать в 3 ночи если письма перестали доходить:** откатить DNS обратно: `v=DMARC1; p=reject;` (убрать `rua=`). DNS TTL — единственный таймер.

**Деплой:**

1. Cloudflare dashboard → зона **manicbot.com** → DNS → Records → найти TXT-запись `_dmarc`
2. Изменить Content на:
   ```
   v=DMARC1; p=reject; rua=mailto:vdovin.kyrylo@gmail.com
   ```
3. Save
4. Проверить: `cd manicbot && node scripts/verify-deliverability.mjs` — должен дать exit 0

**Никакого Worker deploy не нужно** — это чисто DNS правка.

---

## Блокер 3 — Атомарный webhook dedup ([0d2ff84](https://github.com/anywhere))

**Что было сломано:** KV-based dedup в `src/utils/dedup.js` использовал GET-then-PUT pattern. KV не имеет compare-and-swap. Два одновременных retry'я того же webhook'а на разных edge-нодах могут оба прочитать `null`, оба записать, оба вернуть `true` → бот обрабатывает то же сообщение 2 раза → дубликаты записей, дубликаты AI-ответов, дубликаты аналитики.

**Что починено:** dedup мигрирован на D1 UNIQUE-constraint с атомарным `INSERT ... ON CONFLICT DO NOTHING`. SQLite — strongly consistent → ровно одна claim выигрывает. Тесты с `Promise.all` на 50 параллельных запросов подтверждают: ровно 1 возвращает `true`, 49 — `false`. На KV эта проверка **не проходила**.

- Миграция `0089_webhook_dedup.sql` — новая таблица
- API сохранён (`claimTelegramUpdate`, `claimMetaMessage`, `claimWAMessage`, `claimOnce`) → нулевые изменения в webhook-хэндлерах
- Backend pluggable через `env.WEBHOOK_DEDUP_BACKEND ∈ "kv"|"d1"|"dual"`, default `"dual"` (D1 — источник правды, KV — audit-mirror для мгновенного rollback'а)
- Cleanup-cron в `worker.scheduled()` сжимает таблицу: `DELETE FROM webhook_dedup WHERE expires_at < now`

**Как проверить за 30 секунд:**

```bash
cd manicbot/
npx vitest run test/dedup-d1-backend.test.js
# Должно быть 14 passed (14)
```

В проде после деплоя — мониторить `wrangler tail`:
- `worker.dedupCleanup { deleted: N }` раз в 15 минут
- 0 дубликатов в `analytics_events` за 24h после старта рекламы

**Что делать в 3 ночи если боты повторяют сообщения:** мгновенный rollback на KV-only:

```bash
wrangler secret put WEBHOOK_DEDUP_BACKEND
# ввести значение: kv
```

Worker подхватит переменную окружения на следующем cold start (~30 секунд) и переключится обратно на KV-логику.

**Деплой:**

1. **Применить миграцию 0089:** `wrangler d1 migrations apply manicbot-db --remote`
2. **Деплой Worker:** `cd manicbot && npx wrangler deploy`
3. После выката — наблюдать `wrangler tail` на дубликаты в течение 1 часа

---

## Блокер 4 — Защита от email injection ([c0102ec](https://github.com/anywhere))

**Что было сломано:** `webUsers.register` принимал `name: z.string().max(200)` без проверки содержимого, а `welcomeEmailHtml(name, ...)` / `roleRequestAdminEmailHtml` / `emailChangeEmailHtml` вставляли пользовательскую строку прямо в HTML через template literals. Атакующий, регистрирующийся с `name = '<script>alert(1)</script>'` или `name = 'Anna\r\nBcc: attacker@evil.com'`, получал бы payload в каждом welcome / role-change / email-change письме.

**Что починено:**

- Два новых санитайзера в [`server/security/sanitize.ts`](../manicbot/admin-app/src/server/security/sanitize.ts):
  - `sanitizeEmailDisplayName(input, maxLen=100)`: strip HTML tags, CRLF, control bytes, zero-width chars, leading RTL override, HTML-escape residue
  - `sanitizeEmailSubject(input, maxLen=200)`: CRLF kill для subject line
- Companion zod-предикат `isSafeDisplayName()` — failwise на tRPC-границе с локализованным сообщением (RU/UA/EN/PL)
- Inline UI-валидация на форме регистрации в 4 языках — пользователь сразу видит, что не так
- Email-шаблоны (`welcomeEmailHtml`, `roleRequestAdminEmailHtml`, `emailChangeEmailHtml`, `emailChangeCodeEmailHtml`) теперь санитизируют user-controlled input на функциональной границе (defence in depth)
- Read-only ретроактивный скан: `node scripts/scan-malicious-names.mjs --remote > /tmp/bad-names.csv` — **не удаляет**, только репортит

**Как проверить за 30 секунд:**

```bash
cd manicbot/admin-app
npx vitest run src/__tests__/sanitize-email.test.ts
# Должно быть 20 passed (20)

# Ретро-скан существующих юзеров
node scripts/scan-malicious-names.mjs --remote
# Должен показать пустой CSV если БД чистая
```

В UI: открой `/register`, введи в поле имени `<script>` — увидишь красное предупреждение под полем + кнопка submit не сработает.

**Что делать в 3 ночи если кто-то жалуется на «не могу зарегаться, ругается на имя»:** в DevTools посмотри, какой именно символ — обычно это zero-width space из copy-paste из мессенджера. Если ложноположительный кейс — отдельный фикс в `isSafeDisplayName`. Скрипт скана покажет, какой символ зацепился.

**Деплой:**

1. **Без миграций.** Это чисто admin-app код.
2. Push в `main` → GitHub Actions auto-deploy в Cloudflare Pages (~7 минут push→live)
3. Если есть подозрительные имена в БД: запустить ретро-скан и обработать вручную (переименовать через dashboard или связаться с пользователем)

---

## Блокер 5 — Pre-launch funnel analytics + God Mode dashboard ([b5b593b](https://github.com/anywhere))

**Что было сломано:** аналитической инфраструктуры по сути не было видно. Worker-side helper `recordEvent` существовал и писал в `analytics_events`, но критичные signup-funnel события (started, email_verified, completed) не фиксировались. Запуск рекламы без аналитики = деньги в трубу.

**Что починено:**

- Admin-app companion helper [`server/services/recordEvent.ts`](../manicbot/admin-app/src/server/services/recordEvent.ts) с Drizzle-сигнатурой
- Const-map `ANALYTICS_EVENTS` — 18 канонических слагов (single source of truth, typo здесь ломает тесты)
- **Wired сейчас:** `signup.started`, `signup.email_verified`, `signup.completed` в `webUsers.register` + `webUsers.verifyEmail`. Самые критичные для замера ad-funnel конверсии.
- **Wired в Worker уже до этого спринта:** `booking.created`, `booking.cancelled`, `promo.returning_candidate`, `promo.redeemed`, `ai.call`, `dashboard.tab_view`, etc.
- **Новая tRPC-роутер `analyticsEvents`** (adminProcedure): `list`, `stats`, `distinctEvents`
- **Новая страница** `/system/events` — God Mode дашборд: 18 stat-карточек 24h/7d, фильтры по event/tenant/user/JSON-search, paginated таблица raw events
- Nav-entry `god.analytics` "Analytics Events" — ru/ua/en/pl
- Test coverage: 8 unit-тестов на роутер + auth gating

**Что НЕ сделано в этом спринте (TODO следующих PR, не блокирующее запуск рекламы):**

- `bot.linked`, `salon.profile_completed` (нужны first-X dedup-чеки)
- `service.first_created`, `first_booking_link_shared`, `first_external_booking`, `first_paid_appointment` (idempotency-логика на «первый раз»)
- `subscription.started/renewed/churn_warning` (частично уже стреляют из Worker billing/webhooks.js — проверить и подкрутить)
- `payment.method_added` (Stripe webhook)
- `support.message_sent`
- `system.god_mode_action` (middleware для каждой adminProcedure-мутации)
- `trial.started/warning_3d/expired` (cron edits)

Покрытие 4 из 18 событий — этого достаточно для первого замера ad-funnel (signup конверсия). Остальные 14 — следующая итерация после первой партии данных.

**Как проверить за 30 секунд:**

После деплоя — открыть `/system/events` в God Mode. Зарегистрироваться тестовым аккаунтом → должна появиться строка `signup.started`. Подтвердить email → две новых строки: `signup.email_verified` + `signup.completed`. На страничке Analytics Events это видно сразу.

**Что делать в 3 ночи если события не пишутся:** проверь `wrangler tail` на ошибки от `recordEvent`. Helper fire-and-forget, никогда не блокирует hot path; ошибка локализована.

**Деплой:**

1. **Без миграций.** Таблица `analytics_events` создана ещё в миграции 0029.
2. Push в `main` → GitHub Actions auto-deploy в Cloudflare Pages
3. Открыть `/system/events` после деплоя → должна работать страница и показывать events

---

## Ready for ad spend? Чеклист

| Блокер | Готов к деплою | Готов к запуску рекламы |
|--------|---------------:|------------------------:|
| 1. Бэкапы D1 | ✅ | ✅ (после первого срабатывания cron, ≤15 мин после деплоя) |
| 2. DMARC `rua=` | ✅ (DNS-правка руками) | ✅ |
| 3. Webhook dedup | ✅ | ✅ |
| 4. Email injection | ✅ | ✅ |
| 5. Analytics (signup-funnel) | ✅ | ✅ для signup-конверсии; для billing-конверсии — следующий PR |

---

## Полный deploy-чеклист (в порядке выполнения)

```bash
# 0. На прод-БД применить две новые миграции (0088 + 0089).
#    БЕЗ ЭТОГО Worker не задеплоится корректно — таблицы webhook_dedup и
#    d1_backup_log должны существовать на момент первого вызова.
cd manicbot/
npx wrangler d1 migrations apply manicbot-db --remote

# 1. Деплой Worker (бэкап-cron + dedup-cron + analytics).
npx wrangler deploy

# 2. Push admin-app в main → GitHub Actions → Cloudflare Pages.
cd ..
git push origin claude/trusting-merkle-ca4dcb:main

# 3. Cloudflare DNS — правка _dmarc.manicbot.com TXT-записи.
#    См. docs/dns/DMARC.md (manicbot/docs/dns/DMARC.md в репо)
#    OLD: v=DMARC1; p=reject;
#    NEW: v=DMARC1; p=reject; rua=mailto:vdovin.kyrylo@gmail.com

# 4. Через 15 минут — sanity-check:
cd manicbot/
node scripts/verify-deliverability.mjs          # → PASS
node scripts/restore-d1.mjs --list              # → backups/daily/...
npx wrangler tail | grep -E "d1Backup|dedupCleanup|recordEvent"

# 5. Через час — посмотреть аналитику:
#    Открыть /system/events → счётчики должны быть > 0 на signup.* событиях
```

---

## Дополнительная информация

- **Скрипт ретро-скана имён:** `node manicbot/admin-app/scripts/scan-malicious-names.mjs --remote > /tmp/bad-names.csv`
- **Worker tests:** `cd manicbot && npm test` → 2644/2644 passing
- **Admin-app tests:** `cd manicbot/admin-app && npm test` → 4903/4910 passing (7 skipped — pre-existing, не связаны с этим спринтом)
- **Schema parity:** `cd manicbot && npm run check-schema` → 91 tables match

Если что-то пошло не так после деплоя — открой Claude Code сессию в репо, скажи что произошло. Все эти изменения откатываются:

- Блокер 1: миграция 0088 безопасна (`CREATE TABLE IF NOT EXISTS`); revert коммита уберёт cron-вызов и таблица станет неиспользуемой
- Блокер 2: одна DNS-правка обратно
- Блокер 3: `WEBHOOK_DEDUP_BACKEND=kv` через `wrangler secret put`
- Блокер 4: revert коммита — но это снова делает email-инъекцию возможной
- Блокер 5: revert коммита — таблица `analytics_events` не удаляется, просто перестают приходить новые сигналы
