// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";
import { TrialBanner } from "~/components/dashboard/BillingTab/TrialBanner";

const ONE_DAY = 86400;

afterEach(cleanup);

describe("TrialBanner", () => {
  it("renders nothing when trialEndsAt is null", () => {
    const { container } = renderWithLang(<TrialBanner trialEndsAt={null} lang="ru" />, "ru");
    expect(container.firstChild).toBeNull();
  });

  it("shows days-left headline in default (non-urgent) state", () => {
    const now = 1_700_000_000;
    renderWithLang(
      <TrialBanner trialEndsAt={now + 10 * ONE_DAY} nowUnix={now} lang="ru" />,
      "ru",
    );
    expect(screen.getByText(/10 дней/)).toBeTruthy();
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-trial-state")).toBe("ok");
  });

  it("uses urgent (amber) styling when ≤ 3 days remain", () => {
    const now = 1_700_000_000;
    renderWithLang(
      <TrialBanner trialEndsAt={now + 2 * ONE_DAY} nowUnix={now} lang="ru" />,
      "ru",
    );
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-trial-state")).toBe("urgent");
    // Urgent copy is visible
    expect(screen.getByText(/Триал заканчивается/)).toBeTruthy();
  });

  it("collapses to 'ends today' when hours < 24", () => {
    const now = 1_700_000_000;
    renderWithLang(
      <TrialBanner trialEndsAt={now + 3 * 3600} nowUnix={now} lang="ru" />,
      "ru",
    );
    expect(screen.getByText(/заканчивается сегодня/)).toBeTruthy();
  });

  it("renders expired state when trialEndsAt is in the past", () => {
    const now = 1_700_000_000;
    renderWithLang(
      <TrialBanner trialEndsAt={now - 86400} nowUnix={now} lang="ru" />,
      "ru",
    );
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-trial-state")).toBe("expired");
    expect(screen.getByText(/Пробный период истёк/)).toBeTruthy();
  });

  it("pluralizes correctly across Slavic and English", () => {
    const now = 1_700_000_000;
    // RU: 2 → "2 дня" (few), 5 → "5 дней" (many)
    // ceil(1.5) = 2, ceil(4.5) = 5 — use half-day offsets so we land on clean day counts.
    renderWithLang(
      <TrialBanner trialEndsAt={now + Math.floor(1.5 * ONE_DAY)} nowUnix={now} lang="ru" />,
      "ru",
    );
    expect(screen.getByText(/2 дня/)).toBeTruthy();
    cleanup();

    renderWithLang(
      <TrialBanner trialEndsAt={now + Math.floor(4.5 * ONE_DAY)} nowUnix={now} lang="ru" />,
      "ru",
    );
    expect(screen.getByText(/5 дней/)).toBeTruthy();
    cleanup();

    renderWithLang(<TrialBanner trialEndsAt={now + 10 * ONE_DAY} nowUnix={now} lang="en" />, "en");
    expect(screen.getByText(/10 days left/)).toBeTruthy();
  });

  it("renders a progress bar with sensible bounds", () => {
    const now = 1_700_000_000;
    renderWithLang(
      <TrialBanner trialEndsAt={now + 7 * ONE_DAY} nowUnix={now} lang="ru" />,
      "ru",
    );
    const bar = screen.getByRole("progressbar");
    const value = Number(bar.getAttribute("aria-valuenow"));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
    // ~7 of 14 days elapsed → roughly 50%
    expect(value).toBeGreaterThan(40);
    expect(value).toBeLessThan(60);
  });
});
