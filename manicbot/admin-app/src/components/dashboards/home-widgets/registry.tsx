/**
 * Home-widget registry — the SINGLE SOURCE OF TRUTH for the configurable
 * salon "Домой" (overview) dashboard.
 *
 * This is the FROZEN CONTRACT all three feature areas build against:
 *   - the board (HomeWidgetBoard) renders `WIDGET_REGISTRY[type].Component`,
 *   - the persistence layer (useDashboardPrefs) stores `HomeWidgetItem[]`,
 *   - the Settings → Виджеты section reads `WIDGET_REGISTRY` to list toggles
 *     and `WidgetDef.options` to render its dropdowns.
 *
 * Phase-0 ships STUB `Component`s (placeholder render). The board owner
 * (Agent B) replaces them with the real widget components under
 * `home-widgets/widgets/*` — the type contract below does not change.
 */
import type { FC } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Users,
  CalendarDays,
  Wallet,
  UserPlus,
  UserX,
  CalendarRange,
  Sparkles,
  UserRound,
  Activity,
  Zap,
} from "lucide-react";
import type { Lang, TranslationKey } from "~/lib/i18n";
import type { AppRole } from "~/server/api/routers/auth";
import { TodayAppointmentsWidget } from "./widgets/TodayAppointmentsWidget";
import {
  KpiTotalClientsWidget,
  KpiWeekAppointmentsWidget,
  KpiMonthRevenueWidget,
  KpiNewClientsWidget,
  KpiNoShowRateWidget,
} from "./widgets/KpiWidgets";
import { CalendarHeatmapWidget } from "./widgets/CalendarHeatmapWidget";
import { TopServicesWidget, TopMastersWidget } from "./widgets/TopListWidgets";
import { ActivityFeedWidget } from "./widgets/ActivityFeedWidget";
import { QuickActionsWidget } from "./widgets/QuickActionsWidget";

/** Every widget available in catalog v1. */
export type HomeWidgetType =
  | "today_appointments"
  | "kpi_total_clients"
  | "kpi_week_appointments"
  | "kpi_month_revenue"
  | "kpi_new_clients"
  | "kpi_no_show_rate"
  | "calendar_heatmap"
  | "top_services"
  | "top_masters"
  | "activity_feed"
  | "quick_actions";

/** Iterable, ordered list of all widget types (drives the add-widget menu order). */
export const HOME_WIDGET_TYPES: readonly HomeWidgetType[] = [
  "today_appointments",
  "kpi_total_clients",
  "kpi_week_appointments",
  "kpi_month_revenue",
  "kpi_new_clients",
  "kpi_no_show_rate",
  "calendar_heatmap",
  "top_services",
  "top_masters",
  "activity_feed",
  "quick_actions",
] as const;

export type WidgetCategory = "metric" | "calendar" | "list" | "action";

/** A single selectable value inside a widget option dropdown. */
export interface WidgetOptionChoice {
  value: string;
  labelKey: TranslationKey;
}

/**
 * A dropdown-configurable widget option (e.g. metric `period`, calendar
 * `view`, top-N `limit`). Declarative so BOTH the board's edit-mode and the
 * Settings → Виджеты page can render the same `Select` from one definition.
 */
export interface WidgetOptionSpec {
  /** Stored under `HomeWidgetItem.opts[key]`. */
  key: string;
  labelKey: TranslationKey;
  /** Used when the stored value is missing or no longer a valid choice. */
  default: string;
  choices: WidgetOptionChoice[];
}

/**
 * One placed widget instance on the board. Persisted (per-user) inside
 * `DashboardPrefs.homeWidgets`. Field names `i/x/y/w/h` mirror
 * react-grid-layout's `Layout` item so the board can map 1:1 without a
 * translation step. For catalog v1 every widget is a singleton, so `i`
 * equals `type`.
 */
export interface HomeWidgetItem {
  i: string;
  type: HomeWidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  opts?: Record<string, unknown>;
}

