/**
 * Pins the /notifications route into the (dashboard) layout whitelist —
 * if it's missing from any role block, the role's dashboard intercepts
 * the URL and the notifications page silently never renders.
 *
 * Mirrors the existing whitelist pattern around `isMarketingPage` /
 * `isMessagesPage`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../app/(dashboard)/layout.tsx");

describe("(dashboard)/layout.tsx — /notifications whitelist", () => {
  const src = readFileSync(FILE, "utf8");

  it("declares isNotificationsPage from pathname", () => {
    expect(src).toMatch(/const isNotificationsPage = pathname === "\/notifications"/);
  });

  it("includes isNotificationsPage in the whitelist for every role block", () => {
    // Mirror the 4 existing isMessagesPage usages — one per role block
    // (tenant_owner / tenant_manager / master / support+technical_support).
    const occurrences = src.match(/isNotificationsPage/g) ?? [];
    // 1 declaration + 4 usages in the role blocks = 5 minimum.
    expect(occurrences.length).toBeGreaterThanOrEqual(5);
  });
});
