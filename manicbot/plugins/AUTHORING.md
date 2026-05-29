# Authoring a New ManicBot Plugin

Step-by-step for a first-party plugin. **External vendors are not accepted** —
the `vendor` field in every manifest must be the literal `"manicbot"`.

## 1. Choose a slug

Kebab-case, 3-40 chars, `[a-z][a-z0-9-]*`. This is permanent — installs in
production key on it. Prefer short, descriptive names: `sms-reminders`,
`portfolio-gallery`, `gdpr-center`.

## 2. Create the folder

```
manicbot/plugins/<slug>/
└── manifest.ts      # default export PluginManifest
```

Minimum viable manifest (for a `coming_soon` plugin with no runtime yet):

```ts
// manicbot/plugins/my-plugin/manifest.ts
import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "my-plugin",
  version: "0.1.0",
  vendor: "manicbot",
  category: "productivity",
  status: "coming_soon",
  scope: "tenant",
  icon: { name: "Sparkles", tint: "#8b5cf6" },
  name: {
    ru: "Мой плагин",
    ua: "Мій плагін",
    en: "My Plugin",
    pl: "Moja wtyczka",
  },
  tagline: {
    ru: "Короткое описание в одной строке",
    ua: "Короткий опис в одному рядку",
    en: "One-line tagline",
    pl: "Hasło w jednej linii",
  },
  description: {
    ru: "Развёрнутое описание — 1-2 абзаца.",
    ua: "Розгорнутий опис — 1-2 абзаци.",
    en: "Longer description, 1-2 paragraphs.",
    pl: "Dłuższy opis, 1-2 akapity.",
  },
  keywords: {
    ru: ["плагин", "пример"],
    ua: ["плагін", "приклад"],
    en: ["plugin", "example"],
    pl: ["wtyczka", "przykład"],
  },
  availableForRoles: ["tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
```

## 3. Register it

Add two lines to `manicbot/plugins/registry.ts`:

```ts
import myPluginManifest from "./my-plugin/manifest";

const RAW_MANIFESTS = [
  /* ...existing... */
  myPluginManifest,
];
```

That's it for a `coming_soon` plugin — it will show up in the catalog as a
greyed-out card once the next deploy lands.

## 4. (Optional) Add a tRPC sub-router

When the plugin needs its own procedures (e.g., custom data queries):

1. Set `capabilities.trpcSubRouter: true` in the manifest.
2. Create `my-plugin/router.ts`:

```ts
// manicbot/plugins/my-plugin/router.ts
import { z } from "zod";
import { createTRPCRouter, managerProcedure } from "~/server/api/trpc";
import { assertPluginEnabled } from "~/server/plugins/assertPluginEnabled";

export const router = createTRPCRouter({
  status: managerProcedure
    .query(async ({ ctx }) => {
      await assertPluginEnabled(ctx, "my-plugin");
      return { ok: true };
    }),
});
```

3. Wire the lazy loader in `registry.ts` `PLUGIN_ROUTER_LOADERS`:

```ts
const PLUGIN_ROUTER_LOADERS = {
  "my-plugin": () => import("./my-plugin/router").then(m => ({ router: m.router })),
};
```

4. The namespace router at
   `admin-app/src/server/api/routers/plugins/_namespace.ts` auto-mounts every
   loader. Callers invoke `api.plugins.myPlugin.status` (underscores become
   dots in tRPC naming by convention — the `_namespace.ts` file handles the
   slug-to-key mapping).

## 5. (Optional) Add lifecycle hooks

The following lifecycle hooks are available; all are optional. Declare each one
you implement as `true` in the manifest `lifecycle` object, then export the
corresponding async function from `my-plugin/lifecycle.ts`.

| Hook flag          | Function signature                                | When called                                              |
|--------------------|---------------------------------------------------|----------------------------------------------------------|
| `onInstall`        | `onInstall(ctx: PluginLifecycleCtx)`              | When a tenant enables the plugin for the first time.     |
| `onUninstall`      | `onUninstall(ctx: PluginLifecycleCtx)`            | When a tenant removes the plugin.                        |
| `onEnable`         | `onEnable(ctx: PluginLifecycleCtx)`               | Each time the plugin is toggled enabled (after install). |
| `onDisable`        | `onDisable(ctx: PluginLifecycleCtx)`              | Each time the plugin is toggled disabled.                |
| `healthCheck`      | `healthCheck(ctx: PluginLifecycleCtx): Promise<{ ok: boolean; detail?: string }>` | Periodic health probe (used by dashboard status card). |

