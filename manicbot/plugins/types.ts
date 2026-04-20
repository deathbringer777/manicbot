/**
 * Plugin Marketplace — type definitions.
 *
 * Kept dependency-free so both admin-app (which runs Zod validation on import)
 * and the worker (pure ESM, no zod) can consume these types without pulling a
 * runtime library. Runtime validation lives at
 * `admin-app/src/server/plugins/manifestSchema.ts`.
 *
 * ALL plugins must be 1st-party (vendor = "manicbot"). External vendor values
 * are rejected by the Zod schema — enforced at registry load time.
 */

// ─── Const arrays (exported for enum-like usage) ─────────────────────────────

export const PLUGIN_LANGS = ["ru", "ua", "en", "pl"] as const;
export type PluginLang = (typeof PLUGIN_LANGS)[number];

export const PLUGIN_CATEGORIES = [
  "communication",
  "analytics",
  "growth",
  "operations",
  "branding",
  "ai",
  "finance",
  "compliance",
  "productivity",
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_STATUSES = ["live", "beta", "coming_soon"] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const BILLING_MODELS = [
  "free",
  "included_in_plan",
  "paid_addon_monthly",
  "paid_addon_onetime",
] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const PLUGIN_SCOPES = ["platform", "tenant", "both"] as const;
export type PluginScope = (typeof PLUGIN_SCOPES)[number];

export const PLUGIN_ROLES = [
  "system_admin",
  "tenant_owner",
  "tenant_manager",
  "master",
  "support",
  "technical_support",
] as const;
export type PluginRole = (typeof PLUGIN_ROLES)[number];

export const PLAN_GATE_VALUES = ["any", "start", "pro", "max"] as const;
export type PlanGate = (typeof PLAN_GATE_VALUES)[number];

export const BILLING_STATES = [
  "not_applicable",
  "included",
  "paid",
  "trialing",
  "past_due",
  "canceled",
] as const;
export type PluginBillingState = (typeof BILLING_STATES)[number];

export const NAV_GROUPS = [
  "overview",
  "management",
  "platform",
  "salon",
  "master",
  "support",
] as const;
export type PluginNavGroup = (typeof NAV_GROUPS)[number];

// ─── Localized fields ────────────────────────────────────────────────────────

export interface LocalizedText {
  ru: string;
  ua: string;
  en: string;
  pl: string;
}

export interface LocalizedKeywords {
  ru: string[];
  ua: string[];
  en: string[];
  pl: string[];
}

// ─── Capability contributions ────────────────────────────────────────────────

export interface NavContribution {
  /** lowercase dotted id, e.g. "plugin.sms-reminders" */
  id: string;
  href: string;
  iconName: string;
  labelKey: string;
  roles: PluginRole[];
  group?: PluginNavGroup;
  requiresPersonalTenant?: boolean;
}

export interface SettingsPanelContribution {
  /** must start with "plugin:" followed by the plugin slug */
  sectionKey: string;
  componentId: string;
}

export interface CronContribution {
  schedule: string;
  handlerId: string;
}

export interface WorkerRouteContribution {
  pattern: string;
  handlerId: string;
}

export interface PluginCapabilities {
  nav?: NavContribution[];
  settingsPanel?: SettingsPanelContribution;
  cron?: CronContribution[];
  workerRoutes?: WorkerRouteContribution[];
  trpcSubRouter?: boolean;
  healthCheck?: boolean;
}

// ─── Permissions declaration (UI-only) ───────────────────────────────────────

export interface PluginPermissionDecl {
  key: string;
  scope: "read" | "write";
  sensitive?: boolean;
}

// ─── Billing ────────────────────────────────────────────────────────────────

export interface PluginBilling {
  model: BillingModel;
  featureKey?: string;
  stripePriceIdEnv?: string;
  priceHintUsd?: number;
  label?: LocalizedText;
}

// ─── Lifecycle declaration ──────────────────────────────────────────────────

export interface PluginLifecycle {
  onInstall?: boolean;
  onUninstall?: boolean;
  onEnable?: boolean;
  onDisable?: boolean;
}

// ─── Screenshot ─────────────────────────────────────────────────────────────

export interface PluginScreenshot {
  url: string;
  captionKey?: string;
}

// ─── Icon ───────────────────────────────────────────────────────────────────

export interface PluginIcon {
  /** lucide-react icon name */
  name: string;
  /** hex colour (3-8 digits including leading #) */
  tint: string;
}

// ─── Root manifest ──────────────────────────────────────────────────────────

export interface PluginManifest {
  slug: string;
  version: string;
  vendor: "manicbot";
  category: PluginCategory;
  status: PluginStatus;
  scope: PluginScope;
  icon: PluginIcon;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  keywords: LocalizedKeywords;
  screenshots?: PluginScreenshot[];
  availableForRoles: PluginRole[];
  minPlan: PlanGate;
  billing: PluginBilling;
  permissions: PluginPermissionDecl[];
  capabilities: PluginCapabilities;
  lifecycle: PluginLifecycle;
}

// ─── Runtime module shape (produced by registry) ────────────────────────────

export interface PluginModule {
  manifest: PluginManifest;
  loadRouter?: () => Promise<{ router: unknown }>;
  loadLifecycle?: () => Promise<{
    onInstall?: (ctx: PluginLifecycleCtx) => Promise<void>;
    onUninstall?: (ctx: PluginLifecycleCtx) => Promise<void>;
    onEnable?: (ctx: PluginLifecycleCtx) => Promise<void>;
    onDisable?: (ctx: PluginLifecycleCtx) => Promise<void>;
  }>;
  loadHealth?: () => Promise<{
    checkHealth: (ctx: PluginHealthCtx) => Promise<{
      status: "ok" | "degraded" | "down" | "not_configured";
      detail?: string;
    }>;
  }>;
}

export interface PluginLifecycleCtx {
  db: unknown;
  tenantId: string | null;
  webUserId: string;
  settings: Record<string, unknown> | null;
  stripe?: unknown;
  env?: Record<string, string | undefined>;
}

export interface PluginHealthCtx {
  db: unknown;
  env: Record<string, string | undefined>;
}

// ─── Derived lock state (computed per viewer) ──────────────────────────────

export type PluginLockReason =
  | { kind: "none" }
  | { kind: "coming_soon" }
  | { kind: "role_mismatch"; availableFor: PluginRole[] }
  | { kind: "plan"; required: PlanGate; current: string | null }
  | { kind: "platform_only"; currentScope: PluginScope };

export interface CatalogCard {
  slug: string;
  category: PluginCategory;
  status: PluginStatus;
  iconName: string;
  iconTint: string;
  name: string;
  tagline: string;
  description: string;
  keywords: string[];
  billingLabel: string;
  billingModel: BillingModel;
  priceHintUsd?: number;
  lock: PluginLockReason;
  installed: boolean;
  installationId: string | null;
  enabled: boolean;
}
