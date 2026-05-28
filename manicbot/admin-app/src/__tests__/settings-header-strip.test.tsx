// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { User, ShieldCheck } from "lucide-react";

import { SettingsHeaderStrip } from "~/components/settings/SettingsHeaderStrip";

afterEach(() => cleanup());

describe("SettingsHeaderStrip", () => {
  it("renders the title", () => {
    render(<SettingsHeaderStrip icon={User} title="user@example.com" />);
    expect(screen.getByText("user@example.com")).toBeTruthy();
  });

  it("renders the subtitle when provided", () => {
    render(
      <SettingsHeaderStrip
        icon={User}
        title="user@example.com"
        subtitle="Salon owner"
      />
    );
    expect(screen.getByText("Salon owner")).toBeTruthy();
  });

  it("renders the rightSlot when provided", () => {
    render(
      <SettingsHeaderStrip
        icon={User}
        title="user@example.com"
        rightSlot={<span data-testid="custom-badge">✓ verified</span>}
      />
    );
    expect(screen.getByTestId("custom-badge")).toBeTruthy();
  });

  it("is NOT wrapped in a button — it's read-only", () => {
    const { container } = render(
      <SettingsHeaderStrip icon={User} title="user@example.com" />
    );
    // The whole strip is a section. No interactive button wrapping the content
    // (so clicking the strip does nothing — intentional, CTAs go in collapsibles).
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByTestId("settings-header-strip").tagName).toBe("SECTION");
  });

  it("ignores subtitle/rightSlot when undefined (no empty DOM nodes)", () => {
    const { container } = render(
      <SettingsHeaderStrip icon={User} title="user@example.com" />
    );
    // Title is the only <p> in the strip when subtitle is absent.
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0]?.textContent).toBe("user@example.com");
  });

  it("renders an icon (rendered as svg by lucide)", () => {
    const { container } = render(
      <SettingsHeaderStrip icon={ShieldCheck} title="user@example.com" />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
