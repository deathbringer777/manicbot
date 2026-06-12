import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { tenants, webUsers } from "~/server/db/schema";
import { evaluateTrialState } from "~/lib/billing/trialState";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

/** tRPC context shape used by salon / channels / conversations routers */
export type TenantAccessCtx = {
  webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null | undefined;
  db: DbInstance;
};

/**
 * Verify caller is tenant_owner for tenantId, or system admin.
 * Independent masters (web role "master" on a personal tenant) also pass this check.
 */
export async function assertTenantOwner(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  // Reject null/empty tenantId — prevents null===null bypass
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }

  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.webUser.webRole === "system_admin") return;
  if (ctx.webUser.webRole === "tenant_owner" && ctx.webUser.tenantId === tenantId) return;
  // Independent master on their own personal tenant gets owner-level access
  if (ctx.webUser.webRole === "master" && ctx.webUser.tenantId === tenantId) {
    const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (t?.isPersonal) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
}

/**
 * Verify caller is a tenant member (owner OR tenant_manager) for tenantId, or system_admin.
 * Use this where read access is shared across roles.
 *
 * ⚠️ CS-7 (audit 2026-06-12): per-permission write gating via
 * `assertPermission()` is NOT wired anywhere yet — handlers must gate writes
 * themselves until the manager permission lane lands server-side.
 */
export async function assertTenantMember(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.webUser.webRole === "system_admin") return;
  if (ctx.webUser.tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Tenant scope mismatch" });
  }
  const role = ctx.webUser.webRole;
  if (role === "tenant_owner" || role === "tenant_manager") return;
  if (role === "master") {
    const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (t?.isPersonal) return;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Tenant member access required" });
}

/**
 * Server-side billing enforcement (audit 2026-06-12, CS-1 / H8).
 *
 * The trial/billing gate used to exist ONLY as a client render-swap in
 * (dashboard)/layout.tsx — a locked tenant could keep using the product by
 * calling tRPC directly. This guard re-evaluates the tenant's billing state
 * on the server via the SAME pure helper the UI gate uses
 * (`evaluateTrialState`), so the two layers cannot drift.
 *
 * Call it AFTER the tenant-access assert (assertTenantOwner /
 * assertTenantMember / assertThreadMember) so it never becomes a
 * billing-status oracle for tenants the caller is not a member of.
 *
 * Enforcement policy: applied to high-value PRODUCT mutations (booking
 * writes, outbound messaging, marketing sends). Reads and billing/settings
 * procedures intentionally stay open so the owner can see their data and
 * resolve the lock by paying.
 */
export async function assertTenantBillingActive(ctx: TenantAccessCtx, tenantId: string): Promise<void> {
  if (!tenantId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Tenant ID is required" });
  }
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  // Platform staff operate on tenants regardless of their billing state.
  if (ctx.webUser.webRole === "system_admin") return;

  const [t] = await ctx.db
    .select({
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
      stripeCustomerId: tenants.stripeCustomerId,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) {
    // Fail closed: a vanished tenant row must not grant a free pass.
    throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
  }

  const state = evaluateTrialState(t, Math.floor(Date.now() / 1000));
  if (state.isTrialExpired) {
    // `isTrialExpired` is the general "billing locked" signal (expired trial
    // OR churned/cancelled customer); comped grants never lock — see
    // evaluateTrialState / isCompedTenant.
    throw new TRPCError({ code: "FORBIDDEN", message: "billing_locked" });
  }
}

/**
 * Server-side email-verification enforcement (audit 2026-06-12, CS-2).
 *
 * The EmailVerificationGate in (dashboard)/layout.tsx is a client render-swap
 * only — an unverified account could operate the product via direct tRPC.
 * This guard re-checks web_users.email_verified on the server for the same
 * high-value outbound/product mutations as the billing gate (CS-1).
 *
 * `email_verified` is NOT NULL DEFAULT 0, so a fresh row is unverified until
 * the email flow (or a verified Google OAuth profile) flips it to 1. Platform
 * staff (system_admin) skip the check; a missing row fails closed.
 */
export async function assertEmailVerified(ctx: TenantAccessCtx): Promise<void> {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.webUser.webRole === "system_admin") return;

  const [row] = await ctx.db
    .select({ emailVerified: webUsers.emailVerified })
    .from(webUsers)
    .where(eq(webUsers.id, ctx.webUser.id))
    .limit(1);
  if (!row?.emailVerified) {
    throw new TRPCError({ code: "FORBIDDEN", message: "email_unverified" });
  }
}
