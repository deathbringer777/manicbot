/**
 * /messages path-whitelist — real-source structural pin.
 *
 * Phase 2 cleanup: dropped the local `isWhitelistedPath` /
 * `resolveRouteOutcome` mirror functions. The whitelist lives inline in
 * `(dashboard)/layout.tsx` (four mirror blocks per role). We pin the
 * exact `isMessagesPage` declaration and assert it is referenced from
 * EVERY role-block guard, so a refactor that omits it from one block
 * fails the suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const layoutSrc = readFileSync(
  path.resolve(__dirname, "../app/(dashboard)/layout.tsx"),
  "utf8",
);

describe("/messages whitelist pinned in (dashboard)/layout.tsx", () => {
  it("declares isMessagesPage covering /messages and /messages/*", () => {
    expect(layoutSrc).toMatch(
      /const\s+isMessagesPage\s*=\s*pathname\s*===\s*"\/messages"\s*\|\|\s*pathname\.startsWith\("\/messages\/"\)/,
    );
  });

  it("includes isMessagesPage in EVERY role-block whitelist gate", () => {
    // The layout has 4 mirror blocks (tenant_owner / tenant_manager / master /
    // support+technical_support). Each must reference isMessagesPage so a
    // master typing /messages/<thread_id> renders the page-router children
    // instead of being intercepted by MasterDashboard.
    const matches = layoutSrc.match(/isMessagesPage/g) ?? [];
    // 1 declaration + 4 role-block usages = at least 5.
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("co-exists with isSettingsPage / isPluginsPage / isMarketingPage in the same OR-chain", () => {
    // The whitelist gates combine all module exceptions inside one ||-chain
    // per role block; this regex pins the exact composition (the order is
    // load-bearing for readability but assertion just locks membership).
    expect(layoutSrc).toMatch(
      /isSettingsPage\s*\|\|\s*isPluginsPage\s*\|\|\s*isMarketingPage\s*\|\|\s*isMessagesPage/,
    );
  });
});