All hooks must be **idempotent** — they may be called more than once without
corrupting state. Throwing inside any hook auto-writes `event=error` to
`plugin_events` and surfaces the error in the dashboard.

Example lifecycle file covering all hooks:

```ts
import type { PluginLifecycleCtx } from "../types";

export async function onInstall(ctx: PluginLifecycleCtx) {
  // Seed tenant_config rows, register cron jobs, etc.
}

export async function onUninstall(ctx: PluginLifecycleCtx) {
  // Clean up per-install state.
}

export async function onEnable(ctx: PluginLifecycleCtx) {
  // Re-activate any paused jobs or subscriptions.
}

export async function onDisable(ctx: PluginLifecycleCtx) {
  // Pause jobs; do NOT delete data.
}

export async function healthCheck(ctx: PluginLifecycleCtx) {
  // Return { ok: true } or { ok: false, detail: "reason" }
  return { ok: true };
}
```

Manifest flags:

```ts
lifecycle: {
  onInstall: true,
  onUninstall: true,
  onEnable: true,
  onDisable: true,
  healthCheck: true,
},
```

> **Note on capabilities:** `healthCheck` is declared in `capabilities` (not
> `lifecycle`) in `PluginManifest` — set `capabilities.healthCheck: true` in the
> manifest when implementing a health check.

Register the lifecycle loader in `PLUGIN_LIFECYCLE_LOADERS` inside
`manicbot/plugins/registry.ts`:

```ts
const PLUGIN_LIFECYCLE_LOADERS = {
  "my-plugin": () => import("./my-plugin/lifecycle"),
};
```

> **Current state:** `PLUGIN_ROUTER_LOADERS`, `PLUGIN_LIFECYCLE_LOADERS`, and
> `PLUGIN_HEALTH_LOADERS` are all empty objects in `registry.ts` — no built-in
> plugin has runtime code yet. Add your plugin's loader as the first entry when
> you introduce the first live plugin.

## 6. (Optional) Add a settings panel

Set `capabilities.settingsPanel: { sectionKey: "plugin:my-plugin", componentId: "my-plugin.SettingsPanel" }`.

Create `my-plugin/ui/SettingsPanel.tsx`:

```tsx
"use client";

import { api } from "~/trpc/react";
import { toast } from "~/lib/toast";

export default function SettingsPanel({ installationId }: { installationId: string }) {
  const utils = api.useUtils();
  const saveMut = api.plugins.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.plugins.getInstalled.invalidate();
    },
  });
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      saveMut.mutate({ installationId, settings: { /* ... */ } });
    }}>
      {/* fields */}
    </form>
  );
}
```

Register the loader in `admin-app/src/components/settings/pluginPanels.ts`:

```ts
const PANEL_LOADERS = {
  "my-plugin.SettingsPanel": () => import("../../../../plugins/my-plugin/ui/SettingsPanel"),
};
```

Navigate to `/settings?section=plugin:my-plugin` — the panel renders.

## 6.5. Runtime UI (the `/plugin/<slug>` open page)

A *runtime* is the full-page UI users see when they click **Open** on a plugin
card. Runtimes live in `admin-app/src/components/plugins/runtimes/` and are
registered in `runtimePanels.ts`.

### Mandatory shell

Every runtime **MUST** wrap its output in `PluginRuntimeShell`. The shell
reads the manifest from the registry and renders the icon + localized
`name` + `tagline` exactly the same way the catalog card does — so the
detail page never drifts from the catalog. Hand-rolling a header (with an
inline brand SVG, custom heading, etc.) is forbidden and enforced by
[`plugin-runtime-architecture.test.ts`](../admin-app/src/__tests__/plugin-runtime-architecture.test.ts).

```tsx
// admin-app/src/components/plugins/runtimes/MyPluginRuntime.tsx
"use client";

import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

export default function MyPluginRuntime({ installationId, slug }: PluginRuntimeProps) {
  return (
    <PluginRuntimeShell slug={slug} bare>
      {/* runtime body — focus on functionality, NOT identity */}
    </PluginRuntimeShell>
  );
}
```

`bare` skips the default rounded card so the runtime can use its own grid /
column layout. Drop `bare` if you want the standard white card.

