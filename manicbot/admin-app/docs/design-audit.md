# Design audit — palette migration + tenant-dashboard redesign

Audit backing the `test-redesign` work: migrate the **authenticated app** (tenant
dashboard + god-mode admin) to a warm **beige + red + turquoise** palette in light
and dark, redesign the tenant dashboard, and leave public/marketing/storefront
pages on their current look. This file is the Phase A (Auditor) output.

## Styling system (as found)

- **Tailwind 4, no config file.** All theme config lives in `@theme` + `@layer base`
  in [`src/styles/globals.css`](../src/styles/globals.css).
- **Dark mode** = `.dark` class on `<html>` (`@custom-variant dark`), toggled from
  `localStorage.manicbot_web_theme` by a pre-paint script in `layout.tsx` and the
  custom `PublicThemeProvider`. Light is the public default; `:root` (no `.dark`) is
  the dashboard's dark default — note the **inverted** convention.
- **Existing semantic base vars** (`--background --foreground --card --primary
  --secondary --muted --muted-foreground --accent --destructive --border --ring` …)
  plus custom `--color-brand-*` (purple) and `--color-accent-*` (green) scales and
  Brevo `--color-surface*/--color-ink*` fixed tokens.
- **Primitives:** in-house `components/ui/Button.tsx` + `Pill.tsx` (tone × variant,
  explicit paired light/dark classes). No shadcn / Radix / CVA. `clsx` + `tailwind-merge`.

## Scope boundary

| Surface | Roles | Treatment |
| --- | --- | --- |
| Tenant dashboard — `SalonDashboard`, `MasterDashboard`, `components/salon/**`, tenant calendar views | `tenant_owner`, `tenant_manager`, `master` | **Redesign + recolor** |
| God-mode admin — `(dashboard)/system/**`, `SupportDashboard` | `system_admin`, support | **Recolor only** (tokens), no structural edits |
| Shared shell / primitives — `layout/WebShell.tsx`, `components/ui/*`, `dashboard-ui/*` | all | **Recolor via tokens**, structure frozen |
| Public / auth — `app/(public)/**`, `(auth)/**` (salon storefronts, pricing, blog, login) | anon / all | **Untouched** (keep current palette) |

`SalonDashboard`/`MasterDashboard` are confirmed tenant-only (not rendered for
`system_admin`), so redesigning them does not bleed into the admin app.

## Blast radius (grep, `src/`)

- 184 component files; **~269** hex/rgb literal lines across 49 files; **~3,464** raw
  Tailwind color-utility usages. `gray-*` already 0 (neutrals canonicalised onto `slate-*`).
- `brand-*` ≈ 97 component files, `accent-*` ≈ 6 — concentrated in authed components,
  but also used by 28 god-mode files and (dark mode only) the public site.
- Literal hotspots: `calendar/MonthCalendar.tsx`, `ui/KpiCard.tsx`,
  `dashboard-ui/StatCard.tsx`, `chat/MessageBubble.tsx` (salon `brandPalette` fallback
  `#EC4899`), `calendar/DragCreateLayer.tsx`, `lib/appointments.ts` (`STATUS_STYLES`).

## Chosen approach — scoped theming

Because the palette must reach the authed app **only**, the new tokens are scoped
under a `[data-app="authed"]` marker (set on `<body>` by `(dashboard)/layout.tsx`),
overriding the design-token variables for that subtree. Public pages never mount that
layout, so they keep the default palette. Within the scope, overriding the
`brand-*`/`accent-*` scales re-tints `bg-brand-*` / `text-accent-*` to red/turquoise
with no component edits.

**Gotcha recorded:** `@theme { --color-primary: var(--primary) }` is substituted at
`:root`, so overriding only `--primary` on a descendant does **not** re-resolve the
`bg-primary` utility there. The indirection is therefore **re-anchored inside the
authed scope** (`--color-*: var(--*)` redeclared under `[data-app="authed"]`). Scale
tokens use literal values, which need no re-anchoring.

## Accessibility findings (light turquoise traps)

Programmatic WCAG check (gated by `__tests__/theme-tokens-contrast.test.ts`) caught
sub-AA pairs in the proposed light palette, now fixed in token values:

- white-on-turquoise button 2.96:1 → **dark teal text** on turquoise fill.
- turquoise-as-text on beige 2.91:1 → separate darker `--secondary-text`.
- warning-as-text 2.91:1 → `--warning-strong`.
- turquoise focus ring 2.62:1 (non-text needs ≥3) → deeper ring `#178a7b`.
- `muted-foreground` darkened to clear 4.5:1 on the page background.

Dark palette passed all checks unchanged.

## Local-dev limitation

The real dashboard **cannot run on `next dev`**: no Cloudflare D1 binding → `getDb()`
returns an empty mock → role query is null → redirect loop to `/login`. Visual work is
verified via a dev-only mock preview route (`app/(dev)/preview`, presentational, no
tRPC) plus a Cloudflare Pages **branch preview** deploy for the real data-bound app.
