/**
 * Tests for the global search router: role gating + query shape.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { searchRouter } from "~/server/api/routers/search";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const createCaller = createCallerFactory(searchRouter);

describe("searchRouter auth guards", () => {
  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeUnauthCtx(db) as never);
    await expect(caller.global({ q: "hello" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects tenant_owner callers (admin-only)", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, "t_1") as never);
    await expect(caller.global({ q: "hello" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("searchRouter input validation", () => {
  it("rejects single-char query", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(caller.global({ q: "x" })).rejects.toThrow();
  });

  it("caps limit at 50", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeAdminCtx(db) as never);
    await expect(caller.global({ q: "abc", limit: 999 })).rejects.toThrow();
  });
});

describe("searchRouter result shape", () => {
  it("returns hits with stable schema", async () => {
    const tenantRows = [{ id: "t_1", name: "Salon 1", slug: "salon-1" }];
    const userRows = [{ id: "wu_1", email: "owner@salon1.com", role: "tenant_owner", tenantId: "t_1" }];
    const leadRows = [{ id: 1, name: "Lead One", email: "lead1@example.com", phone: "+48111" }];
    const contactRows = [{ id: 5, email: "contact@sample.com", name: "Contact" }];
    const { db } = createDbMock([tenantRows, userRows, leadRows, contactRows]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const hits = await caller.global({ q: "salon", limit: 20 });
    expect(hits.length).toBe(4);
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toEqual(["contact", "lead", "tenant", "user"]);
    for (const hit of hits) {
      expect(hit.id).toBeTruthy();
      expect(hit.title).toBeTruthy();
      expect(hit.href).toMatch(/^\//);
    }
  });

  it("returns empty array when all tables return empty", async () => {
    const { db } = createDbMock([[], [], [], []]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const hits = await caller.global({ q: "noresults" });
    expect(hits).toEqual([]);
  });

  it("URL-encodes id/email in href", async () => {
    const userRows = [{ id: "wu_1", email: "tricky email+%@test.com", role: "tenant_owner", tenantId: "t" }];
    const { db } = createDbMock([[], userRows, [], []]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const hits = await caller.global({ q: "trick" });
    expect(hits[0]?.href).toContain("/users?email=");
    expect(hits[0]?.href).not.toContain(" ");
  });
});
