/**
 * appointments.createManual — unassigned-master path (2026-05-26).
 *
 * Salon owners must be able to book a slot without committing to a specific
 * master, e.g. when the salon just registered and has no masters yet, or
 * when the owner wants to assign the booking later. Previously the zod
 * input schema required `masterId: z.number().int()`, blocking the modal
 * entirely on salons with an empty roster.
 *
 * Contract:
 *   - Owner / system_admin role: `masterId` may be omitted → DB row gets
 *     `master_id = NULL`; the synthetic Unassigned column in SalonDayView
 *     surfaces the booking (chatId = -1 fallback).
 *   - Master role: `masterId` is REQUIRED. Allowing a master to create
 *     an unassigned booking on someone else's tenant breaks the existing
 *     IDOR contract (`assertCallerIsMaster` only validates the master's
 *     OWN masterId).
 *   - Skipping per-master block checks (master_client_blocks) is safe —
 *     they're keyed on (tenant, master, client). With master_id = NULL
 *     there is no per-master scope, only the global block check applies.
 *   - Skipping slotsBusy is safe — slot conflicts are per-master. With
 *     no master assigned the booking is a placeholder waiting for the
 *     owner's later assignment, at which point the row goes through
 *     `appointments.update` and gets the conflict guard there.
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
import { slotsBusy } from "~/server/api/slotsBusy";
import { makeAdminCtx, makeTenantOwnerCtx, makeMasterCtx } from "./helpers/db-mock";

const slotsBusyMock = vi.mocked(slotsBusy);

const TENANT = "t_demo";

function chainable(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const inserts: any[] = [];
  const updates: any[] = [];
  const db: any = {
    select: vi.fn(() => chainable(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: any) => {
        inserts.push(vals);
        return {
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          then: (r: any) => Promise.resolve({ ok: true }).then(r),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: any) => {
        updates.push(vals);
        return { where: vi.fn().mockResolvedValue({ ok: true }) };
      }),
    })),
    $client: {
      prepare: () => ({ bind: () => ({ run: async () => undefined }) }),
    },
  };
  return { db, inserts, updates, selectsRemaining: () => queue.length };
}

describe("appointments.createManual — unassigned master (masterId omitted)", () => {
  const createCaller = createCallerFactory(appointmentsRouter);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    slotsBusyMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("owner: creates appointment with master_id=null when masterId omitted (new client)", async () => {
    // Select queue for a new-client path WITHOUT masterId:
    //   1. service lookup
    //   2. (NO per-master block early check — masterId omitted)
    //   3. post-resolve users global block (post-create check)
    //   4. (NO per-master block post-resolve)
    const dbMock = buildDb([
      [{ svcId: "classic", duration: 60, price: 80 }],
      [{ isBlockedGlobal: 0 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const r = await caller.createManual({
      tenantId: TENANT,
      // masterId intentionally omitted
      serviceId: "classic",
      date: "2026-09-12",
      time: "11:00",
      clientName: "Walk-in",
      clientPhone: "+48123456789",
    });
    expect(r.ok).toBe(true);
    // slotsBusy must NOT be called when masterId is null — no master = no conflict scope.
    expect(slotsBusyMock).not.toHaveBeenCalled();
    // The inserted appointment row should carry masterId: null.
    const aptInsert = dbMock.inserts.find((v) => v.id?.startsWith?.("a"));
    expect(aptInsert).toBeDefined();
    expect(aptInsert.masterId).toBeNull();
  });

  it("owner: creates appointment with master_id=null for existing client (skips per-master block check)", async () => {
    // Select queue for existing client + no master:
    //   1. early users global block check (clientChatId provided)
    //   2. (NO master_client_blocks check — masterId omitted)
    //   3. service lookup
    //   4. (NO slotsBusy)
    //   5. post-resolve users global block re-check
    //   6. (NO master_client_blocks re-check)
    const dbMock = buildDb([
      [{ isBlockedGlobal: 0 }],
      [{ svcId: "classic", duration: 60, price: 80 }],
      [{ isBlockedGlobal: 0 }],
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    const r = await caller.createManual({
      tenantId: TENANT,
      clientChatId: 42,
      // masterId intentionally omitted
      serviceId: "classic",
      date: "2026-09-12",
      time: "11:00",
    });
    expect(r.ok).toBe(true);
    expect(slotsBusyMock).not.toHaveBeenCalled();
    const aptInsert = dbMock.inserts.find((v) => v.id?.startsWith?.("a"));
    expect(aptInsert).toBeDefined();
    expect(aptInsert.masterId).toBeNull();
  });

  it("master role: refuses when masterId is omitted (cannot create unassigned bookings)", async () => {
    // Masters must always own the booking they create. The lookup-loaded
    // masters row binds via web_user_id; if masterId is null we cannot
    // verify the caller is the row, so we refuse outright.
    //
    // Master role passes `assertTenantOwner` only on a PERSONAL tenant,
    // so the first select returns `{ isPersonal: 1 }` to clear that gate
    // before the createManual master-role branch fires the actual reject.
    const dbMock = buildDb([
      [{ isPersonal: 1 }], // assertTenantOwner tenants probe
    ]);
    const caller = createCaller(makeMasterCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.createManual({
        tenantId: TENANT,
        clientChatId: 42,
        // masterId intentionally omitted
        serviceId: "classic",
        date: "2026-09-12",
        time: "11:00",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Masters can only book on their own calendar",
    });
  });

  it("owner: existing path with masterId still works (regression — backward compatibility)", async () => {
    // Queue mirrors `appointments-block-enforcement.test.ts`'s happy path.
    const dbMock = buildDb([
      [{ isBlockedGlobal: 0 }],
      [],
      [{ svcId: "classic", duration: 60, price: 80 }],
      [{ isBlockedGlobal: 0 }],
      [],
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    const r = await caller.createManual({
      tenantId: TENANT,
      clientChatId: 42,
      masterId: 7,
      serviceId: "classic",
      date: "2026-09-12",
      time: "11:00",
    });
    expect(r.ok).toBe(true);
    expect(slotsBusyMock).toHaveBeenCalledTimes(1);
    const aptInsert = dbMock.inserts.find((v) => v.id?.startsWith?.("a"));
    expect(aptInsert.masterId).toBe(7);
  });
});
