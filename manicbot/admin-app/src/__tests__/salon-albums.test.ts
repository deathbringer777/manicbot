/**
 * Photo albums CRUD (migration 0104) + background-image URL hardening (0103).
 *
 * Pins:
 *   • createAlbum appends at MAX(sort_order)+1 and mints an `al_` id, scoped
 *     to the caller's tenant.
 *   • setAlbumPhotos full-replaces an album's photos (delete + ordered
 *     re-insert) and syncs the album cover to the first photo.
 *   • setAlbumPhotos rejects non-https photo URLs (stored-XSS guard — photos
 *     render into <img src>), mirroring logo/coverPhoto in updateSalonProfile.
 *   • reorderAlbums refuses a forged id that doesn't belong to the tenant.
 *   • Album mutations are tenant-isolated (assertTenantOwner): a caller can't
 *     touch another tenant's albums.
 *   • updateSalonProfile.bgImage enforces https-only (same guard as cover).
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
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(salonRouter);

describe("salon photo albums — CRUD + isolation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("createAlbum appends at MAX(sort_order)+1 with an al_ id, tenant-scoped", async () => {
    const { db, insertCalls } = createDbMock([[{ max: 2 }]]); // current max sort_order
    const caller = createCaller(makeTenantOwnerCtx(db, "t_owner") as never);

    const res = await caller.createAlbum({ tenantId: "t_owner", name: "Маникюр" });

    expect(res.sortOrder).toBe(3);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.values.tenantId).toBe("t_owner");
    expect(String(insertCalls[0]!.values.id)).toMatch(/^al_/);
    expect(insertCalls[0]!.values.sortOrder).toBe(3);
  });

  it("setAlbumPhotos replaces photos (delete + ordered insert) and syncs the cover", async () => {
    // 1st select = album-exists check.
    const { db, insertCalls, deleteCalls, updateCalls } = createDbMock([[{ id: "al_1" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_owner") as never);

    const res = await caller.setAlbumPhotos({
      tenantId: "t_owner",
      albumId: "al_1",
      photos: [
        { url: "https://cdn.test/a.jpg", r2Key: "k1" },
        { url: "https://cdn.test/b.jpg" },
      ],
    });

    expect(res).toEqual({ ok: true, count: 2 });
    expect(deleteCalls.length).toBeGreaterThan(0);          // old rows dropped
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]!.values.photoUrl).toBe("https://cdn.test/a.jpg");
    expect(insertCalls[0]!.values.sortOrder).toBe(0);
    expect(insertCalls[1]!.values.sortOrder).toBe(1);
    // Cover synced to the first photo.
    expect(updateCalls.some((u) => u.values.coverUrl === "https://cdn.test/a.jpg")).toBe(true);
  });

  it("setAlbumPhotos rejects a non-https photo URL (stored-XSS guard)", async () => {
    const { db } = createDbMock([]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_owner") as never);

    await expect(
      caller.setAlbumPhotos({
        tenantId: "t_owner",
        albumId: "al_1",
        photos: [{ url: "javascript:alert(1)" }],
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reorderAlbums refuses a forged id not belonging to the tenant", async () => {
    // The known-ids select returns only al_known.
    const { db } = createDbMock([[{ id: "al_known" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, "t_owner") as never);

    await expect(
      caller.reorderAlbums({ tenantId: "t_owner", ids: ["al_known", "al_forged"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a cross-tenant createAlbum (assertTenantOwner)", async () => {
    const { db, insertCalls } = createDbMock([[{ max: 0 }]]);
    // Caller owns t_owner but targets t_other.
    const caller = createCaller(makeTenantOwnerCtx(db, "t_owner") as never);

    await expect(
      caller.createAlbum({ tenantId: "t_other", name: "X" }),
    ).rejects.toThrow();
    expect(insertCalls).toHaveLength(0);
  });
});

describe("salon.updateSalonProfile — bgImage URL hardening", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  function makeCaller(tenantId = "t_owner") {
    const { db } = createDbMock([[{ id: tenantId, name: "Studio", slug: "studio", salon: "{}" }]]);
    return createCaller(makeTenantOwnerCtx(db, tenantId) as never);
  }

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "http://cdn.example.com/bg.png", // bare http
  ])("rejects bgImage = %j", async (badUrl) => {
    await expect(
      makeCaller().updateSalonProfile({ tenantId: "t_owner", bgImage: badUrl } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it.each([
    "https://cdn.example.com/bg.jpg",
    "", // clearing the field
  ])("accepts bgImage = %j", async (goodUrl) => {
    await expect(
      makeCaller().updateSalonProfile({ tenantId: "t_owner", bgImage: goodUrl } as never),
    ).resolves.toBeTruthy();
  });
});
