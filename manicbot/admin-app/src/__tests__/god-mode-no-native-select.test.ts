/**
 * God-Mode native-select pin.
 *
 * Native `<select>` elements render at the OS layer, ignore page
 * theming, and look out of place inside the brand-styled admin shell.
 * The project ships `~/components/ui/Select.tsx` — a controlled
 * replacement with the same API surface (one-line swap) used across
 * every tenant-facing marketing modal (see
 * `marketing-modals-no-native-select.test.ts`).
 *
 * This file extends that contract to the God Mode (system_admin) page
 * surfaces. New native `<select>` tags inside any listed file will
 * fail the test — keeping the visual contract consistent between the
 * salon dashboard and the cross-tenant admin views.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const GOD_MODE_FILES = [
  "app/(dashboard)/errors/ErrorsPageClient.tsx",
  "app/(dashboard)/conversations/_components/ConversationsClient.tsx",
  "app/(dashboard)/marketing-autopilot/MarketingAutopilotClient.tsx",
];

describe("God Mode pages — no native <select>", () => {
  describe.each(GOD_MODE_FILES)("%s", (file) => {
    const src = read(file);

    // Skip comment lines so a JSDoc that describes the old surface
    // can legitimately mention `<select>`.
    const codeOnly = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => !line.trim().startsWith("*"))
      .join("\n");

    it("does not render a native <select> tag", () => {
      expect(codeOnly).not.toMatch(/<select\b/);
    });

    it("imports the custom Select component", () => {
      expect(src).toMatch(/from\s+"~\/components\/ui\/Select"/);
    });
  });
});
