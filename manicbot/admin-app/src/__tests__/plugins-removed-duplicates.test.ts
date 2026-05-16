import { describe, it, expect } from "vitest";
import { listManifests, getPlugin } from "@plugins/index";

const REMOVED_DUPLICATE_SLUGS = [
  "platform-analytics-pro",
  "revenue-intelligence",
  "commission-calc",
  "sms-reminders",
  // 2026-05-16 cleanup — duplicates of built-in features:
  "command-palette",      // CommandPalette.tsx is mounted directly in (dashboard)/layout.tsx
  "activity-feed",        // ActivityFeed.tsx is mounted directly in (dashboard)/layout.tsx
  "birthday-campaigns",   // Marketing module (0032) + phasePromos cron already handle birthday promos
  "multi-lang-bot",       // orphan — never registered, never imported
] as const;

describe("removed duplicate plugins stay removed", () => {
  const slugs = new Set(listManifests().map((m) => m.slug));

  for (const removed of REMOVED_DUPLICATE_SLUGS) {
    it(`registry does NOT contain "${removed}"`, () => {
      expect(slugs.has(removed)).toBe(false);
      expect(getPlugin(removed)).toBeNull();
    });
  }

  it("google-calendar plugin is registered (addresses 'Nothing found' search bug)", () => {
    expect(slugs.has("google-calendar")).toBe(true);
    const plugin = getPlugin("google-calendar");
    expect(plugin).not.toBeNull();
    expect(plugin!.manifest.status).toBe("live");
  });
});
