# ManicBot Plugins — Overview

The ManicBot plugin system is a **1st-party** extension layer (no external vendors).
Each plugin is a compile-time module with a typed manifest, optional tRPC
sub-router, optional lifecycle hooks, and optional UI contributions.

Plugins are:
- Discoverable via the catalog at `/plugins` (all authenticated users)
- Installable per-tenant (`tenant_owner` / `tenant_manager`) or
  platform-wide (`system_admin`)
- Gated by role, plan, and billing state
- Searchable in 4 languages (ru / ua / en / pl) via Fuse.js
- Audited — every install / uninstall / enable / disable / settings_updated
  writes a row to `plugin_events`

## Directory Layout

```
manicbot/plugins/
├── types.ts                 # shared TS types (no runtime deps)
├── registry.ts              # static registry — one import per plugin
├── index.ts                 # barrel export
├── AUTHORING.md             # how to author a new plugin
├── SECURITY.md              # security invariants
├── <slug>/
│   ├── manifest.ts          # REQUIRED — default export PluginManifest
│   ├── router.ts            # optional — tRPC sub-router
│   ├── lifecycle.ts         # optional — onInstall/onUninstall/onEnable/onDisable
│   ├── health.ts            # optional — checkHealth()
│   ├── worker.ts            # optional — cron + worker route handlers
│   ├── ui/
│   │   └── SettingsPanel.tsx  # optional — client settings component
│   └── locales/
│       ├── ru.ts ua.ts en.ts pl.ts   # optional — extra i18n strings
```

## How Plugins Are Registered

Every plugin is a **static import** inside `registry.ts`. No dynamic loading,
no user-uploaded code, no third-party vendors.

```ts
// plugins/registry.ts
import helloWorld from "./hello-world/manifest";

const RAW_MANIFESTS = [helloWorld, /* ... */] as const;
```

At module-load time the registry assembles `PLUGINS: Record<slug, PluginModule>`.
Runtime validation of each manifest happens inside the admin-app
(`manicbot/admin-app/src/server/plugins/manifestSchema.ts`) — Zod — called by
tests and the tRPC router.

## Manifest Fields — Cheatsheet

| Field | Required | Notes |
|-------|----------|-------|
| `slug` | ✓ | kebab-case, 3-40 chars, unique, permanent |
| `version` | ✓ | semver (`1.0.0`) |
| `vendor` | ✓ | literal `"manicbot"` |
| `category` | ✓ | one of `communication / analytics / growth / operations / branding / ai / finance / compliance / productivity` |
| `status` | ✓ | `live` / `beta` / `coming_soon` |
| `scope` | ✓ | `platform` (system_admin installs) / `tenant` / `both` |
| `icon.name` | ✓ | lucide-react icon name (e.g. `Bell`, `Shield`) |
| `icon.tint` | ✓ | hex `#RRGGBB` |
| `name` | ✓ | LocalizedText (ru/ua/en/pl) — all 4 required |
| `tagline` | ✓ | LocalizedText |
| `description` | ✓ | LocalizedText (one-paragraph markdown) |
| `keywords` | ✓ | LocalizedKeywords (4 arrays) |
| `screenshots` | — | Optional array of `{url, captionKey?}` |
| `availableForRoles` | ✓ | at least one role from `system_admin / tenant_owner / tenant_manager / master / support / technical_support` |
| `minPlan` | ✓ | `any / start / pro / max` |
| `billing.model` | ✓ | `free / included_in_plan / paid_addon_monthly / paid_addon_onetime` |
| `billing.featureKey` | conditional | Required when `included_in_plan`; passed to `canUse(ctx, key)` |
| `billing.stripePriceIdEnv` | conditional | Required for paid addons; points at env var name (`STRIPE_PRICE_XYZ`) |
| `billing.priceHintUsd` | — | display only |
| `permissions` | ✓ | array of `{ key, scope: "read"/"write", sensitive? }`. Documentation for the install modal |
| `capabilities.nav` | — | sidebar nav contributions `[{id, href, iconName, labelKey, roles[], group?, requiresPersonalTenant?}]` |
| `capabilities.settingsPanel` | — | `{sectionKey: "plugin:<slug>", componentId}` — routes `/settings?section=plugin:<slug>` to a React panel |
| `capabilities.cron` | — | `[{schedule: "*/15 * * * *", handlerId}]` — worker-side |
| `capabilities.workerRoutes` | — | `[{pattern: "GET /plugin/x/*", handlerId}]` |
| `capabilities.trpcSubRouter` | — | `true` if plugin ships `router.ts` |
| `capabilities.healthCheck` | — | `true` if plugin ships `health.ts` |
| `lifecycle` | ✓ | `{onInstall?, onUninstall?, onEnable?, onDisable?}` — each `true` when the plugin ships that hook |

## Lock State Precedence (for catalog UI)

When computing `lock` for a card, the server applies gates in this order:

1. `coming_soon` — always wins
2. `role_mismatch` — viewer role not in `availableForRoles`
3. `platform_only` — `scope=platform` but viewer is not `system_admin`
4. `plan` — `minPlan` exceeds viewer's tenant plan
5. `none` — installable

Locked cards still render in the catalog (greyscale + tooltip), so users see
what's possible in their plan tier or role.

## Related Docs

- [AUTHORING.md](./AUTHORING.md) — step-by-step guide to writing a new plugin
- [SECURITY.md](./SECURITY.md) — invariants that any plugin author must respect
- Admin-app entry point: `manicbot/admin-app/src/server/api/routers/plugins.ts`
- Guard: `manicbot/admin-app/src/server/plugins/assertPluginEnabled.ts`
- Registry: `manicbot/plugins/registry.ts`
- Migration: `manicbot/migrations/0035_plugins.sql`
