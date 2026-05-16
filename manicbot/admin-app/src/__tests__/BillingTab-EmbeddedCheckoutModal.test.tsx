// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";

// Mock Stripe SDK so we don't try to hit the network.
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () => Promise.resolve({ /* fake stripe instance */ }),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({ children }: any) => <div data-testid="checkout-provider">{children}</div>,
  EmbeddedCheckout: () => <div data-testid="embedded-checkout">Stripe form</div>,
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_xxx");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importModal() {
  const mod = await import("~/components/dashboard/BillingTab/EmbeddedCheckoutModal");
  return mod.EmbeddedCheckoutModal;
}

describe("EmbeddedCheckoutModal", () => {
  it("renders nothing when clientSecret is null", async () => {
    const Modal = await importModal();
    const { container } = render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret={null} onClose={() => {}} lang="ru" />
      </LangContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the modal with embedded checkout form when clientSecret is set", async () => {
    const Modal = await importModal();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret="cs_test_xxx" onClose={() => {}} lang="ru" />
      </LangContext.Provider>,
    );
    expect(screen.getByTestId("checkout-modal")).toBeTruthy();
    expect(screen.getByTestId("embedded-checkout")).toBeTruthy();
    expect(screen.getByText("Оплата подписки")).toBeTruthy();
  });

  it("calls onClose when ESC is pressed", async () => {
    const Modal = await importModal();
    const onClose = vi.fn();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret="cs_test_xxx" onClose={onClose} lang="ru" />
      </LangContext.Provider>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the X button", async () => {
    const Modal = await importModal();
    const onClose = vi.fn();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret="cs_test_xxx" onClose={onClose} lang="ru" />
      </LangContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("checkout-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the backdrop", async () => {
    const Modal = await importModal();
    const onClose = vi.fn();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret="cs_test_xxx" onClose={onClose} lang="ru" />
      </LangContext.Provider>,
    );
    const backdrop = screen.getByTestId("checkout-modal");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when clicking inside the dialog content", async () => {
    const Modal = await importModal();
    const onClose = vi.fn();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <Modal clientSecret="cs_test_xxx" onClose={onClose} lang="ru" />
      </LangContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("checkout-provider"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
