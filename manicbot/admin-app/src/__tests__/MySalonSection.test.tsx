// @vitest-environment happy-dom
/**
 * Behaviour-lock for the «Мой салон» top sub-tab refactor.
 *
 * The section used to be one tall scroll of 8 collapsible cards. It now groups
 * them under a top sub-tab strip (Профиль · Оформление · Публикация ·
 * Бронирование · Интеграции) mirrored to a `?sub=` query param. These tests
 * fail if anyone regresses the tab grouping, the deep-link seeding, or the
 * URL sync — and pin that the former «Публичный профиль» surface
 * (SalonPublishBody) now lives under «Публикация».
 *
 * Heavy editor children are stubbed so the test exercises the navigation
 * logic, not every child's own tRPC wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// ---- controllable router / search-params ----
let subValue: string | null = null;
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "sub" ? subValue : null) }),
  useRouter: () => ({ replace: mockReplace }),
}));

// ---- tRPC: only getSalonProfile is read by MySalonSection itself ----
vi.mock("~/trpc/react", () => ({
  api: {
    salon: {
      getSalonProfile: {
        useQuery: () => ({
          data: { name: "Demo Salon", slug: "demo", publicActive: 0 },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: "t_demo" }),
}));

vi.mock("~/components/LangContext", () => ({
  useLang: () => ({ lang: "ru" }),
}));

vi.mock("~/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/i18n")>();
  return actual; // real translations
});

// ---- chrome + child stubs ----
vi.mock("~/components/settings/SettingsHeaderStrip", () => ({
  SettingsHeaderStrip: () => React.createElement("div", { "data-testid": "header-strip" }),
}));
vi.mock("~/components/ui/Pill", () => ({
  Pill: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
}));
// Render CollapsibleSection's children unconditionally so body stubs are visible.
vi.mock("~/components/settings/CollapsibleSection", () => ({
  CollapsibleSection: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
}));

vi.mock("~/components/salon/SalonBasicInfoBody", () => ({ SalonBasicInfoBody: () => React.createElement("div", { "data-testid": "body-basic" }) }));
vi.mock("~/components/salon/SalonHoursBody", () => ({ SalonHoursBody: () => React.createElement("div", { "data-testid": "body-hours" }) }));
vi.mock("~/components/salon/SalonGalleryBody", () => ({ SalonGalleryBody: () => React.createElement("div", { "data-testid": "body-gallery" }) }));
vi.mock("~/components/salon/SalonBrandingBody", () => ({ SalonBrandingBody: () => React.createElement("div", { "data-testid": "body-branding" }) }));
vi.mock("~/components/salon/SalonAlbumsBody", () => ({ SalonAlbumsBody: () => React.createElement("div", { "data-testid": "body-albums" }) }));
vi.mock("~/components/salon/SalonStorefrontBody", () => ({ SalonStorefrontBody: () => React.createElement("div", { "data-testid": "body-storefront" }) }));
vi.mock("~/components/salon/SalonPublishBody", () => ({ SalonPublishBody: () => React.createElement("div", { "data-testid": "body-publish" }) }));
vi.mock("~/components/salon/AutoConfirmSettings", () => ({ AutoConfirmSettings: () => React.createElement("div", { "data-testid": "body-autoconfirm" }) }));
vi.mock("~/components/salon/AutoSuggestFavoriteSettings", () => ({ AutoSuggestFavoriteSettings: () => React.createElement("div", { "data-testid": "body-favorite" }) }));
vi.mock("~/components/salon/SalonCalendarSection", () => ({ SalonCalendarSection: () => React.createElement("div", { "data-testid": "body-calendar" }) }));

import { MySalonSection } from "~/components/settings/sections/MySalonSection";

function visibleBodies() {
  return [
    "body-basic", "body-hours", "body-gallery", "body-branding", "body-albums",
    "body-storefront", "body-publish", "body-autoconfirm", "body-favorite", "body-calendar",
  ].filter((id) => screen.queryByTestId(id));
}

describe("MySalonSection — top sub-tabs", () => {
  beforeEach(() => {
    subValue = null;
    mockReplace.mockClear();
  });
  afterEach(cleanup);

  it("renders exactly the 5 category tabs as a tablist", () => {
    render(React.createElement(MySalonSection));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      "Профиль", "Оформление", "Публикация", "Бронирование", "Интеграции",
    ]);
  });

  it("defaults to the Профиль category (basic info + hours), no other category's cards", () => {
    render(React.createElement(MySalonSection));
    expect(visibleBodies()).toEqual(["body-basic", "body-hours"]);
  });

  it("seeds the active category from ?sub= (publishing → publish block + storefront)", () => {
    subValue = "publishing";
    render(React.createElement(MySalonSection));
    // The former «Публичный профиль» surface now lives here.
    expect(visibleBodies()).toEqual(["body-storefront", "body-publish"]);
  });

  it("falls back to Профиль when ?sub= is an unknown value", () => {
    subValue = "bogus";
    render(React.createElement(MySalonSection));
    expect(visibleBodies()).toEqual(["body-basic", "body-hours"]);
  });

  it("clicking a tab swaps the visible cards and writes ?sub= to the URL", () => {
    render(React.createElement(MySalonSection));
    fireEvent.click(screen.getByRole("tab", { name: /Оформление/ }));
    expect(visibleBodies()).toEqual(["body-gallery", "body-branding", "body-albums"]);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(String(mockReplace.mock.calls[0]?.[0])).toContain("sub=appearance");
  });

  it("groups booking (auto-confirm + favorite) and integrations (calendar) correctly", () => {
    render(React.createElement(MySalonSection));
    fireEvent.click(screen.getByRole("tab", { name: /Бронирование/ }));
    expect(visibleBodies()).toEqual(["body-autoconfirm", "body-favorite"]);
    fireEvent.click(screen.getByRole("tab", { name: /Интеграции/ }));
    expect(visibleBodies()).toEqual(["body-calendar"]);
  });
});
