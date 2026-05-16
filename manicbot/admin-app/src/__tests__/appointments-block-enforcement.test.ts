/**
 * appointments.createManual — block-enforcement contract (0062).
 *
 * Mirrors the Worker-side `saveApt` sentinel test
 * (`manicbot/test/client-block-booking.test.js`) but for the admin-app
 * tRPC path used by the salon dashboard's ManualBookingModal.
 *
 * The salon-side router refuses bookings when either:
 *   1. `users.is_blocked_global = 1` for the client (tenant-wide block
 *      set by the owner) — emits `client_blocked_global`.
 *   2. A `master_client_blocks` row matches (master, client) — emits
 *      `client_blocked_for_master`.
 *
 * The check happens FIRST when the caller passed an existing
 * `clientChatId` so we fail fast with the clearest error. For new
 * clients (name + at-least-one-contact only) the post-resolve check
 * catches the case where the just-resolved chatId already matched a
 * block — practically only relevant for race conditions, but the
 * defence stays in place.
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

// slotsBusy must not interfere — return "free" always; the block check
// runs before it for existing clients and only runs after slot-conflict
// for fresh ones.
vi.mock("~/server/api/slotsBusy", () => ({
  slotsBusy: vi.fn().mockResolvedValue({ busy: false }),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { makeTenantOwnerCtx, makeAdminCtx } from "./helpers/db-mock";

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
  return { db, inserts, updates };
}

describe("appointments.createManual — block enforcement", () => {
  const createCaller = createCallerFactory(appointmentsRouter);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const INPUT = {
    tenantId: TENANT,
    clientChatId: 42,
    masterId: 7,
    serviceId: "classic",
    date: "2026-09-12",
    time: "11:00",
  };

  it("refuses with client_blocked_global when users.is_blocked_global=1", async () => {
    // Selects fired in order by createManual:
    //   1. tenants check inside assertTenantOwner (admin-ctx skips this branch
    //      — system_admin returns early). To be safe we still queue an empty.
    //   2. users lookup for the early block check → returns blocked row.
    const dbMock = buildDb([
      [{ isBlockedGlobal: 1 }], // early users lookup
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    await expect(caller.createManual(INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "client_blocked_global",
    });
    // No appointment row written.
    expect(dbMock.inserts.filter((v) => v.id?.startsWith?.("a"))).toHaveLength(0);
  });

  it("refuses with client_blocked_for_master when master_client_blocks row matches", async () => {
    const dbMock = buildDb([
      [{ isBlockedGlobal: 0 }], // not globally blocked
      [{ id: 1 }],               // master_client_blocks → hit
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    await expect(caller.createManual(INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "client_blocked_for_master",
    });
  });

  it("proceeds when no block matches (early gate passes)", async () => {
    const dbMock = buildDb([
      [{ isBlockedGlobal: 0 }],                    // not globally blocked
      [],                                          // no per-master block
      [{ svcId: "classic", duration: 60, price: 80 }], // service lookup
      [{ isBlockedGlobal: 0 }],                    // post-resolve global re-check (still 0)
      [],                                          // post-resolve master re-check (no block)
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);
    const r = await caller.createManual(INPUT);
    expect(r.ok).toBe(true);
    expect(r.appointmentId).toMatch(/^a/);
  });
});
