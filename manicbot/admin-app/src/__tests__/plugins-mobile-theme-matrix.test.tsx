// @vitest-environment happy-dom
/**
 * Mobile+theme matrix: sample plugin rendered at different viewport widths
 * and in light vs dark mode. happy-dom doesn't apply CSS media queries, so we
 * only assert Tailwind responsive classes are present in the DOM + the card
 * mounts cleanly in both themes.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: { cancel: () => Promise.resolve(), getData: () => [], setData: () => {}, invalidate: () => Promise.resolve() },
      },
    }),
    plugins: {
      listPinned: { useQuery: () => ({ data: [], isLoading: false }) },
      togglePin: { useMutation: () => ({ mutate: () => {}, error: null }) },
    },
  },
}));

import { PluginCard } from "~/components/plugins/PluginCard";
import { PluginFilters } from "~/components/plugins/PluginFilters";
import { LockedFeatureCard } from "~/components/plugins/LockedFeatureCard";
import { renderWithLang, setDarkMode } from "./helpers/renderWithLang";
import type { CatalogCard } from "@plugins/types";

const card: CatalogCard = {
  slug: "quick-notes",
  category: "productivity",
  status: "live",
  iconName: "StickyNote",
  iconTint: "#f59e0b",
  name: "Quick Notes",
  tagline: "Capture ideas fast",
  description: "Simple notepad in the panel",
  keywords: ["notes"],
  billingLabel: "Free",
  billingModel: "free",
  lock: { kind: "none" },
  installed: false,
  installationId: null,
  enabled: false,
};

afterEach(() => {
  cleanup();
  setDarkMode(false);
});

describe("Responsive classes present", () => {
  it("PluginCard has breakpoint padding (p-4 sm:p-5)", () => {
    renderWithLang(<PluginCard card={card} />);
    const el = screen.getByTestId("plugin-card");
    expect(el.className).toMatch(/p-4\b/);
    expect(el.className).toMatch(/sm:p-5/);
  });

  it("PluginFilters is sticky with backdrop blur", () => {
    renderWithLang(<PluginFilters value={{ q: "", category: null, billing: null, installedOnly: false }} onChange={() => {}} />);
    const bar = screen.getByTestId("plugin-filters");
    expect(bar.className).toMatch(/sticky/);
    expect(bar.className).toMatch(/backdrop-blur/);
  });
});

describe("Theme matrix", () => {
  it.each([false, true])("PluginCard renders with dark=%s", (dark) => {
    setDarkMode(dark);
    renderWithLang(<PluginCard card={card} />);
    const el = screen.getByTestId("plugin-card");
    // Tailwind dark: classes are always in the markup; we just verify mount.
    expect(el).toBeTruthy();
    expect(el.className).toContain("dark:");
  });

  it.each([false, true])("LockedFeatureCard overlay renders with dark=%s", (dark) => {
    setDarkMode(dark);
    renderWithLang(
      <LockedFeatureCard reason={{ kind: "coming_soon" }}>
        <div>c</div>
      </LockedFeatureCard>,
    );
    const el = screen.getByTestId("locked-feature-card");
    expect(el).toBeTruthy();
  });

  it.each([false, true])("PluginFilters renders with dark=%s", (dark) => {
    setDarkMode(dark);
    renderWithLang(<PluginFilters value={{ q: "", category: null, billing: null, installedOnly: false }} onChange={() => {}} />);
    expect(screen.getByTestId("plugin-filters")).toBeTruthy();
  });
});

describe("Mobile-friendly drawer / modal sizing hints", () => {
  it("PluginCard grid layout uses flex column for mobile-first layout", () => {
    renderWithLang(<PluginCard card={card} />);
    const el = screen.getByTestId("plugin-card");
    expect(el.className).toContain("flex-col");
    expect(el.className).toContain("h-full");
  });
});
