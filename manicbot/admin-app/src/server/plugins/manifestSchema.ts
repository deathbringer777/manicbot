/**
 * Zod schemas for the plugin manifest types defined in `@plugins/types`.
 *
 * Runtime validation owner. The registry does not import Zod — instead,
 * admin-app calls `validateAll()` at test-time to catch bad manifests before
 * they reach production.
 *
 * Keep in sync with `manicbot/plugins/types.ts` — if a new field is added to
 * the TS type, mirror it here.
 */

import { z } from "zod";
import type { PluginManifest } from "@plugins/types";
import {
  PLUGIN_CATEGORIES,
  PLUGIN_STATUSES,
  BILLING_MODELS,
  PLUGIN_SCOPES,
  PLUGIN_ROLES,
  PLAN_GATE_VALUES,
  NAV_GROUPS,
  listManifests,
} from "@plugins/index";

// ─── Localized fields ────────────────────────────────────────────────────────

const LocalizedTextSchema = z.object({
  ru: z.string().min(1),
  ua: z.string().min(1),
  en: z.string().min(1),
  pl: z.string().min(1),
});

const LocalizedKeywordsSchema = z.object({
  ru: z.array(z.string().min(1)).min(1),
  ua: z.array(z.string().min(1)).min(1),
  en: z.array(z.string().min(1)).min(1),
  pl: z.array(z.string().min(1)).min(1),
});

// ─── Enums (mirror types.ts) ─────────────────────────────────────────────────

export const PluginCategorySchema = z.enum(PLUGIN_CATEGORIES);
export const PluginStatusSchema = z.enum(PLUGIN_STATUSES);
export const BillingModelSchema = z.enum(BILLING_MODELS);
export const PluginScopeSchema = z.enum(PLUGIN_SCOPES);
export const PluginRoleSchema = z.enum(PLUGIN_ROLES);
export const PlanGateSchema = z.enum(PLAN_GATE_VALUES);
export const NavGroupSchema = z.enum(NAV_GROUPS);

// ─── Capability contributions ───────────────────────────────────────────────

const NavContributionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase dotted id"),
  href: z.string().startsWith("/"),
  iconName: z.string().min(1),
  labelKey: z.string().min(1),
  roles: z.array(PluginRoleSchema).min(1),
  group: NavGroupSchema.optional(),
  requiresPersonalTenant: z.boolean().optional(),
});

const SettingsPanelContributionSchema = z.object({
  sectionKey: z.string().regex(/^plugin:[a-z0-9][a-z0-9-]*$/),
  componentId: z.string().min(1),
});

const CronContributionSchema = z.object({
  schedule: z.string().min(1),
  handlerId: z.string().min(1),
});

const WorkerRouteContributionSchema = z.object({
  pattern: z.string().min(1),
  handlerId: z.string().min(1),
});

const PluginCapabilitiesSchema = z.object({
  nav: z.array(NavContributionSchema).optional(),
  settingsPanel: SettingsPanelContributionSchema.optional(),
  cron: z.array(CronContributionSchema).optional(),
  workerRoutes: z.array(WorkerRouteContributionSchema).optional(),
  trpcSubRouter: z.boolean().optional(),
  healthCheck: z.boolean().optional(),
});

const PluginPermissionDeclSchema = z.object({
  key: z.string().min(1),
  scope: z.enum(["read", "write"]),
  sensitive: z.boolean().optional(),
});

const PluginBillingSchema = z.object({
  model: BillingModelSchema,
  featureKey: z.string().optional(),
  stripePriceIdEnv: z.string().optional(),
  priceHintUsd: z.number().nonnegative().optional(),
  label: LocalizedTextSchema.optional(),
});

const PluginLifecycleSchema = z.object({
  onInstall: z.boolean().optional(),
  onUninstall: z.boolean().optional(),
  onEnable: z.boolean().optional(),
  onDisable: z.boolean().optional(),
});

const PluginScreenshotSchema = z.object({
  url: z.string().url().or(z.string().startsWith("/")),
  captionKey: z.string().min(1).optional(),
});

export const PluginManifestSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/, "kebab-case, 3-40 chars"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver major.minor.patch"),
  vendor: z.literal("manicbot"),
  category: PluginCategorySchema,
  status: PluginStatusSchema,
  scope: PluginScopeSchema,
  icon: z.object({
    name: z.string().min(1),
    tint: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
  }),
  name: LocalizedTextSchema,
  tagline: LocalizedTextSchema,
  description: LocalizedTextSchema,
  keywords: LocalizedKeywordsSchema,
  screenshots: z.array(PluginScreenshotSchema).optional(),
  availableForRoles: z.array(PluginRoleSchema).min(1),
  minPlan: PlanGateSchema,
  billing: PluginBillingSchema,
  permissions: z.array(PluginPermissionDeclSchema),
  capabilities: PluginCapabilitiesSchema,
  lifecycle: PluginLifecycleSchema,
});

export function validateManifest(m: PluginManifest): z.SafeParseReturnType<PluginManifest, PluginManifest> {
  return PluginManifestSchema.safeParse(m) as z.SafeParseReturnType<PluginManifest, PluginManifest>;
}

/** Validate every registered manifest — used by tests and dev smoke checks. */
export function validateAllManifests(): { ok: true; count: number } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const manifests = listManifests();
  for (const m of manifests) {
    const r = PluginManifestSchema.safeParse(m);
    if (!r.success) {
      errors.push(`[${m.slug}] ${r.error.message}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, count: manifests.length };
}
