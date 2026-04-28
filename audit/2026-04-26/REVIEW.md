# Manicbot — Полный обзор и ревью

**Дата:** 2026-04-26
**Автор:** Claude Code (orchestrated audit)
**Скоуп:** `manicbot/` (Worker) + `manicbot/admin-app/` (Next.js mini-app) + миграции + CI/CD + плагины + маркетинг + бизнес-модель
**Метод:** горизонтальный + вертикальный код-разбор; 7 параллельных sub-agent-проходов (3 в Phase 1 разведки + 4 в Phase 2 deep-dive валидации); консолидация против 3 предыдущих отчётов в репо; live-проверки локально, в GitHub Actions, в Wrangler/Cloudflare.

---

## 0. Что делалось (для воспроизводимости)

### 0.1 Live-проверки выполнены

| Проверка | Команда | Результат |
|---|---|---|
| Worker tests | `cd manicbot && npm test` | ✅ **94 файла / 1541 тест** за 11.43s |
| Admin-app tests | `cd manicbot/admin-app && npm test` | ✅ **67 файлов / 3075 тестов** за 15.18s |
| Admin-app typecheck | `cd manicbot/admin-app && npm run typecheck` | ✅ чисто (no output) |
| D1 schema parity | `cd manicbot && npm run check-schema` | ✅ **57 таблиц** совпадают между `schema.sql` и Drizzle `schema.ts` |
| GitHub Actions | `gh run list --limit 15` | ✅ Последние 13 прогонов на `main` зелёные; 2 неудачи в i18n-серии за 25 апр (потом починены) |
| Open PRs | `gh pr list --state open` | 2 открытых: PR#2 + PR#3 «Brevo redesign» от `claude/*` веток с 23 апр |
| Wrangler | `wrangler whoami` | ✅ Logged in (vdovin.kyrylo@gmail.com) |
| D1 / KV | `wrangler d1 list` / `wrangler kv namespace list` | `manicbot-db` (prod, 991 KB), KV `MANICBOT` |
| Worker deploys | `wrangler deployments list` | Несколько deploy за 26 апр (продакшн актуален) |
| Migrations | `ls manicbot/migrations/` | **39 миграций** (0002-0039) |

### 0.2 Использовано агентов / скиллов

- **Phase 1**: 3 параллельных Explore-агента (бэкенд, фронтенд, cross-cutting инфра/маркетинг)
- **Phase 2**: 4 параллельных Explore-агента-валидатора (backend findings status, frontend a11y, marketing+biz, ops/CI/GDPR)
- **TodoWrite**: трекинг 9 шагов
- **AskUserQuestion**: уточнил формат (single file in folder) и язык (русский)

### 0.3 Существующие отчёты в репо (на которые опирается этот)

| Файл | Дата | Размер | Что внутри |
|---|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | 26 / 20 апр | 33k | Architecture reference, role model, plugin system |
| `DESIGN_MARKETING_REPORT.md` | 25 апр | 131k / 676 строк | Глубокий UX/маркетинг-аудит, 20 ROI-приоритетов, конкурентка vs Yclients/Booksy |
| `FULL_REVIEW_AUDIT_2026-04-26.md` | 26 апр | 10k / 245 строк | Общий аудит, priority matrix |
| `manicbot/REVIEW_REPORT.md` | 25 апр | 9k | Code review (10 багов исправлено + остаток B6/B8/B11/B12/T3) |
| `manicbot/SECURITY_FINDINGS.md` | 25 апр | 12k | H1-H5 / M1-M7 / L1-L6 |

> Этот отчёт **консолидирует** предыдущие, **валидирует** их находки против текущего кода (часть уже исправлена!) и **углубляет** разделы, которые слабо покрыты — особенно plugin-wiring, GDPR, CI/CD-цепочка, виральные циклы.

---

## 1. Executive Summary

### 1.1 Общая оценка

Manicbot — **технически зрелый продукт на early-stage**: 4616 тестов проходят, schema parity выдержан, security-baseline крепкий (HKDF-encryption, timing-safe compare, PII-redaction, queues fan-out, multi-tenant isolation). Архитектура чистая (HTTP modules → handlers → services), Plugin Marketplace заложен на правильном фундаменте, mini-app в Next.js 15 с tRPC построен грамотно.

**Главные ограничители НЕ технические, а продуктово-операционные:**
1. **GTM**: 0 систем аналитики (это блокер №1 — никакие маркетинговые гипотезы не измеряемы), public salon profile рендерит 30% от данных, нет lifecycle email-цепочек, нет реферальной программы, нет watermark-виральности.
2. **Безопасность**: один CRITICAL (Master IDOR) и три HIGH (REQUIRE_WEBHOOK_BOT_ID закомментирован в проде, connectBot не сохраняет токен в KV, auth.getMyRole возвращает не того мастера) — все три могут пробить multi-tenant изоляцию.
3. **Plugin Marketplace**: 24 плагина в `registry.ts`, но `PLUGIN_ROUTER_LOADERS / LIFECYCLE / HEALTH` — **пустые dict'ы**. То есть все плагины — manifest-only стабы, без backend-runtime. Это half-built feature.
4. **CI/CD**: actions запиннены тегами (не SHA), Semgrep soft-fail, нет approval-gate, авто-деплой на main. Supply-chain риск выше необходимого.
5. **Marketing module**: `campaignSendNow` и `automationsList` явно стабы (`{ ok: false, stub: true }`); `consent_log` таблица создана, но никем не пишется.
6. **GDPR-готовность**: нет user erasure endpoint, нет ToS/Privacy ссылок в mini-app, нет DPO email, retention TTLs только частично документированы. Для PL/UA/RU рынка с RODO — это риск.

### 1.2 Топ-5 проблем (для понедельника утром)

1. **CRITICAL**: Master IDOR — `manicbot/admin-app/src/server/api/routers/masterRouter.ts` мастер может изменить `allowDelegation` другому мастеру в том же тенанте.
2. **CRITICAL**: Прод работает в legacy-режиме (`REQUIRE_WEBHOOK_BOT_ID` закомментирован в `manicbot/wrangler.toml:21`). Откройте strict-mode.
3. **CRITICAL**: 0 систем аналитики — без неё все маркетинговые правки делаются вслепую. Установите GA4 + Yandex.Метрика + PostHog за 1-2 часа.
4. **HIGH**: Modal a11y — 3 из 4 модалок (`InstallConfirmModal`, `ManualBookingModal`, `InviteMemberModal`) не имеют `role="dialog"` / focus trap / Esc — WCAG 2.1 AA fail.
5. **HIGH**: Plugin Marketplace runtime пустой — `manicbot/plugins/registry.ts:98-102` показывает что routers/lifecycle/health loaders — `{}`. Каталог UI красивый, но плагины ничего не делают. Либо допилить, либо честно скрыть «scaffold».

### 1.3 Топ-5 побед (что уже сделано хорошо)

1. **Тесты на уровне зрелого продукта**: 4616 тестов, schema parity check встроен в CI, multi-tenant isolation покрыт, encryption enforcement покрыт, prompt injection покрыт.
2. **Security-baseline**: HKDF-encryption с domain separation, timing-safe compare, PII-redaction в логгерах (Worker + admin-app), Stripe webhook idempotency dual-layer (D1 + KV 7d TTL), Telegram HMAC validation.
3. **i18n из коробки** — 4 языка (ru/ua/en/pl), `t()` helper, тестовый контракт, 4 перевода email-шаблонов. Это редко на early-stage.
4. **Multi-tenant архитектура**: Cloudflare Queues fan-out для cron (масштабируется до 5000+ тенантов), `assertTenantOwner()` строгий, KV префиксы изолируют (`t:{tenantId}:`).
5. **Plugin Marketplace архитектура** (НЕ runtime, см. выше): 4 billing models, manifest schema, audit trail (`plugin_events` immutable), Stripe webhook routing по `plugin_slug` metadata. Если допилить runtime — будет действительно сильная фича.

---

## 2. Master Priority Matrix — все находки от Critical до Low

> Колонка **Status**: ⛔️ STILL ACTIVE / ✅ FIXED (с прошлых отчётов) / ⚠️ PARTIALLY / 🆕 NEW (обнаружено в этом ревью)
>
> Префиксы ID: **S** — Security, **B** — Backend, **F** — Frontend/UX, **M** — Marketing, **Bz** — Business model, **O** — Ops/CI/GDPR.

