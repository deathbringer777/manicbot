# Тестовые аккаунты Manicbot

> **ВНИМАНИЕ — это тестовые аккаунты.** Не удаляй и не блокируй вручную.
> Они нужны для регрессии биллинга, ролей и публичного каталога.
> Все 8 пересоздаются одной командой:
>
> ```bash
> cd manicbot && npm run seed:test-accounts
> ```
>
> Скрипт идемпотентен (детерминированные ID + `INSERT OR IGNORE`),
> повторный запуск ничего не дублирует.

## Общие данные

| Параметр  | Значение                              |
| --------- | ------------------------------------- |
| Пароль    | `TestPass!2026` (одинаковый для всех) |
| Домен     | `@test.manicbot.local` (не доставляется — это намеренно, чтобы не отправить настоящее письмо) |
| Флаг      | `tenants.is_test = 1` — фильтр в God Mode `tenants.getAll({ test: true })` |
| Бейдж     | Жёлтый `TEST` на: публичной карточке салона, шапке Salon/Master Dashboard, строке списка тенантов |

## Группа A — годовые активные подписки (6 аккаунтов)

`billing_status = active`, `current_period_end = now + 365 дней`. Платформа
работает в Польше — имена и города у тест-аккаунтов польские.

| Email                              | Роль          | План  | Имя / Город          | Тенант (`is_personal`) | Где смотреть             |
| ---------------------------------- | ------------- | ----- | -------------------- | ---------------------- | ------------------------ |
| `salon-start@test.manicbot.local`  | tenant_owner  | start | Test Salon Start / Warszawa | 0 (обычный салон) | SalonDashboard, /search  |
| `salon-pro@test.manicbot.local`    | tenant_owner  | pro   | Test Salon Pro / Kraków     | 0                 | SalonDashboard, /search  |
| `salon-max@test.manicbot.local`    | tenant_owner  | max   | Test Salon Max / Wrocław    | 0                 | SalonDashboard, /search  |
| `master-start@test.manicbot.local` | master        | start | Test Mistrz Start / Warszawa | 1 (personal)     | MasterDashboard          |
| `master-pro@test.manicbot.local`   | master        | pro   | Test Mistrz Pro / Kraków     | 1                | MasterDashboard          |
| `master-max@test.manicbot.local`   | master        | max   | Test Mistrz Max / Gdańsk     | 1                | MasterDashboard          |

## Группа B — истёкшие триалы (2 аккаунта)

`billing_status = trialing`, `trial_ends_at = now − 1 день` — реальный
продакшн-кейс, когда юзер зарегистрировался, триал автопроставился, ушёл и
не оплатил.

| Email                               | Роль          | План  | Имя / Город              | Тенант      | Что должно быть видно                       |
| ----------------------------------- | ------------- | ----- | ------------------------ | ----------- | ------------------------------------------- |
| `salon-trial@test.manicbot.local`   | tenant_owner  | start | Test Salon Trial / Wrocław | обычный   | Заглушка «триал истёк», staff-фичи блокированы |
| `master-trial@test.manicbot.local`  | master        | start | Test Mistrz Trial / Wrocław | personal | То же                                       |

## Что проверять

1. **Видимость в каталоге** — все 8 видны на `/search` (флаг `public_active=1`).
2. **Бейдж TEST** — рендерится в 4 точках:
   - публичная карточка салона `/salon/<slug>`,
   - шапка SalonDashboard,
   - шапка MasterDashboard,
   - строка списка в God Mode `/tenants`.
3. **Гейтинг по плану** — start/pro/max открывают разные вкладки. Откройте каждый и сравните.
4. **Истёкший триал** — staff-фичи (создание брони мастером, AI-чат, рассылки) недоступны; клиентский флоу через бот остаётся.
5. **Фильтр в админке** — `tenants.getAll({ test: true })` возвращает ровно 8 строк.

## Как войти

| Канал         | URL                                              | Логин                            | Пароль          |
| ------------- | ------------------------------------------------ | -------------------------------- | --------------- |
| Web (админка) | https://admin.manicbot.com/login                 | любой email из таблиц            | `TestPass!2026` |
| Telegram      | через `linkAccount` (см. BOT_GUIDE.md)           | привязать chat_id мастера/салона | —               |

## Как пересоздать (или восстановить после ручного удаления)

```bash
cd manicbot
npm run seed:test-accounts          # выполняется на remote D1 через wrangler
# либо для предпросмотра без записи:
npm run seed:test-accounts:dry      # печатает SQL в stdout
```

## Что под капотом

- Скрипт: `manicbot/scripts/seed-test-accounts.mjs`
- tRPC-эквивалент (для админ-панели): `provisioning.provisionTestAccount`
- Миграция: `manicbot/migrations/0033_is_test_flag.sql`
- Бейдж: `manicbot/admin-app/src/components/ui/TestBadge.tsx`
- Тесты: `manicbot/admin-app/src/__tests__/provisioning-test-accounts.test.ts`,
  `manicbot/admin-app/src/__tests__/billing-manual-activate-days.test.ts`
