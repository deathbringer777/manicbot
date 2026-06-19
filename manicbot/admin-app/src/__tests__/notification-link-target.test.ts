/**
 * resolveNotificationHref — pins the rule that notification links are anchored
 * at the in-app home (/dashboard) before router.push().
 *
 * Why this exists: the Worker (src/http/adminAppProxy.js) does NOT proxy "/"
 * to the admin-app — root serves the marketing landing page. A notification
 * whose stored link is "/" or "/?tab=…" therefore navigates the user OUT to
 * the landing instead of the intended in-app entity. Bare relative links
 * ("?tab=…") resolve against whatever page is current, which is equally wrong
 * from a full-page route. This helper coerces both to /dashboard so existing
 * rows (already written with the bad link) and future writes both land
 * correctly.
 */
import { describe, it, expect } from "vitest";
import { resolveNotificationHref } from "~/lib/notifications/linkTarget";

describe("resolveNotificationHref — root/relative links anchor at /dashboard", () => {
  it("rewrites the bare root path to /dashboard", () => {
    expect(resolveNotificationHref("/")).toBe("/dashboard");
  });

  it("rewrites a root path with a query (the birthday/appointment bug)", () => {
    expect(resolveNotificationHref("/?tab=clients&q=Olga")).toBe(
      "/dashboard?tab=clients&q=Olga",
    );
    expect(resolveNotificationHref("/?tab=appointments&apt=apt_1")).toBe(
      "/dashboard?tab=appointments&apt=apt_1",
    );
    expect(resolveNotificationHref("/?ticket=tk_1")).toBe("/dashboard?ticket=tk_1");
  });

  it("rewrites a bare relative query link to /dashboard", () => {
    expect(resolveNotificationHref("?tab=masters")).toBe("/dashboard?tab=masters");
    expect(resolveNotificationHref("?tab=schedule")).toBe("/dashboard?tab=schedule");
  });

  it("leaves already-correct admin-app links untouched", () => {
    const passthrough = [
      "/dashboard",
      "/dashboard?tab=channels",
      "/settings?section=billing",
      "/settings?section=help&ticket=1",
      "/messages?platform=1",
      "/messages?thread=th_1",
      "/marketing",
      "/notifications",
      "/invitations/inv_1",
      "/plugins",
    ];
    for (const link of passthrough) {
      expect(resolveNotificationHref(link)).toBe(link);
    }
  });

  it("does NOT mangle paths that merely start with the same letters as root", () => {
    // "/settings" must not be treated like "/" + "settings".
    expect(resolveNotificationHref("/settings")).toBe("/settings");
  });

  it("returns falsy input unchanged (caller guards on link presence)", () => {
    expect(resolveNotificationHref("")).toBe("");
  });
});