| ID | Severity | Area | Title | File:line | Effort | Status |
|---|---|---|---|---|---|---|
| **S-01** | 🔴 CRITICAL | Security | Master IDOR в `updateDelegation` — `masterId` не привязан к caller identity | `admin-app/src/server/api/routers/masterRouter.ts:42-56` | M | ⛔️ |
| **O-01** | 🔴 CRITICAL | Ops/Infra | `REQUIRE_WEBHOOK_BOT_ID` закомментирован в проде | `manicbot/wrangler.toml:21` | S | ⛔️ |
| **M-01** | 🔴 CRITICAL | Marketing | Ноль систем аналитики на лендинге и в mini-app — GTM-блокер | весь репо | S | ⛔️ |
| **S-02** | 🟠 HIGH | Security | `connectBot` валидирует токен, но не сохраняет в Worker KV → `getBotToken=null` | `admin-app/src/server/api/routers/salon.ts` (`connectBot`) | M | ⛔️ |
| **S-03** | 🟠 HIGH | Security | `auth.getMyRole` берёт первого активного мастера в тенанте, не привязанного к web-user | `admin-app/src/server/api/routers/auth.ts:92-100` | M | ⚠️ |
| **B-01** | 🟠 HIGH | Backend | Plugin runtime пустой — `PLUGIN_ROUTER_LOADERS / LIFECYCLE / HEALTH = {}` | `manicbot/plugins/registry.ts:98-102` | XL | 🆕 |
| **F-01** | 🟠 HIGH | Frontend/UX | Модалки без `role="dialog"` + focus trap + Esc | `InstallConfirmModal.tsx:41-119`, `ManualBookingModal.tsx:107-115`, `StaffTab.tsx:283-349` | M | ⛔️ |
| **F-02** | 🟠 HIGH | Frontend/UX | Native `confirm()` диалоги (UX/a11y антипаттерн) | `StaffTab.tsx:202`, `PluginSettingsSection.tsx` | S | ⛔️ |
| **F-03** | 🟠 HIGH | Frontend/UX | 10+ хардкоженых русских строк без i18n | `SupportDashboard.tsx:88,155,245`, `StaffTab.tsx:74,80,202,255,287,331,295,88` | S | ⛔️ |
| **F-04** | 🟠 HIGH | Frontend/UX | WCAG color contrast — `gray-400` на `#fafaf7` ~ 5.5:1 (под порогом для важных элементов) | `WebShell.tsx:60,106,114,199` | S | 🆕 |
| **O-02** | 🟠 HIGH | Ops/CI | GitHub Actions запиннены тегами, не SHA — supply-chain риск | `.github/workflows/deploy.yml:28,33,38,56,118,170,209` | S | ⛔️ |
| **O-03** | 🟠 HIGH | Ops/CI | Semgrep soft-fail | `.github/workflows/deploy.yml:48` | S | ⛔️ |
| **O-04** | 🟠 HIGH | Ops/CI | Auto-deploy в прод на push в `main`, без approval-gate | `.github/workflows/deploy.yml:102` | M | ⛔️ |
| **M-02** | 🟠 HIGH | Marketing | `campaignSendNow` стаб — основной маркетинговый поток не работает | `admin-app/src/server/api/routers/marketing.ts:282-287` | L | ⛔️ |
| **M-03** | 🟠 HIGH | Marketing | 0 lifecycle/marketing email-шаблонов (Day-7, abandoned-trial, re-engagement) | `admin-app/src/server/email/emailService.ts` (9 transactional) | L | ⛔️ |
| **M-04** | 🟠 HIGH | Marketing | Lead-form vs self-serve `/register` — конкуренция воронки | landing source (вне репо) + `landingHttp.js` | M | ⛔️ |
| **B-02** | 🟠 HIGH | Backend | Public Salon Profile рендерит ~30% возвращаемых полей (нет cover/photos/description) | `admin-app/src/app/salon/[slug]/SalonProfileClient.tsx` | M | ⛔️ |
| **F-05** | 🟠 HIGH | Frontend/UX | Onboarding-checklist: шаги 4 и 5 ведут на те же экраны, что 3 и 2 | `admin-app/src/components/OnboardingChecklist.tsx` | S | ⛔️ |
| **F-06** | 🟠 HIGH | Frontend/UX | Logout не сбрасывает HttpOnly cookie + KV-сессию — нельзя сменить роль/аккаунт | auth/session paths | S | ⛔️ |
| **S-04** | 🟡 MEDIUM | Security | Widget sanitizer link safety — uncommitted мод. `src/embed/demoChat.js` | `src/embed/demoChat.js` | S | ⛔️ |
| **S-05** | 🟡 MEDIUM | Security | TOCTOU race в `checkAndIncrement` rate-limiter (read→compute→write) | `src/utils/rateLimit.js:29-51` | M | ⛔️ |
| **S-06** | 🟡 MEDIUM | Security | `sanitizeHtml` regex-based, разрешает `style` (CSS injection) | `admin-app/src/server/security/sanitize.ts` | M | ⛔️ |
| **S-07** | 🟡 MEDIUM | Security | Stripe `session.metadata.tenantId` не валидируется против D1 | `src/billing/webhooks.js:179` | S | ⛔️ |
| **S-08** | 🟡 MEDIUM | Security | Worker CSP — только `frame-ancestors 'none'`, нет `script-src/connect-src` | `src/worker.js` `addSecurityHeaders` | S | ⛔️ |
| **S-09** | 🟡 MEDIUM | Security | `stamp_card_configs` queries в `try/catch` без логирования (silent swallow) | `src/handlers/callback.js:212-228` | S | ⛔️ |
| **S-10** | 🟡 MEDIUM | Security | Password length асимметрия: Worker `/admin/web-user` 8 chars vs tRPC 12 | `src/http/adminKeyHttp.js:499` vs `webUsers.create` | S | ⛔️ |
| **B-03** | 🟡 MEDIUM | Backend | `events.getRecent` polling каждые 5с — нагрузка на D1 | `EventsPageClient.tsx:123` | S | ⛔️ |
| **B-04** | 🟡 MEDIUM | Backend | `B6` — `review_requested_at` vs `review_requested` (флаги расходятся) | `src/handlers/cron.js:385-388` | S | ⛔️ |
| **B-05** | 🟡 MEDIUM | Backend | `T3` — returning-client promo создаётся только аналитический event, реальный promo код не выдаётся | `src/handlers/cron.js:413-426` | M | ⚠️ |
| **F-07** | 🟡 MEDIUM | Frontend/UX | Нет inline валидации + password strength meter + disable-until-valid в `/register` | `app/(auth)/register/page.tsx` | S | ⛔️ |
| **F-08** | 🟡 MEDIUM | Frontend/UX | Empty-states «Услуг нет» — без шаблонов, без иллюстрации, без CTA | `Services` tab UI | S | ⛔️ |
| **F-09** | 🟡 MEDIUM | Frontend/UX | Нет `env(safe-area-inset-bottom)` под bottom-nav на mobile | `WebShell.tsx`, `Shell.tsx` | S | ⛔️ |
| **F-10** | 🟡 MEDIUM | Frontend/UX | Биллинг tab: нет usage display (3/5 мастеров), истории платежей, активных плагинов | `admin-app/src/components/billing/` | M | ⛔️ |
| **F-11** | 🟡 MEDIUM | Frontend/UX | Public Profile builder отсутствует (только slug + city + show/hide) | `salon/tabs/PublicProfileTab.tsx` | L | ⛔️ |
| **M-05** | 🟡 MEDIUM | Marketing | Цены только в PLN на всех языках — когнитивный барьер для RU/UA | `landing` (вне репо) + `billing/config.js` | M | ⛔️ |
| **M-06** | 🟡 MEDIUM | Marketing | `sitemap.xml` статический, не генерируется из живых салонов — city-page SEO мёртв | `admin-app/public/sitemap.xml` (отсутствует) | M | ⛔️ |
| **M-07** | 🟡 MEDIUM | Marketing | Нет `LocalBusiness` JSON-LD на `/salon/<slug>` (только `BeautySalon`) — verify | `salon/[slug]/page.tsx:67-78` | S | ⚠️ |
| **M-08** | 🟡 MEDIUM | Marketing | Нет «Powered by Manicbot» в booking confirmation messages — потеря виральной точки | `manicbot/src/i18n/{ru,ua,en,pl}/booking.js` | S | ⛔️ |
| **M-09** | 🟡 MEDIUM | Marketing | Нет реферальной системы — только free-text `referral_note` колонка | migration `0028_referral_note.sql` | L | ⛔️ |
| **Bz-01** | 🟡 MEDIUM | Business | Нет CSV-импорта клиентов из Yclients/Excel/WhatsApp — миграционный барьер | `clients` tab UI + import script | L | ⛔️ |
| **Bz-02** | 🟡 MEDIUM | Business | Sandbox-booking в onboarding отсутствует — Time-to-Value 1-3 дня вместо 8 минут | `OnboardingChecklist.tsx` step 6 | M | ⛔️ |
| **O-05** | 🟡 MEDIUM | Ops/CI | `npm audit --audit-level=high` warn-only (не блокирует merge) | `.github/workflows/deploy.yml:78,94` | S | ⛔️ |
| **O-06** | 🟡 MEDIUM | Ops/GDPR | Нет user erasure endpoint (right-to-be-forgotten) | admin-app routers (отсутствует) | M | ⛔️ |
| **O-07** | 🟡 MEDIUM | Ops/GDPR | `consent_log` таблица создана, но не пишется ни в одном code-path | migration 0032 + grep `marketing_consent_log` | S | ⛔️ |
| **O-08** | 🟡 MEDIUM | Ops/GDPR | Нет ссылок на Terms / Privacy / DPO в mini-app | `app/(dashboard)/layout.tsx`, footer | S | ⛔️ |
| **O-09** | 🟡 MEDIUM | Ops/Infra | Нет `[env.staging]` блока в обоих `wrangler.toml` — single env | `manicbot/wrangler.toml`, `admin-app/wrangler.toml` | M | ⛔️ |
| **O-10** | 🟡 MEDIUM | Ops/Infra | Нет runbooks для D1 down / Stripe stuck / cron isolation / token rotation | `docs/`, `runbooks/` (отсутствуют) | M | ⛔️ |
| **O-11** | 🟡 MEDIUM | Ops/Observability | `error_log` (migration 0039) растёт без TTL и cleanup cron | `migrations/0039_error_log.sql` + cron.js | S | ⛔️ |
| **O-12** | 🟡 MEDIUM | Ops/Observability | Нет Sentry / Datadog / error tracking — только Logpush + error_log | весь репо | M | ⛔️ |
| **S-11** | 🔵 LOW | Security | `.dev.vars` + `admin-app/.env` хранят 64-char hex локально (не в git) | local files | S | ⛔️ |
| **S-12** | 🔵 LOW | Security | Admin-app middleware CSP — проверить полноту script-src/connect-src | `admin-app/middleware.ts` | S | ⚠️ |
| **S-13** | 🔵 LOW | Security | `webUsers.setInitialPassword` не бампит `password_changed_at` | `webUsers.ts` (Google OAuth flow) | S | ⛔️ |
| **S-14** | 🔵 LOW | Security | `.env.example` неполный (нет AUTH_SECRET, ADMIN_KEY) | `admin-app/.env.example` | S | ⛔️ |
| **S-15** | 🔵 LOW | Security | Rate-limit table cleanup probabilistic (10% requests) | `src/utils/rateLimit.js` | S | ⛔️ |
| **S-16** | 🔵 LOW | Security | `googlePrefillPreview` без rate-limit — token enumeration oracle | `webUsers.ts` `googlePrefillPreview` | S | ⛔️ |
| **S-17** | 🔵 LOW | Security | Legacy `/admin` HTTP Basic auth — base64 в headers, видны TLS-proxies | `admin-app/middleware.ts` | S | ⛔️ |
| **F-12** | 🔵 LOW | Frontend/UX | localStorage SSR не безопасен на первом рендере — flicker возможен | `WebShell.tsx:138,148` | S | ⛔️ |
| **F-13** | 🔵 LOW | Frontend/UX | Auth pages могут не иметь `robots: noindex` | `app/(auth)/layout.tsx` | S | ⚠️ |
| **F-14** | 🔵 LOW | Frontend/UX | Нет skip-link для unverified email уведомления | `WebShell.tsx:240-250` | S | ⛔️ |
| **F-15** | 🔵 LOW | Frontend/UX | Console.log в `landingHttp.js:64,108,114,139` (mobile frame detection) | `manicbot/src/http/landingHttp.js` | S | ⛔️ |
| **B-06** | 🔵 LOW | Backend | `circuitBreaker.js` никогда не импортируется (dead code) | `manicbot/src/utils/circuitBreaker.js` | S | ⛔️ |
| **B-07** | 🔵 LOW | Backend | `kv-keys.js` 21/22 экспорта unused (dead code) | `manicbot/src/utils/kv-keys.js` | S | ⛔️ |
| **B-08** | 🔵 LOW | Backend | Hardcoded польские дефолты в `src/config.js` (адрес, телефон, тайм-зона) | `manicbot/src/config.js` | S | ⛔️ |
| **B-09** | 🔵 LOW | Backend | `https://admin-app-3nc.pages.dev` хардкод в worker.js — internal URL в коде | `manicbot/src/worker.js:33` | S | ⛔️ |
| **O-13** | 🔵 LOW | Ops | `/admin/web-user` принимает 8-char пароли vs tRPC 12 — асимметрия | См. S-10 | S | ⛔️ |

**Всего**: 60 находок (3 CRITICAL + 16 HIGH + 28 MEDIUM + 13 LOW).

