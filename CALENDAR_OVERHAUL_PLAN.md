# Calendar Overhaul — Plan

Goal: rebuild the «Записи» tab so it looks and behaves like Google Calendar — week as default, dropdown view selector, drag-to-create on the grid, three working FAB scenarios (booking / time reservation / time off), with seeded demo data on `manicbot.com@gmail.com` and a vitest safety net.

Source of truth for the UI is **two** components today, kept in lockstep:
- `manicbot/admin-app/src/components/dashboards/SalonDashboard.tsx` (lines 1595–1715) — tenant_owner / master view.
- `manicbot/admin-app/src/app/(dashboard)/appointments/AppointmentsPageClient.tsx` — God Mode cross-tenant view.

Both share the underlying view components: `SalonDayView`, `SalonWeekView`, `MonthCalendar`, `SalonAgendaView` (becomes List), `QuickAddFab`, `ManualBookingModal`.

---

## 1. Data layer — migration 0061

New table `appointment_blocks` (separate from `appointments` so we don't loosen `chatId`/`svcId NOT NULL` and don't pollute the booking flow):

```sql
CREATE TABLE IF NOT EXISTS appointment_blocks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  master_id     INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('reservation','time_off')),
  date          TEXT NOT NULL,        -- YYYY-MM-DD (start day)
  time          TEXT NOT NULL,        -- HH:MM (start)
  duration_min  INTEGER NOT NULL,     -- minutes; for multi-day time_off use end_date
  end_date      TEXT,                 -- YYYY-MM-DD when type='time_off' spans multiple days
  reason        TEXT,                 -- free text, optional
  created_at    INTEGER NOT NULL,
  created_by    TEXT,                 -- web_user id or 'system'
  cancelled     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_apt_blocks_master_date ON appointment_blocks(tenant_id, master_id, date);
CREATE INDEX idx_apt_blocks_tenant_date ON appointment_blocks(tenant_id, date);
```

Schema sync:
- `manicbot/migrations/0061_appointment_blocks.sql`
- `manicbot/src/db/schema.sql` (reference DDL block)
- `manicbot/admin-app/src/server/db/schema.ts` (Drizzle table)

`npm run check-schema` must pass.

---

## 2. tRPC router — `appointmentBlocks`

`manicbot/admin-app/src/server/api/routers/appointmentBlocks.ts`

- `create({ tenantId, masterId, type, date, time, durationMin, endDate?, reason? })` — `assertTenantOwner`; conflict check against existing appointments AND blocks.
- `delete({ id })` — soft cancel.
- `listByRange({ tenantId, dateFrom, dateTo })` — `assertTenantOwner`; for the calendar fetch.

Conflict semantics: blocks behave like a booked slot — `appointments.createManual` and `slot_conflict` check must include them. Implementation: a small `slotsBusy()` helper used by both routers.

---

## 3. View selector — Google Calendar parity

Replace the inline 5-pill switcher in **both** `AppointmentsPageClient.tsx` and `SalonDashboard.tsx` with a single dropdown component:

`manicbot/admin-app/src/components/dashboards/CalendarViewSwitcher.tsx`

- Trigger: button "Неделя ▾" (current view label + chevron).
- Menu: Day (D), Week (W), Month (M), List (L) — keyboard shortcuts wired (matches GCal).
- Drop **«Агенда»** — merge into "Список" (the user explicitly said nobody knows the word). The agenda renderer survives, it just becomes the `list` mode renderer.
- Default mode flips from `"day"` → `"week"` in both files.
- Animated open (CSS `transition opacity + translate`, no Framer).

Also fix duplicate header:
- AppointmentsPageClient: remove the inline `<h2>{t("gmAppts.title", lang)}</h2>` at line 319 (the top `PageHeader` already shows the title).
- SalonDashboard: remove the inline `<h2>{t("salon.appointments", lang)}</h2>` at line 1679.

