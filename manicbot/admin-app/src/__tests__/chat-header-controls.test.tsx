// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";

import { ChatHeader } from "~/components/chat/ChatHeader";
import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { LangContext } from "~/components/LangContext";
import { render } from "@testing-library/react";
import type { ChatSalon } from "~/components/chat/chatTypes";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

/**
 * Salon chat page chrome lives inside ChatHeader (not the public site
 * PublicHeader, which is intentionally hidden on /salon/<slug>/chat).
 * That makes the lang dropdown + theme toggle inside ChatHeader the
 * ONLY way for a chat visitor to change language or theme. Pin both.
 */
describe("ChatHeader — embedded language + theme controls", () => {
  const salon: ChatSalon = {
    slug: "manicbot-demo",
    name: "ManicBot Demo",
    legalName: "ManicBot Demo Sp. z o.o.",
    logo: null,
    coverPhoto: null,
    brandPalette: { primary: "#EC4899" },
    description: null,
    city: "Warsaw",
  };

  function mount() {
    let currentLang: "ru" | "en" | "ua" | "pl" = "ru";
    return render(
      <PublicThemeProvider>
        <LangContext.Provider
          value={{ lang: currentLang, setLang: (l) => (currentLang = l) }}
        >
          <ChatHeader salon={salon} />
        </LangContext.Provider>
      </PublicThemeProvider>,
    );
  }

  it("renders the language dropdown trigger (flag + label)", () => {
    const { container } = mount();
    const langBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /RU|EN|UA|PL/.test(b.textContent ?? ""),
    );
    expect(langBtn).toBeTruthy();
  });

  it("renders the theme toggle and flips dark class on click", () => {
    const { container } = mount();
    const themeBtn = container.querySelector(
      "button[aria-label*='mode']",
    ) as HTMLButtonElement | null;
    expect(themeBtn).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(themeBtn!);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps the salon avatar + name + online status", () => {
    const { container } = mount();
    expect(container.textContent).toContain("ManicBot Demo");
    expect(container.textContent).toContain("Warsaw");
  });
});
