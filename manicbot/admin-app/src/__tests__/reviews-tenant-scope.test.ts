/**
 * reviews.updateStatus / addReply / deleteReply are owner-only moderation
 * mutations (protectedProcedure + assertTenantOwner(ctx, input.tenantId)).
 *
 * These pin the tenant binding that issue #259 flagged as fragile: the
 * procedure type alone (protectedProcedure, and even tenantOwnerProcedure) is
 * ROLE-only — it does NOT check that the session owns input.tenantId. The real
 * isolation guard is the inner assertTenantOwner call. If a future refactor
 * drops it, these tests go RED (a tenant_owner of tenant A must NOT be able to
 * touch tenant B's reviews by passing input.tenantId = B).
 *
 * Run against real Drizzle/libsql so the WHERE clause is genuinely enforced.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "1", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

const NOW = 1_780_000_000;

const BOOTSTRAP_SQL = `CREATE TABLE reviews (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  appointment_id  TEXT,
  master_id       TEXT,
  chat_id         INTEGER NOT NULL,
  channel         TEXT DEFAULT 'telegram',
  rating          INTEGER NOT NULL,
  text            TEXT,
  photos          TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  reply_text      TEXT,
  reply_at        INTEGER,
  created_at      INTEGER NOT NULL
)`;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(BOOTSTRAP_SQL);
  return drizzle(client, { schema });
}

async function seedReview(db: ReturnType<typeof drizzle>, over: Record<string, unknown> = {}) {
  await db.insert(schema.reviews).values({
    id: "rv_a", tenantId: "t_a", chatId: 900, rating: 5,
    text: "great", status: "active", replyText: null, replyAt: null, createdAt: NOW,
    ...over,
  });
}

/** A tenant_owner session bound to `tenantId` (mirrors the real ctx shape). */
function ownerCtx(db: ReturnType<typeof drizzle>, tenantId: string) {
  return {
    headers: new Headers(),
    webUser: { id: "wu", email: "o@x.io", tenantId, webRole: "tenant_owner" },
    db,
  } as unknown;
}

async function caller(ctx: unknown) {
  const { createCallerFactory } = await import("~/server/api/trpc");
  const { reviewsRouter } = await import("~/server/api/routers/reviews");
  return createCallerFactory(reviewsRouter)(ctx as never);
}

async function statusOf(db: ReturnType<typeof drizzle>, id: string) {
  const [row] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, id));
  return row;
}

describe("reviews owner mutations — tenant isolation (#259)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updateStatus succeeds on the owner's own tenant", async () => {
    const db = await freshDb();
    await seedReview(db); // rv_a in t_a
    const c = await caller(ownerCtx(db, "t_a"));
    const res = await c.updateStatus({ tenantId: "t_a", reviewId: "rv_a", status: "hidden" });
    expect(res.ok).toBe(true);
    expect((await statusOf(db, "rv_a"))!.status).toBe("hidden");
  });

  it("updateStatus is FORBIDDEN cross-tenant and leaves the victim row untouched", async () => {
    const db = await freshDb();
    await seedReview(db, { id: "rv_b", tenantId: "t_b", status: "active" }); // victim
    const attacker = await caller(ownerCtx(db, "t_a")); // owns t_a, NOT t_b
    await expect(
      attacker.updateStatus({ tenantId: "t_b", reviewId: "rv_b", status: "hidden" }),
    ).rejects.toThrow(/owner access required/i);
    expect((await statusOf(db, "rv_b"))!.status).toBe("active");
  });

  it("addReply is FORBIDDEN cross-tenant and writes no reply", async () => {
    const db = await freshDb();
    await seedReview(db, { id: "rv_b", tenantId: "t_b" });
    const attacker = await caller(ownerCtx(db, "t_a"));
    await expect(
      attacker.addReply({ tenantId: "t_b", reviewId: "rv_b", text: "pwned" }),
    ).rejects.toThrow(/owner access required/i);
    expect((await statusOf(db, "rv_b"))!.replyText).toBeNull();
  });

  it("addReply then deleteReply succeed on the owner's own tenant", async () => {
    const db = await freshDb();
    await seedReview(db);
    const c = await caller(ownerCtx(db, "t_a"));
    await c.addReply({ tenantId: "t_a", reviewId: "rv_a", text: "thanks!" });
    expect((await statusOf(db, "rv_a"))!.replyText).toBe("thanks!");
    await c.deleteReply({ tenantId: "t_a", reviewId: "rv_a" });
    expect((await statusOf(db, "rv_a"))!.replyText).toBeNull();
  });

  it("deleteReply is FORBIDDEN cross-tenant and keeps the existing reply", async () => {
    const db = await freshDb();
    await seedReview(db, { id: "rv_b", tenantId: "t_b", replyText: "owner reply", replyAt: NOW });
    const attacker = await caller(ownerCtx(db, "t_a"));
    await expect(
      attacker.deleteReply({ tenantId: "t_b", reviewId: "rv_b" }),
    ).rejects.toThrow(/owner access required/i);
    expect((await statusOf(db, "rv_b"))!.replyText).toBe("owner reply");
  });

  it("unauthenticated callers are rejected before any tenant check", async () => {
    const db = await freshDb();
    await seedReview(db);
    const anon = await caller({ headers: new Headers(), webUser: null, db } as unknown);
    await expect(
      anon.updateStatus({ tenantId: "t_a", reviewId: "rv_a", status: "hidden" }),
    ).rejects.toThrow(/Authentication required/i);
    expect((await statusOf(db, "rv_a"))!.status).toBe("active");
  });
});
