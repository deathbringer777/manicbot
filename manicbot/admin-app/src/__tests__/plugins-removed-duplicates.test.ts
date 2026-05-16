import { describe, it, expect } from "vitest";
import { listManifests, getPlugin } from "@plugins/index";

/**
 * Every slug in this list was REMOVED from the marketplace registry.
 * Tests assert the registry stays clean — if any slug accidentally
 * re-enters, the cleanup gets caught by CI instead of regressing live.
 *
 * 2026-05-16 cleanup added 13 more slugs that either duplicated already-shipped
 * core capabilities (booking-reminder, client-crm-lite, quick-notes) or whose
 * UI got folded back into core (ai-abuse-monitor, gdpr-center, sla-tracker,
 * escalation-playbook, kb-search, ticket-templates, keyboard-shortcuts,
 * dark-plus, portfolio-gallery). `google-calendar` was initially in the
 * dropped list but was later restored as a marketplace facade over the
 * existing core OAuth flow — it is NOT in REMOVED_DUPLICATE_SLUGS below.
 * See the `manicbot/plugins/registry.ts` header for the full rationale.
 *
 * `sms-reminders` stays in this list until Phase 3 of the catalog roadmap
 * lands the real implementation; once that PR ships, remove the line.
 */
const REMOVED_DUPLICATE_SLUGS = [
  "platform-analytics-pro",
  "revenue-intelligence",
  "commission-calc",
  "sms-reminders",
  // 2026-05-16 prior cleanup — duplicates of built-in features:
  "command-palette",      // CommandPalette.tsx is mounted directly in (dashboard)/layout.tsx
  "activity-feed",        // ActivityFeed.tsx is mounted directly in (dashboard)/layout.tsx
  "birthday-campaigns",   // Marketing module (0032) + phasePromos cron already handle birthday promos
  "multi-lang-bot",       // orphan — never registered, never imported
  // 2026-05-16 catalog audit — Phase 1 cleanup:
  // NOTE: `google-calendar` was in the original cleanup list but was
  // restored as a marketplace facade over the core OAuth flow — do NOT
  // re-add it here.
  "booking-reminder",     // duplicated by worker `phaseReminders` cron
  "client-crm-lite",      // duplicated by core `clients.ts` router (0062)
  "quick-notes",          // subset of task-board
  "ai-abuse-monitor",     // folded into God Mode `/errors` filter tab
  "gdpr-center",          // folded into `consent.ts` + `/admin/gdpr` page
  "sla-tracker",          // folded into Support dashboard SLA tab
  "escalation-playbook",  // folded into Support dashboard playbook tab
  "kb-search",            // folded into Support dashboard FTS search
  "ticket-templates",     // folded into Support reply composer
  "keyboard-shortcuts",   // folded into `(dashboard)/layout.tsx` global hook
  "dark-plus",            // folded into `AppearanceSection` extra themes
  "portfolio-gallery",    // folded into public salon + master profile pages
] as const;

describe("removed duplicate plugins stay removed", () => {
  const slugs = new Set(listManifests().map((m) => m.slug));

  for (const removed of REMOVED_DUPLICATE_SLUGS) {
    it(`registry does NOT contain "${removed}"`, () => {
      expect(slugs.has(removed)).toBe(false);
      expect(getPlugin(removed)).toBeNull();
    });
  }

  it("task-board plugin is still registered (regression guard for retained 7)", () => {
    expect(slugs.has("task-board")).toBe(true);
    const plugin = getPlugin("task-board");
    expect(plugin).not.toBeNull();
    expect(plugin!.manifest.status).toBe("live");
  });
});