/** Props passed to every widget's render `Component`. */
export interface WidgetRenderProps {
  item: HomeWidgetItem;
  /**
   * `item.opts` validated + merged over the widget's option defaults
   * (see `resolveWidgetOpts`). Always a complete, choice-valid map so
   * widgets never have to re-implement default resolution.
   */
  opts: Record<string, string>;
  tenantId: string;
  lang: Lang;
  /** True while the board is in edit mode (drag/resize active). */
  editMode: boolean;
}

export interface WidgetDef {
  type: HomeWidgetType;
  titleKey: TranslationKey;
  icon: LucideIcon;
  category: WidgetCategory;
  /** Initial size in 12-col grid units on the `lg` breakpoint. */
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /**
   * Roles allowed to use this widget. `undefined` = every role that can see
   * the home board (owner / manager / master / system_admin). No v1 widget
   * restricts roles, but the field exists so future owner-only widgets can.
   */
  roles?: AppRole[];
  /** Dropdown-configurable options. Omitted = no configuration. */
  options?: WidgetOptionSpec[];
  /** All v1 widgets are single-instance (`i === type`). */
  singleton: boolean;
  Component: FC<WidgetRenderProps>;
}

// ── Reusable option specs ────────────────────────────────────────────────────
const PERIOD_OPTION: WidgetOptionSpec = {
  key: "period",
  labelKey: "widget.opt.period",
  default: "30d",
  choices: [
    { value: "7d", labelKey: "widget.opt.period.7d" },
    { value: "30d", labelKey: "widget.opt.period.30d" },
    { value: "90d", labelKey: "widget.opt.period.90d" },
  ],
};

const VIEW_OPTION: WidgetOptionSpec = {
  key: "view",
  labelKey: "widget.opt.view",
  default: "month",
  choices: [
    { value: "month", labelKey: "widget.opt.view.month" },
    { value: "week", labelKey: "widget.opt.view.week" },
  ],
};

const LIMIT_OPTION: WidgetOptionSpec = {
  key: "limit",
  labelKey: "widget.opt.limit",
  default: "5",
  choices: [
    { value: "5", labelKey: "widget.opt.limit.5" },
    { value: "10", labelKey: "widget.opt.limit.10" },
  ],
};

export const WIDGET_REGISTRY: Record<HomeWidgetType, WidgetDef> = {
  today_appointments: {
    type: "today_appointments",
    titleKey: "widget.today_appointments.title",
    icon: CalendarClock,
    category: "list",
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 4, h: 4 },
    singleton: true,
    Component: TodayAppointmentsWidget,
  },
  kpi_total_clients: {
    type: "kpi_total_clients",
    titleKey: "widget.kpi_total_clients.title",
    icon: Users,
    category: "metric",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    singleton: true,
    Component: KpiTotalClientsWidget,
  },
  kpi_week_appointments: {
    type: "kpi_week_appointments",
    titleKey: "widget.kpi_week_appointments.title",
    icon: CalendarDays,
    category: "metric",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    singleton: true,
    Component: KpiWeekAppointmentsWidget,
  },
  kpi_month_revenue: {
    type: "kpi_month_revenue",
    titleKey: "widget.kpi_month_revenue.title",
    icon: Wallet,
    category: "metric",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    singleton: true,
    Component: KpiMonthRevenueWidget,
  },
  kpi_new_clients: {
    type: "kpi_new_clients",
    titleKey: "widget.kpi_new_clients.title",
    icon: UserPlus,
    category: "metric",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    options: [PERIOD_OPTION],
    singleton: true,
    Component: KpiNewClientsWidget,
  },
  kpi_no_show_rate: {
    type: "kpi_no_show_rate",
    titleKey: "widget.kpi_no_show_rate.title",
    icon: UserX,
    category: "metric",
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    options: [PERIOD_OPTION],
    singleton: true,
    Component: KpiNoShowRateWidget,
  },
  calendar_heatmap: {
    type: "calendar_heatmap",
    titleKey: "widget.calendar_heatmap.title",
    icon: CalendarRange,
    category: "calendar",
    defaultSize: { w: 6, h: 6 },
    minSize: { w: 4, h: 4 },
    options: [VIEW_OPTION],
    singleton: true,
    Component: CalendarHeatmapWidget,
  },
  top_services: {
    type: "top_services",
    titleKey: "widget.top_services.title",
    icon: Sparkles,
    category: "list",
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    options: [PERIOD_OPTION, LIMIT_OPTION],
    singleton: true,
    Component: TopServicesWidget,
  },
  top_masters: {
    type: "top_masters",
    titleKey: "widget.top_masters.title",
    icon: UserRound,
    category: "list",
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    options: [PERIOD_OPTION, LIMIT_OPTION],
    singleton: true,
    Component: TopMastersWidget,
  },
  activity_feed: {
    type: "activity_feed",
    titleKey: "widget.activity_feed.title",
    icon: Activity,
    category: "list",
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 3 },
    options: [LIMIT_OPTION],
    singleton: true,
    Component: ActivityFeedWidget,
  },
  quick_actions: {
    type: "quick_actions",
    titleKey: "widget.quick_actions.title",
    icon: Zap,
    category: "action",
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    singleton: true,
    Component: QuickActionsWidget,
  },
};

