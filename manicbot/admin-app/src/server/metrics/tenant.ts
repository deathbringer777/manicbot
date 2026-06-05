/**
 * Per-tenant operational metrics — "how is THIS salon doing": how many distinct
 * clients it has served and how many appointments it has booked. Deliberately
 * separate from {@link ./platform} (our-business KPIs) so the two populations
 * are never mixed into one number again.
 *
 * Phase 2 will surface these to salon owners on their own dashboard; for now
 * the same function powers the God-Mode per-tenant view. The function is the
 * single definition of "clients processed" so platform and tenant surfaces
 * agree.
 */

import { and, eq, sql } from "drizzle-orm";
import { users, appointments } from "~/server/db/schema";

const THIRTY_DAYS_SEC = 30 * 86400;

export interface TenantMetrics {
  /** Distinct end-customers this salon has served (unique chat_id in `users`). */
  clientsProcessed: number;
  /** Non-cancelled appointments, all time. */
  appointmentsTotal: number;
  /** Non-cancelled appointments created in the last 30 days. */
  appointmentsThisMonth: number;
}

/**
 * Compute operational KPIs for a single tenant.
 *
 * @param db       a Drizzle D1 client
 * @param tenantId the salon's tenant id
 * @param nowSec   current time in unix seconds (injected for testability)
 */
export async function getTenantMetrics(db: any, tenantId: string, nowSec: number): Promise<TenantMetrics> {
  const since = nowSec - THIRTY_DAYS_SEC;

  const [clientsRow, totalRow, monthRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(distinct ${users.chatId})` })
      .from(users)
      .where(eq(users.tenantId, tenantId)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(appointments)
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.cancelled, 0))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.cancelled, 0),
          sql`${appointments.createdAt} >= ${since}`,
        ),
      ),
  ]);

  return {
    clientsProcessed: Number(clientsRow[0]?.count ?? 0),
    appointmentsTotal: Number(totalRow[0]?.count ?? 0),
    appointmentsThisMonth: Number(monthRow[0]?.count ?? 0),
  };
}