Both files keep the view switcher anchored on the right of the row that previously held the duplicate H2.

CSS view transition: wrap each view branch in a `<div data-view-key={mode} className="apt-view-transition">` and add a small global rule (Tailwind layer) for `apt-view-transition` → `transition: opacity .18s, transform .18s; key change re-mounts`.

---

## 4. FAB rebuild — three real scenarios

`manicbot/admin-app/src/components/dashboards/QuickAddFab.tsx` — drop the `disabled` + `СКОРО` paths; always render all three actions enabled.

Three dialogs:

### 4.1 NewBookingDialog (existing `ManualBookingModal`)
- Trigger: FAB → «Новая запись», or drag on Day/Week grid.
- Already implemented — just polish the sticky CTA + accept new optional props `defaultDate`, `defaultTime`, `defaultMasterId` for drag-prefill.

### 4.2 TimeReservationDialog (new)
`manicbot/admin-app/src/components/dashboard/TimeReservationDialog.tsx`
- Trigger: FAB → «Резерв времени».
- Fields: master, date, start time, duration (15/30/45/60/90/120 min preset + custom), optional reason.
- Submits to `appointmentBlocks.create({ type: 'reservation' })`.
- Block renders in Day/Week as a hatched grey block with the reason text — no client column, no actions.

### 4.3 TimeOffDialog (new)
`manicbot/admin-app/src/components/dashboard/TimeOffDialog.tsx`
- Trigger: FAB → «Перерыв / выходной».
- Sub-mode selector at top: «Перерыв (часы)» / «Выходной (день)» / «Отпуск (диапазон)».
  - Перерыв: master + date + start time + duration.
  - Выходной: master(s) + date — auto-fills 00:00 / 1440 min.
  - Отпуск: master(s) + start date + end date — multiple block rows on submit.
- Submits to `appointmentBlocks.create({ type: 'time_off' })` (one or many).
- Block renders in Day/Week as a tinted full-width band across the master column.

### 4.4 Sticky-bottom dialog scaffolding
Shared `DialogShell` component with consistent header, body scroll, sticky footer. Avoids the current rebuild-per-modal pattern.

---

## 5. Drag-to-create on Day + Week

Touch-target: SalonDayView and SalonWeekView master/day columns. Mouse down on empty area → drag → release.

Behaviour:
- Snap to 15-min increments.
- Live "ghost" rectangle while dragging, shows `HH:MM – HH:MM`.
- Release → opens NewBookingDialog with date/time/master/duration prefilled (modifier key Shift + drag → opens TimeReservationDialog instead — matches Google).
- Touch: long-press 250 ms then drag.
- Click without drag (just empty cell) → opens NewBookingDialog with that 1-hour slot prefilled.

Implementation: extracted `useDragToCreate` hook that returns `{ onPointerDown, ghost }` to keep the view files thin.

---

## 6. Render blocks in views

`SalonDayView` and `SalonWeekView` get a new prop `blocks: BlockRow[]`. Block renderer is sibling to appointment renderer — same column geometry, different visual:
- Reservation: diagonal hatching, grey, reason as label.
- Time off: solid muted tone, lock icon, reason.
Click on a block → small popover with «Удалить» (calls `appointmentBlocks.delete`).

`MonthCalendar` shows blocks as muted chips with a lock icon. List view mixes blocks into the agenda groups.

---

## 7. Seed — `manicbot.com@gmail.com` demo data

