# Messenger Full Review — ManicBot (2026-06-12)

Branch: `feat/system-messaging`. Five-lens review (security, bugs, compat/i18n, stability/perf, UX).
Baseline before review: Worker suite **260 files / 3283 tests green**, `check-schema` green (98 tables).
No files were modified during the review.

---

## Краткое резюме (RU)

Подсистема Messenger в хорошем состоянии. **Tenant-изоляция — CLEAN**: каждый доступ к треду идёт
через `assertThreadMember` (сначала tenant, потом membership), кросс-тенантные операции закрыты
`systemAdminProcedure`, системный/новостной канал для тенантов **read-only** (owner-reply жёстко
запрещён на уровне API). Секреты сравниваются `timingSafeEqual`, AI-вход санитизируется,
тела сообщений рендерятся как текст (без `dangerouslySetInnerHTML`), URL вложений pin'ятся к CDN.

**P0/P1 по безопасности нет.** Реальные находки — продуктовые:
- **P0** — `RequestCard.tsx` (главная owner-facing карточка входящей заявки) полностью на русском, без
  `t()`/`useLang`. PL/EN салоны видят русский текст. Висит с ревью 2026-06-07.
- **P1** — Вложения staff→client **не долетают** до внешнего канала (Telegram/WA/IG): relay шлёт только
  `body`. Reply «только картинка» уходит клиенту литералом `"(вложение)"` без изображения.
- Дальше — связка дешёвых корректностных P2 (порядок ULID, регрессия delivery_state и read-pointer,
  отсутствие gap-fill при реконнекте, неконсистентные таймстемпы) и масштабные P2 (per-tenant WS
  fan-out вместо per-thread, последовательный consumer очереди, jitter реконнекта).

Рекомендация к Phase 5: чиним **P0 + P1 + дешёвые P2 (B2/B3/B6)** в этом заходе; крупные
архитектурные P2 (per-thread WS-фильтр, monotonic ULID, batch-size очереди) — отдельным треком, чтобы
не раздувать messaging-PR. Все P3 — pre-launch hardening.

---

## Prioritized findings

