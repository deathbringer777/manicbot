/**
 * Pins /notifications into the (dashboard) full-page-route whitelist — if it is
 * not a full-page route, the role dashboard intercepts the URL and the
 * notifications page silently never renders.
 *
 * The per-route booleans were consolidated into `isFullPageRoute()` in
 * `lib/routing/fullPageRoutes`; this pins the route + the layout's delegation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isFullPageRoute } from "~/lib/routing/fullPageRoutes";

const FILE = resolve(__dirname, "../app/(dashboard)/layout.tsx");

describe("(dashboard)/layout.tsx — /notifications whitelist", () => {
  const src = readFileSync(FILE, "utf8");

  it("treats /notifications (and sub-paths) as a full-page route", () => {
    expect(isFullPageRoute("/notifications")).toBe(true);
    expect(isFullPageRoute("/notifications/x")).toBe(true);
  });

  it("delegates the role-dashboard-swap decision to isFullPageRoute", () => {
    expect(src).toMatch(
      /import\s*\{\s*isFullPageRoute\s*\}\s*from\s*"~\/lib\/routing\/fullPageRoutes"/,
    );
    const occurrences = src.match(/isFullPage\b/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
