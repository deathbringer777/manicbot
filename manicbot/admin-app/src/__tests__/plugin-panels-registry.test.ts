/**
 * Tests for the plugin settings panel registry (dynamic import map).
 */

import { describe, it, expect } from "vitest";
import { hasPluginPanel, loadPluginPanel, listPanelComponentIds } from "~/components/settings/pluginPanels";

describe("pluginPanels registry", () => {
  it("hasPluginPanel returns false for unknown componentId", () => {
    expect(hasPluginPanel("nonsense.Panel")).toBe(false);
  });

  it("loadPluginPanel returns null for unknown componentId", () => {
    expect(loadPluginPanel("nonsense.Panel")).toBeNull();
  });

  it("listPanelComponentIds is a string array", () => {
    const ids = listPanelComponentIds();
    expect(Array.isArray(ids)).toBe(true);
    for (const id of ids) expect(typeof id).toBe("string");
  });

  it("every registered id is also discoverable via hasPluginPanel", () => {
    for (const id of listPanelComponentIds()) {
      expect(hasPluginPanel(id)).toBe(true);
    }
  });
});
