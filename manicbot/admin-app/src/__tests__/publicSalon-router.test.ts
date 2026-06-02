import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/auth/auth", () => ({
  auth: vi.fn(async () => null),
}));

// Rate-limit short-circuit — the public router calls
// `checkRateLimit(ctx.db, ip, action, ...)` against D1, but the mock
// ctx has no rate_limits table. Stub the helper to always allow.
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100, resetAt: 0 })),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { publicSalonRouter } from "~/server/api/routers/publicSalon";
import { createDbMock } from "./helpers/db-mock";

function publicCaller(db: any) {
  return createCallerFactory(publicSalonRouter)({
    db,
    webUser: null,
    headers: new Headers(),
  } as never);
}

describe("publicSalon router — FTS5 wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search", () => {
    it("returns the underlying tenant rows (FTS-joined) for a free-text query", async () => {
      const rows = [
        {
          id: "t_1",
          slug: "studio-a",
          name: "Studio A",
          description: "Best",
          city: "Warsaw",
          lat: null,
          lng: null,
          photos: null,
          salon: null,
          mapsUrl: null,
          instagramUrl: null,
          isTest: 0,
        },
      ];
      const dbMock = createDbMock([rows]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.search({ query: "manicure", limit: 20, page: 1, radiusKm: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.slug).toBe("studio-a");
      // Mock db is hit exactly once for the FTS-joined select.
      expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    });

    it("returns an empty page when the query sanitises to nothing (e.g. '!!!')", async () => {
      // No DB call should happen — the procedure short-circuits when
      // buildFtsMatchExpression returns null for the free-text input.
      const dbMock = createDbMock([]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.search({ query: "!!!", limit: 20, page: 1, radiusKm: 20 });

      expect(result).toEqual({ items: [], hasMore: false, page: 1, total: 0 });
      expect(dbMock.db.select).not.toHaveBeenCalled();
    });

    it("runs without an FTS join when no query/city is provided (browse mode)", async () => {
      const dbMock = createDbMock([[]]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.search({ limit: 20, page: 1, radiusKm: 20 });

      expect(result.items).toEqual([]);
      expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    });

    it("returns hasMore=true when the row count exceeds limit", async () => {
      const rows = Array.from({ length: 21 }, (_, i) => ({
        id: `t_${i}`,
        slug: `s-${i}`,
        name: `Salon ${i}`,
        description: null,
        city: null,
        lat: null,
        lng: null,
        photos: null,
        salon: null,
        mapsUrl: null,
        instagramUrl: null,
        isTest: 0,
      }));
      const dbMock = createDbMock([rows]);
      const caller = publicCaller(dbMock.db);
      const result = await caller.search({ query: "salon", limit: 20, page: 1, radiusKm: 20 });

      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(20);
    });
  });

  describe("autocomplete", () => {
    it("returns the salon list (FTS-joined) when q is at least 2 chars", async () => {
      const rows = [
        { slug: "studio-a", name: "Studio A", city: "Warsaw", photos: null },
      ];
      const dbMock = createDbMock([rows]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.autocomplete({ q: "ma" });

      expect(result.salons).toHaveLength(1);
      expect(result.salons[0]?.slug).toBe("studio-a");
      expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    });

    it("returns empty when q is below 2 chars (no DB hit)", async () => {
      const dbMock = createDbMock([]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.autocomplete({ q: "a" });

      expect(result.salons).toEqual([]);
      expect(dbMock.db.select).not.toHaveBeenCalled();
    });

    it("returns empty when q sanitises to nothing (e.g. punctuation only)", async () => {
      const dbMock = createDbMock([]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.autocomplete({ q: "!!" });

      expect(result.salons).toEqual([]);
      expect(dbMock.db.select).not.toHaveBeenCalled();
    });

    it("matches blog articles via substring on titles", async () => {
      const dbMock = createDbMock([[]]);
      const caller = publicCaller(dbMock.db);
      const result = await caller.autocomplete({ q: "telegram" });

      // The blog article "manicbot-telegram-booking" should match by
      // its multi-lang title containing 'telegram'.
      expect(result.articles.length).toBeGreaterThan(0);
      expect(result.articles[0]?.slug).toBe("manicbot-telegram-booking");
    });
  });

  describe("getProfile — no longer issues the dead reviews-by-slug query", () => {
    it("queries reviews exactly once, keyed on tenant.id (not slug)", async () => {
      // Promise.all chunk (current): tenant + services + masters + tenantConfig + bots + serviceCategories.
      // Then a follow-up single reviews query (only if reviewsPublic).
      const tenantRows = [{ id: "t_real", slug: "demo", publicActive: 1, name: "Demo" }];
      const reviewsAvg = [{ avg: 4.5, count: 12 }];
      const dbMock = createDbMock([
        tenantRows, // tenants
        [],         // services
        [],         // masters
        [],         // tenantConfig — no reviews_public override
        [],         // bots
        [],         // serviceCategories (PR — categories list, parallel with bots)
        [],         // photoAlbums (0104 — albums batch)
        [],         // albumPhotos (0104 — albums batch)
        reviewsAvg, // reviews (single query, keyed on tenant.id)
      ]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.getProfile({ slug: "demo" });

      expect(result?.rating).toEqual({ avg: 4.5, count: 12 });
      // 8 selects for the Promise.all batch + exactly 1 for reviews = 9 total.
      // The batch grew from 6→8 when photo_albums + album_photos joined it
      // (migration 0104). Still ONE reviews query, not two — the test's
      // original guarantee (no dead reviews-by-slug round-trip) holds.
      expect(dbMock.db.select).toHaveBeenCalledTimes(9);
    });
  });

  describe("getProfile — background image + albums (0103/0104)", () => {
    it("exposes bgImage and assembles albums, dropping empty ones", async () => {
      const tenantRows = [
        { id: "t_real", slug: "demo", publicActive: 1, name: "Demo", bgImage: "https://cdn.test/bg.jpg" },
      ];
      const albumRows = [
        { id: "al_1", name: "Маникюр", coverUrl: null, sortOrder: 0 },
        { id: "al_empty", name: "Пусто", coverUrl: null, sortOrder: 1 },
      ];
      const albumPhotoRows = [
        { albumId: "al_1", photoUrl: "https://cdn.test/p1.jpg" },
        { albumId: "al_1", photoUrl: "https://cdn.test/p2.jpg" },
      ];
      const dbMock = createDbMock([
        tenantRows, [], [], [], [], [], albumRows, albumPhotoRows, [{ avg: 0, count: 0 }],
      ]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.getProfile({ slug: "demo" });

      expect(result?.bgImage).toBe("https://cdn.test/bg.jpg");
      // al_empty has no photos → filtered out.
      expect(result?.albums).toHaveLength(1);
      expect(result?.albums[0]).toMatchObject({ id: "al_1", name: "Маникюр" });
      expect(result?.albums[0]?.photos).toEqual([
        "https://cdn.test/p1.jpg",
        "https://cdn.test/p2.jpg",
      ]);
    });

    it("returns null bgImage and empty albums for a salon with none (backward-compat)", async () => {
      const tenantRows = [{ id: "t2", slug: "plain", publicActive: 1, name: "Plain" }];
      const dbMock = createDbMock([
        tenantRows, [], [], [], [], [], [], [], [{ avg: 0, count: 0 }],
      ]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.getProfile({ slug: "plain" });

      expect(result?.bgImage).toBeNull();
      expect(result?.albums).toEqual([]);
    });
  });
});
