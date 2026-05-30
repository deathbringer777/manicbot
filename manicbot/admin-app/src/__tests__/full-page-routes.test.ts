/**
 * isFullPageRoute — single source of truth for which (dashboard) paths render
 * their own page.tsx (inside WebShell) for EVERY role, instead of the client
 * layout swapping in the role dashboard.
 *
 * Regression pin: the salon-invitation bell notification linked to a correct
 * `/invitations/<id>` URL, but `(dashboard)/layout.tsx` only rendered `children`
 * for a hard-coded whitelist that omitted `/invitations`. A tenant_owner who
 * clicked the notification landed on the home dashboard, never the accept page.
 */
import { describe, it, expect } from "vitest";
import { isFullPageRoute } from "~/lib/routing/fullPageRoutes";

describe("isFullPageRoute", () => {
  it("treats the invitation accept page as a full page (the bell-invite-click bug)", () => {
    expect(isFullPageRoute("/invitations/202ea940-503d-4cdf-82c2-873956626b13")).toBe(true);
    expect(isFullPageRoute("/invitations")).toBe(true);
  });

  it("keeps every previously-whitelisted prefix renderable", () => {
    for (const p of [
      "/settings",
      "/plugins",
      "/plugins/abc",
      "/plugin/abc",
      "/marketing",
      "/marketing/autopilot",
      "/messages",
      "/messages/thread-1",
      "/notifications",
    ]) {
      expect(isFullPageRoute(p)).toBe(true);
    }
  });

  it("does NOT treat role-dashboard / tabbed routes as full pages", () => {
    for (const p of ["/dashboard", "/", "/appointments", "/channels", "/billing", "/clients"]) {
      expect(isFullPageRoute(p)).toBe(false);
    }
  });

  it("does not match a prefix that is only a substring (no false positives)", () => {
    expect(isFullPageRoute("/settings-export")).toBe(false);
    expect(isFullPageRoute("/messages-archive")).toBe(false);
  });
});