| ID | Sev | Area | Location | Issue | Fix sketch |
|----|-----|------|----------|-------|-----------|
| C-RC | **P0** | i18n | `admin-app/.../messages/RequestCard.tsx:68-128` | Entire booking-request card hardcoded RU (no `t()`/`useLang`). PL/EN owners see Russian on the primary inbound surface. | Add `useLang`+`t()`; new keys `messenger.request.*` in all 4 locales. |
| C-ATT | **P1** | cross-channel | `messenger.ts:103` (relayToWorker) → `messengerOutboundHttp.js:119-208` | Relay passes only `body`; attachments never reach Telegram/WA/IG. Image-only reply sends literal `"(вложение)"` as text. Data loss + RU leak. | Thread `attachments` through relay → adapters; at minimum suppress/localize the sentinel and send media. |
| A-WS | P2 | security/perf | `messengerHub.js:62-82` + `messengerWsHttp.js` | WS fan-out is per-**tenant**, not per-**thread**. Non-member staff receive `message.new`/`thread.updated` **metadata** frames (not bodies). | Carry membership set in WS token + filter frames in DO, OR assert frames stay body-free + document. |
| B1 | P2 | correctness | `src/utils/ulid.js:42`, `admin-app/src/lib/ulid.ts` | ULID has no monotonic counter; same-ms messages get random low bits → ordering/pagination can disagree with insert order. | Monotonic ULID factory (increment random component when `ms===lastMs`); keep Worker/admin byte-compatible. |
| B2 | P2 | correctness | `messenger.ts:755` (sendMessage relay-success UPDATE) | `sent` write is **not** terminal-guarded; a concurrent Meta `delivered` receipt gets downgraded sent←delivered. | `WHERE id=? AND delivery_state='pending'` on the relay `sent` UPDATE. |
| B3 | P2 | correctness | `messenger.ts:943` (markRead) | No monotonic guard; opening a paginated old view can move `lastReadMessageId` **backwards** → unread badge resurrects. | `AND (last_read_message_id IS NULL OR last_read_message_id < ?)`. |
| B4 | P2 | reliability | `admin-app/.../useMessengerSocket.ts` | On reconnect, only `listThreads` is invalidated, not `getThread` for the open thread; no `since` cursor → gap recovered only by ≤15s poll. | On socket `open`, also invalidate `getThread` for active thread. |
| D-16 | P2 | scale | `worker.js:860-898` / `:821-855`, `wrangler.toml:107` | Cron + outbound-retry queue consumers process the 10-msg batch **sequentially**; 10 heavy crons per invocation risk budget/DLQ at 1000s tenants. | Lower `max_batch_size` to 1–3, or bounded `Promise.all` concurrency. |
| D-1 | P2 | scale | `messengerHub.js:74-81` | No per-tenant socket cap; synchronous `send()` loop → buffered frames inflate DO memory on slow/many sockets. | Cap connections per DO (~200), drop oldest; optional `bufferedAmount` check. |
| D-4 | P2 | reliability | `useMessengerSocket.ts:182-191` | Backoff has no jitter; non-precondition mint failures retry-storm `issueWsToken` (D1 write/attempt) across tabs. **Activates once `WS_TOKEN_SECRET` set in prod** (currently unset → realtime off). | Add jitter; sticky-disable after K mint 5xx. |
| D-10 | P2 | hardening | `messengerHub.js:62-69` | DO `/publish` `await request.json()` with no size cap (not reachable via current product surface — trusted Worker caller only). | Reject body > 16 KB; whitelist frame fields. |
| B6 | P3→P2 | i18n/UX | `ThreadView.tsx:18-23`, `ThreadList.tsx:29-39` | Three different timestamp renderings on one screen; ThreadList relative suffixes `now/m/h` hardcoded EN; `fmtFull` bypasses locale-aware `formatTime`. | Use `formatDate`+`formatTime` and `formatRelativeShort` (already in i18n.ts) everywhere. |
| C-MC | P2 | i18n | `MessageComposer.tsx:32,84`, `PlatformAdminPane.tsx:14` | EN strings ("Relay not configured", "Max N attachments"); browser-locale date instead of app lang. | Route through `t()`; pass `lang` to `formatDate`. |
| B7 | P3 | correctness | `messenger.ts:894-897` | editMessage preview-refresh guard `lastMessageAt === createdAt` can falsely skip → stale inbox preview. | Refresh by comparing newest message id, not timestamp equality. |
| B5 | P3 | reliability | `useMessengerSocket.ts:146-150` | `attempts` reset on every `open`; a flap (open→immediate close) never backs off. | Reset only after stable-open > N s. |
| A-ATT2 | P3 | security | `ThreadView.tsx:384` | Read path renders stored attachment URL with no host re-validation; pre-IU-1 rows could hold arbitrary host. | Re-run `isChatAttachmentCdnUrl` at render / backfill-scan. |
| A-TOK | P3 | hygiene | `messengerWsHttp.js:44` | WS token in query string (`?token=`) — could land in edge access logs. Low blast radius (≤60s TTL, tenant-bound). | Confirm CF logs strip query on `/ws/messenger/*`. |
| A-TYP | P3 | security | `messengerHub.js:114-134` | Typing frames re-broadcast with client-asserted `memberRef`/`displayName` (spoofable, ephemeral). | Derive `memberRef` from WS token. |
| D-2/D-19 | P3 | obs/perf | `messengerHub.js`, `messengerWsHttp.js:75-90` | No `bufferedAmount` backpressure; publish failures only warn-logged. | Optional backpressure drop; error-level log on systemic publish failure. |
| C-ANN | P3 | i18n (by design) | `platformCampaigns.js` renderAnnouncementBodies | Operator announcements are author-passthrough (RU reaches PL/EN owners). Reports/reminders ARE localized (ru/ua/en/pl). | Document; add per-locale variants if PL/EN owner base grows — **the new service addresses this via per-locale templates**. |

### Verified CLEAN (no action)
Tenant isolation (all messenger queries tenant-scoped; `assertThreadMember` tenant-first), cross-tenant
guards (`systemAdminProcedure` on all 18 platformBroadcasts + platformMessenger procs, target from input),
system-channel read-only (owner `sendMyReply` → FORBIDDEN), secret compares (`timingSafeEqual`), AI input
sanitization, message-body safe-render (React text nodes), attachment write-pin (CDN host + tenant path),
R2 upload guards (2 MB cap, magic-byte sniff, single-use jti, content-addressed keys), batched unread
(2 queries, no N+1), DM-title batching, getThread pagination (≤100, ULID cursor), one-DO-per-tenant +
hibernation, queue cron fan-out chunking (100/batch), outbound-retry boundedness + DLQ (MAX_ATTEMPTS=5,
no double-send on ambiguous failures), thread-create race (UNIQUE-violation catch + re-select),
full i18n coverage on all 140 `messenger.*` keys, filter-tab logic (ALL hides client_conv per role,
double-gated), no plan-gating inconsistency.

---

## Phase-5 fix decision (this PR)
**Fix now:** C-RC (P0), C-ATT (P1), B2 + B3 (cheap correctness guards), B6 + C-MC (i18n/timestamp
consistency). **Track separately (not in messaging PR):** A-WS, B1, B4, D-16, D-1, D-4, D-10 — larger
surface, deserve focused PRs with their own tests. **Accept pre-launch:** all P3 hardening items.

## Notes for the new System & Seasonal Messaging service
- C-ANN is the strongest signal **for** the new service: per-locale template rows (RU/UK/PL/EN) replace
  the single author-passthrough announcement body, fixing PL/EN localization at the source.
- D-4/D-10/D-1 matter once `WS_TOKEN_SECRET` is set in prod; the service does not depend on realtime WS
  (it delivers via the existing campaign center/bell ledger), so it is unaffected.
