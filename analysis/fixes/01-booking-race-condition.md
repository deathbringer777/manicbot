# FIX-01: Race Condition при одновременном бронировании (CRITICAL)

## Проблема

В `saveApt()` (`manicbot/src/services/appointments.js:149-208`) присутствует классическая TOCTOU-уязвимость (Time-Of-Check-Time-Of-Use):

1. **Строка 180-184:** `SELECT COUNT(*)` проверяет количество активных записей
2. **Строка 199-206:** `INSERT INTO appointments` создаёт новую запись

Между проверкой и вставкой нет блокировки. Два одновременных запроса могут оба пройти проверку и оба создать запись на один и тот же слот.

## Затронутые файлы

- `manicbot/src/services/appointments.js` — `saveApt()` (строка 149)
- `manicbot/src/db/schema.sql` — таблица `appointments`

## Root Cause

D1 (SQLite) не поддерживает `SELECT ... FOR UPDATE`. Отсутствие уникального индекса на комбинацию `(tenant_id, date, time, master_id)` позволяет дубликаты.

## Предложенное решение

### Вариант A: Уникальный частичный индекс (рекомендуется)

```sql
-- Новая миграция: 0010_booking_slot_unique.sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_slot_unique
  ON appointments(tenant_id, date, time, master_id)
  WHERE cancelled = 0 AND status != 'cancelled';
```

Изменение `saveApt()`:

```javascript
// appointments.js, строка 199 — заменить dbRun на:
try {
  await dbRun(ctx,
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, ...)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ...)`,
    id, ctx.tenantId, apt.chatId, apt.svcId, apt.date, apt.time, apt.ts,
    'pending', apt.masterId, ...
  );
} catch (e) {
  if (e.message?.includes('UNIQUE constraint failed')) {
    console.warn(`[apt] slot conflict: ${apt.date} ${apt.time} master=${apt.masterId}`);
    return null; // Слот уже занят
  }
  throw e;
}
```

### Вариант B: KV-лок (дополнительно к варианту A)

```javascript
const lockKey = `slot_lock:${ctx.tenantId}:${apt.date}:${apt.time}:${apt.masterId || 'any'}`;
const existing = await kvGet(ctx, lockKey);
if (existing) return null; // Слот заблокирован

// Установить лок на 30 секунд
await kvPut(ctx, lockKey, apt.chatId, { expirationTtl: 30 });

try {
  // ... INSERT ...
} catch (e) {
  await kvDel(ctx, lockKey); // Освободить при ошибке
  throw e;
}
```

## Стратегия тестирования

```javascript
// test/booking-race-condition.test.js
test('concurrent bookings to same slot: only first succeeds', async () => {
  const ctx = buildTestCtx();
  const apt1 = { chatId: 'u1', svcId: 's1', date: '2026-04-10', time: '10:00', masterId: 'm1', ts: Date.now() + 86400000 };
  const apt2 = { ...apt1, chatId: 'u2' };

  const [r1, r2] = await Promise.all([
    saveApt(ctx, apt1),
    saveApt(ctx, apt2),
  ]);

  // Один должен вернуть null (конфликт)
  expect([r1, r2].filter(Boolean)).toHaveLength(1);
});
```

## Effort

- Миграция: 5 мин
- Код: 15 мин
- Тесты: 30 мин
- **Итого: ~1 час**