/**
 * First-run board layout (12-col `lg`). Non-overlapping. When a user's
 * `homeWidgets` is empty the board falls back to this. Smaller breakpoints are
 * derived by the board (RGL) / collapse to one column on touch.
 */
export const DEFAULT_HOME_LAYOUT: HomeWidgetItem[] = [
  { i: "kpi_total_clients", type: "kpi_total_clients", x: 0, y: 0, w: 3, h: 2 },
  { i: "kpi_week_appointments", type: "kpi_week_appointments", x: 3, y: 0, w: 3, h: 2 },
  { i: "kpi_month_revenue", type: "kpi_month_revenue", x: 6, y: 0, w: 3, h: 2 },
  { i: "kpi_new_clients", type: "kpi_new_clients", x: 9, y: 0, w: 3, h: 2 },
  { i: "kpi_no_show_rate", type: "kpi_no_show_rate", x: 0, y: 2, w: 3, h: 2 },
  { i: "today_appointments", type: "today_appointments", x: 0, y: 4, w: 6, h: 6 },
  { i: "calendar_heatmap", type: "calendar_heatmap", x: 6, y: 4, w: 6, h: 6 },
  { i: "top_services", type: "top_services", x: 0, y: 10, w: 4, h: 5 },
  { i: "top_masters", type: "top_masters", x: 4, y: 10, w: 4, h: 5 },
  { i: "activity_feed", type: "activity_feed", x: 8, y: 10, w: 4, h: 5 },
  { i: "quick_actions", type: "quick_actions", x: 0, y: 15, w: 3, h: 4 },
];

/** Runtime type guard — drops unknown widget types from persisted layouts. */
export function isHomeWidgetType(value: unknown): value is HomeWidgetType {
  return typeof value === "string" && value in WIDGET_REGISTRY;
}

/**
 * Resolve a widget's effective options: each declared option falls back to its
 * `default` when the stored value is missing or no longer a valid choice.
 * Pure — safe to unit-test and to call during render.
 */
export function resolveWidgetOpts(
  type: HomeWidgetType,
  item?: { opts?: Record<string, unknown> },
): Record<string, string> {
  const def = WIDGET_REGISTRY[type];
  const out: Record<string, string> = {};
  for (const spec of def.options ?? []) {
    const raw = item?.opts?.[spec.key];
    out[spec.key] =
      typeof raw === "string" && spec.choices.some((c) => c.value === raw)
        ? raw
        : spec.default;
  }
  return out;
}

/** Roles that may see the home board when a widget does not restrict access. */
const DEFAULT_WIDGET_ROLES: AppRole[] = [
  "tenant_owner",
  "tenant_manager",
  "master",
  "system_admin",
];

/** Whether `role` is allowed to use `def` (respects `def.roles` when set). */
export function widgetAllowedForRole(def: WidgetDef, role: AppRole): boolean {
  const allowed = def.roles ?? DEFAULT_WIDGET_ROLES;
  return role != null && allowed.includes(role);
}
