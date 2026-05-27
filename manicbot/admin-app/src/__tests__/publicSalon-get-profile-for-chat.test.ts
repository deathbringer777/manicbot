/**
 * `publicSalon.getProfileForChat` — chat-page reader (migration 0091).
 *
 * Twin of `publicSalon.getProfile` with one critical change: the WHERE
 * clause filters on `tenants.chatEnabled = 1` instead of
 * `tenants.publicActive = 1`. This is what lets the salon owner keep
 * their public-catalog card hidden while still serving a working chat
 * URL at `/salon/{slug}/chat`.
 *
 * The catalog gate (`getProfile`) is untouched: hiding the salon from
 * the directory still works exactly as before.
 *
 * Pins in this file:
 *   • Happy path: returns a projection when D1 yields the tenant row.
 *   • Returns null when D1 yields nothing (slug missing or chat off).
 *   • Source-code pin: the procedure references `tenants.chatEnabled`
 *     and NOT `tenants.publicActive` in its WHERE clause. Drift here
 *     would silently re-couple the chat to catalog visibility — exactly
 *     the bug 0091 was written to fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/auth/auth", () => ({ auth: vi.fn(async () => null) }));
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

describe("publicSalon.getProfileForChat — chat-only gate", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null when the slug is not found / chat is disabled", async () => {
    const dbMock = createDbMock([[]]); // empty result for the tenant lookup
    const caller = publicCaller(dbMock.db);

    const result = await caller.getProfileForChat({ slug: "missing" });
    expect(result).toBeNull();
  });

  it("returns a projection when a tenant row is yielded (independent of publicActive)", async () => {
    // Note the deliberate publicActive=0 here: this is the whole point
    // of 0091 — a salon with the catalog hidden can still serve chat.
    const tenantRow = {
      id: "t_chat",
      slug: "crystal",
      name: "Crystal",
      displayName: "Crystal Nails",
      logo: "https://cdn.example/logo.png",
      coverPhoto: null,
      brandPalette: null,
      description: "Salon",
      city: "Warsaw",
      lat: null,
      lng: null,
      photos: null,
      salon: "{}",
      mapsUrl: null,
      instagramUrl: null,
      isTest: 0,
      publicActive: 0,
      chatEnabled: 1,
    };
    // 1 tenant select + 5 parallel selects (services / masters / config /
    // bots / categories). Reviews skipped for brevity (default cfg has
    // no reviews_public=false, but we feed an empty rating fetch to
    // tolerate either branch).
    const dbMock = createDbMock([
      [tenantRow], [], [], [], [], [], [],
    ]);
    const caller = publicCaller(dbMock.db);

    const result = await caller.getProfileForChat({ slug: "crystal" });
    expect(result).not.toBeNull();
    expect(result?.slug).toBe("crystal");
    expect(result?.name).toBe("Crystal");
    expect(result?.displayName).toBe("Crystal Nails");
    expect(result?.logo).toBe("https://cdn.example/logo.png");
  });
});

describe("publicSalon.getProfileForChat — source-code pin (gate column)", () => {
  it("references tenants.chatEnabled (and NOT tenants.publicActive) inside its WHERE", () => {
    // Static check on the router source so a future refactor can't
    // silently re-couple the chat surface to `publicActive`. We look at
    // the slice between the `getProfileForChat:` token and the start of
    // the next procedure (`,\n  /**` or a sibling key).
    const here = path.dirname(fileURLToPath(import.meta.url));
    const routerPath = path.resolve(here, "..", "server", "api", "routers", "publicSalon.ts");
    const src = readFileSync(routerPath, "utf8");

    const startIdx = src.indexOf("getProfileForChat:");
    expect(startIdx, "getProfileForChat: must exist in publicSalon.ts").toBeGreaterThan(-1);

    // Slice from the proc name forward up to ~3000 chars — large enough
    // to capture the full procedure body, small enough not to bleed
    // into the next one.
    const procBody = src.slice(startIdx, startIdx + 3000);

    expect(procBody).toMatch(/tenants\.chatEnabled/);
    // Either no mention of publicActive at all OR only in a comment.
    // Strip block comments first.
    const stripped = procBody.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(stripped).not.toMatch(/eq\(tenants\.publicActive/);
  });
});