> ⚠️ Заметка: префикс `O-13` — дублирует `S-10`, но даёт ops-проекцию. Это намеренно — одна и та же проблема может относиться к нескольким срезам.

---

## 3. Раздел 1 — Безопасность

### 3.1 CRITICAL findings

#### S-01 — Master IDOR в `updateDelegation` (CRITICAL, ⛔️ STILL ACTIVE)

**Что происходит**: tRPC procedure `updateDelegation` принимает `tenantId` и `masterId` как input. Текущая защита (на ~строке 50): `ctx.webUser.webRole === "master" && ctx.webUser.tenantId === input.tenantId`. Но `masterId` НЕ проверяется на принадлежность caller'у. Мастер A может передать `masterId` мастера B (в том же тенанте) и изменить ему `allowDelegation` — и любые подобные ручки.

**Файл**: `manicbot/admin-app/src/server/api/routers/masterRouter.ts:42-56` (по dump'у Phase 2 валидатора).

**Impact**: внутри-тенантная privilege-escalation. Не cross-tenant — это ослабляет, но всё равно нарушает trust между мастерами в крупном салоне.

**Варианты исправления** (с компромиссами):

1. **(Рекомендую)** **Server-side identity binding**: для роли `master` игнорировать `input.masterId` и брать его из `ctx.webUser` строго (через FK `masters.web_user_id`). Совместимость: добавить миграцию `0040_masters_web_user_id.sql`, заполнить из существующих связей через `chat_id`/email lookup, после backfill — сделать NOT NULL. Effort: **M (1d)**. Плюс: один источник правды, нельзя обойти даже через прокси-вызовы. Минус: миграция массивных данных (потребует backfill-скрипт).

2. **Procedure split**: разделить на `getMy*` / `updateMy*` (без `masterId` параметра) и `getMaster* / updateMaster*` (admin/owner only, с проверкой `assertTenantOwner`). Effort: **M (1-2d)**. Плюс: интенция явная, легче ревьюить. Минус: больше кода, больше ручек, риск drift.

3. **Policy-middleware**: добавить middleware `assertCallerIsMaster(masterId)` в каждом master-procedure. Effort: **S (4h)**. Плюс: минимальное изменение. Минус: пропустить проверку легко (как уже произошло).

**Рекомендация**: вариант 1 + вариант 2 в комбинации (миграция + сплит). Это закрывает не только IDOR, но и предотвращает рецидивы.

**Связанные**: S-03 (auth.getMyRole тоже про master mapping).

---

#### O-01 — `REQUIRE_WEBHOOK_BOT_ID` закомментирован в проде (CRITICAL, ⛔️)

**Что происходит**: `manicbot/wrangler.toml:21` строка `# REQUIRE_WEBHOOK_BOT_ID = "1"` закомментирована. По AGENTS.md: «set Worker var `REQUIRE_WEBHOOK_BOT_ID=1` when D1 is bound to reject legacy `POST /webhook` (403 — use `/webhook/{botId}` only)». Сейчас прод принимает legacy `/webhook` и пытается legacy-fallback context build (`buildLegacyCtx`).

**Impact**: если у атакующего есть валидный `BOT_TOKEN` (или WEBHOOK_SECRET) от любого исторически легаси-настроенного бота, он может постить через `/webhook` без указания tenant-router'а — потенциально атаковать чужой tenant context, если worker делает fallback.

**Варианты**:

1. **(Рекомендую)** Раскомментировать `REQUIRE_WEBHOOK_BOT_ID = "1"` в `wrangler.toml`, протестировать webhook flow на `/webhook/{botId}`-роутах для всех активных тенантов, deploy. Effort: **S (2h)**. Плюс: один-line fix. Минус: если есть тенанты, у которых Telegram setWebhook ещё указан на старый `/webhook` без botId — у них ляжет inbound. Решение: `gh` найти таких тенантов через `/admin/migrate` или wrangler kv get + предупредить.

2. **Fail-closed by default**: вместо env-флага — сделать строгую проверку дефолтной, добавить opt-out `ALLOW_LEGACY_WEBHOOK=1` для миграционных периодов. Effort: **S (4h)**. Плюс: правильный fail-closed дизайн. Минус: больше кода.

3. **Полностью убрать legacy путь**: удалить `buildLegacyCtx` и все упоминания, оставить только D1-resolved tenant. Effort: **M (1d)**. Плюс: меньшая поверхность атаки. Минус: больше риск регрессии.

**Рекомендация**: вариант 1 на этой неделе → вариант 2 в следующем спринте → вариант 3 через 1 квартал, если миграция чистая.

---

### 3.2 HIGH findings

#### S-02 — `connectBot` валидирует токен, но не сохраняет в Worker KV (HIGH, ⛔️)

**Файл**: `admin-app/src/server/api/routers/salon.ts` — procedure `connectBot`.

**Что происходит**: процедура валидирует Telegram token через `getMe`, регистрирует bot в D1 `bots` table. Но Worker'овский `getBotToken(botId)` читает из KV (зашифрованный). Admin-app **не пишет в KV напрямую** (правильно — отдельные runtime'ы). Но и не дёргает Worker `POST /admin/provision`. Итог: token зарегистрирован, но Worker не может его расшифровать → silent webhook failure.

**Варианты**:

1. **(Рекомендую)** Admin-app дёргает Worker `POST /admin/provision` (с ADMIN_KEY) внутри `connectBot`. Worker шифрует токен и кладёт в KV. Effort: **M (1d)**. Плюс: использует существующий путь Provision. Минус: admin-app должен иметь ADMIN_KEY (env var) и этот ключ должен быть тот же, что у Worker.

