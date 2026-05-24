# Task — Platform Customers CRM page

## Goal
Ship a sysadmin-only `/system/customers` page with two tabs (Accounts /
Subscribers) that gives the platform operator a single place to see "who
registered as a salon owner, what plan are they on, are they paying, who
cancelled, who only subscribed to the newsletter". Read-only.

## Context
- Existing pattern lives at `/system/marketing/*` — `SystemMarketingShell`
  with sub-nav + amber "PLATFORM" badge, all data via `api.marketing.*`
  (`adminProcedure`). We mirror that shape.
- Schema: `web_users` is the salon-owner registration table; `tenants`
  carries `plan` / `billing_status` / `trial_ends_at` /
  `stripe_customer_id` / `stripe_subscription_id`. JOIN on
  `web_users.tenant_id = tenants.id`.
- `web_users.role` is the discriminator — only `tenant_owner` rows count
  as "salon accounts" (the role we want listed). Masters / support /
  system_admin rows are out of scope here.
- `newsletter_subscribers` is being added by a parallel PR. The existing
  table `email_subscribers` exists today (the landing-page newsletter
  capture from migration 0046), but the user's text refers to
  `newsletter_subscribers`. We probe `newsletter_subscribers` first and
  fall back to `email_subscribers` so this page works pre-AND post-merge
  of the parallel PR. If neither table exists, the proc returns
  `{ tableMissing: true, rows: [], total: 0 }`.
- Plan prices are fixed in CLAUDE.md: start=45 PLN, pro=60 PLN, max=90
  PLN. MRR contribution per row = price IF
  `billing_status IN ('active','grace','trialing')`. Cancelled / expired
  contribute 0.
- Modal stacking contract (0062) must be followed for the detail modal:
  `z-[100]`, `bg-slate-950/70 backdrop-blur-md`, solid card with
  `ring-1 ring-black/5`. New file path goes into MODAL_FILES.

## Constraints
- Read-only views — NO edit / delete / pause / cancel actions.
- `adminProcedure` for every proc. Defense in depth on the page level
  via `useRole`.
- Even a sysadmin who has activated a tenant-role preview must NOT see
  the page (mirrors `SystemMarketingShell` defensive check on
  `role === "system_admin"` before any data hook fires).
- No migrations from us. The parallel PR owns the
  `newsletter_subscribers` schema.
- Modal contract — pass the modal-styling-regression test.

## Success criteria
1. `/system/customers` renders Accounts tab with rows for every
   `web_users.role='tenant_owner'` row, JOINed with tenants metadata.
2. Filters (plan multi-select, status multi-select, search) trim the
   result set server-side.
3. Stats card shows total_accounts, paying, trialing, churned,
   mrr_total_pln, newsletter_subs.
4. Subscribers tab degrades gracefully when neither table exists —
   "миграция в работе" message.
5. Detail modal opens on row click, follows 0062 stacking contract,
   links to Stripe Dashboard via `stripe_customer_id`.
6. New nav entry `god.customers` visible to sysadmin only, in the
   `platform` group, just after `god.marketing`.
7. New router has ≥16 tests (auth, filters, pagination, stats math,
   tableMissing path, accountDetail not-found).
8. RTL test for the page (renders for sysadmin, placeholder for other
   roles, tab switching via `?tab=`).
9. `cd manicbot/admin-app && npm run typecheck` clean.
10. `cd manicbot/admin-app && npm test` green.

## Verification
- `npm run typecheck` clean.
- `npm test` green; new tests show up in the failure summary if the
  contract regresses.
- Manual hit `/system/customers` as system_admin → table appears.
- Manual hit same URL as tenant_owner → SalonDashboard intercepts
  (existing layout behaviour) so the data router stays untouched.
