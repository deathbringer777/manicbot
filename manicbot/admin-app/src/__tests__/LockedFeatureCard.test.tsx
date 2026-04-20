// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { LockedFeatureCard } from "~/components/plugins/LockedFeatureCard";
import { renderWithLang, setDarkMode } from "./helpers/renderWithLang";
import type { PluginLockReason } from "@plugins/types";

const LANGS = ["ru", "ua", "en", "pl"] as const;

afterEach(() => {
  cleanup();
  setDarkMode(false);
});

describe("LockedFeatureCard — no lock", () => {
  it("renders children transparently when reason.kind='none'", () => {
    const reason: PluginLockReason = { kind: "none" };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div data-testid="child">inside</div>
      </LockedFeatureCard>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.queryByTestId("locked-feature-card")).toBeNull();
  });
});

describe("LockedFeatureCard — coming_soon", () => {
  it.each(LANGS)("shows localized coming-soon label in %s", (lang) => {
    const reason: PluginLockReason = { kind: "coming_soon" };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div data-testid="child">child</div>
      </LockedFeatureCard>,
      lang,
    );
    const wrapper = screen.getByTestId("locked-feature-card");
    expect(wrapper.getAttribute("data-lock-kind")).toBe("coming_soon");
    const labels: Record<typeof lang, string> = {
      ru: "Скоро будет доступно",
      ua: "Скоро буде доступно",
      en: "Coming soon",
      pl: "Wkrótce dostępne",
    };
    expect(wrapper.textContent).toContain(labels[lang]);
  });
});

describe("LockedFeatureCard — role_mismatch", () => {
  it.each(LANGS)("shows role_mismatch label in %s", (lang) => {
    const reason: PluginLockReason = {
      kind: "role_mismatch",
      availableFor: ["tenant_owner"],
    };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div>c</div>
      </LockedFeatureCard>,
      lang,
    );
    const wrapper = screen.getByTestId("locked-feature-card");
    const labels: Record<typeof lang, string> = {
      ru: "Недоступно для вашей роли",
      ua: "Недоступно для вашої ролі",
      en: "Not available for your role",
      pl: "Niedostępne dla Twojej roli",
    };
    expect(wrapper.textContent).toContain(labels[lang]);
  });
});

describe("LockedFeatureCard — plan gate", () => {
  it("shows required plan in the label (uppercase)", () => {
    const reason: PluginLockReason = { kind: "plan", required: "pro", current: "start" };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div>c</div>
      </LockedFeatureCard>,
    );
    const wrapper = screen.getByTestId("locked-feature-card");
    expect(wrapper.textContent).toContain("PRO");
  });

  it("uses amber accent styling for plan locks", () => {
    const reason: PluginLockReason = { kind: "plan", required: "max", current: "pro" };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div>c</div>
      </LockedFeatureCard>,
    );
    const wrapper = screen.getByTestId("locked-feature-card");
    // badge has text-blue class (plan style)
    const badge = wrapper.querySelector("[role='status']");
    expect(badge).toBeTruthy();
    expect(badge?.className).toContain("blue");
  });
});

describe("LockedFeatureCard — platform_only", () => {
  it("shows platform_only label", () => {
    const reason: PluginLockReason = { kind: "platform_only", currentScope: "tenant" };
    renderWithLang(
      <LockedFeatureCard reason={reason}>
        <div>c</div>
      </LockedFeatureCard>,
      "en",
    );
    expect(screen.getByTestId("locked-feature-card").textContent).toContain(
      "Platform admin only",
    );
  });
});

describe("LockedFeatureCard — theme", () => {
  it("renders content regardless of theme class (light)", () => {
    setDarkMode(false);
    renderWithLang(
      <LockedFeatureCard reason={{ kind: "coming_soon" }}>
        <div data-testid="c">inside</div>
      </LockedFeatureCard>,
    );
    expect(screen.getByTestId("c")).toBeTruthy();
  });

  it("renders content regardless of theme class (dark)", () => {
    setDarkMode(true);
    renderWithLang(
      <LockedFeatureCard reason={{ kind: "coming_soon" }}>
        <div data-testid="c">inside</div>
      </LockedFeatureCard>,
    );
    expect(screen.getByTestId("c")).toBeTruthy();
  });
});

describe("LockedFeatureCard — accessibility", () => {
  it("overlay is NOT aria-hidden so screen readers see the lock reason", () => {
    renderWithLang(
      <LockedFeatureCard reason={{ kind: "coming_soon" }}>
        <div>c</div>
      </LockedFeatureCard>,
    );
    const wrapper = screen.getByTestId("locked-feature-card");
    const overlay = wrapper.querySelector("[role='status']");
    expect(overlay?.getAttribute("aria-hidden")).not.toBe("true");
  });

  it("children are pointer-events-none to prevent interaction on locked cards", () => {
    renderWithLang(
      <LockedFeatureCard reason={{ kind: "role_mismatch", availableFor: ["system_admin"] }}>
        <button data-testid="trapped">Click me</button>
      </LockedFeatureCard>,
    );
    // parent of trapped button should have pointer-events-none class
    const btn = screen.getByTestId("trapped");
    const parent = btn.parentElement;
    expect(parent?.className).toContain("pointer-events-none");
  });
});