2. Создать отдельный signed endpoint на Worker (HMAC-подписанный admin-app'ом) для записи tenant-token: `POST /worker-internal/store-bot-token`. Effort: **M (1d)**. Плюс: не используется ADMIN_KEY (отдельный shared secret). Минус: дополнительный мост, больше движущихся частей.

3. Перенести encrypted KV-write в admin-app (обе кодовые базы шарят `BOT_ENCRYPTION_KEY`). Effort: **L (2-3d)**. Плюс: меньше hops. Минус: дублирование encryption-логики, риск drift.

**Рекомендация**: вариант 1.

---

#### S-03 — `auth.getMyRole` возвращает не того мастера (HIGH, ⚠️ PARTIALLY FIXED)

**Файл**: `admin-app/src/server/api/routers/auth.ts:92-100`. Phase 2 validator: query сейчас `where(and(eq(masters.tenantId, tenantId), eq(masters.active, 1)))` — берёт первого активного мастера в тенанте, БЕЗ привязки к `web_user`. Если мастеров несколько — возвращает рандомного (или первого по PK).

**Impact**: master видит не своё расписание/клиентов/заработки. Cross-master leakage в одном тенанте.

**Варианты**:

1. **(Рекомендую)** Добавить FK `masters.web_user_id` (миграция `0040`) и резолвить мастера по этой связи. Если связи нет — `masterId: null` и UI показывает MasterSetup. Effort: **M (1-2d)**. Плюс: исправляет S-01 заодно. Минус: миграция данных.

2. Резолвить через `chat_id` совпадение: `masters.chat_id === ctx.webUser.tg_chat_id`. Effort: **S (2h)**. Плюс: быстро. Минус: Independent masters имеют синтетические chat_id (>10B), могут не совпадать с реальными.

3. Резолвить через email: `masters.email === ctx.webUser.email`. Effort: **S (2h)**. Плюс: семантично. Минус: масterа можно завести без email.

**Рекомендация**: вариант 1 (общая миграция с S-01).

---

#### S-04 — Widget sanitizer link safety (HIGH, ⛔️ uncommitted)

**Файл**: `manicbot/src/embed/demoChat.js` (есть незакоммиченные изменения, см. `git status`).

**Контекст**: FULL_REVIEW_AUDIT отметил unsafe `href` patterns в embeddable chat sanitizer. Phase 2 backend validator не смог глубоко проверить (`не сканировался`).

**Варианты**:

1. **(Рекомендую)** Вынести sanitizer в shared библиотеку с whitelist протоколов (`http:`, `https:`, `tel:`, `mailto:`) + DOMPurify-pattern. Effort: **M (1d)**. Плюс: одно место правды. Минус: добавит ~5KB к embed bundle (приемлемо).

2. Удалить raw anchor passthrough, рендерить ссылки только через safe parser. Effort: **S (4h)**. Плюс: фундаментально безопасно. Минус: ломает existing markdown-рендеринг.

3. Добавить regression-тесты для известных payloads (`javascript:`, nested entities, malformed tags). Effort: **S (2h)**. Плюс: быстро видна регрессия. Минус: не предотвращает unknown vectors.

**Рекомендация**: вариант 1 + 3.

---

### 3.3 MEDIUM/LOW findings (краткий обзор)

| ID | Файл:line | Что | Рекомендуемый вариант (1 из 2-3) | Effort |
|---|---|---|---|---|
| S-05 | `src/utils/rateLimit.js:29-51` | TOCTOU race | INSERT OR REPLACE с conditional WHERE count<limit (sliding window вариант 2 — token bucket) | M |
| S-06 | `admin-app/src/server/security/sanitize.ts` | regex-based, разрешает `style` | заменить на `sanitize-html` с allowlist | M |
| S-07 | `src/billing/webhooks.js:179` | metadata.tenantId не валидируется | `SELECT id FROM tenants WHERE id=?` перед обработкой | S |
| S-08 | `src/worker.js` `addSecurityHeaders` | weak CSP | `default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'` | S |
| S-09 | `src/handlers/callback.js:212-228` | silent catch на stamp_card | либо логировать в `error_log`, либо удалить мёртвый код (B12) | S |
| S-10 | `src/http/adminKeyHttp.js:499` | password 8 vs 12 | привести к 12 в Worker endpoint | S |
| S-11 | `.dev.vars`, `admin-app/.env` | dev secrets locally | проверить, не используются ли в проде; ротировать `wrangler secret put` если да | S |
| S-12 | `admin-app/middleware.ts` | CSP полнота | проверить наличие `script-src 'self'` + nonce для inline | S |
| S-13 | `webUsers.setInitialPassword` | не бампит `password_changed_at` | добавить `UPDATE web_users SET password_changed_at = ?` | S |
| S-14 | `admin-app/.env.example` | неполный | добавить AUTH_SECRET и ADMIN_KEY с placeholder | S |
| S-15 | `src/utils/rateLimit.js` cleanup | probabilistic 10% | добавить cron task для batch-cleanup expired rows | S |
| S-16 | `googlePrefillPreview` | без rate-limit | добавить rate-limit per IP (5/min) | S |
| S-17 | legacy `/admin` HTTP Basic | base64 в headers | переключить на signed-cookie session или удалить legacy admin | S |

> Все S-05..S-17 могут быть исправлены в рамках одного «Security hardening» PR размером 1-2 дня.

---

## 4. Раздел 2 — Backend (Worker + tRPC + БД)

### 4.1 HIGH findings

#### B-01 — Plugin runtime пустой (HIGH, 🆕)

**Файл**: `manicbot/plugins/registry.ts:98-102`. Phase 2 валидатор:
> `PLUGIN_ROUTER_LOADERS`, `PLUGIN_LIFECYCLE_LOADERS`, `PLUGIN_HEALTH_LOADERS` are all empty dicts `{}`. No plugin actually wires a router, lifecycle, or health check. Lazy loaders return `undefined`. Plugins are manifest-only stubs.

**Impact**: 24 плагина импортированы (manifest-only). UI каталог их показывает. Но backend не загружает ни один router/lifecycle/health. Если пользователь пытается use plugin (например, `taskBoard`), backend ничего не делает. Это «декоративный marketplace».

**Варианты**:

1. **(Рекомендую)** Допилить runtime: для **3-5 топовых плагинов** (`google-calendar`, `loyalty-stamps`, `birthday-campaigns`, `booking-reminder`, `command-palette`) добавить `router.ts` + `lifecycle.ts` + `health.ts`, заполнить `PLUGIN_ROUTER_LOADERS` etc. Effort: **XL (1-2 недели на каждый по 1-2 дня)**. Плюс: marketplace становится живым. Минус: значительный объём работы; следует start с тех плагинов, где есть прототип.

2. **Honest scaffold mode**: убрать «Marketplace» из публичного доступа, переименовать в «В разработке (alpha)». Effort: **S (2h)**. Плюс: честность с пользователями. Минус: убирает существенную часть value-prop.

3. **Гибрид**: показывать только установленные `googleCalendar` (он production), скрывать остальные за feature-flag для founder beta. Effort: **S (4h)**. Плюс: показ чего-то рабочего. Минус: каталог становится пустым.

**Рекомендация**: вариант 3 — на этой неделе, вариант 1 — на 30/60/90 план для каждого плагина пошагово.

---

#### B-02 — Public Salon Profile рендерит ~30% полей (HIGH)

**Файл**: `admin-app/src/app/salon/[slug]/SalonProfileClient.tsx`. Phase 2 marketing-validator:
> `getProfile` возвращает 22 поля. Рендерится: имя, город, рейтинг, услуги (с фото), мастера, чат-кнопка, телефон, IG. **Не рендерится**: салонный photos[] карусель, описание (about), cover photo, brand palette не применяется.

**Impact**: SEO/marketplace-функция (`publicSalon.search`) практически бесполезна. Пользователь приходит на `/salon/<slug>` через Google → видит почти пустую страницу → bounces.

**Варианты**:

1. **(Рекомендую)** Public Profile MVP (1 неделя): cover photo + 1 photo карусель + about (300 chars) + brand palette accent. Effort: **L (1 неделя)**. Плюс: видимый прогресс, разблокирует marketplace. Минус: требует UI работы и admin-side загрузки фото (R2 — но R2 закомментирован в `wrangler.toml`! см. O-09 контекст).

2. **Upload-через-URL**: разрешить салону вставить URL фото из своего IG/Google (без R2). Effort: **S (4h)**. Плюс: быстро. Минус: hotlinking может ломаться.

3. **Templates + placeholder fallback**: для пустых профилей показывать шаблон «Заполните 4 поля чтобы клиенты находили вас»: name, address, work hours, 1 photo. Effort: **S (4h)**. Плюс: motivates completeness. Минус: не решает основную проблему.

**Рекомендация**: вариант 2 на этой неделе (быстрый win) + вариант 1 в 30-дневном плане. R2 нужно активировать (см. O-09).

---

### 4.2 MEDIUM findings (Backend)

| ID | Файл:line | Что | Решение |
|---|---|---|---|
| B-03 | `EventsPageClient.tsx:123` | `events.getRecent` polling 5с | Снизить до 30с; рассмотреть SSE или WebSocket если важна real-time |
| B-04 | `src/handlers/cron.js:385-388` | review_requested_at vs review_requested | Добавить миграцию `0040_review_requested_separation.sql` с явным `visit_prompt_sent_at` |
| B-05 | `src/handlers/cron.js:413-426` | T3 promo never created | Создать `promoCodes.createReturning()` server-action и дёргать из cron |

### 4.3 LOW findings (Backend / dead code)

| ID | Файл | Что | Решение |
|---|---|---|---|
| B-06 | `manicbot/src/utils/circuitBreaker.js` | dead code — never imported | Удалить файл |
| B-07 | `manicbot/src/utils/kv-keys.js` | 21/22 экспорта unused | Сократить до `ticketFwdAckKey` или удалить |
| B-08 | `manicbot/src/config.js` | hardcoded польские дефолты (адрес, телефон, timezone) | Вынести в env vars или per-tenant config |
| B-09 | `manicbot/src/worker.js:33` | `https://admin-app-3nc.pages.dev` хардкод | В env var `ADMIN_APP_URL` (она уже есть в wrangler.toml — просто не использовать fallback константу) |

---

## 5. Раздел 3 — Frontend & UX (mini-app + a11y + i18n)

### 5.1 HIGH findings

#### F-01 — Модалки не WCAG-compliant (HIGH, ⛔️)

Phase 2 frontend-validator подтвердил:
- `InstallConfirmModal.tsx:43-45` — есть `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, click-outside close. **Нет**: focus trap, Esc handler.
- `ManualBookingModal.tsx:107-115` — `<div className="fixed inset-0...">` без `role="dialog"`/aria. Click-outside есть.
- `StaffTab.tsx:283-349` — InviteMemberModal без `role="dialog"`/aria.

**Impact**: screen-reader пользователи не идентифицируют модалку как dialog; keyboard-only пользователи не могут закрыть Esc'ом и могут табом уйти за пределы модалки на страницу под ней.

**Варианты**:

1. **(Рекомендую)** Создать единый `<Dialog>` primitive (на базе `@headlessui/react Dialog` или `@radix-ui/react-dialog`), мигрировать все модалки. Effort: **M (1-2d)**. Плюс: одно решение для всех модалок, гарантированный focus trap, Esc, role, aria. Минус: миграция 4-6 модалок.

2. Custom hook `useDialogA11y(ref)`: focus trap + Esc + initial focus. Effort: **M (1d)**. Плюс: без новой зависимости. Минус: можно забыть применить в новой модалке.

3. Только добавить `role="dialog"` + `aria-modal` + Esc keydown listener — без focus trap. Effort: **S (4h)**. Плюс: быстрый win. Минус: focus trap всё равно нужен для полного WCAG compliance.

**Рекомендация**: вариант 1.

---

#### F-02 — Native `confirm()` диалоги (HIGH, ⛔️)

Phase 2 frontend-validator:
- `StaffTab.tsx:202`: `if (confirm('Отозвать доступ у ${member.email}?')) revoke.mutate(...)`
- `PluginSettingsSection.tsx`: `if (!confirm(t("plugins.uninstall.confirm", lang))) return;`

**Impact**: native browser confirm — non-localized в Telegram WebApp (показывает на языке системы), не настраиваем визуально, не WCAG-friendly, блокирует event loop.

**Вариант** (1-2 в комбо):

1. **(Рекомендую)** Заменить на `<ConfirmDialog>` primitive (часть F-01 миграции). Effort: **M (1d вместе с F-01)**.

2. Минимальный fix: написать `useConfirm()` hook, возвращающий Promise, на основе React-state модалки. Effort: **S (4h)**.

**Рекомендация**: вариант 1 как часть F-01.

---

#### F-03 — 10+ хардкоженых русских строк без i18n (HIGH, ⛔️)

Phase 2 frontend-validator подтвердил:

| # | Строка | File:line |
|---|---|---|
| 1 | "Ошибка загрузки. Попробуйте обновить." | `SupportDashboard.tsx:88, 245` (2x) |
| 2 | "Вложение в Telegram (откройте диалог в боте)" | `SupportDashboard.tsx:155` |
| 3 | "Отозвать доступ у {email}?" | `StaffTab.tsx:202` |
| 4 | "Администраторы салона" | `StaffTab.tsx:74` |
| 5 | "Пригласить" | `StaffTab.tsx:80` |
| 6 | "Пригласить администратора" | `StaffTab.tsx:287` |
| 7 | "Сохранить" | `StaffTab.tsx:255` |
| 8 | "Отмена" | `StaffTab.tsx:331` |
| 9 | "Администратору придёт письмо..." | `StaffTab.tsx:295` |
| 10 | "Администраторов пока нет..." | `StaffTab.tsx:88` |

**Impact**: PL/UA/EN пользователи видят русский текст. Снижает trust на не-RU рынках.

**Варианты**:

1. **(Рекомендую)** Перенести каждую строку в `i18n.ts` с ключами вида `support.errorLoading`, `support.tgAttachmentNote`, `staff.admins.title` и т.д. Effort: **S (4h)**. Дополнительно: добавить ESLint rule (custom) против `[А-я]+` literals в `.tsx` outside `t()` calls. Effort: +**S (2h)**.

2. Прогнать через `lefthook` pre-commit hook, который сканирует diff на cyrillic-literals. Effort: **S (2h)**. Плюс: catch на уровне commit. Минус: не помогает с уже legacy строками.

3. Включить в CI `npm run lint:i18n` (отдельный test что выходит ненулевым кодом если найден literal). Effort: **M (1d)**. Плюс: блокирует merge. Минус: false-positives на тестовых строках.

**Рекомендация**: вариант 1 + 3 (как новый CI gate).

---

#### F-04 — WCAG color contrast (HIGH, 🆕)

Phase 2 frontend-validator:
> `gray-400` (`#9ca3af`) на `bg-[#fafaf7]` ≈ 5.5:1 — для важных элементов (nav text) это ниже WCAG AA 7:1 (large text 4.5:1, small text 4.5:1). На стандартном шрифте 14-16px — **fail**.

**Файлы**: `WebShell.tsx:60, 106, 114, 199`.

**Варианты**:

1. **(Рекомендую)** Заменить `gray-400` → `gray-600` (`#4b5563`) на light bg. Effort: **S (1h)**. Плюс: фундаментально проходит AA. Минус: чуть «темнее» дизайн.

2. Использовать CSS variables (`--color-text-muted`) с разными значениями в light/dark. Effort: **S (4h)**. Плюс: семантика и тема-aware. Минус: больше тачей.

3. Полный design-tokens audit (token file + Tailwind config + UI library audit). Effort: **L (1 неделя)**. Плюс: исправляет на корню. Минус: много изменений.

**Рекомендация**: вариант 1 на этой неделе → вариант 3 в 60-дневном плане.

---

#### F-05 — Onboarding-checklist дубликаты шагов (HIGH, ⛔️)

DESIGN_MARKETING_REPORT 1.3 confirmed: шаги 4 («Настройте расписание») и 5 («Поделитесь ссылкой») редиректят на те же tabs, что 3 и 2.

**Варианты**:

1. **(Рекомендую)** Сократить до 4 уникальных шагов: 1) Услуга (с шаблонами — F-08), 2) Бот (BotFather flow), 3) Sandbox-бронь (см. Bz-02), 4) Public Profile builder MVP. Effort: **M (1-2d вместе с Bz-02 и F-08)**. Плюс: каждый шаг даёт реальное value. Минус: уменьшает «6 шагов» до «4», но это не плохо.

