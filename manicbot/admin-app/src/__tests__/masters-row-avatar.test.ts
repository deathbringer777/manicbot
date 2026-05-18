/**
 * Masters tab row — avatar render contract.
 *
 * The 2026-05-17 MasterDetailModal shipped an emoji/photo picker (#163)
 * but the masters list row in `SalonDashboard.tsx` was still rendering
 * the legacy "first letter of name on a purple gradient" chip. So the
 * operator saved 💅 / a photo in settings, came back to the list, and
 * saw the initial — looking like the setting had been dropped.
 *
 * Fix: mirror the 0072 ClientRow contract (photo wins → emoji →
 * default 💅 via `resolveMasterAvatarEmoji`). This file pins the
 * contract on the master row inside SalonDashboard so a future refactor
 * cannot regress to the initial chip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SALON_DASHBOARD = join(
  __dirname,
  "..",
  "components",
  "dashboards",
  "SalonDashboard.tsx",
);

function readFile() {
  return readFileSync(SALON_DASHBOARD, "utf-8");
}

/**
 * The masters list block is identified by the `master-row-${m.chatId}`
 * data-testid. Grab the surrounding ~40 lines so the contract assertions
 * apply specifically to the master row, not to an unrelated chip
 * elsewhere in the 2700-line component.
 */
function getMasterRowBlock(src: string): string {
  const start = src.indexOf("data-testid={`master-row-${m.chatId}`}");
  expect(start, "master row anchor must exist").toBeGreaterThan(-1);
  const end = src.indexOf("</button>", start);
  expect(end, "master row closing tag must exist").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("SalonDashboard masters tab — row avatar", () => {
  it("imports the master avatar helper", () => {
    const src = readFile();
    expect(src).toMatch(
      /from\s+["']~\/lib\/masterAvatar["']/,
      // helper module must be wired in or the row falls back to a runtime ReferenceError
    );
    expect(src).toMatch(/resolveMasterAvatarEmoji/);
  });

  it("renders the saved avatar fields (avatarUrl / avatarEmoji) on the master row", () => {
    const block = getMasterRowBlock(readFile());
    expect(block).toContain("m.avatarUrl");
    expect(block).toContain("m.avatarEmoji");
    expect(block).toContain("resolveMasterAvatarEmoji");
  });

  it("does NOT fall back to the legacy 'first letter of name' chip", () => {
    const block = getMasterRowBlock(readFile());
    // The legacy chip rendered `(m.name ?? "?").charAt(0).toUpperCase()`
    // inside the avatar circle. Any reappearance is the regression.
    expect(block).not.toMatch(/charAt\(0\)\.toUpperCase\(\)/);
  });

  it("pins the avatar testid for downstream UI tests", () => {
    const block = getMasterRowBlock(readFile());
    expect(block).toContain("master-row-avatar-");
  });
});
