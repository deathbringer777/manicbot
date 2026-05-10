// @vitest-environment happy-dom
/**
 * Tests for the shared `PluginRuntimeShell` component.
 *
 * The shell is the single source of truth for plugin-runtime visual identity
 * (icon + localized name + tagline + flash banner). These tests pin down:
 *   - manifest data drives the header (icon + name + tagline)
 *   - localized fields follow the active LangContext
 *   - the optional flash banner is rendered with the correct kind
 *   - unknown slugs degrade gracefully (Puzzle fallback, no crash)
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { PluginRuntimeShell, PluginRuntimeLoading } from "~/components/plugins/PluginRuntimeShell";
import type { Lang } from "~/lib/i18n";

afterEach(() => {
  cleanup();
});

function renderShell(slug: string, lang: Lang = "ru", flash: { kind: "ok" | "err"; text: string } | null = null) {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <PluginRuntimeShell slug={slug} flash={flash}>
        <div data-testid="runtime-content">payload</div>
      </PluginRuntimeShell>
    </LangContext.Provider>
  );
}

describe("PluginRuntimeShell", () => {
  it("renders the localized name + tagline from the manifest", () => {
    renderShell("google-calendar", "en");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Google Calendar");
    expect(screen.getByText("Sync appointments with Google Calendar in real time")).toBeTruthy();
  });

  it("switches name/tagline when LangContext changes", () => {
    const { rerender } = renderShell("google-calendar", "ru");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Google Календарь");

    rerender(
      <LangContext.Provider value={{ lang: "pl", setLang: () => {} }}>
        <PluginRuntimeShell slug="google-calendar">
          <div />
        </PluginRuntimeShell>
      </LangContext.Provider>
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Kalendarz Google");
  });

  it("renders the official Google Calendar SVG (PluginIcon GoogleCalendar branch)", () => {
    const { container } = renderShell("google-calendar", "ru");
    const svg = container.querySelector("[data-testid='plugin-runtime-shell'] svg");
    expect(svg).not.toBeNull();
    // The official logo uses Google's brand red. The hand-rolled "ugly" runtime
    // logo did NOT include this colour — guarding against regression.
    const html = container.innerHTML.toLowerCase();
    expect(html).toContain("#ea4335");
  });

  it("renders the flash banner with the right kind", () => {
    renderShell("google-calendar", "ru", { kind: "ok", text: "All good" });
    const flash = screen.getByTestId("plugin-runtime-flash");
    expect(flash.getAttribute("data-kind")).toBe("ok");
    expect(flash.textContent).toContain("All good");

    cleanup();

    renderShell("google-calendar", "ru", { kind: "err", text: "Boom" });
    const errFlash = screen.getByTestId("plugin-runtime-flash");
    expect(errFlash.getAttribute("data-kind")).toBe("err");
    expect(errFlash.textContent).toContain("Boom");
  });

  it("does not render a flash banner when flash is null", () => {
    renderShell("google-calendar", "ru", null);
    expect(screen.queryByTestId("plugin-runtime-flash")).toBeNull();
  });

  it("renders the runtime children inside the content slot", () => {
    renderShell("google-calendar", "ru");
    expect(screen.getByTestId("runtime-content").textContent).toBe("payload");
  });

  it("falls back gracefully when the slug is unknown (no crash, slug as title)", () => {
    renderShell("totally-made-up-slug", "en");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("totally-made-up-slug");
  });

  it("PluginRuntimeLoading renders an accessible spinner", () => {
    render(<PluginRuntimeLoading />);
    expect(screen.getByTestId("plugin-runtime-loading")).toBeTruthy();
  });
});
