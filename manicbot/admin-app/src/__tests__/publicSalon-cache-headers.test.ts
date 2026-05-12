import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verifies that the tRPC fetch route handler attaches the public
 * `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
 * header for `publicSalon.getProfile`, `getCities`, and `autocomplete`
 * (relax.md §4 P2-9), but NOT for any other procedure.
 *
 * We don't dial through to the real Drizzle adapter — auth checks and
 * the directory query are mocked. The test is about the response
 * envelope at the HTTP layer.
 */

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/auth/auth", () => ({
  auth: vi.fn(async () => null), // unauthenticated → publicProcedure only
}));

// Force the publicSalon procedures to short-circuit before touching D1.
vi.mock("~/server/api/routers/publicSalon", async () => {
  const { z } = await import("zod");
  const { createTRPCRouter, publicProcedure } = await import("~/server/api/trpc");
  return {
    publicSalonRouter: createTRPCRouter({
      getProfile: publicProcedure
        .input(z.object({ slug: z.string() }))
        .query(async () => null),
      getCities: publicProcedure.query(async () => ["Warsaw"]),
      autocomplete: publicProcedure
        .input(z.object({ q: z.string().min(1).max(100) }))
        .query(async () => ({ salons: [], articles: [] })),
      // We also need `search` so the negative test can hit it.
      search: publicProcedure
        .input(
          z.object({
            query: z.string().optional(),
            limit: z.number().int().min(1).max(50).default(20),
          }),
        )
        .query(async () => ({ items: [], hasMore: false, page: 1, total: 0 })),
    }),
  };
});

import superjson from "superjson";
import { GET, POST } from "~/app/api/trpc/[trpc]/route";

function makeTrpcGet(procedure: string, input?: unknown): Request {
  // tRPC v11 GET shape: /api/trpc/<procedure>?input=<superjson>
  // The Content-Type header must be set so the JSON handler picks it up.
  const url = new URL(`https://example.test/api/trpc/${procedure}`);
  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
  }
  return new Request(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
}

describe("tRPC route Cache-Control headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches public Cache-Control on publicSalon.getProfile", async () => {
    const res = await GET(makeTrpcGet("publicSalon.getProfile", { slug: "demo" }) as never);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("attaches public Cache-Control on publicSalon.getCities", async () => {
    const res = await GET(makeTrpcGet("publicSalon.getCities") as never);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("attaches public Cache-Control on publicSalon.autocomplete", async () => {
    const res = await GET(makeTrpcGet("publicSalon.autocomplete", { q: "manicure" }) as never);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("does NOT cache publicSalon.search (it is personalised by lat/lng)", async () => {
    const res = await GET(makeTrpcGet("publicSalon.search", { query: "x" }) as never);
    // Either absent or set by another middleware, but specifically NOT
    // our public-cache string.
    expect(res.headers.get("Cache-Control")).not.toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("does NOT cache mutation requests (POST)", async () => {
    // POSTs to the tRPC handler are mutations / batches. Even if the
    // batch contained an allow-listed query, the type !== 'query' guard
    // in responseMeta should prevent edge caching.
    const url = new URL("https://example.test/api/trpc/publicSalon.getCities");
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.headers.get("Cache-Control")).not.toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });
});