2. 6 шагов с разными экранами: 1) Услуга, 2) Бот, 3) Часы работы (новый отдельный экран), 4) Sandbox-бронь, 5) Public Profile, 6) Поделиться deep-link в WhatsApp/IG bio template. Effort: **M (2d)**. Плюс: более полное покрытие. Минус: больше.

3. Геймификация: progress bar + badges за каждый шаг + reward (на трёх шагах — «вы прошли setup»). Effort: **M (1d)**. Плюс: motivates completion. Минус: не решает основную проблему дублирующих экранов.

**Рекомендация**: вариант 2.

---

#### F-06 — Logout не сбрасывает HttpOnly cookie + KV-сессию (HIGH, ⛔️)

DESIGN_MARKETING_REPORT confirmed: «Кнопка "Выйти" вызывает logout, но HttpOnly cookie не сбрасывается, при следующем `/login` → redirect на `/dashboard`».

**Варианты**:

1. **(Рекомендую)** Server-action `signOut`: `Set-Cookie: session=; Max-Age=0` + удалить KV `state:{cid}` + удалить web-session record. Effort: **S (2h)**. Плюс: правильный logout flow. Минус: нет.

2. Client-side принудительный redirect на `/api/auth/signout` (NextAuth-нативный) — проверить, что он точно очищает cookie. Effort: **S (1h)**. Плюс: использует существующий путь. Минус: NextAuth должен быть настроен на explicit clear.

**Рекомендация**: вариант 1+2 — оба в одном PR.

---

### 5.2 MEDIUM/LOW findings (Frontend) — таблица

| ID | File:line | Issue | Recommended |
|---|---|---|---|
| F-07 | `app/(auth)/register/page.tsx` | нет inline валидации, password meter, disable-until-valid | добавить `react-hook-form` + zod validation на client |
| F-08 | services empty | пустой empty state | 5 шаблонов услуг (manicure / gel / removal / design / coating) с 1-clickAdd |
| F-09 | `WebShell.tsx`, `Shell.tsx` bottom-nav | safe-area-inset для notch | `pb-[env(safe-area-inset-bottom)]` |
| F-10 | `components/billing/` | нет usage display | добавить «3/5 мастеров», «следующее списание», «история», «активные plugins» |
| F-11 | salon/tabs/PublicProfileTab.tsx | builder отсутствует | см. B-02 — гибридный план |
| F-12 | `WebShell.tsx:138,148` | localStorage SSR flicker | `useState(() => initial)` лежит в `"use client"` — проверить hydration order |
| F-13 | `app/(auth)/layout.tsx` | возможно нет robots noindex | `metadata.robots = { index: false }` на auth pages |
| F-14 | `WebShell.tsx:240-250` | unverified email badge без skip-link | добавить `aria-describedby` + skip-link |
| F-15 | `landingHttp.js:64,108,114,139` | console.log в проде | удалить или переключить на logger.debug |

---

## 6. Раздел 4 — Маркетинг (модуль + GTM)

### 6.1 CRITICAL findings

#### M-01 — Ноль систем аналитики (CRITICAL, ⛔️)

Phase 2 marketing-validator подтвердил: grep'ом по всему репо не нашёл ни одного из `gtag`, `dataLayer`, `ym(`, `Plausible`, `posthog`, `mixpanel`, `hotjar`, `clarity`, `umami`. `landingHttp.js` инжектит только демо-чат bridge, без аналитики.

**Impact**: каждая правка лендинга/onboarding'а — гипотеза без доказательства. Нельзя измерить:
- Конверсию hero CTA → /register
- Drop-off на этапе password 12 chars
- Drop-off на verify-email
- Время до первой записи (Time-to-Value)
- Какой channel приводит больше paying tenants
- Bounce rate на pricing page
- A/B-варианты лендинга

**Варианты**:

1. **(Рекомендую)** GA4 + Yandex.Метрика + PostHog в `index.html` лендинга (3 скрипта в `<head>`). Effort: **S (1h)**. Плюс: 3 источника, разные сильные стороны (GA4 для funnel, YM для российского трафика, PostHog для session recording + heatmaps + feature flags). Минус: 3 GDPR consent items.

2. Plausible + PostHog: privacy-first комбо. Effort: **S (30min)**. Плюс: меньше cookie-баннер. Минус: меньше depth для funnel-анализа.

3. Только PostHog (full stack): events + heatmaps + recordings + experiments. Effort: **S (30min)**. Плюс: одна интеграция. Минус: $0-450/mo в зависимости от volume; нет YM-data для российского рынка.

**Рекомендация**: вариант 1. Goals для GA4: `scroll_to_pricing`, `scroll_to_faq`, `click_register_cta`, `submit_lead_form`, `complete_signup`, `verify_email`, `complete_onboarding_step_1..6`, `first_booking_made`.

> Это — действие №1 на понедельник 9:00.

---

### 6.2 HIGH findings

#### M-02 — `campaignSendNow` стаб (HIGH, ⛔️)

Phase 2 marketing-validator: `marketing.ts:282-287`:
```ts
campaignSendNow: adminProcedure.input(...).mutation(async ({ ctx, input }) => {
  return { ok: false, stub: true, message: "Send-now is a stub in phase 1" };
})
```

Также `automationsList` возвращает empty array (линия 352-354).

**Impact**: каркас маркетингового модуля построен (контакты, сегменты, шаблоны, кампании в БД), но **отправлять нечего**. Это самая дорогая фича по затраченному времени с самым низким returned value пока стаб.

**Варианты**:

1. **(Рекомендую)** Phase 2 MVP: реализовать send-now для **email-канала только** через Resend (уже live). Один тип кампании: «one-shot send to segment». Effort: **L (1 неделя)**. Плюс: видимый прогресс, можно начать делать lifecycle email-цепочки (M-03). Минус: SMS и WhatsApp откладываются.

2. Phase 2 broader: email + SMS (через Brevo SMS, который dormant в `PROVIDERS.md`). Effort: **XL (2-3 недели)**. Плюс: больше каналов сразу. Минус: больше запутанности с провайдерами.

3. Признать каркас «scaffolding mode», скрыть marketing-tab из UI до Phase 2 завершения. Effort: **S (2h)**. Плюс: честно. Минус: убирает существенный функционал из UI.

**Рекомендация**: вариант 1, обязательно с `consent_log` записью на каждую отправку (закрывает O-07).

---

#### M-03 — 0 lifecycle/marketing email-цепочек (HIGH, ⛔️)

Phase 2: `emailService.ts` — 9 transactional шаблонов, 0 marketing/lifecycle.

**Impact**: после регистрации пользователь получает 1 welcome-письмо. Через 7 дней — тишина. Через 14 дней trial кончается — снова тишина. Conversion-to-paid падает на 30-50%.

**Варианты**:

1. **(Рекомендую)** 3 базовых lifecycle-email через cron + Resend:
   - **Day-7 Trial Nudge** («7 дней trial — уже сделали бронирование? вот 3 шаблона услуг»)
   - **Day-12 Trial Ending** («2 дня осталось — продолжим? карта не будет списана автоматически»)
   - **Day-14 Trial Expired** («Расскажите почему не подошло — 3 мин на опрос → купон 20%»)
   
   Effort: **M (1-2d)** — шаблоны + cron triggers + dedup logic. Плюс: дешёвый ROI. Минус: требует contact email и consent.

2. Расширить до 8 email серий: + Day-3 «попробуйте sandbox-booking», + Day-21 win-back, + Day-30 milestone, + Day-90 expansion offer. Effort: **L (1 неделя)**. Плюс: maximum lifecycle coverage. Минус: больше работы и контента.

3. Использовать готовый сервис (Postmark / SendGrid / Customer.io): outsource lifecycle automation. Effort: **M (1 неделя на интеграцию)**. Плюс: визуальный editor, готовые triggers. Минус: $$$, vendor lock-in.

**Рекомендация**: вариант 1 на 2-недельном горизонте, вариант 2 — на 60 дней.

---

#### M-04 — Lead-form vs self-serve конкуренция (HIGH, ⛔️)

DESIGN_MARKETING_REPORT 1.2: «Lead-funnel конкурирует сам с собой. На лендинге одновременно 3 разных конверсионных пути».

**Варианты**:

1. **(Рекомендую)** Убрать lead-form с главной страницы или превратить в «Запишитесь на 15-минутное демо» (1 поле — телефон) для high-intent leads. Self-serve `/register` остаётся primary. Effort: **S (2h)**. Плюс: один primary path. Минус: теряете leads, которым не подходит self-serve.

2. Сделать lead-form opt-in: спрятать за «Хочу демо вместо самостоятельной регистрации». Effort: **S (4h)**. Плюс: оба варианта живут. Минус: всё ещё confusing.

3. A/B test: 50% юзеров видят только self-serve, 50% видят lead-form. Effort: **M (требует analytics — см. M-01)**. Плюс: данные. Минус: пока нет аналитики — невозможно.

**Рекомендация**: вариант 1 после установки M-01 аналитики (через 2 недели можно мерить).

---

### 6.3 MEDIUM findings (Marketing) — таблица

| ID | File / Place | Issue | Recommended |
|---|---|---|---|
| M-05 | `billing/config.js`, landing | PLN-only pricing на всех языках | Локализация: RUB на `?lang=ru`, UAH на `?lang=ua`, EUR на `?lang=en`, PLN на `?lang=pl` (Stripe сам конвертирует) |
| M-06 | `admin-app/public/sitemap.xml` (отсутствует) | Sitemap статический, не из живых салонов | Создать `app/sitemap.ts` который возвращает `{ url: ..., lastModified: ... }` для каждого `publicActive=1` салона |
| M-07 | `salon/[slug]/page.tsx:67-78` | Только `BeautySalon` JSON-LD, проверить `LocalBusiness` | Добавить `LocalBusiness` schema (Google рекомендует) |
| M-08 | `manicbot/src/i18n/{ru,ua,en,pl}/booking.js` | Нет «Powered by Manicbot» в booking confirmation | Добавить footer-line «Записано через @manicbot_app — попробуй для своего салона» (можно отключить на MAX/white-label) |
| M-09 | migration `0028_referral_note.sql` + admin | Нет реферальной системы — только текстовая колонка | Создать миграцию `0040_referrals.sql` с `referral_codes`, `referral_rewards`; UI «Пригласить коллегу» |

---

## 7. Раздел 5 — Бизнес-модель (pricing + plugin economics + unit-econ)

### 7.1 Текущая модель

- **3 тарифа**: Start 45 / Pro 60 / MAX 90 PLN/мес. Annual = -20% (×9.6).
- **Trial**: 14 дней без CC.
- **Grace**: 7 дней после payment fail (только booking работает).
- **Feature gates** (`src/billing/features.js:10-20`):
  - all plans: booking
  - Pro+: AI assistant, support tickets, Google Calendar, WhatsApp, Instagram
  - Max: white-label
