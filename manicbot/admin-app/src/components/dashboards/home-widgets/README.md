# Home widgets — the salon «Домой» (overview) board

A configurable, per-user widget dashboard. Widgets can be dragged, resized,
added, and removed; the layout persists per user with **no migration** — it
rides the schemaless `tenant_config` ui-prefs blob.

## Files

| File | Role |
|------|------|
| `registry.tsx` | **Frozen contract**: `HomeWidgetType`, `WidgetDef`, `HomeWidgetItem`, `WidgetOptionSpec`, `WidgetRenderProps`, `WIDGET_REGISTRY`, `DEFAULT_HOME_LAYOUT`, and pure helpers (`resolveWidgetOpts` / `isHomeWidgetType` / `widgetAllowedForRole`). |
| `HomeWidgetBoard.tsx` | `react-grid-layout` host (mounted `ssr:false`): edit mode, add / remove / reset, persistence. |
| `WidgetFrame.tsx` | Per-widget chrome: the title bar is the drag handle; remove button in edit mode. |
| `HomeWidgetContext.tsx` | Host bridge for the two *interactive* widgets — `today_appointments` (render slot of the existing overview JSX) and `quick_actions` (host modal/nav handlers). Optional: pure widgets ignore it. |
| `MiniCalendar.tsx` | Shared heatmap, extracted from the god-mode `DashboardClient`. |
| `widgets/*` | One component per `HomeWidgetType`. |

- **Data**: the tenant-scoped `salonMetrics` tRPC router (`server/api/routers/salonMetrics.ts`).
- **Persistence + helpers**: `lib/useDashboardPrefs.ts` (`homeWidgets` field + setters).
- **Configuration UI**: `components/settings/sections/WidgetsSection.tsx` — edits the **same** `homeWidgets` state (single source of truth shared with the board's edit mode).

## Adding a widget

1. Add the id to `HomeWidgetType` **and** `HOME_WIDGET_TYPES` in `registry.tsx`.
2. Add a `WIDGET_REGISTRY[id]` entry (title i18n key, icon, category,
   default/min size, optional `options`, `Component`). Add the title (and any
   option) keys to `lib/i18n.ts` in all 4 langs (ru/ua/en/pl).
3. Implement the component in `widgets/` consuming `WidgetRenderProps`
   (`{ item, opts, tenantId, lang, editMode }`). If it needs data, add a
   procedure to `salonMetrics` (TDD, `tenant_id`-scoped).
4. Optionally add it to `DEFAULT_HOME_LAYOUT` (the first-run board).

The board, the settings page, and persistence all read the registry, so a
new entry surfaces everywhere automatically.

## Constraints

- Drag/resize is desktop-only (`useCoarsePointer`); the grid collapses to one
  column on `xs/xxs`.
- `today_appointments` reuses the existing overview JSX **verbatim** (via
  `HomeWidgetContext`) — do not rewrite it.
- Every `salonMetrics` query is `tenant_id`-scoped and guarded by
  `tenantOwnerProcedure` + `assertTenantOwner`.
- Layout lives in the `tenant_config` ui-prefs blob — never add a `tenants`
  column for it (that would force `getTenant`/`putTenant` threading).
