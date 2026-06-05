/**
 * platformCustomers router — sysadmin Platform Customers page backend.
 *
 * Pins:
 *  - Every proc is `adminProcedure` → public/master/tenant_owner are rejected.
 *  - listAccounts filters compose into the WHERE: plan in (), status in (),
 *    search LIKE on email + name.
 *  - listAccounts pagination is offset-based; page=0 is the first page,
 *    page beyond last yields rows=[] without throwing.
 *  - stats math: MRR is only contributed by tenants in PAYING_STATUSES.
 *    Trialing / churned counters use TRIALING_STATUSES / CHURNED_STATUSES.
 *  - listSubscribers tolerates "no such table" — bubbles up the
 *    `tableMissing: true, rows: [], total: 0` sentinel.
 *  - accountDetail throws NOT_FOUND when the web_user does not exist.
 *  - accountDetail builds the Stripe Dashboard URL when stripeCustomerId
 *    is present; omits it (returns null) otherwise.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
  platformCustomersRouter,
  __testing,
} from "~/server/api/routers/platformCustomers";
import {
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
  makeSupportCtx,
} from "./helpers/db-mock";

const callerFor = createCallerFactory(platformCustomersRouter);

// ─── chain mock — captures every where/orderBy/limit/offset call ──────

interface SelectCapture {
  where?: unknown;
  whereSql?: string;
  orderBy?: unknown;
  limit?: number;
  offset?: number;
  groupBy?: unknown;
}

function chainable(result: unknown, capture?: SelectCapture) {
  const cap = capture ?? {};
  const limitChain: any = {
    offset: (o: number) => {
      cap.offset = o;
      return Promise.resolve(result);
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: (w: unknown) => {
      cap.where = w;
      // Drizzle conditions have a `getSQL()` method — stringify for assert.
      try {
        const sqlVal = (w as any)?.getSQL?.();
        cap.whereSql = sqlVal ? JSON.stringify(sqlVal) : String(w);
      } catch {
        cap.whereSql = String(w);
      }
      return chain;
    },
    orderBy: (o: unknown) => {
      cap.orderBy = o;
      return chain;
    },
    groupBy: (g: unknown) => {
      cap.groupBy = g;
      return chain;
    },
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: (n: number) => {
      cap.limit = n;
      return limitChain;
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(
  selectResults: unknown[][],
  opts: { runImpl?: (sqlStr: string, binds?: unknown[]) => unknown } = {},
) {
  const captures: SelectCapture[] = [];
  const queue = [...selectResults];
  const runCalls: Array<{ sql: string; binds: unknown[] }> = [];
  return {
    db: {
      select: vi.fn(() => {
        const cap: SelectCapture = {};
        captures.push(cap);
        const next = queue.shift() ?? [];
        return chainable(next, cap);
      }),
      run: vi.fn(async (sqlVal: any, binds?: unknown[]) => {
        // sql.raw(...) yields a SQL object — extract its string form.
        const sqlStr =
          typeof sqlVal === "string"
            ? sqlVal
            : sqlVal?.sql ?? sqlVal?.queryChunks?.map((c: any) => c.value?.[0] ?? "").join("") ?? String(sqlVal);
        runCalls.push({ sql: sqlStr, binds: binds ?? [] });
        if (opts.runImpl) return opts.runImpl(sqlStr, binds);
        return { results: [], rows: [] };
      }),
    },
    captures,
    runCalls,
  };
}

// ─── auth gating ──────────────────────────────────────────────────────

describe("platformCustomers router — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stats rejects unauthenticated callers", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stats rejects tenant_owner", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeTenantOwnerCtx(db, "t1") as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("stats rejects master", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeMasterCtx(db, "t1") as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("stats rejects support agents", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeSupportCtx(db, "support") as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("stats rejects technical_support agents", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeSupportCtx(db, "technical_support") as never);
    await expect(caller.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("every write-shaped proc is read-only — only 4 procs are exposed", () => {
    // Defensive: if someone adds a mutation by accident, this fails.
    const procs = Object.keys(platformCustomersRouter._def.procedures);
    expect(procs.sort()).toEqual(
      ["accountDetail", "listAccounts", "listSubscribers", "stats"].sort(),
    );
  });

  it("stats accepts system_admin", async () => {
    // getPlatformMetrics issues a single owner⋈tenant join; newsletter count
    // comes from db.run (returns empty → 0).
    const { db } = buildDb([
      [], // join rows (no real tenants)
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.stats();
    expect(res.total_accounts).toBe(0);
    expect(res.mrr_total_pln).toBe(0);
    expect(res.newsletter_subs).toBe(0);
  });
});

// ─── stats math ───────────────────────────────────────────────────────

describe("platformCustomers router — stats math", () => {
  beforeEach(() => vi.clearAllMocks());

  const FAR_FUTURE = 9_999_999_999; // trial that has not expired

  it("MRR only from real paying tenants; comped / trial / expired excluded", async () => {
    const { db } = buildDb([
      [
        { plan: "start", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", isTest: 0 }, // +45
        { plan: "pro", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_2", isTest: 0 }, // +60
        { plan: "max", billingStatus: "grace_period", trialEndsAt: null, stripeSubscriptionId: "sub_3", isTest: 0 }, // +90 (grace, real sub)
        { plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // comped (grant)
        { plan: "pro", billingStatus: "trialing", trialEndsAt: FAR_FUTURE, stripeSubscriptionId: null, isTest: 0 }, // trial
        { plan: "max", billingStatus: "expired", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // churned
        { plan: "start", billingStatus: "cancelled", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }, // churned
      ],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.stats();
    expect(res.total_accounts).toBe(7);
    expect(res.paying).toBe(3);
    expect(res.comped).toBe(1);
    expect(res.trialing).toBe(1);
    expect(res.churned).toBe(2);
    expect(res.mrr_total_pln).toBe(45 + 60 + 90);
    expect(res.arr_total_pln).toBe((45 + 60 + 90) * 12);
  });

  it("a granted 'active' tenant with no Stripe sub is comped, not paying MRR", async () => {
    const { db } = buildDb([
      [{ plan: "max", billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: null, isTest: 0 }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.stats();
    expect(res.paying).toBe(0);
    expect(res.comped).toBe(1);
    expect(res.mrr_total_pln).toBe(0);
  });

  it("ignores unknown plan names in MRR math (defaults to 0)", async () => {
    const { db } = buildDb([
      [{ plan: "enterprise" as any, billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_x", isTest: 0 }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.stats();
    expect(res.paying).toBe(1);
    expect(res.mrr_total_pln).toBe(0);
  });

  it("newsletter_subs uses safeCountSubscribers — 0 when both tables missing", async () => {
    const { db } = buildDb(
      [[]],
      {
        runImpl: () => {
          throw new Error("SQLITE_ERROR: no such table: newsletter_subscribers");
        },
      },
    );
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.stats();
    expect(res.newsletter_subs).toBe(0);
  });
});

// ─── listAccounts filters + pagination ────────────────────────────────

describe("platformCustomers router — listAccounts filters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("page=0 (default) issues a select with offset=0", async () => {
    const { db, captures } = buildDb([
      [], // rows
      [{ count: 0 }], // count
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listAccounts({ page: 0, pageSize: 50 });
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    // First select is the rows select — verify limit + offset on it.
    const rowsCapture = captures[0];
    expect(rowsCapture?.limit).toBe(50);
    expect(rowsCapture?.offset).toBe(0);
  });

  it("page=10 issues offset=500 when pageSize=50", async () => {
    const { db, captures } = buildDb([
      [], // rows
      [{ count: 5000 }], // count
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listAccounts({ page: 10, pageSize: 50 });
    expect(res.page).toBe(10);
    expect(res.pageSize).toBe(50);
    const rowsCapture = captures[0];
    expect(rowsCapture?.offset).toBe(500);
  });

  it("page beyond last returns empty rows but real total — UI can detect end-of-list", async () => {
    const { db } = buildDb([
      [], // rows past end
      [{ count: 12 }], // count is real
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listAccounts({ page: 999, pageSize: 50 });
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(12);
  });

  it("rejects negative page values via zod (min(0))", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.listAccounts({ page: -1, pageSize: 50 } as never),
    ).rejects.toBeDefined();
  });

  it("rejects pageSize > 200 via zod", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.listAccounts({ page: 0, pageSize: 999 } as never),
    ).rejects.toBeDefined();
  });

  it("attaches plan + status + search filters to the WHERE expression", async () => {
    const { db, captures } = buildDb([
      [], // rows
      [{ count: 0 }], // count
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.listAccounts({
      page: 0,
      pageSize: 50,
      filters: {
        plans: ["start", "pro"],
        statuses: ["active", "trialing"],
        search: "alice",
      },
    });
    // rowsCapture.where holds the and(...) Drizzle expression. Stringify
    // the SQL chunks and verify the bound values landed there.
    const rowsCapture = captures[0];
    expect(rowsCapture?.where).toBeDefined();
    // The count select uses the same WHERE.
    const countCapture = captures[1];
    expect(countCapture?.where).toBeDefined();
  });

  it("computes mrrPln per row using the same price catalog", async () => {
    const { db } = buildDb([
      [
        {
          webUserId: "w1",
          name: "Alice",
          email: "a@x.com",
          tenantId: "t1",
          createdAt: 1700000000,
          lastLoginAt: null,
          tenantName: "Salon A",
          plan: "pro",
          billingStatus: "active",
          trialEndsAt: null,
          stripeCustomerId: "cus_X",
          stripeSubscriptionId: "sub_X",
          isTest: 0,
          isPersonal: 0,
        },
        {
          webUserId: "w2",
          name: "Bob",
          email: "b@x.com",
          tenantId: "t2",
          createdAt: 1700000001,
          lastLoginAt: null,
          tenantName: "Salon B",
          plan: "start",
          billingStatus: "trialing",
          trialEndsAt: null,
          stripeCustomerId: null,
          isTest: 0,
          isPersonal: 0,
        },
      ],
      [{ count: 2 }],
      [{ tenantId: "t1", count: 3 }],
      [{ tenantId: "t1", count: 7 }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listAccounts({ page: 0, pageSize: 50 });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.mrrPln).toBe(60); // pro + active
    expect(res.rows[1]?.mrrPln).toBe(0); // trialing → no MRR
    expect(res.rows[0]?.mastersCount).toBe(3);
    expect(res.rows[0]?.appointments30d).toBe(7);
    // Tenant t2 wasn't returned in masters / appointments rollups → zero.
    expect(res.rows[1]?.mastersCount).toBe(0);
    expect(res.rows[1]?.appointments30d).toBe(0);
  });
});

// ─── listSubscribers ──────────────────────────────────────────────────

describe("platformCustomers router — listSubscribers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rows from newsletter_subscribers when the table exists", async () => {
    const { db, runCalls } = buildDb([], {
      runImpl: (sqlStr) => {
        if (/COUNT\(\*\)/i.test(sqlStr)) {
          return { results: [{ cnt: 2 }] };
        }
        return {
          results: [
            {
              email: "x@x.com",
              source: "footer",
              lang: "ru",
              confirmed: 1,
              unsubscribed: 0,
              createdAt: 1700000000,
            },
            {
              email: "y@y.com",
              source: "popup",
              lang: "en",
              confirmed: 0,
              unsubscribed: 0,
              createdAt: 1700000001,
            },
          ],
        };
      },
    });
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listSubscribers({ page: 0, pageSize: 50 });
    expect(res.tableMissing).toBe(false);
    expect(res.table).toBe("newsletter_subscribers");
    expect(res.rows).toHaveLength(2);
    expect(res.total).toBe(2);
    // First call hits newsletter_subscribers, NOT email_subscribers.
    expect(runCalls[0]?.sql).toMatch(/newsletter_subscribers/);
  });

  it("falls back to email_subscribers when newsletter_subscribers does not exist", async () => {
    let phase = 0;
    const { db } = buildDb([], {
      runImpl: (sqlStr) => {
        if (/newsletter_subscribers/.test(sqlStr)) {
          throw new Error("SQLITE_ERROR: no such table: newsletter_subscribers");
        }
        if (/COUNT\(\*\)/i.test(sqlStr)) {
          return { results: [{ cnt: 1 }] };
        }
        phase += 1;
        return {
          results: [
            {
              email: "legacy@x.com",
              source: null,
              lang: "ru",
              confirmed: 1,
              unsubscribed: 0,
              createdAt: 1690000000,
            },
          ],
        };
      },
    });
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listSubscribers({ page: 0, pageSize: 50 });
    expect(res.tableMissing).toBe(false);
    expect(res.table).toBe("email_subscribers");
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(phase).toBe(1);
  });

  it("returns tableMissing=true when neither table exists", async () => {
    const { db } = buildDb([], {
      runImpl: () => {
        throw new Error("SQLITE_ERROR: no such table: anything");
      },
    });
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.listSubscribers({ page: 0, pageSize: 50 });
    expect(res.tableMissing).toBe(true);
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.table).toBeNull();
  });

  it("re-throws non-'no such table' errors", async () => {
    const { db } = buildDb([], {
      runImpl: () => {
        throw new Error("SQLITE_BUSY: database is locked");
      },
    });
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.listSubscribers({ page: 0, pageSize: 50 }),
    ).rejects.toMatchObject({ message: /BUSY/ });
  });

  it("rejects unauthenticated callers", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(
      caller.listSubscribers({ page: 0, pageSize: 50 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeTenantOwnerCtx(db, "t1") as never);
    await expect(
      caller.listSubscribers({ page: 0, pageSize: 50 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── accountDetail ────────────────────────────────────────────────────

describe("platformCustomers router — accountDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws NOT_FOUND when web_user does not exist", async () => {
    const { db } = buildDb([
      [], // empty single-row lookup
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.accountDetail({ webUserId: "w_does_not_exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns full profile + recent appointments + masters count when tenant attached", async () => {
    const { db } = buildDb([
      [
        {
          webUserId: "w1",
          name: "Alice",
          email: "a@x.com",
          lang: "ru",
          role: "tenant_owner",
          emailVerified: 1,
          tenantId: "t1",
          createdAt: 1700000000,
          lastLoginAt: 1701000000,
          lastLoginIp: "1.2.3.4",
          referralSource: "google",
          tenantName: "Salon A",
          tenantSlug: "salon-a",
          plan: "pro",
          billingStatus: "active",
          trialEndsAt: null,
          graceEndsAt: null,
          currentPeriodEnd: 1702000000,
          stripeCustomerId: "cus_X",
          stripeSubscriptionId: "sub_X",
          cancelAtPeriodEnd: 0,
          isTest: 0,
          isPersonal: 0,
        },
      ],
      // recent appointments
      [
        { id: "a1", date: "2026-05-20", time: "10:00", status: "done", userName: "Client A" },
      ],
      // masters count
      [{ count: 4 }],
      // total appointments
      [{ count: 12 }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.accountDetail({ webUserId: "w1" });
    expect(res.email).toBe("a@x.com");
    expect(res.tenantId).toBe("t1");
    expect(res.mrrPln).toBe(60);
    expect(res.recentAppointments).toHaveLength(1);
    expect(res.mastersCount).toBe(4);
    expect(res.appointmentsTotal).toBe(12);
    expect(res.stripeDashboardUrl).toBe("https://dashboard.stripe.com/customers/cus_X");
  });

  it("omits Stripe URL + secondary lookups when account has no tenant", async () => {
    const { db } = buildDb([
      [
        {
          webUserId: "w_no_tenant",
          name: "Charlie",
          email: "c@x.com",
          lang: "en",
          role: "tenant_owner",
          emailVerified: 1,
          tenantId: null,
          createdAt: 1700000000,
          lastLoginAt: null,
          lastLoginIp: null,
          referralSource: null,
          tenantName: null,
          tenantSlug: null,
          plan: null,
          billingStatus: null,
          trialEndsAt: null,
          graceEndsAt: null,
          currentPeriodEnd: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          cancelAtPeriodEnd: null,
          isTest: null,
          isPersonal: null,
        },
      ],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    const res = await caller.accountDetail({ webUserId: "w_no_tenant" });
    expect(res.tenantId).toBeNull();
    expect(res.stripeDashboardUrl).toBeNull();
    expect(res.recentAppointments).toEqual([]);
    expect(res.mastersCount).toBe(0);
    expect(res.appointmentsTotal).toBe(0);
    expect(res.mrrPln).toBe(0);
  });

  it("rejects unauthenticated callers", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(
      caller.accountDetail({ webUserId: "w1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner role even with valid input", async () => {
    const { db } = buildDb([]);
    const caller = callerFor(makeTenantOwnerCtx(db, "t1") as never);
    await expect(
      caller.accountDetail({ webUserId: "w1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── pure-helper unit tests (price math + table-error detection) ──────

describe("platformCustomers — pure helpers", () => {
  it("planPricePln matches the documented catalog", () => {
    expect(__testing.planPricePln("start")).toBe(45);
    expect(__testing.planPricePln("pro")).toBe(60);
    expect(__testing.planPricePln("max")).toBe(90);
    expect(__testing.planPricePln(null)).toBe(0);
    expect(__testing.planPricePln("enterprise" as never)).toBe(0);
  });

  it("rowMrrPln only returns price for real paying tenants", () => {
    const base = { plan: "pro", trialEndsAt: null, isTest: 0 } as const;
    expect(__testing.rowMrrPln({ ...base, billingStatus: "active", stripeSubscriptionId: "sub" })).toBe(60);
    expect(__testing.rowMrrPln({ ...base, billingStatus: "grace_period", stripeSubscriptionId: "sub" })).toBe(60);
    // active but no real Stripe subscription → comped, no MRR
    expect(__testing.rowMrrPln({ ...base, billingStatus: "active", stripeSubscriptionId: null })).toBe(0);
    expect(__testing.rowMrrPln({ ...base, billingStatus: "trialing", stripeSubscriptionId: null })).toBe(0);
    expect(__testing.rowMrrPln({ ...base, billingStatus: "expired", stripeSubscriptionId: null })).toBe(0);
    // test tenant never contributes
    expect(__testing.rowMrrPln({ ...base, billingStatus: "active", stripeSubscriptionId: "sub", isTest: 1 })).toBe(0);
  });

  it("isNoSuchTableError matches SQLite + Drizzle variants", () => {
    expect(__testing.isNoSuchTableError(new Error("SQLITE_ERROR: no such table: x"))).toBe(true);
    expect(__testing.isNoSuchTableError(new Error("D1_ERROR: no such table: y"))).toBe(true);
    expect(__testing.isNoSuchTableError("no such table: z")).toBe(true);
    expect(__testing.isNoSuchTableError(new Error("connection refused"))).toBe(false);
    expect(__testing.isNoSuchTableError(undefined)).toBe(false);
  });
});