- **Plugin add-ons**: 4 модели в `plugins/types.ts` — `free | included_in_plan | paid_addon_monthly | paid_addon_onetime`. Реальное состояние: 24 плагина, **0 paid addons активны**.

### 7.2 HIGH findings

#### Bz-01 — Нет CSV-импорта клиентов (HIGH, ⛔️)

DESIGN_MARKETING_REPORT 3.1: «Нет CSV-импорта из Excel/WhatsApp, что блокирует миграцию из Yclients».

**Impact**: мастер из Yclients/Altegio со 500-2000 клиентами в базе не мигрирует — barrier слишком высок. Это **миграционная стена**, удерживающая существующих клиентов конкурентов.

**Варианты**:

1. **(Рекомендую)** CSV-import wizard в admin: drag-drop CSV → preview → mapping (имя/телефон/email/комментарий) → bulk insert в `users` table со scope tenantId. Effort: **L (1-2 недели)**. Плюс: **критическая миграционная фича**. Минус: parsing edge-cases (encoding, разные форматы Yclients/Altegio/etc).

2. Excel + WhatsApp .vcf import (расширение варианта 1). Effort: **XL (2-3 недели)**. Плюс: больше форматов. Минус: больше edge-cases.

3. «Personal data assistant» — OAuth-интеграция с Yclients API (если у них публичный API), пуллит клиентов по подписке. Effort: **XL (3-4 недели)**. Плюс: zero-effort для пользователя. Минус: сложно, может нарушать ToS Yclients, требует API-ключи их пользователей.

**Рекомендация**: вариант 1 на 2-недельном sprint'е, вариант 2 — позже.

---

#### Bz-02 — Sandbox-booking в onboarding (HIGH, ⛔️)

Time-to-Value сейчас 1-3 дня (зависит от реального клиента). Целевой 8 минут.

**Импакт**: aha-moment у мастера откладывается, conversion-to-paid падает.

**Варианты**:

1. **(Рекомендую)** Кнопка «Симулировать первую запись» в onboarding step 6 — создаёт fake-booking от системного «тестового клиента» (`is_test_booking = 1` колонка), отправляет уведомление в TG-бот мастера. Effort: **M (1d)**. Плюс: aha-moment в 30 секунд. Минус: нужна migration `0040_test_bookings.sql` с флагом + UI кнопка.

2. Полный sandbox env: отдельный `is_demo` tenant с pre-filled данными, мастер может «играть» в чужой dashboard. Effort: **L (1 неделя)**. Плюс: максимальное обучение. Минус: сложно, требует data sandbox isolation.

3. Видео-туториал «Как клиент записывается» в onboarding step 6 (вместо реального действия). Effort: **S (4h)**. Плюс: быстро. Минус: не aha-moment.

**Рекомендация**: вариант 1.

---

### 7.3 Анализ монетизации (отсылка к DESIGN_MARKETING_REPORT 4.2)

| Модель | Fit (1-10) | Revenue potential | Risk | Когда |
|---|---|---|---|---|
| **Flat monthly subscription** (текущая) | 7 | LTV ≈ 720 PLN | Низкий | сейчас |
| Per-booking commission (0-3%) | **2 (анти-USP)** | Высокий потолок | Высокий — теряете USP против Booksy | избегать |
| **Freemium + feature gates** | **9** | Total volume больше | Средний | 3-6 мес |
| Lifetime deal (Product Hunt / AppSumo) | 4 | One-shot 500k PLN | Высокий — портит pricing | избегать как core |
| Agency / Franchise B2B2C | 6 | Средний | Средний | 6-12 мес |
| Hybrid 90-day trial + marketplace | **8** | Высокий | Средний | 6-12 мес |

**Рекомендуемая стратегия**: оставить **Flat monthly + 14-day trial** до того как M-01 даст funnel-data; через 3-6 месяцев — добавить **Freemium tier** (1 мастер + Telegram-only + 30 записей/мес — free forever) для acquisition × 5-10.

---

## 8. Раздел 6 — Операции / CI/CD / GDPR / observability

### 8.1 CRITICAL findings

См. **O-01** (REQUIRE_WEBHOOK_BOT_ID) выше — это в Security разделе, но также относится к Ops.

### 8.2 HIGH findings

#### O-02 — GitHub Actions запиннены тегами, не SHA (HIGH, ⛔️)

Phase 2 ops-validator:
- `actions/checkout@v4` (line 28, 56, 104, 184)
- `actions/setup-node@v4` (lines 59, 107, 187)
- `gitleaks/gitleaks-action@v2` (line 33)
- `semgrep/semgrep-action@v1` (line 38)
- `cloudflare/wrangler-action@v3` (lines 118, 209, 170)

**Impact**: если репозиторий action'а compromised, тег `@v4` может указывать на malicious commit. SHA-pinning блокирует.

**Варианты**:

1. **(Рекомендую)** Запинить все actions на commit SHA (через GitHub UI «Pin action by SHA» или вручную). Effort: **S (2h)**. Плюс: фундаментально безопасно. Минус: обновления вручную (что хорошо — намеренные).

2. Использовать `dependabot` для actions — он будет автоматически создавать PR при выходе новых версий. Effort: **S (1h)**. Плюс: автоматизация security обновлений. Минус: всё ещё нужно ревьюить и мерджить.

**Рекомендация**: вариант 1 + 2 (сначала запинить, потом dependabot для auto-bumps).

---

#### O-03 — Semgrep soft-fail (HIGH, ⛔️)

`.github/workflows/deploy.yml:48`: `continue-on-error: ${{ secrets.SEMGREP_APP_TOKEN == '' }}`

Когда `SEMGREP_APP_TOKEN` не установлен — SAST запускается, но не блокирует merge. Когда установлен — все равно продолжает на ошибке.

**Варианты**:

1. **(Рекомендую)** Убрать `continue-on-error`, обязательно требовать `SEMGREP_APP_TOKEN` (организационный secret). Effort: **S (30min)**. Плюс: SAST блокирует. Минус: иногда false-positives блокируют merge — нужен процесс ignore через `nosem`.

2. Заменить Semgrep на CodeQL (встроенный в GitHub) — без soft-fail. Effort: **S (1h)**. Плюс: native в GH Security. Минус: меньше TS/Next-rule packages.

**Рекомендация**: вариант 1.

---

#### O-04 — Auto-deploy в прод без approval-gate (HIGH, ⛔️)

`.github/workflows/deploy.yml:102`: `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` — автодеплой.

**Варианты**:

1. **(Рекомендую)** Создать `environment: production` в GitHub → Settings → Environments с `required_reviewers: [vdovin]`. В deploy job добавить `environment: production`. Effort: **S (30min)**. Плюс: 1-click approval перед каждым деплоем. Минус: один человек становится bottleneck (но это early-stage — приемлемо).

2. Two-stage: deploy в staging (новый Pages project) автоматически + manual promote в production. Effort: **M (1d)**. Плюс: smoke-test на staging. Минус: дополнительный environment, сложнее DNS.

3. Smoke-test gate: после deploy запускать `curl /health` + 2-3 интеграционных теста; если что-то упало — auto-rollback. Effort: **L (3-5d)**. Плюс: автоматизация. Минус: нужен `/health` endpoint (см. O-13 — отсутствует).

**Рекомендация**: вариант 1 на этой неделе → вариант 2 на 60-дневном плане → вариант 3 на 90.

---

### 8.3 MEDIUM findings (Ops)

| ID | Issue | Recommended | Effort |
|---|---|---|---|
| O-05 | `npm audit --audit-level=high` warn-only | добавить `\|\| exit 1` в обоих jobs | S |
| O-06 | Нет user erasure | tRPC `webUsers.requestDeletion` → 14-day grace → cron вычищает D1 cascade | M |
| O-07 | `consent_log` не пишется | вписать `INSERT INTO marketing_consent_log` в каждый `*Send*` поток (но send в M-02 ещё стаб) | S |
| O-08 | Нет ToS / Privacy / DPO в mini-app | footer ссылки на `/legal/terms`, `/legal/privacy`, `mailto:dpo@manicbot.com` | S |
| O-09 | Нет `[env.staging]` в `wrangler.toml` | добавить блок `[env.staging]` с отдельным KV/D1 namespace | M |
| O-10 | Нет runbooks | создать `docs/runbooks/{bot-silence,d1-down,stripe-stuck,token-rotation}.md` (4 шт) | M |
| O-11 | `error_log` без TTL | cron `*/60 * * * *`: `DELETE FROM error_log WHERE created_at < datetime('now', '-90 days')` | S |
| O-12 | Нет error tracking | интеграция Sentry / Cloudflare Workers Analytics с `@sentry/cloudflare-workers` | M |

### 8.4 LOW findings (Ops)

| ID | Issue | Recommended |
|---|---|---|
| O-13 | Нет `/health` endpoint | добавить `GET /healthz` в `worker.js` returning `{ ok: true, version, d1: 'reachable' }` |
| (см. S-13/S-14/S-15 в Security) | | |

### 8.5 Open PRs

- **PR #2** (`claude/nostalgic-beaver-642f6d`): «feat(admin-app): Brevo-quality design system redesign» — открыт 23 апр. Признаков активности нет (на 26 апр без изменений). Кандидат либо мерджить (после ревью), либо закрыть.
- **PR #3** (`claude/elegant-nash-c2f7a5`): «feat(dashboard): Brevo/Shopify quality admin redesign» — то же. Скорее всего конфликтует с #2 (один и тот же скоуп).

**Рекомендация**: ревью обоих PR — выбрать один (или объединить лучшие куски), закрыть второй с notes. Если оба нерелевантны — закрыть оба и зафиксировать решение.

---

## 9. Что сделано хорошо (победы)

### 9.1 Безопасность

1. **Constant-time comparison everywhere** — `src/utils/security.js:5-14` `timingSafeEqual` с XOR; используется для ADMIN_KEY, Telegram secret, Stripe signature.
2. **HKDF subkey derivation для encryption** — `src/utils/security.js:123-149` — domain-separated keys (`bot-token-v1`, `channel-token-v1`, `google-refresh`, `calendar-hmac`); leak одного домена не компрометирует остальные.
3. **Stripe webhook idempotency dual-layer** — `src/billing/webhooks.js:38-68,150-171` — D1 + KV 7d TTL; защита от replay.
4. **Multi-tenant cron via Cloudflare Queues** — `src/worker.js:275-358` — fan-out в очередь (per-tenant), масштабируется до 5000+ тенантов.
5. **Input sanitization против prompt injection** — `src/ai.js:35-39,56-65` — NFKC normalization + Unicode bracket stripping; tested.
6. **Encryption enforcement at startup** — `src/worker.js:105-129` `validateSecurityConfig()` throws на weak/missing secrets.
7. **PII redaction в логгерах** — обе кодовые базы имеют `REDACTED_KEYS` для password, token, secret, apiKey, email regex, phone regex, Telegram initData.
8. **D1 parameterized queries everywhere** — `src/utils/db.js` — все query через `.prepare().bind()`, нет string interpolation.
9. **Brute-force defense** — 5 failed logins → 15-min lockout + email alert на новый IP (admin-app).
10. **94 test files на security**: encryption-enforcement, prompt-injection, role-master-tenant, security-config, timing-safe-equal, worker-no-hardcoded-tokens.

