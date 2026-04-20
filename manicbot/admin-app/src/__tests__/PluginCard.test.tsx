// @vitest-environment happy-dom
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
import { renderWithLang, setDarkMode } from "./helpers/renderWithLang";
import type { CatalogCard, PluginLockReason } from "@plugins/types";

afterEach(() => {
  cleanup();
  setDarkMode(false);
});

function card(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    slug: "sample-plugin",
    category: "productivity",
    status: "live",
    iconName: "Sparkles",
    iconTint: "#8b5cf6",
    name: "Sample",
    tagline: "A tagline",
    description: "Full description",
    keywords: ["sample", "demo"],
    billingLabel: "Free",
    billingModel: "free",
    lock: { kind: "none" },
    installed: false,
    installationId: null,
    enabled: false,
    ...overrides,
  };
}

describe("PluginCard — base rendering", () => {
  it("renders localized name, tagline, and category", () => {
    renderWithLang(<PluginCard card={card({ category: "growth" })} />, "en");
    const el = screen.getByTestId("plugin-card");
    expect(el.textContent).toContain("Sample");
    expect(el.textContent).toContain("A tagline");
    expect(el.textContent).toContain("Growth");
  });

  it.each(["ru", "ua", "en", "pl"] as const)("renders category label in %s", (lang) => {
    renderWithLang(<PluginCard card={card({ category: "communication" })} />, lang);
    const el = screen.getByTestId("plugin-card");
    const expected = {
      ru: "Коммуникации",
      ua: "Комунікації",
      en: "Communication",
      pl: "Komunikacja",
    }[lang];
    expect(el.textContent).toContain(expected);
  });

  it("renders billing label", () => {
    renderWithLang(<PluginCard card={card({ billingLabel: "$9/mo", billingModel: "paid_addon_monthly" })} />);
    expect(screen.getByTestId("plugin-card").textContent).toContain("$9/mo");
  });

  it("exposes slug + category + status via data- attributes", () => {
    renderWithLang(<PluginCard card={card({ slug: "x", category: "ai", status: "beta" })} />);
    const el = screen.getByTestId("plugin-card");
    expect(el.getAttribute("data-slug")).toBe("x");
    expect(el.getAttribute("data-category")).toBe("ai");
    expect(el.getAttribute("data-status")).toBe("beta");
  });
});

describe("PluginCard — badges", () => {
  it("shows 'Installed' badge when card.installed + enabled", () => {
    renderWithLang(<PluginCard card={card({ installed: true, enabled: true, installationId: "pi_1" })} />, "en");
    expect(screen.getByTestId("plugin-card").textContent).toMatch(/Installed/i);
  });

  it("shows 'Disabled' badge when installed but not enabled", () => {
    renderWithLang(<PluginCard card={card({ installed: true, enabled: false, installationId: "pi_1" })} />, "en");
    expect(screen.getByTestId("plugin-card").textContent).toMatch(/Disabled/i);
  });

  it("shows 'Beta' badge for beta plugins", () => {
    renderWithLang(<PluginCard card={card({ status: "beta" })} />, "en");
    expect(screen.getByTestId("plugin-card").textContent).toMatch(/Beta/i);
  });

  it("no status badge for plain live uninstalled plugins", () => {
    renderWithLang(<PluginCard card={card()} />);
    const el = screen.getByTestId("plugin-card");
    // Neither "Installed" nor "Beta" should appear in text
    expect(el.textContent).not.toMatch(/Installed/);
    expect(el.textContent).not.toMatch(/Beta/);
  });
});

describe("PluginCard — lock states wrap the card", () => {
  it.each([
    { kind: "coming_soon" } as PluginLockReason,
    { kind: "role_mismatch", availableFor: ["system_admin"] } as PluginLockReason,
    { kind: "plan", required: "pro", current: "start" } as PluginLockReason,
    { kind: "platform_only", currentScope: "tenant" } as PluginLockReason,
  ])("wraps card when lock=%o", (lock) => {
    renderWithLang(<PluginCard card={card({ lock })} />);
    expect(screen.getByTestId("locked-feature-card")).toBeTruthy();
  });

  it("does not wrap when lock.kind='none'", () => {
    renderWithLang(<PluginCard card={card({ lock: { kind: "none" } })} />);
    expect(screen.queryByTestId("locked-feature-card")).toBeNull();
    expect(screen.getByTestId("plugin-card")).toBeTruthy();
  });
});

describe("PluginCard — CTA link", () => {
  it("says 'Learn more' when uninstalled", () => {
    renderWithLang(<PluginCard card={card()} />, "en");
    const el = screen.getByTestId("plugin-card");
    expect(el.textContent).toMatch(/Learn more/i);
  });

  it("says 'Open' when installed+enabled", () => {
    renderWithLang(<PluginCard card={card({ installed: true, enabled: true, installationId: "pi_1" })} />, "en");
    const el = screen.getByTestId("plugin-card");
    expect(el.textContent).toMatch(/Open/i);
  });

  it("CTA link points to /plugins/<slug>", () => {
    renderWithLang(<PluginCard card={card({ slug: "tip-jar" })} />);
    const link = screen
      .getByTestId("plugin-card")
      .querySelector("a[href='/plugins/tip-jar']");
    expect(link).toBeTruthy();
  });
});

describe("PluginCard — themes", () => {
  it("renders in light mode", () => {
    setDarkMode(false);
    renderWithLang(<PluginCard card={card()} />);
    expect(screen.getByTestId("plugin-card")).toBeTruthy();
  });

  it("renders in dark mode", () => {
    setDarkMode(true);
    renderWithLang(<PluginCard card={card()} />);
    expect(screen.getByTestId("plugin-card")).toBeTruthy();
  });
});

describe("PluginCard — mobile adaptation", () => {
  it("uses responsive padding (p-4 sm:p-5)", () => {
    renderWithLang(<PluginCard card={card()} />);
    const el = screen.getByTestId("plugin-card");
    expect(el.className).toContain("p-4");
    expect(el.className).toContain("sm:p-5");
  });

  it("grid/flex layout scales in card body (flex-1 min-h-0)", () => {
    renderWithLang(<PluginCard card={card({ tagline: "Very long tagline ".repeat(10) })} />);
    const body = screen.getByTestId("plugin-card").querySelector(".flex-1");
    expect(body).toBeTruthy();
  });
});
