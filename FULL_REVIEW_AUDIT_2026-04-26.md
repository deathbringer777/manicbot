# ManicBot: Full Review & Audit

*Date: 2026-04-26*

## Scope and Method

- Horizontal + vertical audit across `manicbot/` (Worker) and `manicbot/admin-app/` (Next.js mini-app), including docs and deployment configuration.
- Orchestrated parallel deep reviews by domain: security, backend, frontend/UX, marketing/business, infra/CI/CD.
- Local verification executed:
  - `manicbot`: `npm run check-schema`, `npm test`
  - `manicbot/admin-app`: `npm run typecheck`, `npm test`
- Operational checks executed:
  - GitHub Actions latest runs via `gh run list` (recent runs green)
  - Cloudflare deployments via `wrangler deployments list`
  - Wrangler config review (`manicbot/wrangler.toml`, `manicbot/admin-app/wrangler.toml`)

---

## Executive Snapshot

- Project is **technically strong** overall: high automated test coverage, clear role model, serious security primitives already in place (webhook signatures, timing-safe compare, encryption patterns, security tests).
- Main risk cluster is **authorization and release hardening**, not lack of features.
- Business-wise, biggest gap is **marketing execution**: schema/UI are present, but campaign delivery path is still largely stubbed.
- Recommended strategy: first close **access control and CI/runtime hardening**, then tackle **activation and growth loops**.

---

## Priority Matrix (Critical -> Minor)


| Priority | Area               | Issue                                                                                | Impact                                         | Recommended Window |
| -------- | ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------ |
| Critical | Backend/Security   | Master-to-master IDOR risk via `masterId` trust in API paths                         | Unauthorized access/modification within tenant | 24-48h             |
| High     | Security/Frontend  | Potential unsafe link HTML path in embedded chat sanitizer                           | XSS/phishing vector in widget context          | 24-72h             |
| High     | Backend/Auth       | `auth.getMyRole` master mapping can resolve wrong master                             | Data mix-ups + amplifies authorization issue   | 24-48h             |
| High     | Infra/Security     | Auto-deploy to prod on `main` without approval gates                                 | Fast incident propagation                      | 2-4 days           |
| High     | Infra/Supply chain | GitHub actions not pinned by SHA; Semgrep can be soft-fail                           | CI trust degradation and missed findings       | 2-4 days           |
| High     | Business/Marketing | Marketing send path mostly stubbed                                                   | Weak acquisition/retention loops, lost revenue | 1-2 weeks          |
| Medium   | Backend/Public API | `publicSalon.getProfile` exposure risk for unpublished profiles                      | Premature data exposure                        | 2-5 days           |
| Medium   | UX/A11y            | Several modals lack full dialog semantics/focus trap                                 | Accessibility debt and keyboard UX friction    | 1-2 weeks          |
| Medium   | Runtime security   | Insecure-by-default posture (`REQUIRE_WEBHOOK_BOT_ID`, optional encryption key path) | Larger attack surface and drift risk           | 2-5 days           |
| Medium   | Product analytics  | Missing robust product analytics instrumentation baseline                            | Blind growth decisions                         | 1-2 weeks          |
| Low      | Docs/Operations    | Comment/runbook drift (legacy hints)                                                 | Operator confusion                             | Ongoing            |


---

## Detailed Findings and Change Options

## 1) Security Report

### 1.1 Critical/High findings

1. **Master IDOR (Critical)**
  - Risk: master endpoints trust incoming `masterId`; master can target another master in same tenant.
  - Evidence: `manicbot/admin-app/src/server/api/routers/masterRouter.ts`
  - Options:
    - Bind identity server-side: ignore incoming `masterId` for `master` role, derive from authenticated user.
    - Add explicit FK binding (`masters.webUserId`) and enforce in all queries/mutations.
    - Split API into self-endpoints (no `masterId`) vs owner/admin endpoints.
2. **Widget sanitizer link safety gap (High)**
  - Risk: embeddable chat sanitization may allow unsafe `href` patterns in some paths.
  - Evidence: `manicbot/src/embed/demoChat.js`
  - Options:
    - Unify sanitizer policy with strict shared allowlist and protocol filtering.
    - Remove raw anchor passthrough; render links only via safe parser.
    - Add dedicated malicious payload tests (`javascript:`, nested entity, malformed tags).
3. **Wrong master mapping in role payload (High)**
  - Risk: `auth.getMyRole` can return first active master in tenant, not current user-linked master.
  - Evidence: `manicbot/admin-app/src/server/api/routers/auth.ts`
  - Options:
    - Resolve `masterId` strictly from user->master binding.
    - Return `masterId: null` if binding absent and force onboarding/linking.
    - Add invariant tests for role identity mapping.

### 1.2 Medium findings

- Public profile publish guard inconsistency in `publicSalon` paths (`manicbot/admin-app/src/server/api/routers/publicSalon.ts`).
- Open CORS on multiple public routes expands abuse surface (intentional for embed/public, but needs compensating controls).
- Upload token replay window is bounded but not strictly one-time (`manicbot/src/services/upload.js`, `admin-app/src/server/lib/uploadToken.ts`).

### 1.3 Security strengths

- Strong webhook protection and fail-closed checks (`telegramWebhookHttp`, `metaWebhooksHttp`).
- Timing-safe secret comparisons and extensive security-oriented tests.
- Startup security validation in worker.
- Token hashing and auth hardening patterns in web user flows.

---

## 2) Backend Review

### Key risks

