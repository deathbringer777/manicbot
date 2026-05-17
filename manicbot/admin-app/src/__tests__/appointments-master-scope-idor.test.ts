/**
 * appointments.createManual + appointments.rescheduleAppointment — master
 * role IDOR guard.
 *
 * Bug regression. PR #124 (drag-to-reschedule) and the earlier manual-booking
 * router both gate the "master role can only act on their own calendar" rule
 * by looking up the master row in `masters` with WHERE (tenantId, active=1).
 * That predicate identifies "any active master in the tenant" — NOT "the
 * caller". In a multi-master salon both rows are active and the query
 * returns whichever the DB happens to order first (insertion order in
 * SQLite). The check then compares that arbitrary master's chat_id against
 * input.masterId / apt.masterId.
 *
 * Net effect on a 2-master salon:
 *   - Half the masters lose access to their own calendar (chosen master
 *     row != caller → false FORBIDDEN).
 *   - The "first" master can target the "other" master's calendar without
 *     being rejected (chosen master row matches the IDOR target → check
 *     passes).
 *
 * Fix: bind the lookup to `masters.web_user_id = ctx.webUser.id` (same
 * pattern `masterRouter.ts assertCallerIsMaster` already uses, #P0-4).
 *
 * This test asserts that the master-role SELECT against `masters` contains
 * a `web_user_id` predicate. The buggy code fails the assertion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));

vi.mock("~/server/api/slotsBusy", () => ({
  slotsBusy: vi.fn().mockResolvedValue({ busy: false }),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { makeMasterCtx } from "./helpers/db-mock";

const TENANT = "t_two_masters";

/**
 * Walks a Drizzle SQL object's `queryChunks` tree (and only that tree —
 * NOT the back-references on Column objects, which point at the full
 * table schema and would always match) looking for a column reference
 * with `name === "web_user_id"`.
 */
function whereContainsWebUserId(arg: unknown): boolean {
  function walk(node: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    const obj = node as { name?: unknown; queryChunks?: unknown[] };
    if (obj.name === "web_user_id") return true;
    if (Array.isArray(obj.queryChunks)) {
      for (const chunk of obj.queryChunks) {
        if (walk(chunk)) return true;
      }
    }
    return false;
  }
  return walk(arg);
}

interface WhereCapturingMock {
  db: unknown;
  wheres: unknown[];
}

function buildDb(selectResults: unknown[][]): WhereCapturingMock {
  const queue = [...selectResults];
  const wheres: unknown[] = [];

  function makeChain(result: unknown): unknown {
    const limitChain: Record<string, unknown> = {
      offset: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        wheres.push(cond);
        return chain;
      },
      orderBy: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      groupBy: () => chain,
      limit: () => limitChain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ ok: true }).then(r),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((cond: unknown) => {
          wheres.push(cond);
          return Promise.resolve({ ok: true });
        }),
      })),
    })),
    $client: { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
  };
  return { db, wheres };
}

describe("appointments — master role scoping uses web_user_id binding", () => {
  const createCaller = createCallerFactory(appointmentsRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createManual: master-role lookup against `masters` is bound to web_user_id", async () => {
    // Imagine a 2-master salon. The DB happens to return Master B's row
    // first (chatId 200) when we filter only on (tenantId, active=1).
    // The caller is Master A (web_user_id = w_master). With the buggy
    // query (no web_user_id filter), the resolver thinks "you are Master B"
    // and lets the IDOR through. The fix binds to web_user_id so the
    // resolver returns Master A's row (chatId 100) and the check throws.
    const { db, wheres } = buildDb([
      [{ isPersonal: 1 }],   // assertTenantOwner → personal-tenant master gate
      [{ chatId: 200 }],     // master-role lookup (the WHERE we pin)
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    // Master A targets Master B's calendar. Pre-fix the check passes because
    // the lookup returned Master B's row. We don't care about the rest of
    // the flow — the contract we're pinning is the QUERY shape.
    try {
      await caller.createManual({
        tenantId: TENANT,
        clientName: "Client",
        clientPhone: "+48123456789",
        masterId: 200,
        serviceId: "classic",
        date: "2026-09-12",
        time: "11:00",
      });
    } catch {
      // Either outcome is fine here — we're asserting on the WHERE shape.
    }

    expect(wheres.length).toBeGreaterThanOrEqual(2);
    // The master-role SELECT is the second WHERE (assertTenantOwner runs
    // first to verify the personal-tenant flag). Pre-fix this assertion
    // fails because the buggy WHERE is just (tenantId, active=1).
    expect(whereContainsWebUserId(wheres[1])).toBe(true);
  });

  it("rescheduleAppointment: master-role lookup against `masters` is bound to web_user_id", async () => {
    // Selects in order:
    //   1. assertTenantOwner → tenants.isPersonal lookup
    //   2. appointment row (by id + tenant)
    //   3. masters lookup — the WHERE we're pinning
    const { db, wheres } = buildDb([
      [{ isPersonal: 1 }],
      [{ id: "a1", tenantId: TENANT, date: "2026-09-12", time: "10:00", masterId: 200, svcId: "classic", cancelled: 0, noShow: 0, status: "confirmed" }],
      [{ chatId: 200 }],
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    try {
      await caller.rescheduleAppointment({
        tenantId: TENANT,
        appointmentId: "a1",
        newDate: "2026-09-12",
        newTime: "12:00",
      });
    } catch {
      // ignore — we only inspect the WHERE shape.
    }

    expect(wheres.length).toBeGreaterThanOrEqual(3);
    // wheres[0]: assertTenantOwner tenants lookup
    // wheres[1]: appointment row by id+tenant
    // wheres[2]: master-role lookup — must be bound to web_user_id post-fix
    expect(whereContainsWebUserId(wheres[2])).toBe(true);
  });

  it("createManual: rejects when caller's master row doesn't exist (no fallback)", async () => {
    // assertCallerIsMaster pattern: if the bound row is missing, the answer
    // is FORBIDDEN, never "let any active master through". This regression
    // would have caught the pre-fix code where an empty result still fell
    // through to whatever the first row happened to be.
    const { db } = buildDb([
      [{ isPersonal: 1 }], // assertTenantOwner
      [],                  // master-role lookup → no bound row
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    await expect(
      caller.createManual({
        tenantId: TENANT,
        clientName: "Client",
        clientPhone: "+48123456789",
        masterId: 100,
        serviceId: "classic",
        date: "2026-09-12",
        time: "11:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rescheduleAppointment: rejects when caller's master row doesn't exist", async () => {
    const { db } = buildDb([
      [{ isPersonal: 1 }],
      [{ id: "a1", tenantId: TENANT, date: "2026-09-12", time: "10:00", masterId: 100, svcId: "classic", cancelled: 0, noShow: 0, status: "confirmed" }],
      [], // master-role lookup → empty
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    await expect(
      caller.rescheduleAppointment({
        tenantId: TENANT,
        appointmentId: "a1",
        newDate: "2026-09-12",
        newTime: "12:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
