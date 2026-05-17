/**
 * Marketing-modal native-select pin.
 *
 * Native `<select>` elements render at the OS layer, ignore page
 * theming, and look out of place inside our glass-card modals. The
 * project ships `~/components/ui/Select.tsx` — a brand-styled
 * controlled replacement with the same API surface (one-line swap).
 *
 * This file pins that every tenant-facing marketing modal uses the
 * custom `Select`. New native `<select>` tags inside these files will
 * fail the test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MODAL_FILES = [
  "components/marketing/AutomationFormModal.tsx",
  "components/marketing/CampaignFormModal.tsx",
  "components/marketing/TemplateFormModal.tsx",
  "components/plugins/reminders/ReminderModal.tsx",
];

describe("marketing modals — no native <select>", () => {
  describe.each(MODAL_FILES)("%s", (file) => {
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
