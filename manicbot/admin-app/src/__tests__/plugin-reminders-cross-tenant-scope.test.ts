/**
 * pluginReminders — `enforceMasterScopeOnCreate` must look up the target
 * master only within the caller's tenant.
 *
 * Bug: the helper was filtering on `masters.chat_id` alone, no tenant_id
 * predicate. If the same chat_id exists in another tenant (synthetic
 * personal-tenant chat_ids in [10B, 11B) can collide, and test fixtures
 * routinely reuse small chat_ids across tenants), the helper resolves
 * the wrong row, reads its `web_user_id`, and a master caller who
 * happens to share that row's owner id bypasses the scope check. Net:
 * the master can pin a reminder with `target_master_id = X` where X
 * isn't an actual master in their own tenant — the reminder fires
 * against a non-existent target, but the tenant-isolation invariant is
 * already violated.
 *
 * Fix: bind the WHERE to `(tenantId, chatId)` so the lookup can never
 * see another tenant's masters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { pluginRemindersRouter } from "~/server/api/routers/pluginReminders";
import { makeMasterCtx } from "./helpers/db-mock";

const TENANT = "t_caller";

const enabledInstall = {
  id: "pi_reminders",
  tenantId: TENANT as string | null,
  pluginSlug: "reminders",
  enabled: 1,
  version: "0.1.0",
  installedBy: "w_master",
  installedAt: 1,
  updatedAt: 1,
  settingsJson: null,
  billingState: "not_applicable",
};

function whereContainsColumn(arg: unknown, colName: string): boolean {
  function walk(node: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    const obj = node as { name?: unknown; queryChunks?: unknown[] };
    if (obj.name === colName) return true;
    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) {
        if (walk(c)) return true;
      }
    }
    return false;
  }
  return walk(arg);
}

function buildDb(selectResults: unknown[][]): {
  db: unknown;
  wheres: unknown[];
  inserts: Array<Record<string, unknown>>;
} {
  const queue = [...selectResults];
  const wheres: unknown[] = [];
  const inserts: Array<Record<string, unknown>> = [];

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
      limit: () => limitChain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        inserts.push(vals);
        return {
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          then: (r: (v: unknown) => unknown) => Promise.resolve({ ok: true }).then(r),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({ ok: true }) }),
      ),
    })),
    $client: { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
  };
  return { db, wheres, inserts };
}

describe("pluginReminders — enforceMasterScopeOnCreate is tenant-scoped", () => {
  const createCaller = createCallerFactory(pluginRemindersRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("create: master-scope lookup against `masters` carries a tenant_id predicate", async () => {
    // SELECTs in order:
    //   1. assertTenantMember → tenants.isPersonal lookup (master role)
    //   2. assertPluginEnabled → plugin_installations lookup
    //   3. enforceMasterScopeOnCreate → masters lookup (the WHERE we pin)
    const { db, wheres } = buildDb([
      [{ isPersonal: 1 }],
      [enabledInstall],
      [{ webUserId: "w_master" }],
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    try {
      await caller.create({
        tenantId: TENANT,
        title: "Self reminder",
        startsOn: "2026-06-01",
        time: "09:00",
        recurrence: { type: "once" as const },
        targetMasterId: 200,
      });
    } catch {
      // We don't care if the call succeeds — only that the masters lookup
      // carried tenant_id. Pre-fix that WHERE was `(chatId = 200)` only.
    }

    // The masters lookup is identified by its `chat_id` column predicate.
    // The fix is to add `tenant_id` to the SAME WHERE so the lookup can't
    // resolve a master row from another tenant.
    const mastersWhere = wheres.find((w) => whereContainsColumn(w, "chat_id"));
    expect(mastersWhere).toBeDefined();
    expect(whereContainsColumn(mastersWhere, "tenant_id")).toBe(true);
  });

  it("update: target_master patch lookup also carries a tenant_id predicate", async () => {
    // SELECTs in order:
    //   1. assertTenantMember → tenants.isPersonal lookup
    //   2. assertPluginEnabled → plugin_installations lookup
    //   3. loadOwnReminderOrThrow → plugin_reminders lookup
    //   4. enforceMasterScopeOnCreate → masters lookup
    const { db, wheres } = buildDb([
      [{ isPersonal: 1 }],
      [enabledInstall],
      [{
        id: "rm_x",
        tenantId: TENANT,
        createdByWebUserId: "w_master",
        targetMasterId: null,
        kind: "reminder",
        title: "Existing",
        note: null,
        startsOn: "2026-06-01",
        time: "09:00",
        recurrenceJson: JSON.stringify({ type: "once" }),
        channelsJson: JSON.stringify(["inapp"]),
        archivedAt: null,
        createdAt: 1,
        updatedAt: 1,
      }],
      [{ webUserId: "w_master" }],
    ]);
    const ctx = makeMasterCtx(db, TENANT);
    const caller = createCaller(ctx as never);

    try {
      await caller.update({
        tenantId: TENANT,
        id: "rm_x",
        patch: { targetMasterId: 200 },
      });
    } catch {
      // ignore — we inspect the SQL shape.
    }

    // The masters lookup must be tenant-bound. Pre-fix the helper was
    // called without tenantId so the WHERE was `chat_id = ?` only.
    const mastersWhere = wheres.find((w) => whereContainsColumn(w, "chat_id"));
    expect(mastersWhere).toBeDefined();
    expect(whereContainsColumn(mastersWhere, "tenant_id")).toBe(true);
  });
});
