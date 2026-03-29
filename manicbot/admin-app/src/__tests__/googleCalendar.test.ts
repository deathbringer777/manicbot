import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({
  getDb: () => null,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { googleCalendarRouter } from "~/server/api/routers/googleCalendar";

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

function makeAwaitableChain(result: unknown) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(Array.isArray(result) ? result.slice(0, 1) : result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function createDbMock(selectResults: unknown[] = []) {
  const updateCalls: Array<{ values: Record<string, unknown> }> = [];
  const deleteCalls: Array<{ whereCalled: boolean }> = [];

  return {
    db: {
      select: vi.fn(() => makeAwaitableChain(selectResults.shift() ?? [])),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateCalls.push({ values });
          return {
            where: vi.fn(async () => ({ ok: true })),
          };
        }),
      })),
      delete: vi.fn(() => {
        const call = { whereCalled: false };
        deleteCalls.push(call);
        return {
          where: vi.fn(async () => {
            call.whereCalled = true;
            return { ok: true };
          }),
        };
      }),
    },
    updateCalls,
    deleteCalls,
  };
}

describe("googleCalendarRouter", () => {
  const createCaller = createCallerFactory(googleCalendarRouter);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists integrations with resolved master names and boolean sync state", async () => {
    const dbMock = createDbMock([
      [
        {
          id: "int_1",
          scope: "master",
          masterChatId: 42,
          providerAccountEmail: "master@example.com",
          calendarId: "cal_1",
          calendarSummary: "Anna",
          syncEnabled: 1,
          syncDirection: "two_way",
          lastSyncAt: 123,
          lastSyncStatus: "ok",
          lastSyncError: null,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      [{ chatId: 42, name: "Anna Master" }],
    ]);
    const caller = createCaller({ db: dbMock.db as never, user: { id: 1, first_name: "Test" }, webUser: null, headers: new Headers() });

    const rows = await caller.list({ tenantId: "tenant_demo" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "int_1",
      masterName: "Anna Master",
      syncEnabled: true,
      providerAccountEmail: "master@example.com",
    });
  });

  it("returns the active salon bot link for secure connect handoff", async () => {
    const dbMock = createDbMock([
      [{ botId: "123456789", botUsername: "@demo_salon_bot" }],
    ]);
    const caller = createCaller({ db: dbMock.db as never, user: { id: 1, first_name: "Test" }, webUser: null, headers: new Headers() });

    const info = await caller.getConnectInfo({ tenantId: "tenant_demo" });

    expect(info).toEqual({
      botId: "123456789",
      botUsername: "demo_salon_bot",
      botLink: "https://t.me/demo_salon_bot",
    });
  });

  it("toggleSync stores integer flags and millisecond timestamps", async () => {
    const dbMock = createDbMock();
    const caller = createCaller({ db: dbMock.db as never, user: { id: 1, first_name: "Test" }, webUser: null, headers: new Headers() });
    const before = Date.now();

    const result = await caller.toggleSync({
      tenantId: "tenant_demo",
      integrationId: "int_1",
      enabled: false,
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateCalls).toHaveLength(1);
    expect(dbMock.updateCalls[0]?.values.syncEnabled).toBe(0);
    expect(Number(dbMock.updateCalls[0]?.values.updatedAt)).toBeGreaterThanOrEqual(before);
  });

  it("disconnect cleans integration-linked records and resets master calendar state", async () => {
    const dbMock = createDbMock([
      [{ id: "int_1", scope: "master", masterChatId: 42 }],
    ]);
    const caller = createCaller({ db: dbMock.db as never, user: { id: 1, first_name: "Test" }, webUser: null, headers: new Headers() });

    const result = await caller.disconnect({
      tenantId: "tenant_demo",
      integrationId: "int_1",
    });

    expect(result).toEqual({ ok: true });
    expect(dbMock.updateCalls).toHaveLength(2);
    expect(dbMock.updateCalls[0]?.values).toEqual({
      googleIntegrationId: null,
      googleCalendarId: null,
      googleEventId: null,
    });
    expect(dbMock.updateCalls[1]?.values).toEqual({
      googleCalendarId: null,
      calendarEnabled: 0,
    });
    expect(dbMock.deleteCalls).toHaveLength(2);
    expect(dbMock.deleteCalls.every((call) => call.whereCalled)).toBe(true);
  });
});
