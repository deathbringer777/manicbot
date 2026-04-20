// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { PluginFilters, type FilterValue } from "~/components/plugins/PluginFilters";
import { renderWithLang } from "./helpers/renderWithLang";

const EMPTY: FilterValue = {
  q: "",
  category: null,
  billing: null,
  installedOnly: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PluginFilters — search input", () => {
  it("renders localized placeholder in 4 languages", () => {
    const expectations = {
      ru: "Поиск по плагинам…",
      ua: "Пошук плагінів…",
      en: "Search plugins…",
      pl: "Szukaj wtyczek…",
    };
    for (const [lang, text] of Object.entries(expectations)) {
      cleanup();
      renderWithLang(
        <PluginFilters value={EMPTY} onChange={() => {}} />,
        lang as keyof typeof expectations,
      );
      const input = screen.getByTestId("plugin-filters-search") as HTMLInputElement;
      expect(input.placeholder).toBe(text);
    }
  });

  it("debounces calls to onChange by ~120ms", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderWithLang(<PluginFilters value={EMPTY} onChange={onChange} />, "en");
    const input = screen.getByTestId("plugin-filters-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sms" } });
    // Before debounce: onChange not called with new value
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(130);
    expect(onChange).toHaveBeenCalledTimes(1);
    const firstCall = onChange.mock.calls[0];
    expect(firstCall?.[0].q).toBe("sms");
  });
});

describe("PluginFilters — category pills", () => {
  it("renders a pill for each category", () => {
    renderWithLang(<PluginFilters value={EMPTY} onChange={() => {}} />, "en");
    for (const cat of ["communication", "analytics", "growth", "operations", "branding", "ai", "finance", "compliance", "productivity"]) {
      expect(screen.getByTestId(`filter-cat-${cat}`)).toBeTruthy();
    }
  });

  it("clicking a pill triggers onChange with category set", () => {
    const onChange = vi.fn();
    renderWithLang(<PluginFilters value={EMPTY} onChange={onChange} />, "en");
    fireEvent.click(screen.getByTestId("filter-cat-analytics"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, category: "analytics" });
  });
});

describe("PluginFilters — billing chips", () => {
  it("toggles billing filter on click", () => {
    const onChange = vi.fn();
    renderWithLang(<PluginFilters value={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("filter-billing-paid_addon_monthly"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, billing: "paid_addon_monthly" });
  });

  it("clicking an active billing chip clears it", () => {
    const onChange = vi.fn();
    renderWithLang(
      <PluginFilters value={{ ...EMPTY, billing: "free" }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("filter-billing-free"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, billing: null });
  });
});

describe("PluginFilters — installedOnly", () => {
  it("toggles installedOnly via the checkbox", () => {
    const onChange = vi.fn();
    renderWithLang(<PluginFilters value={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("plugin-filters-installed-only"));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, installedOnly: true });
  });
});

describe("PluginFilters — clear button", () => {
  it("shows clear button only when some filter is active", () => {
    const { rerender } = renderWithLang(
      <PluginFilters value={EMPTY} onChange={() => {}} />,
    );
    expect(screen.queryByTestId("plugin-filters-clear")).toBeNull();
    rerender(<PluginFilters value={{ ...EMPTY, category: "ai" }} onChange={() => {}} />);
    expect(screen.getByTestId("plugin-filters-clear")).toBeTruthy();
  });

  it("clicking clear resets everything", () => {
    const onChange = vi.fn();
    renderWithLang(
      <PluginFilters
        value={{ q: "hi", category: "ai", billing: "free", installedOnly: true }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("plugin-filters-clear"));
    expect(onChange).toHaveBeenCalledWith(EMPTY);
  });
});

describe("PluginFilters — a11y", () => {
  it("search input has an aria-label", () => {
    renderWithLang(<PluginFilters value={EMPTY} onChange={() => {}} />);
    const input = screen.getByTestId("plugin-filters-search");
    expect(input.getAttribute("aria-label")).toBeTruthy();
  });
});
