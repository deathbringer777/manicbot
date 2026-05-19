/**
 * M-C (audit 2026-05-20) — consent.record is `publicProcedure` by design
 * (anonymous landing visitors must be able to log decisions before any
 * account exists), so a rate-limit is the only defense against
 * append-only log spam. The audit flagged this as "likely already
 * mitigated; confirm by source pin" — this test makes the regression
 * hazard explicit so the rate-limit wiring cannot be removed silently.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

const CONSENT_ROUTER_PATH = new URL(
  "../server/api/routers/consent.ts",
  import.meta.url,
);

describe("M-C — consent.record rate-limit pin", () => {
  it("imports checkRateLimit", async () => {
    const src = await readFile(CONSENT_ROUTER_PATH, "utf8");
    expect(src).toMatch(/import\s+\{[^}]*checkRateLimit[^}]*\}\s+from\s+["']~\/server\/auth\/rateLimit["']/);
  });

  it("calls checkRateLimit with action='consent_record' inside the record mutation", async () => {
    const src = await readFile(CONSENT_ROUTER_PATH, "utf8");
    // Inside `record:` arrow, there must be a checkRateLimit call with the
    // action slug — the slug is the durable contract; constants can be
    // renamed but the action string is what the rate_limits PK uses.
    expect(src).toMatch(/checkRateLimit\([^)]*"consent_record"/);
  });

  it("rate-limit window must be ≤ 1 minute and cap must be ≤ 60", async () => {
    const src = await readFile(CONSENT_ROUTER_PATH, "utf8");
    const max = /RECORD_RATE_LIMIT_MAX\s*=\s*(\d+)/.exec(src)?.[1];
    const window = /RECORD_RATE_LIMIT_WINDOW_MS\s*=\s*([\d_]+)/.exec(src)?.[1]?.replaceAll("_", "");
    expect(max).toBeDefined();
    expect(window).toBeDefined();
    const maxN = Number(max);
    const windowN = Number(window);
    expect(maxN).toBeGreaterThan(0);
    expect(maxN).toBeLessThanOrEqual(60);
    expect(windowN).toBeGreaterThan(0);
    expect(windowN).toBeLessThanOrEqual(60_000);
  });
});
