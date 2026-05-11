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
      // Promise.all chunk: tenant + services + masters + tenantConfig + bots.
      // Then a follow-up single reviews query (only if reviewsPublic).
      const tenantRows = [{ id: "t_real", slug: "demo", publicActive: 1, name: "Demo" }];
      const reviewsAvg = [{ avg: 4.5, count: 12 }];
      const dbMock = createDbMock([
        tenantRows, // tenants
        [],         // services
        [],         // masters
        [],         // tenantConfig — no reviews_public override
        [],         // bots
        reviewsAvg, // reviews (single query, keyed on tenant.id)
      ]);
      const caller = publicCaller(dbMock.db);

      const result = await caller.getProfile({ slug: "demo" });

      expect(result?.rating).toEqual({ avg: 4.5, count: 12 });
      // 5 selects for the Promise.all batch + exactly 1 for reviews =
      // 6 total. Previously it was 7 (a dead query with eq(tenantId, slug)).
      expect(dbMock.db.select).toHaveBeenCalledTimes(6);
    });
  });
});
