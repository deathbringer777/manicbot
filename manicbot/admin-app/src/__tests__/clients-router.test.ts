/**
 * clients router — Salon Clients tab backend.
 *
 * Pins the contract around tenant isolation, validation, soft-delete with
 * PII scrub, global block toggle, CSV import/export, and tag suggestions.
 * Marketing sync is tested separately in marketing-sync.test.ts — here we
 * verify the router *invokes* sync but don't re-test its internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
  },
}));

// Stub the sync helper so we can assert it was called without going to DB.
// vi.mock is hoisted above the file, so the spy lives inside vi.hoisted().
const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: syncMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { clientsRouter } from "~/server/api/routers/clients";
import {
  makeTenantOwnerCtx,
  makeUnauthCtx,
  makeForbiddenWebCtx,
} from "./helpers/db-mock";

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
  const updates: Array<{ set: Record<string, unknown> }> = [];
  const inserts: Array<{ values: Record<string, unknown> }> = [];

  const queue = [...selectResults];

  const dbCore: any = {
    // tenants assert lookup — gives tenant_owner immediate pass.
    select: vi.fn(() => {
      const next = queue.shift() ?? [];
      return chainable(next);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        inserts.push({ values: vals });
        return {
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          then: (resolve: any) => Promise.resolve({ ok: true }).then(resolve),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updates.push({ set: vals });
        return { where: vi.fn().mockResolvedValue({ ok: true }) };
      }),
    })),
  };
  return { db: dbCore, updates, inserts };
}

function makeCtx(db: any) {
  return makeTenantOwnerCtx(db, TENANT);
}

describe("clientsRouter", () => {
  const createCaller = createCallerFactory(clientsRouter);

  beforeEach(() => {
    vi.clearAllMocks();
    syncMock.mockResolvedValue(99);
  });

  // ─── Auth ──────────────────────────────────────────────────────────────────
  describe("auth", () => {
    it("rejects unauthenticated callers", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeUnauthCtx(db) as never);
      // tenantOwnerProcedure middleware blocks at the role check stage,
      // surfacing FORBIDDEN with the "tenant_owner or system_admin required"
      // message before assertTenantOwner runs. Either FORBIDDEN or
      // UNAUTHORIZED is an acceptable denial — we just need a refusal.
      await expect(caller.list({ tenantId: TENANT })).rejects.toMatchObject({
        code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
      });
    });

    it("rejects callers from a different tenant", async () => {
      const { db } = buildDb([]);
      const ctx = makeForbiddenWebCtx(db); // tenantId is t_demo but webRole is tenant_owner
      // Override to a different tenant
      ctx.webUser.tenantId = "t_other" as string;
      const caller = createCaller(ctx as never);
      await expect(caller.list({ tenantId: "t_demo" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("returns paginated results with total count", async () => {
      const rows = [{ chatId: 1, name: "A" }, { chatId: 2, name: "B" }];
      // 1 select for users.list, 1 for count
      const { db } = buildDb([rows, [{ count: 2 }]]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.list({ tenantId: TENANT });
      expect(r.rows).toHaveLength(2);
      expect(r.total).toBe(2);
      expect(r.nextOffset).toBeNull();
    });

    it("computes nextOffset when more rows remain", async () => {
      // Limit 1 + total 5 → nextOffset = 1
      const { db } = buildDb([[{ chatId: 1, name: "A" }], [{ count: 5 }]]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.list({ tenantId: TENANT, limit: 1, offset: 0 });
      expect(r.nextOffset).toBe(1);
    });

    it("clamps invalid input via Zod", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.list({ tenantId: TENANT, limit: 9999 as never }),
      ).rejects.toThrow();
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe("create", () => {
    it("rejects when no contact channel is provided", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          name: "Karina",
          contacts: {},
        }),
      ).rejects.toMatchObject({ message: "at_least_one_contact_required" });
    });

    it("inserts row, calls syncMarketingContact, writes back marketingContactId", async () => {
      // syncMock returns 99; the router runs an update to set marketing_contact_id.
      const { db, inserts, updates } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      const result = await caller.create({
        tenantId: TENANT,
        name: "Karina",
        contacts: { phone: "+48500152948" },
      });
      expect(result.chatId).toBeLessThan(0); // synthetic negative chatId
      expect(result.marketingContactId).toBe(99);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.values).toMatchObject({
        tenantId: TENANT,
        name: "Karina",
        phone: "+48500152948",
        firstSource: "salon_dashboard_manual",
      });
      expect(syncMock).toHaveBeenCalledOnce();
      // update is the marketing_contact_id back-link
      expect(updates).toHaveLength(1);
      expect(updates[0]!.set.marketingContactId).toBe(99);
    });

    it("strips @ prefix from telegram/instagram handles on insert", async () => {
      const { db, inserts } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.create({
        tenantId: TENANT,
        name: "K",
        contacts: { tgUsername: "@karina", igUsername: "@kar_nails" },
      });
      expect(inserts[0]!.values.tgUsername).toBe("karina");
      expect(inserts[0]!.values.igUsername).toBe("kar_nails");
    });

    it("lowercases email on insert", async () => {
      const { db, inserts } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.create({
        tenantId: TENANT,
        name: "K",
        contacts: { email: "FOO@BAR.COM" },
      });
      expect(inserts[0]!.values.email).toBe("foo@bar.com");
    });

    // 0072 — avatar fields.
    it("persists avatarEmoji on insert when provided", async () => {
      const { db, inserts } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.create({
        tenantId: TENANT,
        name: "K",
        contacts: { phone: "+48000" },
        avatarEmoji: "👸",
      });
      expect(inserts[0]!.values.avatarEmoji).toBe("👸");
      expect(inserts[0]!.values.avatarUrl).toBeNull();
    });

    it("persists avatarUrl on insert when provided", async () => {
      const { db, inserts } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      const validUrl = `https://manicbot.com/cdn/t/${TENANT}/client_avatar-abcdef012345.webp`;
      await caller.create({
        tenantId: TENANT,
        name: "K",
        contacts: { phone: "+48000" },
        avatarUrl: validUrl,
      });
      expect(inserts[0]!.values.avatarUrl).toBe(validUrl);
      expect(inserts[0]!.values.avatarEmoji).toBeNull();
    });

    it("rejects non-https avatarUrl at the Zod boundary", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          name: "K",
          contacts: { phone: "+48000" },
          avatarUrl: "javascript:alert(1)" as never,
        }),
      ).rejects.toBeTruthy();
    });

    it("rejects external/tracking avatarUrl that isn't our /cdn/t/.../client_avatar-... path", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      // External CDN — wrong path shape (not our minted upload).
      await expect(
        caller.create({
          tenantId: TENANT,
          name: "K",
          contacts: { phone: "+48000" },
          avatarUrl: "https://tracker.example.com/pixel.gif" as never,
        }),
      ).rejects.toBeTruthy();
      // Right host, wrong kind (logo instead of client_avatar).
      await expect(
        caller.create({
          tenantId: TENANT,
          name: "K",
          contacts: { phone: "+48000" },
          avatarUrl: `https://manicbot.com/cdn/t/${TENANT}/logo-abcdef012345.webp` as never,
        }),
      ).rejects.toBeTruthy();
    });
  });

  // ─── delete (soft + PII scrub) ─────────────────────────────────────────────
  describe("delete", () => {
    it("scrubs PII and stamps deleted_at", async () => {
      const { db, updates } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.delete({ tenantId: TENANT, chatId: 42 });
      // delete now performs TWO updates: the users PII scrub + the linked
      // marketing_contacts PII scrub (#D-2 — GDPR erasure completeness).
      expect(updates).toHaveLength(2);
      const set = updates[0]!.set;
      expect(set.name).toBeNull();
      expect(set.phone).toBeNull();
      expect(set.email).toBeNull();
      expect(set.tgUsername).toBeNull();
      expect(set.igUsername).toBeNull();
      expect(set.notes).toBeNull();
      expect(set.tags).toBeNull();
      expect(set.dob).toBeNull();
      expect(set.deletedAt).toBeGreaterThan(0);
      // #D-2 — the linked marketing_contacts row is scrubbed + unsubscribed.
      const mset = updates[1]!.set;
      expect(mset.name).toBeNull();
      expect(mset.email).toBeNull();
      expect(mset.phone).toBeNull();
      expect(mset.unsubscribed).toBe(1);
    });
  });

  // ─── setGlobalBlock ────────────────────────────────────────────────────────
  describe("setGlobalBlock", () => {
    it("sets is_blocked_global=1 + reason + timestamp on block", async () => {
      const { db, updates } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.setGlobalBlock({
        tenantId: TENANT,
        chatId: 42,
        blocked: true,
        reason: "no-show 3 times",
      });
      expect(updates[0]!.set.isBlockedGlobal).toBe(1);
      expect(updates[0]!.set.blockedGlobalReason).toBe("no-show 3 times");
      expect(updates[0]!.set.blockedGlobalAt).toBeGreaterThan(0);
    });

    it("clears all block fields on unblock", async () => {
      const { db, updates } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await caller.setGlobalBlock({ tenantId: TENANT, chatId: 42, blocked: false });
      expect(updates[0]!.set.isBlockedGlobal).toBe(0);
      expect(updates[0]!.set.blockedGlobalReason).toBeNull();
      expect(updates[0]!.set.blockedGlobalAt).toBeNull();
    });
  });

  // ─── importCsv (dry-run + writes) ──────────────────────────────────────────
  describe("importCsv", () => {
    it("dry-run reports parse stats without writes", async () => {
      const csv = "name,phone\nA,+48111\nB,+48222\n";
      const { db, inserts, updates } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.importCsv({ tenantId: TENANT, csv, dryRun: true });
      expect(r.created).toBe(0);
      expect(r.updated).toBe(0);
      expect(r.total).toBe(2);
      expect(r.preview).toHaveLength(2);
      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
    });

    it("rejects oversized CSV via Zod max length", async () => {
      const huge = "name,phone\n" + "X,+48111\n".repeat(120_000); // > 1MB
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.importCsv({ tenantId: TENANT, csv: huge }),
      ).rejects.toThrow();
    });

    it("collects parse errors in skipped[]", async () => {
      const csv = "name,phone\n,\n";
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.importCsv({ tenantId: TENANT, csv, dryRun: true });
      expect(r.skipped.length).toBeGreaterThan(0);
    });
  });

  // ─── tagSuggestions ────────────────────────────────────────────────────────
  describe("tagSuggestions", () => {
    it("returns top tags by usage count", async () => {
      // 3 users with tags
      const rows = [
        { tags: "vip,returning" },
        { tags: "vip" },
        { tags: "new" },
      ];
      const { db } = buildDb([rows]);
      const caller = createCaller(makeCtx(db) as never);
      const tags = await caller.tagSuggestions({ tenantId: TENANT });
      expect(tags[0]).toBe("vip"); // most frequent
      expect(tags).toContain("returning");
      expect(tags).toContain("new");
    });

    it("lowercases and trims tags", async () => {
      const { db } = buildDb([[{ tags: " VIP , Returning " }]]);
      const caller = createCaller(makeCtx(db) as never);
      const tags = await caller.tagSuggestions({ tenantId: TENANT });
      expect(tags).toContain("vip");
      expect(tags).toContain("returning");
    });
  });

  // ─── csvTemplate ───────────────────────────────────────────────────────────
  describe("csvTemplate", () => {
    it("returns parseable template content", async () => {
      const { db } = buildDb([]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.csvTemplate({ tenantId: TENANT });
      expect(r.data).toContain("name,phone,email,telegram,instagram,tags,notes,dob");
      expect(r.filename).toContain("template");
    });
  });

  // ─── getListMemberships / setListMemberships (0072 manual lists) ───────────
  describe("getListMemberships", () => {
    it("404s when the client doesn't exist for this tenant", async () => {
      const { db } = buildDb([
        [],                       // users.select → empty (client not found)
      ]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.getListMemberships({ tenantId: TENANT, chatId: 999 }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("returns empty memberships when the client has no marketing_contact_id", async () => {
      const { db } = buildDb([
        [{ marketingContactId: null }], // users row exists, no MC link yet
      ]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.getListMemberships({ tenantId: TENANT, chatId: 1 });
      expect(r).toEqual({ marketingContactId: null, segmentIds: [] });
    });

    it("returns the segment ids the marketing contact belongs to", async () => {
      const { db } = buildDb([
        [{ marketingContactId: 42 }],
        // Membership JOIN result — list of segmentIds
        [{ segmentId: "seg_vip" }, { segmentId: "seg_returning" }],
      ]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.getListMemberships({ tenantId: TENANT, chatId: 1 });
      expect(r.marketingContactId).toBe(42);
      expect(r.segmentIds.sort()).toEqual(["seg_returning", "seg_vip"]);
    });
  });

  describe("setListMemberships", () => {
    it("404s when the client doesn't exist", async () => {
      const { db } = buildDb([
        [],
      ]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.setListMemberships({ tenantId: TENANT, chatId: 999, segmentIds: [] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED when the client has no marketing_contact_id", async () => {
      const { db } = buildDb([
        [{ marketingContactId: null }],
      ]);
      const caller = createCaller(makeCtx(db) as never);
      await expect(
        caller.setListMemberships({ tenantId: TENANT, chatId: 1, segmentIds: ["seg_a"] }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("silently drops segment ids that don't exist or aren't manual lists", async () => {
      const { db, inserts } = buildDb([
        [{ marketingContactId: 42 }],
        // tenant segments — only one manual; filter-based one MUST be dropped.
        [{ id: "seg_real", kind: "manual" }, { id: "seg_filter", kind: "filter" }],
        // current memberships — empty
        [],
        // count after add
        [{ count: 1 }],
      ]);
      const caller = createCaller(makeCtx(db) as never);
      const r = await caller.setListMemberships({
        tenantId: TENANT,
        chatId: 1,
        segmentIds: ["seg_real", "seg_filter", "seg_doesnt_exist"],
      });
      expect(r.added).toBe(1);
      // Only the manual segment should be inserted into members.
      expect(inserts.filter((i) => i.values.segmentId === "seg_real")).toHaveLength(1);
      expect(inserts.find((i) => i.values.segmentId === "seg_filter")).toBeUndefined();
    });
  });
});