`manicbot/scripts/seed-calendar-demo.mjs`
- Targets the email `manicbot.com@gmail.com` (override via `--email …`).
- If web_user missing → create tenant `t_demo_calendar` + web_user with role `tenant_owner`, marked `is_test=1`.
- 4 masters (RU names, distinct palette indices): «Анна», «Ольга», «Карина», «Юлия».
- 6 services: «Маникюр классический» / «Покрытие гель-лак» / «Педикюр» / «Френч» / «Снятие» / «Дизайн».
- 60+ appointments distributed across `today-3d … today+14d`:
  - Every weekday gets 6–10 bookings spread across 09:00–19:00.
  - Status mix: 70% confirmed, 20% pending, 5% cancelled, 5% done (past dates).
  - Confirmed-by-client semantics: status=`confirmed` with `confirmedBy = chat_id of the client` (mirrors Telegram-confirm flow). Cron / notify is bypassed (synthetic).
- 3 reservation blocks, 2 time-off rows (one weekend off, one «Отпуск» 3-day range).

Idempotent via FNV-1a deterministic IDs (matches existing pattern).

`package.json` script: `"seed:calendar-demo": "node scripts/seed-calendar-demo.mjs --apply"`.

---

## 8. Tests — vitest

Adds:
- `appointmentBlocks.test.ts` — router CRUD + conflict guards + assertTenantOwner.
- `CalendarViewSwitcher.test.tsx` — dropdown renders all 4 options, keyboard shortcuts, default = week.
- `useDragToCreate.test.ts` — geometry math (timeToY, yToTime, snap-to-15min).
- `TimeReservationDialog.test.tsx` + `TimeOffDialog.test.tsx` — happy path + validation.
- `seed-calendar-demo.test.ts` — dry-run snapshot of generated SQL (deterministic).

Updates:
- `AppointmentsPageClient.test.tsx` — week is default; agenda mode removed.
- `QuickAddFab.test.tsx` — all three actions enabled.
- `SalonAgendaView.test.tsx` — keep, also covers list mode.

---

## 9. Out-of-scope (explicitly skipped — silent omission = bug per CLAUDE.md)

- Drag-to-RESCHEDULE existing appointments (move/resize). Different problem; will note as follow-up.
- Multi-master-resource view inside Week. Today Week shows day columns; staying that way.
- Real-time collaborative edits / Pusher etc.
- Worker-side cron for time-off auto-cleanup.
- Animated micro-interactions beyond the view-switcher transition.

---

## 10. Order of execution

1. Migration 0061 + schema sync (Worker + Drizzle).
2. tRPC `appointmentBlocks` router.
3. Slot-conflict helper update so blocks are honored by `createManual`.
4. CalendarViewSwitcher component + drop the inline pills + drop agenda + flip default to week + drop duplicate H2 in both pages.
5. QuickAddFab: drop disabled paths.
6. TimeReservationDialog + TimeOffDialog.
7. Render blocks in SalonDayView/SalonWeekView/MonthCalendar/SalonAgendaView.
8. `useDragToCreate` hook + wire into Day + Week views.
9. Seed `seed-calendar-demo.mjs`.
10. Tests (TDD where practical: write failing tests for blocks router first).
11. `npm test` + `npm run typecheck` (admin-app) + `npm test` (worker) + `npm run check-schema`.
12. Commit per logical chunk; push; open PR.

---

## 11. Risks / known sharp edges

- **Hydration mismatch on view-mode default** if the dropdown initial value depends on `localStorage`. Mitigation: SSR uses `"week"`; only after mount we read the stored override.
- **Drag math + horizontal scroll**: Day view has its own scroller (`overflow-auto`). The pointer-event coordinates must be relative to the column, not the page. Already partially handled in `SalonDayView` for the now-line; reuse.
- **Slot conflict double-count**: `createManual` slot check today only looks at `appointments`. Step 3 must extend to `appointment_blocks` or two users will be able to book over a block.
- **Mobile drag**: long-press conflicts with the current 3-day swipe gesture in `SalonWeekView`. Mitigation: long-press requires staying still ≥250ms before drag arms; horizontal flick stays a swipe.
- **Backwards-compat agenda key**: removing `aptViewMode === "agenda"` could break URLs / persisted state. Mitigation: `useState` initializer normalizes any saved `"agenda"` to `"list"`.
