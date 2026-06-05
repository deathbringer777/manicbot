/**
 * PARKED FEATURE FLAGS — fully-built features deliberately hidden from the UI.
 *
 * `false` here does NOT mean "dead code". It means "complete code, switched off
 * on purpose". DO NOT DELETE the code these flags gate — flip the flag to ship.
 *
 * ── MARKETING_AUTOMATIONS_ENABLED ──────────────────────────────────────────
 * Gates the Marketing → Automations sub-tab (`/marketing/automations`) and its
 * route. The UI is finished and the manual "Run Now" path works end-to-end.
 *
 * Why parked: the cron trigger-engine that would auto-fire automations on their
 * triggers (new-contact welcome / birthday / inactivity / booking) is not built
 * yet, so today the tab can only send when clicked — and pre-launch there are
 * ~0 contacts with email consent, so a manual run resolves to "0 of 0". Showing
 * a half-working automation surface confuses salon owners, so we hide it.
 *
 * The stack CAN do cron (we already run a 15-min Cloudflare cron with ~12 phases
 * in manicbot/src/handlers/cron.js, incl. phaseMarketingDispatch which is the
 * direct analog, plus an unwired dispatcher in src/services/marketing/automations.js).
 *
 * To UNLOCK (future PR):
 *   1. Build a `phaseMarketingAutomations` cron phase (model it on
 *      phaseMarketingDispatch) that reads `marketing_automations.trigger_type`.
 *   2. Add a per-automation-per-contact dedup marker so we never re-welcome or
 *      re-greet a birthday twice.
 *   3. Add a `dob` column to `marketing_contacts` (or join users.dob) for the
 *      birthday trigger.
 *   4. Flip this constant to `true` and update marketing-automations-parked.test.ts.
 *
 * Kept on purpose alongside this flag: the tRPC procedures
 * (marketing.automation* / marketingTenant.automation*), the marketing_automations
 * schema, and every marketing.automation.* / marketing.nav.automations i18n key.
 */
// Annotated `: boolean` (not the inferred literal `false`) on purpose: it keeps
// TypeScript from narrowing flag-gated branches to dead code, so the parked
// client component stays referenced instead of being reported unreachable.
export const MARKETING_AUTOMATIONS_ENABLED: boolean = false;
