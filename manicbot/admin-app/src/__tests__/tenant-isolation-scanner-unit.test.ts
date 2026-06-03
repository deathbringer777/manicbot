/**
 * Unit fixtures for the tenant-isolation scanner's pure core
 * (deriveTenantScopedTables / scanSource). The sibling
 * `tenant-isolation-scanner.test.ts` runs the whole script against the live
 * tree; these tests pin the detection logic so the mutation-coverage and
 * table-derivation guarantees can't silently regress.
 */
import { describe, it, expect } from "vitest";
import {
  deriveTenantScopedTables,
  scanSource,
  PLATFORM_GLOBAL_TABLES,
} from "../../scripts/check-tenant-isolation.mjs";

const TENANT = new Set(["marketingContacts", "appointments", "reviews", "masters"]);

describe("deriveTenantScopedTables", () => {
  it("includes any sqliteTable declaring text(\"tenant_id\")", () => {
    const schema = `
      export const appointments = sqliteTable("appointments", { id: text("id"), tenantId: text("tenant_id").notNull() });
      export const reviews = sqliteTable("reviews", { id: text("id"), tenantId: text("tenant_id").notNull() });
    `;
    const s = deriveTenantScopedTables(schema);
    expect(s.has("appointments")).toBe(true);
    expect(s.has("reviews")).toBe(true);
  });

  it("includes tables with a NULLABLE tenant_id (e.g. marketingContacts)", () => {
    const schema = `export const marketingContacts = sqliteTable("marketing_contacts", { id: integer("id"), tenantId: text("tenant_id") });`;
    expect(deriveTenantScopedTables(schema).has("marketingContacts")).toBe(true);
  });

  it("excludes PLATFORM_GLOBAL tables even when they declare tenant_id", () => {
    const schema = `export const webUsers = sqliteTable("web_users", { id: text("id"), tenantId: text("tenant_id") });`;
    expect(deriveTenantScopedTables(schema).has("webUsers")).toBe(false);
    expect(PLATFORM_GLOBAL_TABLES.has("webUsers")).toBe(true);
  });

  it("does NOT match multi-tenant relationship tables (referrer_tenant_id / invitee_tenant_id)", () => {
    const schema = `export const referrals = sqliteTable("referrals", { id: text("id"), referrerTenantId: text("referrer_tenant_id").notNull(), inviteeTenantId: text("invitee_tenant_id").notNull() });`;
    expect(deriveTenantScopedTables(schema).has("referrals")).toBe(false);
  });
});

