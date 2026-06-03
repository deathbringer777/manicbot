# ManicBot design system — authenticated app

The **tenant dashboard + god-mode admin** run on a warm **beige + red + turquoise**
palette in light and dark. Public / marketing / salon-storefront pages keep the
original slate + brand-purple + accent-green look. The two coexist via **scoped
tokens** — see "How scoping works".

Single source of truth: [`src/styles/globals.css`](../src/styles/globals.css)
(CSS tokens) and [`src/lib/theme/palette.ts`](../src/lib/theme/palette.ts) (JS color
values for SVG/canvas/calendar).

## Golden rules

1. **Use tokens, never hardcode.** Style with semantic utilities
   (`bg-background`, `bg-card`, `bg-surface-muted`, `text-foreground`,
   `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`,
   `bg-secondary`, `text-secondary-text`, `bg-success|warning|danger`, `ring-ring`),
   or the `brand-*` (red) / `accent-*` (turquoise) / `slate-*` (warm taupe) scales.
   No new `#hex`, `rgb()`, or `bg-[#...]` arbitrary literals in components.
2. **Need a raw color value in JS** (an SVG stroke, a canvas, a calendar hue)?
   Import from `~/lib/theme/palette` (`PALETTE`, `paletteFor(theme)`,
   `MASTER_EVENT_HUES`, `masterHueSet`, `STATUS_HUES`, `statusHue`). Prefer
   `var(--color-*)` in inline styles where a CSS var works.
3. **Primary action = red, secondary/positive accent = turquoise, destructive =
   danger.** Status colors (pending/confirmed/done/cancelled/no_show) are universal
   semantic hues (amber/emerald/violet/red/orange), not the brand.
4. **`done` status is violet**, not brand — brand is red inside the scope and would
   collide with red `cancelled`.

## Token table

Semantic tokens resolve per theme. Values below are the authenticated-app scope.

| Token (utility)                         | Light       | Dark        | Role |
| --------------------------------------- | ----------- | ----------- | ---- |
| `--background` (`bg-background`)         | `#f7f0e6`   | `#1c1714`   | page background |
| `--foreground` (`text-foreground`)      | `#2e2722`   | `#f2e8da`   | primary text |
| `--card` (`bg-card`)                     | `#fffdf8`   | `#26201b`   | card surface |
| `--surface-muted` (`bg-surface-muted`)  | `#efe5d6`   | `#2f2823`   | muted panel/input |
| `--muted-foreground` (`text-muted-foreground`) | `#6f645b` | `#b8a993` | secondary text |
| `--border` (`border-border`)            | `#e2d4bf`   | `#3d342c`   | hairlines |
| `--primary` (`bg-primary`)              | `#d14638`   | `#e8604f`   | primary action (red) |
| `--primary-foreground`                  | `#ffffff`   | `#1c1714`   | text on primary |
| `--primary-hover`                       | `#b23a30`   | `#f07260`   | primary hover |
| `--secondary` (`bg-secondary`)          | `#1ea896`   | `#34c5b0`   | secondary action (turquoise) |
| `--secondary-foreground`                | `#06302b`   | `#10211e`   | text on turquoise fill |
| `--secondary-text` (`text-secondary-text`) | `#0b6f62` | `#34c5b0` | turquoise as text/icon/link |
| `--success` / `--warning` / `--danger`  | `#1f7a58` / `#c9892f` / `#c0392b` | `#5fbe97` / `#e0a85a` / `#e5705f` | status fills |
| `--warning-strong` (`text-warning-strong`) | `#8a5d18` | `#e0a85a` | warning as text |
| `--ring` (`ring-ring`)                  | `#178a7b`   | `#34c5b0`   | focus ring |

Scale remaps inside the scope (so existing `bg-brand-*`, `text-accent-*`,
`bg-slate-*` utilities reskin automatically):

- `brand-*` → red ramp (`brand-500 #d14638`, `brand-600 #b23a30`).
- `accent-*` → turquoise ramp (`accent-500 #1ea896`, `accent-600 #178a7b`).
- `slate-*` → warm taupe (`slate-500 #7b6a59`, `slate-900 #1c1714`, `slate-200 #e1d7c6`),
  lightness-matched to Tailwind slate so contrast holds.

## How scoping works

`(dashboard)/layout.tsx` sets `data-app="authed"` on `<body>` while the dashboard
is mounted. `globals.css` overrides the token variables (and the brand/accent/slate
scales) under `[data-app="authed"]` (light) and `.dark [data-app="authed"]` (dark).
Tailwind 4 compiles `bg-primary` → `background-color: var(--color-primary)`, so
overriding the variable on the wrapper re-resolves every utility in the subtree.
Body-portaled modals/toasts inherit it (body is the scope node). Public pages never
mount this layout, so they keep the defaults defined in `:root` / `:root:not(.dark)`.

**Gotcha:** `@theme { --color-primary: var(--primary) }` is substituted at `:root`,
so overriding only `--primary` on a descendant does **not** re-resolve the utility.
The `--color-*: var(--*)` indirection is therefore **re-declared inside the
`[data-app="authed"]` block**. If you add a new semantic token, add it both to
`@theme` (to generate the utility) and to the re-anchor block.

## Dark mode

`.dark` on `<html>` (set pre-paint from `localStorage.manicbot_web_theme` by the
script in `layout.tsx`; toggled via `PublicThemeProvider`). Both the default and the
authed palettes ship light + dark; the scope's dark values live in
`.dark [data-app="authed"]`.

## Contrast

Every critical foreground/background pairing meets WCAG AA (≥4.5:1 body, ≥3:1 large/UI)
in both themes, enforced by [`theme-tokens-contrast.test.ts`](../src/__tests__/theme-tokens-contrast.test.ts),
which parses the real token hex out of `globals.css`. The light-turquoise traps are
handled by dark text on turquoise fills, a separate darker `--secondary-text` for
turquoise-as-foreground, `--warning-strong` for warning text, and a deeper `--ring`.

## Swapping the palette

Edit only the `[data-app="authed"]` and `.dark [data-app="authed"]` blocks in
`globals.css` (and mirror any JS values in `palette.ts`). Run
`npm test -- theme-tokens-contrast` to confirm AA still holds, then `npm run typecheck`.

## Dashboard redesign — scope

In scope: tenant dashboard (`SalonDashboard`, `MasterDashboard`, `components/salon/**`,
tenant calendar views) + god-mode admin recolor. The shared shell (`WebShell`) and UI
primitives change **color via tokens only** — no structural edits. Public/auth markup
is untouched.

## Deferred follow-ups

- Blanket migration of remaining raw `slate-*` usages in god-mode/public to tokens
  (cosmetic; the scale remap already warms authed slate).
- `emerald`/`amber` long-tail → semantic `success`/`warning` utilities app-wide.
- Optional: harmonize the public site's dark mode (currently keeps brand-purple).
