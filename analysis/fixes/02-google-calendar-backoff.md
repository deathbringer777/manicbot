# FIX-02: Google Calendar Sync — Exponential Backoff (HIGH)

## Проблема

В `handleCron()` (`manicbot/src/handlers/cron.js:15`) cron каждые 15 минут пытается синхронизировать **все** незасинченные записи:

```javascript
// cron.js — нет лимита на количество sync-запросов
const unsyncedApts = await dbAll(ctx,
  "SELECT * FROM appointments WHERE google_event_id IS NULL AND google_calendar_id IS NOT NULL ...");
for (const apt of unsyncedApts) {
  await syncAppointmentCalendar(ctx, apt); // каждый — запрос к Google API
}
```

Если у тенанта 1000 незасинченных записей (например, после сбоя Google OAuth), каждый cron-запуск отправит 1000 запросов к Google Calendar API, что может:
- Исчерпать квоту Google Calendar API (1M запросов/день, но per-user лимиты строже)
- Увеличить CPU-время Worker (30 сек лимит на Cloudflare)
- Заблокировать sync для других тенантов

## Затронутые файлы

- `manicbot/src/handlers/cron.js` — цикл синхронизации
- `manicbot/src/services/google-calendar-oauth.js` — `syncAppointmentCalendar()`
- `manicbot/src/db/schema.sql` — таблица `google_integrations`

## Предложенное решение

### 1. Ограничить количество sync-попыток за один cron run

```javascript
// cron.js — заменить неограниченный цикл на:
const MAX_SYNC_PER_CRON = 10;
const unsyncedApts = await dbAll(ctx,
  `SELECT * FROM appointments
   WHERE tenant_id = ? AND google_event_id IS NULL
     AND google_calendar_id IS NOT NULL
     AND (sync_retry_after IS NULL OR sync_retry_after < ?)
   ORDER BY created_at ASC
   LIMIT ?`,
  ctx.tenantId, Date.now(), MAX_SYNC_PER_CRON,
);
```

### 2. Добавить колонки для backoff

```sql
-- 0010_google_sync_backoff.sql
ALTER TABLE appointments ADD COLUMN sync_retries INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN sync_retry_after INTEGER DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN sync_last_error TEXT DEFAULT NULL;
```

### 3. Реализовать exponential backoff

```javascript
async function syncWithBackoff(ctx, apt) {
  try {
    await syncAppointmentCalendar(ctx, apt);
    // Успех — сбросить счётчик
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = 0, sync_retry_after = NULL, sync_last_error = NULL WHERE id = ?',
      apt.id);
  } catch (e) {
    const retries = (apt.sync_retries || 0) + 1;
    const backoffMs = Math.min(15 * 60 * 1000 * Math.pow(2, retries), 24 * 60 * 60 * 1000); // max 24h
    const retryAfter = Date.now() + backoffMs;

    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ?',
      retries, retryAfter, e.message?.slice(0, 200), apt.id);

    if (retries >= 5) {
      console.error(`[gcal] sync permanently failed for apt ${apt.id} after ${retries} retries`);
    }
  }
}
```

### 4. Обработать HTTP 429 (Rate Limit)

```javascript
// google-calendar-oauth.js — в fetch-обёртке:
if (resp.status === 429) {
  const retryAfter = parseInt(resp.headers.get('Retry-After') || '60', 10);
  throw new Error(`RATE_LIMITED:${retryAfter}`);
}
```

## Стратегия тестирования

```javascript
test('sync respects MAX_SYNC_PER_CRON limit', async () => {
  // Создать 20 незасинченных записей
  // Запустить handleCron()
  // Убедиться что sync вызван только 10 раз
});

test('backoff increases retry delay exponentially', async () => {
  // Провалить sync 3 раза
  // Проверить sync_retry_after увеличивается: 30m, 60m, 120m
});
```

## Effort

- Миграция: 5 мин
- Код: 30 мин
- Тесты: 30 мин
- **Итого: ~1 час**
