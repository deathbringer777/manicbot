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

Set `lifecycle.onInstall: true` (or others) in manifest, create
`my-plugin/lifecycle.ts`:

```ts
import type { PluginLifecycleCtx } from "../types";

export async function onInstall(ctx: PluginLifecycleCtx) {
  // Seed tenant_config rows, register cron jobs, etc.
  // Throwing here auto-writes event=error to plugin_events and fails install.
}

export async function onUninstall(ctx: PluginLifecycleCtx) {
  // Clean up per-install state.
}
```

Register the loader in `PLUGIN_LIFECYCLE_LOADERS`.

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
