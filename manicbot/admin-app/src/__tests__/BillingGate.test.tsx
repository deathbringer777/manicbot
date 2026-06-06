// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

import { BillingGate } from "~/components/BillingGate";

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("BillingGate", () => {
  it("renders the billing-locked block with primary + secondary CTAs", () => {
    renderWithLang(<BillingGate />, "ru");
    expect(screen.getByTestId("billing-gate")).toBeTruthy();
    expect(screen.getByText("Доступ к панели ограничен")).toBeTruthy();
    expect(screen.getByText("Активировать подписку")).toBeTruthy();
    expect(screen.getByText("Настройки аккаунта")).toBeTruthy();
  });

  it("primary CTA navigates to Settings → Биллинг (canonical billing surface for tenant_owner)", () => {
    renderWithLang(<BillingGate />, "ru");
    fireEvent.click(screen.getByText("Активировать подписку"));
    expect(pushMock).toHaveBeenCalledWith("/settings?section=billing");
  });

  it("secondary CTA navigates to /settings?section=account (escape hatch)", () => {
    renderWithLang(<BillingGate />, "ru");
    fireEvent.click(screen.getByText("Настройки аккаунта"));
    expect(pushMock).toHaveBeenCalledWith("/settings?section=account");
  });

  it("renders in English when lang=en", () => {
    renderWithLang(<BillingGate />, "en");
    expect(screen.getByText("Dashboard access is limited")).toBeTruthy();
    expect(screen.getByText("Activate subscription")).toBeTruthy();
  });

  it("renders in Ukrainian when lang=ua", () => {
    renderWithLang(<BillingGate />, "ua");
    expect(screen.getByText("Доступ до панелі обмежено")).toBeTruthy();
  });

  it("renders in Polish when lang=pl", () => {
    renderWithLang(<BillingGate />, "pl");
    expect(screen.getByText("Dostęp do panelu jest ograniczony")).toBeTruthy();
  });
});
