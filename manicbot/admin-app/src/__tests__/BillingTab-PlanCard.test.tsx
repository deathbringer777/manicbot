// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";
import { PlanCard, type PlanCardData } from "~/components/dashboard/BillingTab/PlanCard";

const PRO: PlanCardData = {
  id: "pro",
  name: "Pro",
  monthlyPrice: 60,
  annualMonthlyPrice: 48,
  currency: "PLN",
  popular: true,
  subtitle: "Для салона с командой",
  features: ["До 5 мастеров", "Все каналы", "ИИ-помощник"],
};

const START: PlanCardData = {
  id: "start",
  name: "Start",
  monthlyPrice: 45,
  annualMonthlyPrice: 36,
  currency: "PLN",
  popular: false,
  subtitle: "Для частного мастера",
  features: ["1 мастер", "Telegram/IG/WA"],
};

afterEach(cleanup);

describe("PlanCard", () => {
  it("shows monthly price + currency + /мес suffix on monthly cycle", () => {
    renderWithLang(
      <PlanCard
        plan={PRO}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.getByText("60")).toBeTruthy();
    expect(screen.getByText("PLN")).toBeTruthy();
    expect(screen.getByText("/мес")).toBeTruthy();
  });

  it("renders annual-monthly price + annual total sub-line when cycle=annual", () => {
    renderWithLang(
      <PlanCard
        plan={PRO}
        cycle="annual"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.getByText("48")).toBeTruthy();
    const total = screen.getByTestId("annual-total");
    // 48 × 12 = 576 PLN в год
    expect(total.textContent).toContain("576");
    expect(total.textContent).toContain("в год");
  });

  it("popular plan shows the 'Популярный' badge with data-popular attr", () => {
    renderWithLang(
      <PlanCard
        plan={PRO}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.getByTestId("popular-badge")).toBeTruthy();
    expect(screen.getByText("Популярный")).toBeTruthy();
  });

  it("non-popular plan has no popular badge", () => {
    renderWithLang(
      <PlanCard
        plan={START}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.queryByTestId("popular-badge")).toBeNull();
  });

  it("shows 'текущий' pill when currentPlan matches", () => {
    renderWithLang(
      <PlanCard
        plan={START}
        cycle="monthly"
        currentPlan="start"
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.getByTestId("current-pill")).toBeTruthy();
  });

  // ─── KEY BUG-FIX REGRESSION TEST ─────────────────────────────────────────────
  it("CTA is ENABLED for current plan while on trial (so user can convert to paid)", () => {
    const onSelect = vi.fn();
    renderWithLang(
      <PlanCard
        plan={START}
        cycle="monthly"
        currentPlan="start"
        isCurrentActive={false} // trial — not yet active
        upgrading={false}
        onSelect={onSelect}
        lang="ru"
      />,
      "ru",
    );
    const cta = screen.getByTestId("select-start") as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    expect(onSelect).toHaveBeenCalledWith("start");
  });

  it("CTA is DISABLED only when subscription is already active on this exact plan+cycle", () => {
    renderWithLang(
      <PlanCard
        plan={START}
        cycle="monthly"
        currentPlan="start"
        isCurrentActive={true}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    const cta = screen.getByTestId("select-start") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("CTA is disabled while upgrading", () => {
    renderWithLang(
      <PlanCard
        plan={START}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={true}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    const cta = screen.getByTestId("select-start") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("renders all features with check icons", () => {
    renderWithLang(
      <PlanCard
        plan={PRO}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    PRO.features.forEach((f) => {
      expect(screen.getByText(f)).toBeTruthy();
    });
  });

  it("Pro card CTA uses brand violet→cyan gradient", () => {
    renderWithLang(
      <PlanCard
        plan={PRO}
        cycle="monthly"
        currentPlan={null}
        isCurrentActive={false}
        upgrading={false}
        onSelect={() => {}}
        lang="ru"
      />,
      "ru",
    );
    const cta = screen.getByTestId("select-pro");
    const style = cta.getAttribute("style") ?? "";
    expect(style).toContain("linear-gradient");
    expect(style).toMatch(/#7c3aed/i);
  });
});
