/**
 * Role-aware default settings section.
 *
 * `getDefaultSettingsSection` drives the landing tab on a bare `/settings`
 * (no ?section= param). It must return the FIRST ordered id for the role:
 * salon for owner/manager, profile for master, account for technical roles.
 * Pinned so the reorder + role-aware default can't silently regress to a
 * hardcoded "account" landing. Order itself is covered by
 * settings-shell-sections.test.tsx.
 */
import { describe, it, expect } from "vitest";
import {
  getDefaultSettingsSection,
  getSettingsSectionIds,
} from "~/components/settings/SettingsShell";

describe("getDefaultSettingsSection — role-aware landing tab", () => {
  it.each([
    ["tenant_owner", "salon"],
    ["tenant_manager", "salon"],
    ["master", "profile"],
    ["system_admin", "account"],
    ["support", "account"],
    ["technical_support", "account"],
    [null, "account"],
  ] as const)("%s → %s", (role, expected) => {
    expect(getDefaultSettingsSection(role)).toBe(expected);
  });

  it("always equals the first ordered section id", () => {
    for (const role of ["tenant_owner", "master", "system_admin", "support"] as const) {
      expect(getDefaultSettingsSection(role)).toBe(getSettingsSectionIds(role, true)[0]);
    }
  });
});
