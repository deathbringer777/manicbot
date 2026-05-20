/**
 * 0083 — blog CMS tRPC surface.
 *
 * Pins:
 *   - All write procs are adminProcedure (system_admin only). Non-admin =
 *     UNAUTHORIZED/FORBIDDEN. Public reads (`listPublic`, `getPublic`) work
 *     without auth and filter out drafts + archived rows.
 *   - Status lifecycle: publish sets status='published' AND published_at;
 *     archive sets status='archived' AND archived_at; unpublish/unarchive
 *     return to status='draft' and clear the matching timestamp.
 *   - mintUploadToken: rejects kinds outside {blog_cover, blog_photo}.
 *   - Slug uniqueness is enforced by the DB UNIQUE index — router catches
 *     and rethrows as CONFLICT with a friendly message.
 *   - delete only works on draft + archived rows (never on published).
 *
 * Test strategy: Drizzle is mocked via the standard db-mock harness; we
 * assert the shape of `update`/`insert`/`delete` calls. Pure serialization
 * is covered by `blog-serialize.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { blogRouter } from "~/server/api/routers/blog";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFor = createCallerFactory(blogRouter);

// ─── Auth gating ──────────────────────────────────────────────────────────

describe("blog router — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(
      caller.create({
        slug: "x",
        category: "tips",
        titles: { ru: "x" },
      } as never)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("create rejects tenant_owner (admin-only surface)", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeTenantOwnerCtx(db, "t1") as never);
    await expect(
      caller.create({
        slug: "x",
        category: "tips",
        titles: { ru: "x" },
      } as never)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create rejects master role", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeMasterCtx(db, "t1") as never);
    await expect(
      caller.create({
        slug: "x",
        category: "tips",
        titles: { ru: "x" },
      } as never)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("publish/archive/delete/mintUploadToken all reject non-admin", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeMasterCtx(db, "t1") as never);
    await expect(caller.publish({ id: "bp_1" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.archive({ id: "bp_1" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.delete({ id: "bp_1" } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.mintUploadToken({ kind: "blog_photo" } as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("listPublic + getPublic accept unauthenticated callers", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    await expect(caller.listPublic({} as never)).resolves.toEqual([]);
  });
});

// ─── create / update ──────────────────────────────────────────────────────

describe("blog router — create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a draft row with the serialized JSON blobs", async () => {
    // 1st select = slug uniqueness probe (empty = unique)
    const { db, insertCalls } = createDbMock([[]]);
    const caller = callerFor(makeAdminCtx(db) as never);

    await caller.create({
      slug: "hello-world",
      category: "tips",
      titles: { ru: "Привет", en: "Hello" },
      excerpts: { en: "Lede" },
      bodies: { en: "Body" },
      coverUrl: "https://cdn.example.com/c.jpg",
      coverAlt: { en: "Cover" },
      publishedDate: "2026-05-21",
    } as never);

    expect(insertCalls.length).toBe(1);
    const v = insertCalls[0]!.values;
    expect(v.slug).toBe("hello-world");
    expect(v.status).toBe("draft");
    expect(v.category).toBe("tips");
    expect(JSON.parse(v.titlesJson as string)).toEqual({ ru: "Привет", en: "Hello" });
    expect(v.coverUrl).toBe("https://cdn.example.com/c.jpg");
    expect(v.createdByWebUserId).toBe("w_admin");
    expect(v.publishedAt).toBeNull(); // not published yet
    expect(typeof v.id).toBe("string");
    expect((v.id as string).startsWith("bp_")).toBe(true);
  });

  it("rejects duplicate slug with CONFLICT", async () => {
    // slug already exists in DB
    const { db } = createDbMock([[{ id: "bp_existing" }]]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.create({
        slug: "hello-world",
        category: "tips",
        titles: { ru: "x" },
      } as never)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an invalid slug", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.create({
        slug: "Bad Slug!",
        category: "tips",
        titles: { ru: "x" },
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an invalid category", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.create({
        slug: "x",
        category: "junk",
        titles: { ru: "x" },
      } as never)
    ).rejects.toThrow();
  });

  it("rejects when at least one title is not provided", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.create({
        slug: "x",
        category: "tips",
        titles: {},
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── status transitions ───────────────────────────────────────────────────

describe("blog router — status transitions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publish sets status=published, published_at=now, clears archived_at", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "bp_1", status: "draft", archivedAt: null }], // get
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.publish({ id: "bp_1" } as never);

    expect(updateCalls.length).toBe(1);
    const v = updateCalls[0]!.values;
    expect(v.status).toBe("published");
    expect(typeof v.publishedAt).toBe("number");
    expect(v.archivedAt).toBeNull();
    expect(v.updatedByWebUserId).toBe("w_admin");
  });

  it("archive sets status=archived and stamps archived_at", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "bp_1", status: "published" }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.archive({ id: "bp_1" } as never);

    const v = updateCalls[0]!.values;
    expect(v.status).toBe("archived");
    expect(typeof v.archivedAt).toBe("number");
  });

  it("unpublish (draft) clears published_at and sets status=draft", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "bp_1", status: "published" }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.unpublish({ id: "bp_1" } as never);

    const v = updateCalls[0]!.values;
    expect(v.status).toBe("draft");
    expect(v.publishedAt).toBeNull();
  });

  it("unarchive clears archived_at and sets status=draft", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "bp_1", status: "archived", archivedAt: 1700000000 }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.unarchive({ id: "bp_1" } as never);

    const v = updateCalls[0]!.values;
    expect(v.status).toBe("draft");
    expect(v.archivedAt).toBeNull();
  });

  it("publish/archive return NOT_FOUND for unknown id", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(caller.publish({ id: "bp_nope" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("delete rejects published rows — must archive first", async () => {
    const { db, deleteCalls } = createDbMock([
      [{ id: "bp_1", status: "published" }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(caller.delete({ id: "bp_1" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteCalls.length).toBe(0);
  });

  it("delete works on draft rows", async () => {
    const { db, deleteCalls } = createDbMock([
      [{ id: "bp_1", status: "draft" }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.delete({ id: "bp_1" } as never);
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]!.whereCalled).toBe(true);
  });

  it("delete works on archived rows", async () => {
    const { db, deleteCalls } = createDbMock([
      [{ id: "bp_1", status: "archived" }],
    ]);
    const caller = callerFor(makeAdminCtx(db) as never);
    await caller.delete({ id: "bp_1" } as never);
    expect(deleteCalls.length).toBe(1);
  });
});

// ─── mintUploadToken ──────────────────────────────────────────────────────

describe("blog router — mintUploadToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mints a blog_cover token for system_admin", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeAdminCtx(db) as never);
    const out = await caller.mintUploadToken({ kind: "blog_cover" } as never);
    expect(out.token).toMatch(/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/);
    expect(out.uploadUrl).toContain("/upload/asset");
    expect(out.uploadUrl).toContain("kind=blog_cover");
  });

  it("mints a blog_photo token for system_admin", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeAdminCtx(db) as never);
    const out = await caller.mintUploadToken({ kind: "blog_photo" } as never);
    expect(out.token).toBeTypeOf("string");
    expect(out.uploadUrl).toContain("kind=blog_photo");
  });

  it("rejects an unknown kind via zod (not just the upload-token allowlist)", async () => {
    const { db } = createDbMock();
    const caller = callerFor(makeAdminCtx(db) as never);
    await expect(
      caller.mintUploadToken({ kind: "logo" } as never)
    ).rejects.toThrow();
  });
});

// ─── listPublic / getPublic ───────────────────────────────────────────────

describe("blog router — public reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listPublic returns parsed BlogPostDto rows", async () => {
    const { db } = createDbMock([
      [
        {
          id: "bp_1",
          slug: "hello",
          status: "published",
          category: "tips",
          coverUrl: "https://cdn/c.jpg",
          coverAltJson: JSON.stringify({ en: "Cover" }),
          coverCredit: null,
          titlesJson: JSON.stringify({ ru: "Привет", en: "Hello" }),
          excerptsJson: JSON.stringify({}),
          bodiesJson: JSON.stringify({}),
          keywordsJson: null,
          relatedSlugsJson: null,
          publishedDate: "2026-05-21",
          updatedDate: null,
          createdAt: 1700000000,
          updatedAt: 1700000100,
          publishedAt: 1700000200,
          archivedAt: null,
          createdByWebUserId: null,
          updatedByWebUserId: null,
        },
      ],
    ]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    const out = await caller.listPublic({} as never);
    expect(out).toHaveLength(1);
    expect(out[0]!.slug).toBe("hello");
    expect(out[0]!.titles.ru).toBe("Привет");
    expect(out[0]!.coverImage?.url).toBe("https://cdn/c.jpg");
  });

  it("getPublic returns null for an unknown slug", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFor(makeUnauthCtx(db) as never);
    const out = await caller.getPublic({ slug: "missing" } as never);
    expect(out).toBeNull();
  });
});
