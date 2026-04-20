# Plugin Security Invariants

The plugin system is 1st-party. These invariants MUST hold for every plugin.
Any violation is a bug, not a feature.

## 1. No External Vendors

`manifest.vendor` must be the literal `"manicbot"`. The Zod schema enforces
this at module load — installing a manifest with any other vendor throws.

## 2. No Dynamic Code Execution

- No `eval`, no `new Function`, no `require()`-with-computed-argument.
- All imports in `registry.ts` are static, resolvable by the bundler at build
  time.
- User-uploaded JS / HTML / JSON must not be executed — plugin settings are
  treated as data, never as code.

## 3. Scope Enforcement — Every Mutation

Plugins obtain permissions via `assertPluginEnabled(ctx, slug)`, which
verifies:

- The install row exists in `plugin_installations`
- The caller's role is in `manifest.availableForRoles`
- `manifest.status !== "coming_soon"`
- `plan` meets `minPlan`
- `billing_state` is permissive for the billing model
- Platform-wide install (`tenant_id IS NULL`) requires `system_admin`
- Tenant-scoped install requires the caller to own that tenant (or be
  `system_admin`); master is allowed only on `isPersonal = 1` tenants

## 4. Install Authorization

- `install({ tenantId: null })` requires `system_admin`. No exceptions.
- `install({ tenantId: X })` requires `tenant_owner` for X or `system_admin`.
- `tenant_manager` cannot install — escalation path runs through
  `tenant_action_requests` (not yet wired for plugins; default-deny).
- Every install/uninstall writes a `plugin_events` row with the actor's
  `web_user_id`. Audit trail is immutable — no `DELETE` or `UPDATE` on
  `plugin_events`.

## 5. Settings Payload

- Size-capped at 8 KiB (bytes of the serialised JSON).
- Parsed via `JSON.parse`; if malformed → treated as `null`.
- Plugin-specific schema validation happens inside the plugin's lifecycle
  hook, never in the router — each plugin owns its own Zod schema for its
  own settings shape.

## 6. Stripe Webhooks

- Signature verified against `STRIPE_WEBHOOK_SECRET` before any state change.
- Event IDs de-duplicated via `stripe_events` table (D1) + KV fallback.
- `plugin_slug` must come from `price.metadata` or `session.metadata` —
  never from URL or request body.
- Failed plugin webhook mutations DO NOT abort the 200 response to Stripe
  (Stripe retries on 5xx; never retry because of plugin-specific errors).

## 7. No Backdoors

- There is no "dev mode" that skips role/plan/billing checks.
- There is no hardcoded slug that bypasses `assertPluginEnabled`.
- `system_admin` is always expressed via session role — never via bearer
  header, query param, or plugin setting.
- `ADMIN_KEY` on the Worker protects `/admin/plugin-addon-checkout` with
  a timing-safe bearer comparison (NO query-param fallback as of S9).

## 8. Permission Declaration

`manifest.permissions` is **documentation for the install confirmation
modal**, not an enforcement surface. Actual enforcement uses the existing
`assertPermission(ctx, tenantId, key)` machinery inside the plugin's own
procedures. Declaring a permission in the manifest does NOT grant it.

## 9. Data Boundary

Plugin lifecycle hooks receive:

```
{
  db, tenantId, webUserId, settings, stripe?, env?
}
```

- `db` is the full Drizzle client. Plugins must scope writes to their own
  state (namespaced rows in `plugin_installations.settings_json`, or their
  own plugin-specific table created via a migration).
- `env` is a map of read-only strings. Plugins must NEVER write to `env`.
- `webUserId` is the actor — use it for audit rows, never for authorization
  (the router already authorized).

## 10. UI Sanitization

All localized strings from manifests are treated as text, not HTML. React
auto-escapes; do NOT use `dangerouslySetInnerHTML` with plugin-provided
data. Icon names are limited to a known lucide allowlist in
`components/plugins/PluginIcon.tsx` and `lib/nav/pluginNavIcons.ts` —
unknown names fall back to `Puzzle`.

## 11. Billing State Gating

| model | gated state |
|-------|-------------|
| `free` | disallow only `canceled` |
| `included_in_plan` | disallow only `canceled`; additionally `canUse(ctx, featureKey)` must pass |
| `paid_addon_monthly` | allow `paid` + `trialing`; block `past_due`, `canceled`, `not_applicable` |
| `paid_addon_onetime` | allow only `paid` |

## 12. Testing

Any change to this file must be accompanied by a test that asserts the
invariant still holds. See:

- `src/__tests__/plugins-plan-billing-helpers.test.ts`
- `src/__tests__/plugins-router.test.ts`
- `src/__tests__/plugins-seed-catalog.test.ts`
- `test/plugin-webhooks.test.js` (worker side)

Run locally: `cd manicbot/admin-app && npm test` and `cd manicbot && npm test`.
