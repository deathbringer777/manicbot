/**
 * Platform Customers router — sysadmin-only platform-side CRM.
 *
 * Surfaces the gap that the existing `/system/marketing/*` does NOT
 * cover: salon-owner accounts (who registered, what plan, who is
 * paying, who churned) and the newsletter directory. `/system/marketing`
 * is per-tenant CLIENT CRM (a salon's marketing toward its own
 * clients) — this router is the operator's view of HIS customers
 * (salon owners).
 *
 * All procedures are `adminProcedure`. Read-only — the sysadmin uses
 * Stripe Dashboard for actual subscription mutations.
 *
 * Tables touched:
 *   - `web_users` (role='tenant_owner' only)
 *   - `tenants`
 *   - `appointments` (count + last-10 for detail view)
 *   - `masters` (count for detail view)
 *   - `newsletter_subscribers` OR `email_subscribers` (whichever exists)
 *
 * The subscribers proc is defensive: a parallel PR is introducing
 * `newsletter_subscribers`. Until that lands, we probe the new table
 * first, fall back to the existing `email_subscribers`, and finally
 * return a `tableMissing` sentinel so the UI can render a friendly
 * "migration in flight" message instead of 500ing.
 */

import { z } from "zod";
import { and, desc, eq, sql, inArray, or, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import {
  webUsers,
  tenants,
  appointments,
  masters,
} from "~/server/db/schema";
import { PLAN_PRICES_PLN } from "~/lib/money";
import { classifyTenant, type ClassifiableTenant } from "~/server/metrics/status";
import { getPlatformMetrics } from "~/server/metrics/platform";

// ───────────────────────────────────────────────────────────────────
// MRR math lives in the shared metrics module (single source of truth,
// see `~/server/metrics/status`). Per-row revenue is derived via
// `classifyTenant`, so a comped / expired / test tenant never shows
// phantom MRR. The plan catalog is `PLAN_PRICES_PLN` in `~/lib/money`.
// ───────────────────────────────────────────────────────────────────

function planPricePln(plan: string | null): number {
  if (!plan) return 0;
  return PLAN_PRICES_PLN[plan] ?? 0;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Real recurring revenue for one tenant row (0 unless truly paying). */
function rowMrrPln(row: ClassifiableTenant): number {
  return classifyTenant(row, nowSec()).mrrPln;
}

// ───────────────────────────────────────────────────────────────────
// Newsletter subscribers — probe and read.
//
// Drizzle ORM has no native "table exists?" check, and listing
// `sqlite_master` per request would be wasteful. Instead we attempt
// the query and catch SQLite's "no such table" error. The cost of a
// missed-cache lookup is one DB round-trip per request, which is fine
// for a sysadmin-only surface and avoids stale schema caching on the
// edge runtime.
// ───────────────────────────────────────────────────────────────────

interface SubscriberRow {
  email: string;
  source: string | null;
  lang: string | null;
  confirmed: number;
  unsubscribed: number;
  createdAt: number;
}

interface ListSubscribersResult {
  tableMissing: boolean;
  table: string | null;
  rows: SubscriberRow[];
  total: number;
}

function isNoSuchTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /no such table/i.test(msg);
}

async function listSubscribersFromTable(
  db: any,
  table: string,
  filters: { source?: string; lang?: string; confirmedOnly?: boolean },
  limit: number,
  offset: number,
): Promise<ListSubscribersResult> {
  // The new schema (`newsletter_subscribers`, parallel PR) is expected
  // to carry: email, source, lang, confirmed, unsubscribed, created_at.
  // The existing `email_subscribers` (migration 0046) carries:
  // email, locale, confirmed, created_at — no `source` / `unsubscribed`.
  // We unify both shapes with COALESCE-style defaults so the UI sees
  // one row contract.
  const hasFullShape = table === "newsletter_subscribers";

  const whereClauses: string[] = [];
  const binds: unknown[] = [];

  if (filters.source && hasFullShape) {
    whereClauses.push(`source = ?`);
    binds.push(filters.source);
  }
  if (filters.lang) {
    // Both tables carry the language column under different names.
    whereClauses.push(hasFullShape ? `lang = ?` : `locale = ?`);
    binds.push(filters.lang);
  }
  if (filters.confirmedOnly) {
    whereClauses.push(`confirmed = 1`);
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const rowsSql = hasFullShape
    ? `SELECT email, source, lang, confirmed, unsubscribed, created_at AS createdAt
       FROM ${table}
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    : `SELECT email, NULL AS source, locale AS lang, confirmed, 0 AS unsubscribed,
              created_at AS createdAt
       FROM ${table}
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`;

  const rowBinds = [...binds, limit, offset];
  const countSql = `SELECT COUNT(*) AS cnt FROM ${table} ${where}`;

  const rowsRes = await db.run(sql.raw(rowsSql), rowBinds);
  const countRes = await db.run(sql.raw(countSql), binds);

  const rowsArr: SubscriberRow[] = (rowsRes?.results ?? rowsRes?.rows ?? []).map((r: any) => ({
    email: String(r.email ?? ""),
    source: r.source ?? null,
    lang: r.lang ?? null,
    confirmed: Number(r.confirmed ?? 0),
    unsubscribed: Number(r.unsubscribed ?? 0),
    createdAt: Number(r.createdAt ?? r.created_at ?? 0),
  }));

  const countArr = countRes?.results ?? countRes?.rows ?? [];
  const total = Number(countArr[0]?.cnt ?? 0);

  return { tableMissing: false, table, rows: rowsArr, total };
}

async function safeListSubscribers(
  db: any,
  filters: { source?: string; lang?: string; confirmedOnly?: boolean },
  limit: number,
  offset: number,
): Promise<ListSubscribersResult> {
  // 1. Try the new table the parallel PR is introducing.
  try {
    return await listSubscribersFromTable(db, "newsletter_subscribers", filters, limit, offset);
  } catch (e) {
    if (!isNoSuchTableError(e)) throw e;
  }
  // 2. Fall back to the existing `email_subscribers` (migration 0046).
  try {
    return await listSubscribersFromTable(db, "email_subscribers", filters, limit, offset);
  } catch (e) {
    if (!isNoSuchTableError(e)) throw e;
  }
  // 3. Neither table exists — UI renders an empty-state.
  return { tableMissing: true, table: null, rows: [], total: 0 };
}

async function safeCountSubscribers(db: any): Promise<number> {
  for (const table of ["newsletter_subscribers", "email_subscribers"]) {
    try {
      const res = await db.run(sql.raw(`SELECT COUNT(*) AS cnt FROM ${table}`));
      const arr = res?.results ?? res?.rows ?? [];
      return Number(arr[0]?.cnt ?? 0);
    } catch (e) {
      if (!isNoSuchTableError(e)) throw e;
    }
  }
  return 0;
}

// ───────────────────────────────────────────────────────────────────
// Validation schemas
// ───────────────────────────────────────────────────────────────────

const PLAN_VALUES = z.enum(["start", "pro", "max"]);
const STATUS_VALUES = z.enum([
  "trialing",
  "trial",
  "active",
  "grace",
  "past_due",
  "expired",
  "cancelled",
  "canceled",
]);

const accountsFilterSchema = z.object({
  plans: z.array(PLAN_VALUES).optional(),
  statuses: z.array(STATUS_VALUES).optional(),
  search: z.string().max(120).optional(),
});

const subscribersFilterSchema = z.object({
  source: z.string().max(80).optional(),
  lang: z.string().max(8).optional(),
  confirmedOnly: z.boolean().optional(),
});

// ───────────────────────────────────────────────────────────────────
// Router
// ───────────────────────────────────────────────────────────────────

export const platformCustomersRouter = createTRPCRouter({
  /**
   * Cross-tenant stats card. Keep cheap — KPI numbers only, NO PII.
   *
   * All numbers come from the shared `getPlatformMetrics` so this card, the
   * God-Mode dashboard and the billing overview agree to the cent. Test
   * tenants, expired trials and comped (grant/promo) accounts are excluded
   * from `paying` / `mrr_total_pln` and surfaced in their own buckets.
   */
  stats: adminProcedure.query(async ({ ctx }) => {
    const [platform, newsletterCount] = await Promise.all([
      getPlatformMetrics(ctx.db, nowSec()),
      safeCountSubscribers(ctx.db),
    ]);

    return {
      total_accounts: platform.ourCustomers,
      paying: platform.paying,
      comped: platform.comped,
      trialing: platform.activeTrials,
      churned: platform.churned,
      mrr_total_pln: platform.mrrPln,
      arr_total_pln: platform.arrPln,
      newsletter_subs: newsletterCount,
    };
  }),

  /**
   * Paginated list of salon-owner accounts joined with their tenant.
   *
   * `tenantId` may be null on a web_user row (registered but never
   * provisioned a tenant) — LEFT JOIN preserves those rows so the
   * sysadmin can spot stuck-onboarding cases.
   */
  listAccounts: adminProcedure
    .input(
      z.object({
        filters: accountsFilterSchema.optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = input.filters ?? {};
      const page = Math.max(0, input.page);
      const limit = input.pageSize;
      const offset = page * limit;

      const conds: any[] = [eq(webUsers.role, "tenant_owner")];
      if (filters.plans && filters.plans.length > 0) {
        conds.push(inArray(tenants.plan, filters.plans));
      }
      if (filters.statuses && filters.statuses.length > 0) {
        conds.push(inArray(tenants.billingStatus, filters.statuses));
      }
      if (filters.search && filters.search.trim()) {
        const s = `%${filters.search.trim().toLowerCase()}%`;
        conds.push(
          sql`(lower(${webUsers.email}) like ${s} or lower(coalesce(${webUsers.name},'')) like ${s})`,
        );
      }
      const whereExpr = conds.length === 1 ? conds[0] : and(...conds);

      const [rows, totalRow] = await Promise.all([
        ctx.db
          .select({
            webUserId: webUsers.id,
            name: webUsers.name,
            email: webUsers.email,
            lang: webUsers.lang,
            tenantId: webUsers.tenantId,
            createdAt: webUsers.createdAt,
            lastLoginAt: webUsers.lastLoginAt,
            tenantName: tenants.name,
            plan: tenants.plan,
            billingStatus: tenants.billingStatus,
            trialEndsAt: tenants.trialEndsAt,
            stripeCustomerId: tenants.stripeCustomerId,
            stripeSubscriptionId: tenants.stripeSubscriptionId,
            isTest: tenants.isTest,
            isPersonal: tenants.isPersonal,
          })
          .from(webUsers)
          .leftJoin(tenants, eq(webUsers.tenantId, tenants.id))
          .where(whereExpr)
          .orderBy(desc(webUsers.createdAt))
          .limit(limit)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(webUsers)
          .leftJoin(tenants, eq(webUsers.tenantId, tenants.id))
          .where(whereExpr),
      ]);

      // Per-tenant subqueries — keep the main JOIN clean by attaching
      // master count + 30d appointments lazily for the rendered page only.
      const tenantIds = Array.from(
        new Set(rows.map((r: any) => r.tenantId).filter((id: any) => !!id)),
      ) as string[];

      let masterCounts: Record<string, number> = {};
      let apt30dCounts: Record<string, number> = {};

      if (tenantIds.length > 0) {
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
        const [masterRows, aptRows] = await Promise.all([
          ctx.db
            .select({
              tenantId: masters.tenantId,
              count: sql<number>`count(*)`,
            })
            .from(masters)
            .where(inArray(masters.tenantId, tenantIds))
            .groupBy(masters.tenantId),
          ctx.db
            .select({
              tenantId: appointments.tenantId,
              count: sql<number>`count(*)`,
            })
            .from(appointments)
            .where(
              and(
                inArray(appointments.tenantId, tenantIds),
                sql`${appointments.createdAt} >= ${thirtyDaysAgo}`,
              ),
            )
            .groupBy(appointments.tenantId),
        ]);
        for (const r of masterRows) {
          if (r.tenantId) masterCounts[r.tenantId] = Number(r.count ?? 0);
        }
        for (const r of aptRows) {
          if (r.tenantId) apt30dCounts[r.tenantId] = Number(r.count ?? 0);
        }
      }

      const enriched = rows.map((r: any) => ({
        ...r,
        mastersCount: r.tenantId ? masterCounts[r.tenantId] ?? 0 : 0,
        appointments30d: r.tenantId ? apt30dCounts[r.tenantId] ?? 0 : 0,
        mrrPln: rowMrrPln(r),
      }));

      return {
        rows: enriched,
        total: Number(totalRow[0]?.count ?? 0),
        page,
        pageSize: limit,
      };
    }),

  /**
   * Newsletter subscribers — defensive over a parallel schema migration.
   */
  listSubscribers: adminProcedure
    .input(
      z.object({
        filters: subscribersFilterSchema.optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(500).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = input.filters ?? {};
      const page = Math.max(0, input.page);
      const limit = input.pageSize;
      const offset = page * limit;
      const result = await safeListSubscribers(ctx.db, filters, limit, offset);
      return { ...result, page, pageSize: limit };
    }),

  /**
   * Full-profile view for the row-click detail modal.
   */
  accountDetail: adminProcedure
    .input(z.object({ webUserId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          webUserId: webUsers.id,
          name: webUsers.name,
          email: webUsers.email,
          lang: webUsers.lang,
          role: webUsers.role,
          emailVerified: webUsers.emailVerified,
          tenantId: webUsers.tenantId,
          createdAt: webUsers.createdAt,
          lastLoginAt: webUsers.lastLoginAt,
          lastLoginIp: webUsers.lastLoginIp,
          referralSource: webUsers.referralSource,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          plan: tenants.plan,
          billingStatus: tenants.billingStatus,
          trialEndsAt: tenants.trialEndsAt,
          graceEndsAt: tenants.graceEndsAt,
          currentPeriodEnd: tenants.currentPeriodEnd,
          stripeCustomerId: tenants.stripeCustomerId,
          stripeSubscriptionId: tenants.stripeSubscriptionId,
          cancelAtPeriodEnd: tenants.cancelAtPeriodEnd,
          isTest: tenants.isTest,
          isPersonal: tenants.isPersonal,
        })
        .from(webUsers)
        .leftJoin(tenants, eq(webUsers.tenantId, tenants.id))
        .where(eq(webUsers.id, input.webUserId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      // Best-effort secondary lookups — keep within sysadmin scope only.
      let recentAppointments: Array<{
        id: string;
        date: string;
        time: string;
        status: string;
        userName: string | null;
      }> = [];
      let mastersCount = 0;
      let appointmentsTotal = 0;

      if (row.tenantId) {
        const [aptRows, mastersRow, aptTotalRow] = await Promise.all([
          ctx.db
            .select({
              id: appointments.id,
              date: appointments.date,
              time: appointments.time,
              status: appointments.status,
              userName: appointments.userName,
            })
            .from(appointments)
            .where(eq(appointments.tenantId, row.tenantId))
            .orderBy(desc(appointments.createdAt))
            .limit(10),
          ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(masters)
            .where(eq(masters.tenantId, row.tenantId)),
          ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(appointments)
            .where(eq(appointments.tenantId, row.tenantId)),
        ]);
        recentAppointments = aptRows.map((r: any) => ({
          id: String(r.id),
          date: String(r.date),
          time: String(r.time),
          status: String(r.status),
          userName: r.userName ?? null,
        }));
        mastersCount = Number(mastersRow[0]?.count ?? 0);
        appointmentsTotal = Number(aptTotalRow[0]?.count ?? 0);
      }

      return {
        ...row,
        mrrPln: rowMrrPln(row),
        mastersCount,
        appointmentsTotal,
        recentAppointments,
        stripeDashboardUrl: row.stripeCustomerId
          ? `https://dashboard.stripe.com/customers/${row.stripeCustomerId}`
          : null,
      };
    }),
});

// Exported for tests so the price math can be asserted in isolation.
// Bucket/MRR classification now lives in `~/server/metrics/status`
// (covered by metrics-classify.test.ts).
export const __testing = {
  planPricePln,
  rowMrrPln,
  isNoSuchTableError,
};

// Quiet unused-import lints — `or` and `isNotNull` are reserved for the
// upcoming "include accounts without a tenant in the search match" pass.
void or;
void isNotNull;
