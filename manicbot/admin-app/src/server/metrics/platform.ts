/**
 * Platform-level metrics — "our business": how many real salon accounts we
 * have, how many actually pay, how much MRR/ARR, how many are on a live trial
 * or comped. This is strictly separate from per-tenant operational metrics
 * (see {@link ./tenant}).
 *
 * Every number here excludes test tenants and is derived from
 * {@link classifyTenant}, so MRR cannot be inflated by expired trials or
 * grant/promo-code "active" tenants.
 */

import { and, eq } from "drizzle-orm";
import { tenants, webUsers } from "~/server/db/schema";
import { classifyTenant } from "./status";

export interface PlatformMetrics {
  /** Real (non-test) salon-owner accounts with a provisioned tenant. */
  ourCustomers: number;
  /** Tenants with a real, paid Stripe subscription. */
  paying: number;
  /** Tenants with granted/promo access and no real payment. */
  comped: number;
  /** Tenants on a trial that has not yet expired. */
  activeTrials: number;
  /** Tenants that lapsed (expired trial, canceled, unpaid, inactive…). */
  churned: number;
  /** Monthly recurring revenue in PLN — real paying tenants only. */
  mrrPln: number;
  /** Annual run-rate (mrr × 12). */
  arrPln: number;
}

/**
 * Compute platform KPIs.
 *
 * @param db     a Drizzle D1 client
 * @param nowSec current time in unix seconds (injected for testability)
 */
export async function getPlatformMetrics(db: any, nowSec: number): Promise<PlatformMetrics> {
  // Pull every non-test tenant attached to a registered owner. The JOIN anchors
  // the set to real product accounts (orphan tenants without an owner, and test
  // tenants, are excluded at the SQL level).
  const rows = (await db
    .select({
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
      isTest: tenants.isTest,
      // 0116 — let classifyTenant exclude secondary salons. The webUsers JOIN
      // already drops them (a secondary has no web_users row), but selecting
      // this keeps the classifier's guard correct if that ever changes.
      parentTenantId: tenants.parentTenantId,
    })
    .from(tenants)
    .innerJoin(webUsers, eq(webUsers.tenantId, tenants.id))
    .where(and(eq(webUsers.role, "tenant_owner"), eq(tenants.isTest, 0)))) as Array<{
    plan: string | null;
    billingStatus: string | null;
    trialEndsAt: number | null;
    stripeSubscriptionId: string | null;
    isTest: number | null;
    parentTenantId: string | null;
  }>;

  let ourCustomers = 0;
  let paying = 0;
  let comped = 0;
  let activeTrials = 0;
  let churned = 0;
  let mrrPln = 0;

  for (const row of rows) {
    const c = classifyTenant(row, nowSec);
    // Defense in depth: even if a test row slips past the SQL pre-filter, the
    // classifier flags it and it never counts as one of "our customers".
    if (c.isTest) continue;
    ourCustomers += 1;
    switch (c.bucket) {
      case "paying":
        paying += 1;
        mrrPln += c.mrrPln;
        break;
      case "comped":
        comped += 1;
        break;
      case "trialing":
        activeTrials += 1;
        break;
      case "churned":
        churned += 1;
        break;
      // "none" (incl. test rows that slipped through) contributes nothing.
    }
  }

  return {
    ourCustomers,
    paying,
    comped,
    activeTrials,
    churned,
    mrrPln,
    arrPln: mrrPln * 12,
  };
}
