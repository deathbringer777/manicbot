/**
 * Modal styling regression — locks in the 0062 visual contract.
 *
 * The user reported that "Новая запись" rendered with a translucent grey
 * card and a bright-white Shell header bleeding through the overlay.
 * Root cause: every modal carried the `glass-card` utility, defined in
 * globals.css as `background: rgba(248,250,252,0.85)` — which beats the
 * neighbouring `bg-white` (same specificity, later in cascade) and
 * renders the dialog as muddy translucent slate-50.
 *
 * Fix shipped: drop `glass-card` everywhere, use solid `bg-white` /
 * `dark:bg-slate-900` + `ring-1 ring-black/5`, plus `z-[100]` to sit
 * above Shell sticky headers (z-30 / z-40) and the mobile bottom nav
 * (z-50). Overlay tone changed from `bg-black/50` to `bg-slate-950/70`
 * with `backdrop-blur-md`.
 *
 * This test pins those constants — if anyone re-introduces `glass-card`
 * on a modal or drops below z-[100], the test fails immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

const MODAL_FILES = [
  "src/components/dashboard/ManualBookingModal.tsx",
  "src/components/salon/tabs/clients/ClientFormModal.tsx",
  "src/components/salon/tabs/clients/ClientDetailModal.tsx",
  "src/components/salon/tabs/clients/ImportClientsModal.tsx",
  "src/components/dashboard/TimeOffDialog.tsx",
  "src/components/dashboard/TimeReservationDialog.tsx",
  "src/components/EmailVerificationPopup.tsx",
  // Marketing module (PR #116) — full-screen modals
  "src/components/marketing/TemplateFormModal.tsx",
  "src/components/marketing/CampaignFormModal.tsx",
  "src/components/marketing/AutomationFormModal.tsx",
  // Reminders plugin (PR #125)
  "src/components/plugins/reminders/ReminderModal.tsx",
  // Master detail modal — owner-side edit (2026-05-17, parity with Clients tab)
  "src/components/salon/tabs/masters/MasterDetailModal.tsx",
  // Master avatar picker — emoji + photo picker (0075)
  "src/components/salon/tabs/masters/MasterAvatarPicker.tsx",
  // Service categories manage modal (0077 — "lists of services")
  "src/components/salon/tabs/services/ServiceCategoriesModal.tsx",
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("modal styling regression (0062)", () => {
  describe.each(MODAL_FILES)("%s", (file) => {
    const src = read(file);

    // We only assert against the modal card markup itself — the
    // string "glass-card" may legitimately appear in comments
    // describing why we DON'T use it. Filter out comment lines.
    const codeOnly = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => !line.trim().startsWith("*"))
      .join("\n");

    it("does not apply the glass-card utility to any element", () => {
      expect(codeOnly).not.toMatch(/className=[^"]*"[^"]*\bglass-card\b/);
    });

    it("uses z-[100] for the overlay (above Shell header z-30/40 and bottom nav z-50)", () => {
      expect(src).toMatch(/z-\[100\]/);
    });

    it("uses bg-slate-950/70 overlay (denser than the legacy bg-black/50)", () => {
      expect(src).toMatch(/bg-slate-950\/70/);
    });

    it("uses solid bg-white (no translucent /95 variant)", () => {
      // Allow bg-white in the card. Disallow bg-white/95, bg-slate-900/95,
      // bg-white/80 patterns that re-introduce translucency on the card.
      expect(codeOnly).not.toMatch(/className=[^"]*"[^"]*bg-(white|slate-900)\/\d+[^"]*shadow/);
    });

    it("includes a ring-1 around the card for clean separation from overlay", () => {
      expect(src).toMatch(/ring-1\s+ring-black\/5/);
    });
  });

  it("MasterDashboard block-confirm modal follows the same contract", () => {
    const src = read("src/components/dashboards/MasterDashboard.tsx");
    // Scope to the block-confirm region by anchoring around the
    // confirmBlock state usage.
    const idx = src.indexOf("confirmBlock && (");
    expect(idx).toBeGreaterThan(0);
    const region = src.slice(idx, idx + 2000);
    expect(region).toMatch(/z-\[100\]/);
    expect(region).toMatch(/bg-slate-950\/70/);
    expect(region).not.toMatch(/className=[^"]*"[^"]*\bglass-card\b/);
  });

  // God Mode / role-management modal — the page file itself uses
  // `glass-card` on UserCard rows (it's not a modal), so we cannot pin
  // the whole file. Anchor on the `roleModal && (` block instead, same
  // pattern as MasterDashboard above.
  it("UsersPageClient role modal follows the same contract", () => {
    const src = read("src/app/(dashboard)/users/UsersPageClient.tsx");
    const idx = src.indexOf("roleModal && (");
    expect(idx).toBeGreaterThan(0);
    const region = src.slice(idx, idx + 2500);
    expect(region).toMatch(/z-\[100\]/);
    expect(region).toMatch(/bg-slate-950\/70/);
    expect(region).toMatch(/backdrop-blur-md/);
    expect(region).toMatch(/ring-1\s+ring-black\/5/);
    expect(region).not.toMatch(/className=[^"]*"[^"]*\bglass-card\b/);
  });
});