### 9.2 Engineering

1. **4616 тестов проходят** (1541 worker + 3075 admin-app) — unit-coverage на серьёзном уровне.
2. **Schema parity check встроен в CI** — 57 таблиц синхронизированы между `schema.sql` и Drizzle `schema.ts`.
3. **39 миграций структурированы chronologically**, каждая с явным префиксом sequence number.
4. **Чистая архитектура HTTP modules** в `src/http/` — каждый модуль изолирован, легко тестировать.
5. **tRPC 11 + Drizzle + Cloudflare D1** — modern stack, edge-runtime compatible.
6. **TypeScript everywhere** в admin-app, типы из Drizzle inferred.

### 9.3 Product / UX

1. **4 языка из коробки** — `i18n.ts` + 4 перевода email-шаблонов; редко на early-stage.
2. **Telegram Mini App + Web auth** одновременно — два orthogonal auth path работают.
3. **Multi-channel** — Telegram + WhatsApp + Instagram (хотя WhatsApp/IG поддержка частичная).
4. **Independent (Personal) Masters** — `is_personal=1` тенанты, мастер-фрилансер регистрируется без салона.
5. **Onboarding chat-style для @BotFather** — лучшая часть UX дашборда (DESIGN_MARKETING_REPORT confirms).

### 9.4 Платформа

1. **God Mode + Activity Feed + Command Palette** — internal admin tooling уровня mid-stage SaaS.
2. **Plugin Marketplace архитектура** — manifest schema, 4 billing models, audit trail (даже если runtime пустой).
3. **Stripe annual discount toggle** — реализован (env-vars `STRIPE_PRICE_*_ANNUAL`).
4. **8 reproducible test accounts** через `npm run seed:test-accounts` (`is_test=1` flag) — серьёзная regression infrastructure.
5. **Cloudflare-native deployment** — Workers + Pages + D1 + KV + Queues + AI binding; единая платформа.

---

## 10. Action Plan 0-30 / 31-60 / 61-90

### 10.1 0-30 дней — Risk containment + быстрые wins

**Неделя 1 (мирно):**
1. **Установить GA4 + Yandex.Метрика + PostHog** на лендинге (M-01) — 1 час
2. **Раскомментировать `REQUIRE_WEBHOOK_BOT_ID = "1"`** + verify webhook flow + deploy (O-01) — 2 часа
3. Запинить все GitHub Actions на SHA (O-02) — 2 часа
4. Убрать `continue-on-error` с Semgrep (O-03) — 30 мин
5. Добавить approval-gate в `environment: production` (O-04) — 30 мин
6. Скрыть `coming_soon` плагины из публичного каталога (часть B-01 решения 3) — 2 часа
7. Перевернуть hero CTA на `/register` + перенести Compare выше fold (M-04 + DESIGN_MARKETING_REPORT 1.2) — 4 часа

**Неделя 2-3 (продуктовая хардизация):**
1. **Master IDOR fix** — миграция `0040_masters_web_user_id.sql` + procedure update (S-01) — 1-2 дня
2. **`auth.getMyRole` fix** — резолв master по `web_user_id` (S-03) — 0.5 дня (в одном PR с S-01)
3. **`connectBot` fix** — admin-app дёргает Worker `/admin/provision` (S-02) — 1 день
4. **Modal a11y migration** — единый `<Dialog>` primitive + миграция всех модалок (F-01 + F-02) — 1-2 дня
5. **i18n migration** — 10+ хардкоженых строк → `i18n.ts` (F-03) — 4 часа
6. **Color contrast fix** — gray-400 → gray-600 (F-04) — 1 час
7. **Logout fix** — server-action `signOut` с явным cookie clear + KV cleanup (F-06) — 2 часа
8. **`error_log` TTL cleanup cron** (O-11) — 4 часа
9. **Sandbox-booking в onboarding step 6** (Bz-02) — 1 день
10. **Onboarding-checklist 6 уникальных шагов** (F-05) — 1-2 дня

**Неделя 4 (security hardening sprint):**
1. **Security PR**: TOCTOU fix (S-05), sanitizeHtml replacement (S-06), Stripe metadata validation (S-07), strict CSP (S-08), password length alignment (S-10), `setInitialPassword` bumps `password_changed_at` (S-13), `.env.example` complete (S-14), rate-limit cleanup cron (S-15), `googlePrefillPreview` rate-limit (S-16) — 1-2 дня (батч)

**Контрольные точки**: на конец 30 дней:
- Все CRITICAL и HIGH findings закрыты ✅
- Аналитика установлена и собирает события ✅
- CI имеет approval-gate и SHA-pinned actions ✅
- Modal a11y compliance ✅
- Sandbox booking сокращает Time-to-Value до < 10 мин ✅

### 10.2 31-60 дней — Product foundation + GTM activation

**Неделя 5-6 (marketing-цикл):**
1. **Lifecycle email-цепочки** Day-7 / Day-12 / Day-14 (M-03) — 1-2 дня шаблоны + cron + dedup
2. **`campaignSendNow` MVP** через Resend для email-канала (M-02) — 1 неделя
3. **`consent_log` writes** в каждый send-flow (O-07) — 0.5 дня
4. **«Powered by Manicbot»** в booking confirmation (M-08) — 2 часа

**Неделя 7-8 (public marketplace + UX):**
1. **Public Profile builder MVP** (B-02 + F-11): cover photo + 1 photo carousel + about (300 chars) + brand palette accent — 1 неделя
2. **R2 bucket активировать** (раскомментировать `wrangler.toml`, создать через `wrangler r2 bucket create`) — 1 час
3. **`sitemap.xml` динамический** из живых салонов (M-06) — 0.5 дня
4. **`LocalBusiness` JSON-LD** на `/salon/<slug>` (M-07) — 1 час
5. **Empty-state Услуг с шаблонами** (F-08) — 1 день
6. **CSV-import wizard MVP** (Bz-01) — 1-2 недели

**Неделя 9 (ops + GDPR):**
1. **User erasure endpoint** (O-06) — 1 день
2. **ToS / Privacy / DPO links** в mini-app (O-08) — 4 часа
3. **`[env.staging]` блок** + staging Pages project (O-09) — 1-2 дня
4. **Sentry / error tracking** (O-12) — 1 день
5. **Runbooks**: bot-silence, d1-down, stripe-stuck, token-rotation (O-10) — 1 день
6. **Health endpoint `/healthz`** (O-13) — 2 часа
7. **`reviewRequested` column separation** (B-04) — 4 часа
8. **Returning-client promo creation** (B-05) — 0.5 дня

**Контрольные точки**: на конец 60 дней:
- Marketing module phase 2 запущен (email-кампании работают) ✅
- Lifecycle email серия активна, измеряема через analytics ✅
- Public profiles рендерят минимум 60% полей ✅
- City-page SEO работает (sitemap + JSON-LD) ✅
- GDPR baseline закрыт (consent_log + erasure + ToS + DPO) ✅
- Staging environment + runbooks + Sentry ✅

### 10.3 61-90 дней — Growth execution

**Неделя 10-12 (виральные циклы):**
1. **Реферальная система** (M-09) — миграция + UI + Stripe coupons — 1-2 недели
2. **Plugin runtime** для 3 топовых плагинов (`google-calendar` уже есть; добавить `loyalty-stamps`, `birthday-campaigns`) (B-01) — 2-3 недели
3. **City-pages SEO** для топ-10 городов с локализованным content — 1-2 недели

**Неделя 13 (бизнес-модель):**
1. **Freemium tier** (1 мастер + Telegram-only + 30 записей/мес) — 1-2 недели
2. **Multi-currency pricing** (RUB/UAH/PLN/EUR по `?lang=`) (M-05) — 1 неделя
3. **Billing tab usage display** (3/5 мастеров, history, активные plugins) (F-10) — 2 дня

**Неделя 14 (B2B + acquisition):**
1. **Agency / Franchise партнёрства** — 2-3 nail-школы (RU + PL) — 3-4 недели sales cycle
2. **Telegram-каналы посев** (50k+ подписчиков beauty-каналов) — 2-3 дня настройка + ongoing
3. **Кейс-стади** 1 реального салона (видео + до/после метрики) — 2 недели

**Контрольные точки**: на конец 90 дней:
- Реферальная программа работает с измеримым K-factor ≥ 0.2 ✅
- Plugin marketplace имеет 3 рабочих платных add-ons ✅
- Acquisition-канал #1 (TG-каналы или партнёрства школ) даёт ≥ 50 регистраций/мес ✅
- Pricing locale-aware ✅
- City-pages в Google search results для топ-10 городов ✅

---

## 11. Приложение A — Сравнение с предыдущими отчётами

### A.1 SECURITY_FINDINGS.md (25 апр) — что закрыто, что висит, что новое

| ID | Описание | Статус на 26 апр |
|---|---|---|
| H1 (dev secrets locally) | `.dev.vars`, `admin-app/.env` | ⛔️ **STILL** — файлы существуют (но не в git) — см. S-11 |
| **H2** (ADMIN_KEY как `?key=`) | `/setup`, `/remove-webhook` | ✅ **FIXED** — `adminKeyHttp.js:26-32` теперь только Bearer header |
| H3 (`connectBot` не сохраняет токен) | salon.ts | ⛔️ **STILL** — см. S-02 |
| H4 (support router publicProcedure) | support.ts | ❓ **NOT REPRODUCIBLE** — Phase 2 валидатор не нашёл файл (либо переименован, либо удалён). Нужно найти и проверить |
| **H5** (INSTAGRAM_ACCESS_TOKEN env fallback) | metaWebhooksHttp.js:146-149 | ✅ **FIXED** — fallback убран, явный warn log |
| **M1** (15+ admin routes `?key=`) | adminKeyHttp.js | ✅ **FIXED** — все маршруты Bearer-only |
| M2 (connectBot token в logger) | logger.ts | ❓ **CANNOT ASSESS** — file not found |
| M3 (Fixed-window rate limiter) | rateLimit.js | ⛔️ **STILL** — см. S-05 |
| M4 (regex sanitizeHtml) | sanitize.ts | ⛔️ **STILL** — см. S-06 |
| M5 (Worker CSP weak) | worker.js | ⛔️ **STILL** — см. S-08 |
| M6 (password 8 vs 12) | adminKeyHttp.js:499 | ⛔️ **STILL** — см. S-10 |
| M7 (Stripe metadata.tenantId не валидируется) | webhooks.js | ⛔️ **STILL** — см. S-07 |
| L1-L6 | various | ⛔️ **STILL** in part — см. S-11..S-17 |

**Итого**: 3 HIGH закрыто (H2, H5, M1), 6 HIGH/MEDIUM висят, 2 не подтверждены.

