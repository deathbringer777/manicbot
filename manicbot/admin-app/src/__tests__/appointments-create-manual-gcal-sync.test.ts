/**
 * appointments.createManual — immediate Google Calendar push (2026-06-04).
 *
 * Bug: a booking added from the dashboard "manual booking" modal was created
 * already-confirmed but NEVER triggered an outbound Google Calendar push,
 * unlike every other confirm path (bot APT_CONFIRM, dashboard updateStatus,
 * claimAndConfirm). The row only got synced by the ≤10-min `phaseGcalSync`
 * cron, so the owner who booked + immediately checked Google Calendar saw
 * nothing → reported "не дублируется в календарь гугл".
 *
 * Contract: after a successful createManual insert, the router fires
 * notifyWorker("sync_calendar", aptId, tenantId, null) — calendar-only, so
 * the manual booking stays SILENT to the client (no Telegram confirmation;
 * cf. updateStatus which uses "confirm" and DOES message the client).
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
import { makeAdminCtx } from "./helpers/db-mock";

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
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ ok: true }) })),
    })),
    $client: { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
  };
  return { db, inserts };
}

describe("appointments.createManual — immediate Google Calendar push", () => {
  const createCaller = createCallerFactory(appointmentsRouter);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    slotsBusyMock.mockClear().mockResolvedValue({ busy: false });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires notifyWorker('sync_calendar') for the new booking (existing client + master)", async () => {
    // Select queue for existing client + master happy path:
    //   1. early users global block check (clientChatId provided)
    //   2. master_client_blocks early check
    //   3. service lookup
    //   4. post-resolve users global block re-check
    //   5. master_client_blocks re-check
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

    // notifyWorker is fire-and-forget — let the microtask queue drain.
    await new Promise((res) => setTimeout(res, 0));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/admin/appointment-action"),
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.action).toBe("sync_calendar");
    expect(body.tenantId).toBe(TENANT);
    expect(body.appointmentId).toBe(r.appointmentId);
  });

  it("fires notifyWorker('sync_calendar') for an unassigned (no-master) booking too", async () => {
    // New-client, no master: service lookup → post-resolve global block.
    const dbMock = buildDb([
      [{ svcId: "classic", duration: 60, price: 80 }],
      [{ isBlockedGlobal: 0 }],
    ]);
    const caller = createCaller(makeAdminCtx(dbMock.db) as never);

    const r = await caller.createManual({
      tenantId: TENANT,
      serviceId: "classic",
      date: "2026-09-12",
      time: "12:00",
      clientName: "Walk-in",
      clientPhone: "+48123456789",
    });
    expect(r.ok).toBe(true);

    await new Promise((res) => setTimeout(res, 0));

    const calendarCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/admin/appointment-action"),
    );
    expect(calendarCall).toBeDefined();
    const body = JSON.parse(calendarCall![1].body as string);
    expect(body.action).toBe("sync_calendar");
    expect(body.appointmentId).toBe(r.appointmentId);
  });
});
