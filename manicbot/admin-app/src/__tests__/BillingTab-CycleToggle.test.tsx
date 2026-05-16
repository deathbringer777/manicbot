// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";
import { CycleToggle } from "~/components/dashboard/BillingTab/CycleToggle";

afterEach(cleanup);

describe("CycleToggle", () => {
  it("renders both options with correct aria-selected", () => {
    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="ru" />, "ru");
    const monthly = screen.getByRole("tab", { name: "Ежемесячно" });
    const annual = screen.getByRole("tab", { name: /Годовая/ });
    expect(monthly.getAttribute("aria-selected")).toBe("true");
    expect(annual.getAttribute("aria-selected")).toBe("false");
  });

  it("annual badge '2 FREE 🎁' is visible regardless of selection", () => {
    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="ru" />, "ru");
    expect(screen.getByTestId("annual-badge").textContent).toContain("FREE");
  });

  it("subtitle is hidden when monthly is selected", () => {
    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="ru" />, "ru");
    expect(screen.queryByTestId("annual-subtitle")).toBeNull();
  });

  it("subtitle '2 месяца бесплатно' appears when annual is selected", () => {
    renderWithLang(<CycleToggle value="annual" onChange={() => {}} lang="ru" />, "ru");
    const subtitle = screen.getByTestId("annual-subtitle");
    expect(subtitle.textContent).toContain("2 месяца бесплатно");
  });

  it("calls onChange with the clicked cycle", () => {
    const onChange = vi.fn();
    renderWithLang(<CycleToggle value="monthly" onChange={onChange} lang="ru" />, "ru");
    fireEvent.click(screen.getByRole("tab", { name: /Годовая/ }));
    expect(onChange).toHaveBeenCalledWith("annual");
    fireEvent.click(screen.getByRole("tab", { name: "Ежемесячно" }));
    expect(onChange).toHaveBeenCalledWith("monthly");
  });

  it("the active button has gradient background applied via inline style", () => {
    renderWithLang(<CycleToggle value="annual" onChange={() => {}} lang="ru" />, "ru");
    const annual = screen.getByRole("tab", { name: /Годовая/ });
    const style = annual.getAttribute("style") ?? "";
    expect(style).toContain("linear-gradient");
    // Brand purple
    expect(style).toMatch(/#7c3aed/i);
  });

  it("localizes labels for all 4 languages", () => {
    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="en" />, "en");
    expect(screen.getByRole("tab", { name: "Monthly" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Yearly/ })).toBeTruthy();
    cleanup();

    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="pl" />, "pl");
    expect(screen.getByRole("tab", { name: "Miesięcznie" })).toBeTruthy();
    cleanup();

    renderWithLang(<CycleToggle value="monthly" onChange={() => {}} lang="ua" />, "ua");
    expect(screen.getByRole("tab", { name: "Щомісяця" })).toBeTruthy();
  });
});
