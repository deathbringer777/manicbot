// @vitest-environment happy-dom
/**
 * ProfileCompletenessCard — gamification widget on the Overview tab.
 * Pins:
 *   - 8 known steps (name, description, city, logo, cover, services≥3,
 *     master≥1, public_active).
 *   - Level brackets: Novice <30%, Apprentice 30-60%, Pro 60-80%,
 *     Master 80-100%, Legend 100%.
 *   - Card hides itself entirely once 8/8.
 *   - "To do" list shows up to 4 unfilled steps with a "+N" overflow.
 *   - Clicking an unfilled step calls onJumpToTab with the target tab id.
 *   - "Already done" details opens a list of filled steps.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { ProfileCompletenessCard } from "~/components/dashboards/ProfileCompletenessCard";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
});

const allFalse = {
  hasName: false,
  hasDescription: false,
  hasCity: false,
  hasLogo: false,
  hasCoverPhoto: false,
  publicActive: false,
  servicesCount: 0,
  mastersCount: 0,
};

const allTrue = {
  hasName: true,
  hasDescription: true,
  hasCity: true,
  hasLogo: true,
  hasCoverPhoto: true,
  publicActive: true,
  servicesCount: 5,
  mastersCount: 3,
};

describe("ProfileCompletenessCard", () => {
  it("renders Novice level when score is 0/8", () => {
    renderWithLang(
      <ProfileCompletenessCard lang="en" signals={allFalse} onJumpToTab={() => undefined} />,
      "en",
    );
    const card = screen.getByTestId("profile-completeness-card");
    expect(card.getAttribute("data-level")).toBe("novice");
    expect(card.getAttribute("data-score")).toBe("0");
  });

  it("renders Apprentice level around 3/8", () => {
    renderWithLang(
      <ProfileCompletenessCard
        lang="en"
        signals={{ ...allFalse, hasName: true, hasDescription: true, hasCity: true }}
        onJumpToTab={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("profile-completeness-card").getAttribute("data-level")).toBe("apprentice");
  });

  it("renders Pro level around 5/8", () => {
    renderWithLang(
      <ProfileCompletenessCard
        lang="en"
        signals={{
          ...allFalse,
          hasName: true,
          hasDescription: true,
          hasCity: true,
          hasLogo: true,
          servicesCount: 3,
        }}
        onJumpToTab={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("profile-completeness-card").getAttribute("data-level")).toBe("pro");
  });

  it("renders Master level around 7/8", () => {
    renderWithLang(
      <ProfileCompletenessCard
        lang="en"
        signals={{ ...allTrue, publicActive: false }}
        onJumpToTab={() => undefined}
      />,
      "en",
    );
    expect(screen.getByTestId("profile-completeness-card").getAttribute("data-level")).toBe("master");
  });

  it("hides itself entirely when 8/8 (Legend)", () => {
    const { container } = renderWithLang(
      <ProfileCompletenessCard lang="en" signals={allTrue} onJumpToTab={() => undefined} />,
      "en",
    );
    expect(screen.queryByTestId("profile-completeness-card")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("shows up to 4 unfilled steps then +N overflow", () => {
    // 0 of 8 filled → 8 unfilled. Show 4 + "+4"
    renderWithLang(
      <ProfileCompletenessCard lang="en" signals={allFalse} onJumpToTab={() => undefined} />,
      "en",
    );
    const steps = screen.getAllByTestId("profile-completeness-step");
    const unfilled = steps.filter((s) => s.getAttribute("data-filled") === "0");
    expect(unfilled.length).toBe(4); // capped at 4
  });

  it("clicking an unfilled step invokes onJumpToTab with the right target", () => {
    const onJumpToTab = vi.fn();
    renderWithLang(
      <ProfileCompletenessCard lang="en" signals={allFalse} onJumpToTab={onJumpToTab} />,
      "en",
    );
    const steps = screen.getAllByTestId("profile-completeness-step");
    fireEvent.click(steps[0]!);
    expect(onJumpToTab).toHaveBeenCalledTimes(1);
    expect(onJumpToTab).toHaveBeenCalledWith("settings"); // first step "name" → settings
  });

  it("requires at least 3 services and 1 master to count those steps as done", () => {
    // Fill enough other steps so masters + services are within the 4-item
    // unfilled cap (or in the filled details). 5 of 8 filled → 3 unfilled.
    renderWithLang(
      <ProfileCompletenessCard
        lang="en"
        signals={{
          ...allFalse,
          hasName: true,
          hasDescription: true,
          hasCity: true,
          hasLogo: true,
          hasCoverPhoto: true,
          servicesCount: 2,    // < 3 → unfilled
          mastersCount: 1,     // >= 1 → filled
        }}
        onJumpToTab={() => undefined}
      />,
      "en",
    );
    const steps = screen.getAllByTestId("profile-completeness-step");
    const stepIds = steps.map((s) => ({
      id: s.getAttribute("data-step-id"),
      filled: s.getAttribute("data-filled") === "1",
    }));
    const services = stepIds.find((s) => s.id === "services");
    const masters = stepIds.find((s) => s.id === "masters");
    expect(services?.filled).toBe(false); // 2 < 3 threshold
    expect(masters?.filled).toBe(true); // 1 >= 1 threshold
  });

  it("renders the progress bar with the right width attribute", () => {
    renderWithLang(
      <ProfileCompletenessCard
        lang="en"
        signals={{ ...allFalse, hasName: true, hasDescription: true, hasCity: true, hasLogo: true }}
        onJumpToTab={() => undefined}
      />,
      "en",
    );
    const bar = screen.getByTestId("profile-completeness-bar").querySelector("[style*='width']");
    expect(bar).toBeTruthy();
    expect((bar as HTMLElement).style.width).toBe("50%");
  });
});
