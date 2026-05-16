// @vitest-environment happy-dom
/**
 * BotFatherGuide — Telegram "how to create a bot" panel. The guide now lives
 * BELOW the connect form, so it must start collapsed and only expand on click.
 * Regression guard: the previous default-expanded state pushed the connect
 * form below the fold on mobile.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { BotFatherGuide } from "~/components/settings/BotFatherGuide";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
});

describe("BotFatherGuide", () => {
  it("starts collapsed (steps hidden until the toggle is clicked)", () => {
    renderWithLang(<BotFatherGuide />);
    // The first step title in Russian — should NOT be in the DOM yet.
    expect(screen.queryByText(/BotFather в Telegram/i)).toBeNull();
  });

  it("expands when the title button is clicked", () => {
    renderWithLang(<BotFatherGuide />);
    const toggle = screen.getByRole("button", { name: /создать бота/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/BotFather в Telegram/i)).toBeTruthy();
  });
});
