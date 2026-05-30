/**
 * /messages path-whitelist — structural pin.
 *
 * The per-route whitelist booleans in `(dashboard)/layout.tsx` were consolidated
 * into a single source of truth: `isFullPageRoute()` in
 * `lib/routing/fullPageRoutes`. We pin (a) `/messages` (and `/messages/*`) is a
 * full-page route and (b) the layout delegates its role-dashboard-swap decision
 * to `isFullPageRoute`, so a master opening `/messages/<thread_id>` renders the
 * page instead of being intercepted by MasterDashboard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isFullPageRoute } from "~/lib/routing/fullPageRoutes";

const layoutSrc = readFileSync(
  path.resolve(__dirname, "../app/(dashboard)/layout.tsx"),
  "utf8",
);

describe("/messages whitelist pinned via isFullPageRoute", () => {
  it("treats /messages and /messages/* as full-page routes", () => {
    expect(isFullPageRoute("/messages")).toBe(true);
    expect(isFullPageRoute("/messages/thread-1")).toBe(true);
  });

  it("delegates the role-dashboard-swap decision to isFullPageRoute", () => {
    expect(layoutSrc).toMatch(
      /import\s*\{\s*isFullPageRoute\s*\}\s*from\s*"~\/lib\/routing\/fullPageRoutes"/,
    );
    const matches = layoutSrc.match(/isFullPage\b/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