describe("scanSource — mutation coverage (the old blind spot)", () => {
  it("flags UPDATE on a tenant table with only an id predicate", () => {
    const src = `await ctx.db.update(marketingContacts).set(patch).where(eq(marketingContacts.id, input.id));`;
    const f = scanSource(src, TENANT);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ op: "update", table: "marketingContacts" });
  });

  it("does NOT flag UPDATE scoped by tenantId", () => {
    const src = `await ctx.db.update(marketingContacts).set(patch).where(and(eq(marketingContacts.id, input.id), eq(marketingContacts.tenantId, input.tenantId)));`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("flags DELETE by id alone", () => {
    const src = `await ctx.db.delete(reviews).where(eq(reviews.id, input.id));`;
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("flags INSERT that omits tenantId", () => {
    const src = `await ctx.db.insert(reviews).values({ id: input.id, text: input.text });`;
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("does NOT flag INSERT that sets tenantId", () => {
    const src = `await ctx.db.insert(reviews).values({ id: input.id, tenantId: input.tenantId, text: input.text });`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });
});

describe("scanSource — SELECT + acceptance patterns", () => {
  it("flags .from(tenantTable) without tenantId", () => {
    const src = `const rows = await ctx.db.select().from(masters).where(eq(masters.id, input.id));`;
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("ignores tables outside the tenant set", () => {
    const src = `const rows = await ctx.db.select().from(webUsers).where(eq(webUsers.email, input.email));`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("accepts a where built from a tenant-scoped variable (.where(scope))", () => {
    const src = `
      const scope = and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId));
      await ctx.db.update(appointments).set(updates).where(scope);
    `;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("accepts a where built from a conditions array (.where(and(...conditions)))", () => {
    const src = `
      const conditions = [];
      if (input.tenantId) conditions.push(eq(appointments.tenantId, input.tenantId));
      const rows = await ctx.db.select().from(appointments).where(and(...conditions));
    `;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("does NOT false-accept an id-only mutation just because an earlier scoped SELECT mentioned the table+tenantId", () => {
    // The realistic load-then-update shape that the OLD heuristic would have missed.
    const src = `
      const existing = await ctx.db.select({ tenantId: marketingContacts.tenantId }).from(marketingContacts).where(and(eq(marketingContacts.id, input.id), eq(marketingContacts.tenantId, input.tenantId))).limit(1);
      await ctx.db.update(marketingContacts).set(patch).where(eq(marketingContacts.id, input.id));
    `;
    const f = scanSource(src, TENANT);
    // The SELECT is scoped (ok); the UPDATE is id-only → must still be flagged.
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ op: "update", table: "marketingContacts" });
  });

  it("accepts a query annotated with a tenant-scan-ignore directive", () => {
    const src = `
      // tenant-scan-ignore: bot_id collision check is intentionally cross-tenant
      const claimed = await ctx.db.select().from(masters).where(eq(masters.id, input.id));
    `;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });
});

describe("scanSource — mutation predicate must be in WHERE (set/comment can't spoof)", () => {
  it("FLAGS an UPDATE that writes tenantId in .set() but filters by id alone (cross-tenant write)", () => {
    // The row being mutated is selected by `id` only; `.set({ tenantId })` writes
    // the column, it does NOT scope which rows are touched. Loose chain-substring
    // matching used to wave this through — the exact write-side regression S6 cares about.
    const src = `await ctx.db.update(appointments).set({ tenantId: input.tenantId, cancelled: 1 }).where(eq(appointments.id, input.id));`;
    const f = scanSource(src, TENANT);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ op: "update", table: "appointments" });
  });

  it("FLAGS a DELETE whose tenantId appears only in a block comment in the chain", () => {
    const src = `await ctx.db.delete(reviews) /* tenantId scoping handled upstream */ .where(eq(reviews.id, input.id));`;
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("FLAGS an UPDATE whose tenantId appears only in a // line comment in the chain", () => {
    const src = `await ctx.db.update(masters).set(patch) // tenantId already checked\n  .where(eq(masters.id, input.id));`;
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("ACCEPTS an UPDATE with tenantId in the WHERE (the correct scoping)", () => {
    const src = `await ctx.db.update(appointments).set({ tenantId: input.tenantId, cancelled: 1 }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("ACCEPTS a DELETE with a nested-paren WHERE (and(eq(...), eq(...))) — balanced extraction", () => {
    const src = `await ctx.db.delete(reviews).where(and(eq(reviews.id, input.id), eq(reviews.tenantId, input.tenantId)));`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("STILL accepts an INSERT scoped by tenantId in .values() (values is the row scope, not a filter)", () => {
    const src = `await ctx.db.insert(reviews).values({ id: input.id, tenantId: input.tenantId, text: input.text });`;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });
});

describe("scanSource — user-scoping and authorize-then-act", () => {
  const USER_TENANT = new Set(["userNotifications"]);

  it("accepts a user-scoped query (webUserId predicate)", () => {
    const src = `await ctx.db.update(userNotifications).set({ readAt: now }).where(and(eq(userNotifications.webUserId, uid), eq(userNotifications.id, input.id)));`;
    expect(scanSource(src, USER_TENANT)).toHaveLength(0);
  });

  it("accepts an authorize-then-act mutation (assert* guard earlier in the handler)", () => {
    const src = `
      delete: protectedProcedure.input(z.object({ tenantId: z.string(), id: z.string() })).mutation(async ({ ctx, input }) => {
        await assertTenantOwner(ctx, input.tenantId);
        const [row] = await ctx.db.select({ tenantId: appointments.tenantId }).from(appointments).where(eq(appointments.id, input.id)).limit(1);
        if (!row || row.tenantId !== input.tenantId) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.db.update(appointments).set({ cancelled: 1 }).where(eq(appointments.id, input.id));
      }),
    `;
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("STILL flags an unguarded mutation — no scope, no user predicate, no assert, no directive", () => {
    const src = `
      reset: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
        await ctx.db.update(appointments).set({ cancelled: 1 }).where(eq(appointments.id, input.id));
      }),
    `;
    const f = scanSource(src, TENANT);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ op: "update", table: "appointments" });
  });
});