### Flash banner

Need success / error feedback from a tRPC mutation? Pass `flash` into the
shell — it renders a styled banner above the content:

```tsx
const [flash, setFlash] = useState<PluginRuntimeFlash>(null);
return (
  <PluginRuntimeShell slug={slug} flash={flash}>
    …
  </PluginRuntimeShell>
);
```

### Loading state

Use `PluginRuntimeLoading` while gating on a query — it ships a centered
spinner that matches the rest of the dashboard.

### Register the loader

Add one line to `admin-app/src/components/plugins/runtimePanels.ts`:

```ts
const RUNTIME_LOADERS: Record<string, RuntimeLoader> = {
  "my-plugin": () => import("./runtimes/MyPluginRuntime"),
  …
};
```

The slug must match the manifest exactly — the architecture test cross-checks
both registries and fails if there's an orphan.

### What the shell already gives you (so don't duplicate it)

- Plugin icon (from `manifest.icon`, rendered via `PluginIcon`).
- Localized name + tagline (active `LangContext` decides ru/ua/en/pl).
- Flash banner (success / error) with consistent styling.
- Default content card with proper light/dark borders.

Anything else — domain controls, lists, forms — is yours.

## 7. (Optional) Contribute a sidebar nav item

Add to manifest:

```ts
capabilities: {
  nav: [{
    id: "plugin.my-plugin",
    href: "/settings?section=plugin:my-plugin",
    iconName: "Sparkles",
    labelKey: "self.name",   // uses manifest.name[lang]
    roles: ["tenant_owner"],
  }],
},
```

The sidebar automatically injects this link for installed+enabled plugins —
no changes to `navConfig.ts` needed.

## 8. (Optional) Declare a paid add-on

```ts
billing: {
  model: "paid_addon_monthly",
  stripePriceIdEnv: "STRIPE_PRICE_MY_PLUGIN_MONTHLY",
  priceHintUsd: 9,
  label: { ru: "$9/мес", ua: "$9/міс", en: "$9/mo", pl: "$9/mies" },
},
```

Then:
1. In Stripe Dashboard, create a Price with metadata `plugin_slug: "my-plugin"`.
2. Add `wrangler secret put STRIPE_PRICE_MY_PLUGIN_MONTHLY` pointing at the price id.
3. UI uses `api.plugins.checkoutAddon` which talks to
   `Worker /admin/plugin-addon-checkout` → Stripe Checkout.
4. On paid, `src/billing/pluginWebhooks.js` flips `billing_state=paid` and
   writes a `billing_state_changed` event.

## 9. Tests

Every plugin should have at least these tests (mostly covered by the seed
validator at `admin-app/src/__tests__/plugins-seed-catalog.test.ts`):

- Manifest passes Zod (automatic)
- 4-language coverage is complete (automatic)
- Routers enforce `assertPluginEnabled` on every mutation
- Lifecycle hooks are idempotent (can be called twice without corrupting state)

If you add custom procedures, follow the `plugins-router.test.ts` pattern —
mock the db with `createDbMock`, cover happy path + role/plan/billing
rejections.

## 10. Deploy

Plugins are compile-time — a normal deploy is enough:

```
cd manicbot/
npm test
npx wrangler deploy

# Pages auto-deploys from git push origin main
```

Run `npm run check-schema` before deploys that touch DB schema.

## Common Pitfalls

- **"Plugin shows up only in ru"** — you missed a language in `name/tagline/description/keywords`. All 4 languages are required.
- **"Install fails with PRECONDITION_FAILED"** — your manifest says `status: "coming_soon"`. Change to `live` or `beta`.
- **"Sidebar item doesn't appear"** — check `capabilities.nav[].roles` includes the viewer's role and the plugin is enabled.
- **"Paid plugin blocks usage"** — billing_state is `trialing` or `past_due`; user must complete checkout.
- **"assertPluginEnabled throws NOT_FOUND"** — slug typo. `getPlugin(slug)` returned null.

## Style

- Ship `status: "coming_soon"` first, then graduate to `beta`, then `live`.
- Keep manifest files small — descriptions are for the card, not for product
  documentation.
- Use lucide icon names that already appear in the project (`Bell`, `Shield`,
  `Sparkles`). Unknown icons fall back to `Puzzle`.
- Always localize keywords — users search in their own language.
