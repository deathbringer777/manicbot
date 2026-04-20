/**
 * Plugin enforcement guard.
 *
 * Throws FORBIDDEN when a caller tries to use a plugin's sub-router without
 * having it installed + enabled for their current scope. Lookup order:
 *
 *   1. Platform-wide install (tenant_id IS NULL) — wins if present & enabled
 *   2. Tenant-local install (tenant_id = caller's tenant) — fallback
 *
 * Also verifies billing state for paid addons. `paid_addon_monthly` plugins
 * with billing_state 'past_due' or 'canceled' are treated as disabled.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { pluginInstallations, tenants } from "~/server/db/schema";
import { getPlugin } from "@plugins/index";
import type {
  PluginManifest,
  PluginRole,
  PlanGate,
  PluginBillingState,
} from "@plugins/types";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

type GuardCtx = {
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

export interface PluginGuardResult {
  installationId: string;
  scope: "platform" | "tenant";
  settings: Record<string, unknown> | null;
  manifest: PluginManifest;
}

/** Ordered from weakest → strongest plan. */
const PLAN_ORDER: readonly string[] = ["start", "pro", "max"];

function meetsPlanGate(current: string | null | undefined, required: PlanGate): boolean {
  if (required === "any") return true;
  if (!current) return false;
  const currentIdx = PLAN_ORDER.indexOf(current);
  const requiredIdx = PLAN_ORDER.indexOf(required);
  return currentIdx >= 0 && requiredIdx >= 0 && currentIdx >= requiredIdx;
}

function billingStateAllows(billing: PluginManifest["billing"], state: PluginBillingState): boolean {
  const m = billing.model;
  if (m === "free" || m === "included_in_plan") return state !== "canceled";
  if (m === "paid_addon_monthly") return state === "paid" || state === "trialing";
  if (m === "paid_addon_onetime") return state === "paid";
  return false;
}

function roleMatches(role: string, allowed: PluginRole[]): boolean {
  return (allowed as string[]).includes(role);
}

/**
 * Throw if the plugin is not installed/enabled for the caller,
 * or if their role/plan/billing status disqualifies them.
 *
 * Returns the effective install metadata so callers can read settings.
 */
export async function assertPluginEnabled(
  ctx: GuardCtx,
  slug: string,
): Promise<PluginGuardResult> {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

  const plugin = getPlugin(slug);
  if (!plugin) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Plugin "${slug}" is not registered`,
    });
  }
  const m = plugin.manifest;

  if (m.status === "coming_soon") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Plugin "${slug}" is not yet available`,
    });
  }

  const role = ctx.webUser.webRole;
  const tenantId = ctx.webUser.tenantId;

  if (!roleMatches(role, m.availableForRoles)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Plugin "${slug}" is not available for role "${role}"`,
    });
  }

  // Lookup install — platform first, then tenant-local. One query with OR.
  const conds = [isNull(pluginInstallations.tenantId)];
  if (tenantId) conds.push(eq(pluginInstallations.tenantId, tenantId));
  const rows = await ctx.db
    .select()
    .from(pluginInstallations)
    .where(
      and(
        eq(pluginInstallations.pluginSlug, slug),
        or(...conds),
      ),
    );

  const platformRow = rows.find((r) => r.tenantId === null);
  const tenantRow = rows.find((r) => r.tenantId && r.tenantId === tenantId);
  const chosen = platformRow ?? tenantRow ?? null;

  if (!chosen) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Plugin "${slug}" is not installed`,
    });
  }

  if (chosen.enabled !== 1) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Plugin "${slug}" is disabled`,
    });
  }

  if (!billingStateAllows(m.billing, chosen.billingState as PluginBillingState)) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: `Plugin "${slug}" billing state "${chosen.billingState}" does not allow usage`,
    });
  }

  // Plan gate — only checked for tenant-scoped installs. Platform installs
  // are a system_admin decision and bypass plan checks.
  if (m.minPlan !== "any" && tenantId && chosen.tenantId !== null) {
    const [t] = await ctx.db
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const plan = t?.plan ?? null;
    if (!meetsPlanGate(plan, m.minPlan)) {
      throw new TRPCError({
        code: "PAYMENT_REQUIRED",
        message: `Plugin "${slug}" requires plan "${m.minPlan}" (current: "${plan ?? "none"}")`,
      });
    }
  }

  let settings: Record<string, unknown> | null = null;
  if (chosen.settingsJson) {
    try { settings = JSON.parse(chosen.settingsJson); }
    catch { settings = null; }
  }

  return {
    installationId: chosen.id,
    scope: chosen.tenantId === null ? "platform" : "tenant",
    settings,
    manifest: m,
  };
}

// Exported helpers — also used by tests and the listCatalog resolver to
// compute the `lock` reason without throwing.
export { meetsPlanGate, billingStateAllows, roleMatches };
