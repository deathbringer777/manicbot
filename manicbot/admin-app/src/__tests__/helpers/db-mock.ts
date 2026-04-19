import { vi } from "vitest";

/**
 * Creates a chainable, awaitable mock chain for Drizzle ORM select queries.
 *
 * Supports three termination patterns:
 *   1. await db.select().from(T)                         → .then()
 *   2. await db.select().from(T).where(C).limit(1)       → limitChain.then()
 *   3. await db.select().from(T).where(C).limit(N).offset(M) → limitChain.offset()
 */
export function makeAwaitableChain(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

export function createDbMock(selectResults: unknown[] = []) {
  const updateCalls: Array<{ values: Record<string, unknown> }> = [];
  const deleteCalls: Array<{ whereCalled: boolean }> = [];
  const insertCalls: Array<{ values: Record<string, unknown> }> = [];

  return {
    db: {
      select: vi.fn(() => makeAwaitableChain(selectResults.shift() ?? [])),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateCalls.push({ values });
          return { where: vi.fn(async () => ({ ok: true })) };
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
      insert: vi.fn(() => ({
        values: vi.fn((vals: Record<string, unknown>) => {
          insertCalls.push({ values: vals });
          const chain: any = {
            onConflictDoUpdate: vi.fn().mockResolvedValue({ ok: true }),
            then: (resolve: any, reject?: any) =>
              Promise.resolve({ ok: true }).then(resolve, reject),
          };
          return chain;
        }),
      })),
    },
    updateCalls,
    deleteCalls,
    insertCalls,
  };
}

// ── Auth context factories (web-session only, Telegram Mini App removed) ────

export function makeAdminCtx(db: any) {
  return {
    db,
    webUser: {
      id: "w_admin",
      email: "admin@test.com",
      tenantId: null as string | null,
      webRole: "system_admin",
    },
    headers: new Headers(),
  };
}

export function makeTenantOwnerCtx(db: any, tenantId: string) {
  return {
    db,
    webUser: {
      id: "w_owner",
      email: "owner@test.com",
      tenantId,
      webRole: "tenant_owner",
    },
    headers: new Headers(),
  };
}

export function makeTenantManagerCtx(db: any, tenantId: string) {
  return {
    db,
    webUser: {
      id: "w_manager",
      email: "manager@test.com",
      tenantId,
      webRole: "tenant_manager",
    },
    headers: new Headers(),
  };
}

export function makeMasterCtx(db: any, tenantId: string) {
  return {
    db,
    webUser: {
      id: "w_master",
      email: "master@test.com",
      tenantId,
      webRole: "master",
    },
    headers: new Headers(),
  };
}

export function makeUnauthCtx(db: any) {
  return {
    db,
    webUser: null as null,
    headers: new Headers(),
  };
}

export function makeForbiddenWebCtx(db: any) {
  return {
    db,
    webUser: {
      id: "w_user",
      email: "user@test.com",
      tenantId: "t_demo" as string | null,
      webRole: "tenant_owner",
    },
    headers: new Headers(),
  };
}

export function makeSupportCtx(
  db: any,
  role: "support" | "technical_support" | "system_admin" = "support",
) {
  return {
    db,
    webUser: {
      id: "w_support",
      email: "support@test.com",
      tenantId: null as string | null,
      webRole: role,
    },
    headers: new Headers(),
  };
}