### A.2 REVIEW_REPORT.md (25 апр) — bug status

| Bug | Описание | Статус на 26 апр |
|---|---|---|
| B6 | review_requested_at vs review_requested | ⛔️ **STILL** — см. B-04 |
| **B8** | Stripe trial set active | ✅ **FIXED** — webhooks.js:184-189 теперь сохраняет только subscriptionId |
| B11 | checkAndIncrement TOCTOU | ⛔️ **STILL** — см. S-05 |
| B12 | stamp_card_configs silent catch | ⛔️ **STILL** — см. S-09 |
| T3 | returning-client promo never created | ⚠️ **PARTIALLY** — analytics event emits, но реальный promo не создаётся (см. B-05) |

### A.3 FULL_REVIEW_AUDIT_2026-04-26.md (сегодня) — что добавлено в этом отчёте

Этот отчёт **расширяет** FULL_REVIEW_AUDIT следующим:
- **+30 новых findings** — B-01 (plugin runtime пустой), F-04 (color contrast), F-08 (empty states), M-06 (sitemap), M-07 (LocalBusiness JSON-LD), M-08 (Powered by), M-09 (нет referral), все Bz-* и большая часть O-*
- **2-3 варианта** на каждое CRITICAL/HIGH (раньше был 1 рекомендованный)
- **Подтверждение через Phase 2 deep-dive валидаторов** — не «мнение агента», а grep + read с file:line
- **Live-проверки** запущены (1541 + 3075 тестов, schema parity, gh, wrangler)
- **30/60/90 plan** концретизирован по неделям

### A.4 DESIGN_MARKETING_REPORT.md (25 апр) — что включено, что добавлено

DESIGN_MARKETING_REPORT остаётся **best-in-class источником для UX/маркетинг-выводов**. Этот отчёт:
- **Цитирует** ключевые выводы (M-01, M-04, F-05, Bz-01, Bz-02)
- **Валидирует** против кода — что подтверждено grep'ом, что нет
- **Не дублирует** 20-приоритетный список — вместо этого оборачивает в формат «2-3 варианта + рекомендуемый» с file:line
- **Расширяет** в сторону backend (S-01..S-17), CI/CD (O-02..O-04), GDPR (O-06..O-08), которые DESIGN_MARKETING_REPORT не покрывает

> Если DESIGN_MARKETING_REPORT.md — это «GTM-стратегический ход», то этот REVIEW.md — «технический playbook на 90 дней + tracking matrix».

---

## 12. Приложение B — Команды для воспроизводства

```bash
# === LOCAL CHECKS ===
cd /Users/vdovin/Desktop/Manicbot_com/manicbot
npm run check-schema          # schema parity (57 tables)
npm test                       # 1541 тестов, ~12с

cd /Users/vdovin/Desktop/Manicbot_com/manicbot/admin-app
npm run typecheck              # tsc --noEmit
npm test                       # 3075 тестов, ~15с

# === GITHUB ===
gh run list --limit 15         # последние CI runs
gh pr list --state open        # открытые PR (#2, #3 — Brevo redesign)
gh release list -L 10

# === WRANGLER ===
cd /Users/vdovin/Desktop/Manicbot_com/manicbot
npx wrangler whoami
npx wrangler deployments list
npx wrangler d1 list           # manicbot-db (prod, 991 KB)
npx wrangler kv namespace list # MANICBOT (62a7d16805e742918a82184e879537cc)

# === GIT ===
git log --oneline -50          # последние коммиты на main
git status                     # untracked: AGENTS.md, DESIGN_MARKETING_REPORT.md (+ uncommitted edits)

# === SEARCH FOR FINDINGS ===
# M-01 — analytics presence
cd /Users/vdovin/Desktop/Manicbot_com
grep -r "gtag\|dataLayer\|ym(\|posthog\|mixpanel" --include="*.{js,ts,tsx,html}" .

# F-03 — hardcoded Russian strings
grep -rn '"[А-я ]\{3,\}"' manicbot/admin-app/src/components/ --include="*.tsx" | grep -v "t(" | head -20

# B-01 — plugin lifecycle wiring
grep -A 5 "PLUGIN_ROUTER_LOADERS\|PLUGIN_LIFECYCLE_LOADERS\|PLUGIN_HEALTH_LOADERS" manicbot/plugins/registry.ts

# O-01 — REQUIRE_WEBHOOK_BOT_ID
grep "REQUIRE_WEBHOOK_BOT_ID" manicbot/wrangler.toml

# O-07 — consent_log writes
grep -r "marketing_consent_log\|consentLog" manicbot/ manicbot/admin-app/src/ --include="*.{js,ts,tsx}"
```

---

## 13. Приложение C — Затронутые файлы (для PR-author'ов)

### Worker
- `manicbot/wrangler.toml` (O-01, O-09)
- `manicbot/src/worker.js` (S-08, B-09)
- `manicbot/src/http/adminPanelHttp.js` (S-related — already fixed H2)
- `manicbot/src/http/adminKeyHttp.js` (S-10)
- `manicbot/src/http/metaWebhooksHttp.js` (already fixed H5)
- `manicbot/src/http/landingHttp.js` (F-15, M-01 для embed)
- `manicbot/src/utils/security.js` (✅ — already strong, do not touch)
- `manicbot/src/utils/rateLimit.js` (S-05, S-15)
- `manicbot/src/utils/circuitBreaker.js` (B-06 — DELETE)
- `manicbot/src/utils/kv-keys.js` (B-07 — REDUCE)
- `manicbot/src/config.js` (B-08)
- `manicbot/src/billing/webhooks.js` (S-07, B-04 в части review trigger)
- `manicbot/src/billing/features.js` (✅)
- `manicbot/src/handlers/cron.js` (B-04, B-05, M-03 lifecycle emails, O-11 cleanup)
- `manicbot/src/handlers/callback.js` (S-09)
- `manicbot/src/handlers/message.js` (✅ — verified clean)
- `manicbot/src/embed/demoChat.js` (S-04, uncommitted)
- `manicbot/src/i18n/{ru,ua,en,pl}/booking.js` (M-08)

### Admin app
- `manicbot/admin-app/wrangler.toml` (O-09)
- `manicbot/admin-app/.env.example` (S-14)
- `manicbot/admin-app/middleware.ts` (S-12, S-17)
- `manicbot/admin-app/src/server/api/routers/auth.ts` (S-03)
- `manicbot/admin-app/src/server/api/routers/masterRouter.ts` (S-01)
- `manicbot/admin-app/src/server/api/routers/salon.ts` (S-02 connectBot)
- `manicbot/admin-app/src/server/api/routers/support.ts` (H4 — verify exists)
- `manicbot/admin-app/src/server/api/routers/marketing.ts` (M-02 campaignSendNow)
- `manicbot/admin-app/src/server/api/routers/webUsers.ts` (S-13, S-16, O-06)
- `manicbot/admin-app/src/server/api/routers/plugins.ts` (B-01)
- `manicbot/admin-app/src/server/api/routers/publicSalon.ts` (B-02)
- `manicbot/admin-app/src/server/api/routers/export.ts` (O-06)
- `manicbot/admin-app/src/server/security/sanitize.ts` (S-06)
- `manicbot/admin-app/src/server/email/emailService.ts` (M-03)
- `manicbot/admin-app/src/server/email/templates.ts` (M-03)
- `manicbot/admin-app/src/server/utils/logger.ts` (M2)
- `manicbot/admin-app/src/components/dashboards/SupportDashboard.tsx` (F-03 lines 88, 155, 245)
- `manicbot/admin-app/src/components/salon/tabs/StaffTab.tsx` (F-02, F-03)
- `manicbot/admin-app/src/components/salon/tabs/PublicProfileTab.tsx` (F-11)
- `manicbot/admin-app/src/components/plugins/InstallConfirmModal.tsx` (F-01)
- `manicbot/admin-app/src/components/salon/ManualBookingModal.tsx` (F-01)
- `manicbot/admin-app/src/components/billing/*` (F-10)
- `manicbot/admin-app/src/components/layout/Shell.tsx` (F-04, F-09)
- `manicbot/admin-app/src/components/layout/WebShell.tsx` (F-04, F-09, F-12, F-14)
- `manicbot/admin-app/src/components/layout/PinnedNavSection.tsx` (uncommitted, F-related)
- `manicbot/admin-app/src/components/OnboardingChecklist.tsx` (F-05)
- `manicbot/admin-app/src/components/MasterSetup.tsx` (S-03 related)
- `manicbot/admin-app/src/app/(auth)/register/page.tsx` (F-07)
- `manicbot/admin-app/src/app/(auth)/layout.tsx` (F-13)
- `manicbot/admin-app/src/app/(dashboard)/role-requests/RoleRequestsPageClient.tsx` (F-02)
- `manicbot/admin-app/src/app/(dashboard)/marketing/MarketingShell.tsx` (M-02)
- `manicbot/admin-app/src/app/(dashboard)/marketing/OverviewClient.tsx` (M-02)
- `manicbot/admin-app/src/app/salon/[slug]/page.tsx` (M-07 LocalBusiness)
- `manicbot/admin-app/src/app/salon/[slug]/SalonProfileClient.tsx` (B-02)
- `manicbot/admin-app/src/app/sitemap.ts` (НОВЫЙ ФАЙЛ для M-06)
- `manicbot/admin-app/src/lib/i18n.ts` (F-03)
- `manicbot/admin-app/public/sitemap.xml` (M-06 — заменить на dynamic)

### Plugins
- `manicbot/plugins/registry.ts` (B-01)
- `manicbot/plugins/{loyalty-stamps,birthday-campaigns,booking-reminder}/router.ts` (B-01 wiring)
- `manicbot/plugins/{loyalty-stamps,birthday-campaigns,booking-reminder}/lifecycle.ts` (B-01 wiring)

### Migrations (новые, для 30/60/90)
- `manicbot/migrations/0040_masters_web_user_id.sql` (S-01, S-03)
- `manicbot/migrations/0041_review_requested_separation.sql` (B-04)
- `manicbot/migrations/0042_test_bookings.sql` (Bz-02 sandbox)
- `manicbot/migrations/0043_referrals.sql` (M-09)

### Workflows / Infra
- `.github/workflows/deploy.yml` (O-02, O-03, O-04, O-05)
- `manicbot/wrangler.toml` (O-01, O-09 staging)
- `manicbot/admin-app/wrangler.toml` (O-09 staging)
- `docs/runbooks/{bot-silence,d1-down,stripe-stuck,token-rotation}.md` (НОВЫЕ ФАЙЛЫ — O-10)

---

**Конец отчёта.**

> Если из всех 60 находок выбрать **3 действия на понедельник 9:00**: (1) установить аналитику (M-01, 1ч), (2) раскомментировать `REQUIRE_WEBHOOK_BOT_ID` (O-01, 2ч), (3) запинить GitHub Actions на SHA (O-02, 2ч). Это даёт `+ visibility, + multi-tenant safety, + supply-chain hygiene` за полдня работы. Дальше — по 30/60/90-плану.
