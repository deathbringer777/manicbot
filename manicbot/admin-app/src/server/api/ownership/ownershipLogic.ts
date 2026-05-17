/**
 * Pure helpers for the ownership-transfer flow. Lifted out of the tRPC router
 * so each branch is independently unit-testable (no D1, no email side-effects).
 */

export const TRANSFER_TTL_SECONDS = 24 * 60 * 60;

/** Generate a 32-char URL-safe random token. */
export function generateTransferToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}

/** SHA-256 of the secret, hex-encoded. Same key shape we use elsewhere. */
export async function hashToken(token: string): Promise<string> {
  const buf = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface TransferEligibilityCheck {
  ok: boolean;
  reason?: "no_active_subscription" | "target_email_unverified" | "target_not_in_tenant" | "self_transfer" | "already_owner";
}

interface EligibilityInputs {
  /** Web user id of the would-be new owner. */
  targetUserId: string;
  /** Web user id of the current owner. */
  fromUserId: string;
  /** Tenant id we are operating on. */
  tenantId: string;
  /** Target's web_users row (id, role, tenant_id, email_verified). */
  target: { id: string; tenantId: string | null; emailVerified: number; role: string } | null | undefined;
  /** Tenant billing status (e.g. "trialing" / "active" / "grace" / "inactive" / "expired"). */
  billingStatus: string | null | undefined;
}

/**
 * Centralised gate for "is this transfer allowed?".
 *
 * Returning a structured reason keeps the router branchless and makes
 * "this combination is rejected" expressible as a single test assertion.
 */
export function checkTransferEligibility(i: EligibilityInputs): TransferEligibilityCheck {
  if (i.targetUserId === i.fromUserId) {
    return { ok: false, reason: "self_transfer" };
  }
  if (!i.target) {
    return { ok: false, reason: "target_not_in_tenant" };
  }
  if (i.target.tenantId !== i.tenantId) {
    return { ok: false, reason: "target_not_in_tenant" };
  }
  if (!i.target.emailVerified) {
    return { ok: false, reason: "target_email_unverified" };
  }
  if (i.target.role === "tenant_owner") {
    return { ok: false, reason: "already_owner" };
  }
  // Subscription must be in good standing: trialing / active / grace are OK,
  // inactive / expired / cancelled are rejected so we don't shuffle accounts
  // around while the tenant is on the dunning path.
  const okStatuses = new Set(["trialing", "active", "grace"]);
  const billing = (i.billingStatus ?? "trialing").toLowerCase();
  if (!okStatuses.has(billing)) {
    return { ok: false, reason: "no_active_subscription" };
  }
  return { ok: true };
}

/** True once `expires_at` has passed. Pure helper for both client and tests. */
export function isTokenExpired(expiresAt: number, nowSeconds: number): boolean {
  return nowSeconds >= expiresAt;
}