- Authorization boundary needs tightening for master-level procedures.
- Role-to-entity mapping (`webUser -> master`) is not consistently authoritative in all flows.
- Public/private content visibility logic is not perfectly uniform across endpoints.

### What is good

- Clear layered architecture (HTTP modules, handlers, services, billing, tenant resolver).
- Very strong automated tests in Worker (`1541 passed`) and Admin app (`3075 passed`).
- Schema discipline with parity check (`check-schema` passed).

### 2-3 change variants (backend hardening package)

1. **Strict identity model**
  - Add canonical relationship `web_user_id` in `masters`.
  - Enforce ownership in DB queries, not only route-level checks.
2. **Procedure split by intent**
  - Self actions (`getMy...`, `updateMy...`) separate from owner/admin actions.
3. **Policy middleware**
  - Centralize authorization helpers for `master`, `tenant_owner`, support roles to reduce drift.

---

## 3) Frontend + UX Review

### Main findings

- Modal accessibility debt: missing full dialog semantics in several screens.
- i18n inconsistency: mixed translated and hardcoded strings; one broken RU key.
- Usage of native `alert/confirm` in product flows creates UX and a11y inconsistency.
- Potential bundle/runtime optimization opportunity in role dashboard loading strategy.

### Evidence (examples)

- `manicbot/admin-app/src/app/(dashboard)/role-requests/RoleRequestsPageClient.tsx`
- `manicbot/admin-app/src/components/salon/tabs/StaffTab.tsx`
- `manicbot/admin-app/src/components/dashboards/SupportDashboard.tsx`
- `manicbot/admin-app/src/lib/i18n.ts`
- `manicbot/admin-app/src/app/(dashboard)/layout.tsx`

### 2-3 change variants (UX package)

1. **Unified dialog primitive**
  - Shared dialog component with focus trap, `aria-modal`, keyboard handling.
2. **i18n quality gate**
  - Enforce `t(...)` for UI strings and add tests for untranslated literals.
3. **Progressive perf pass**
  - Role-based lazy loading + visibility-aware polling budgets.

---

## 4) Marketing Review

### Core issue

- Marketing module has meaningful schema/UI groundwork, but execution path remains partially stubbed (`campaignSendNow`), limiting real conversion and retention impact.

### Business impact

- Lower activation (no lifecycle nudges), lower retention (weak re-engagement), lower monetization velocity (fewer revenue loops).

### 2-3 change variants (marketing package)

1. **MVP delivery first**
  - Enable one real channel (`email`) and one real campaign type (`send now`).
2. **Lifecycle automations**
  - Start with `trial_day_7` and `inactive_14d`.
3. **Outcome metrics**
  - Add sent/open/click/unsub analytics views in God Mode.

---

## 5) Business Model Review

### Findings

- Product appears to pursue both B2B SaaS operations and B2C discovery/marketplace patterns; positioning can dilute primary monetization focus.
- Onboarding still has friction points before first value moment.
- Analytics instrumentation for growth decisions is not strong enough yet.

### 2-3 change variants (business package)

1. **Clarify GTM lanes**
  - Separate B2B conversion path from B2C discovery path with distinct KPIs.
2. **Activation-first onboarding**
  - Add sandbox/assisted first booking to reduce time-to-value.
3. **AARRR baseline**
  - Implement minimal event taxonomy across signup, onboarding, billing, retention triggers.

---

## 6) Infra / CI/CD / Wrangler Review

### Findings

- Deploy pipeline is effective but too direct for production safety (auto deploy on main).
- Security scanning posture can be hardened (unpinned actions, soft Semgrep behavior).
- Runtime defaults should be stricter in production (`REQUIRE_WEBHOOK_BOT_ID`, stronger encryption-key enforcement semantics).

### 2-3 change variants (ops package)

1. **Protected environments**
  - `environment: production` + required reviewers before deploy jobs.
2. **Immutable CI dependencies**
  - Pin actions by commit SHA and fail if security scan prerequisites missing.
3. **Staging-first release**
  - Add explicit staging environment/resources and smoke gates before prod.

---

## Validation Status (Executed)

- Worker schema parity: **PASS**
- Worker tests: **PASS** (`94 files`, `1541 tests`)
- Admin typecheck: **PASS**
- Admin tests: **PASS** (`67 files`, `3075 tests`)
- Recent GitHub workflow runs: **PASS** (recent history successful)
- Cloudflare deployment visibility: available via `wrangler deployments list`

---

## 30/60/90-Day Suggested Plan

### 0-30 days (risk containment)

- Fix master IDOR and role/master mapping.
- Harden widget sanitization and add regression tests.
- Add production deploy approval gate and action SHA pinning.

### 31-60 days (product hardening)

- Modal/a11y standardization and i18n cleanup pass.
- Public profile visibility policy unification.
- Introduce analytics baseline and onboarding quick wins.

### 61-90 days (growth execution)

- Ship marketing send-now MVP and first automations.
- Expand retention loops and business KPI dashboarding.
- Evaluate B2B/B2C lane split with measurable funnel targets.

---

## Final Verdict

- **Engineering maturity:** high (tests, architecture, domain coverage).
- **Security posture:** strong baseline with several high-priority authorization/release-hardening fixes required.
- **UX quality:** good foundation with targeted accessibility and consistency debt.
- **Growth readiness:** strong scaffolding, incomplete execution layer.

If the top 5 risks are closed in the next sprint, the platform moves from “strong but exposed in key seams” to “production-grade with controlled risk and better growth leverage”.