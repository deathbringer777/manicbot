// @vitest-environment happy-dom
/**
 * BillingTabContent — integration view.
 *
 * Pins the main bug fix from this redesign: a brand-new trial account
 * MUST be able to click "Выбрать" on the START card to convert the trial
 * to a paid subscription. Previously the button was disabled because
 * `currentPlan === "start"` was treated as "already on this plan".
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";

const plansData = [
  {
    id: "start",
    name: "Start",
    price: 45,
    currency: "PLN",
    masters: 1,
    popular: false,
    subtitle: { ru: "Для частного мастера", en: "Solo" },
    featureList: { ru: ["1 мастер", "Telegram/IG/WA"], en: ["1 specialist"] },
  },
  {
    id: "pro",
    name: "Pro",
    price: 60,
    currency: "PLN",
    masters: 5,
    popular: true,
    subtitle: { ru: "Для салона", en: "Team" },
    featureList: { ru: ["До 5 мастеров", "ИИ"], en: ["Up to 5"] },
  },
  {
    id: "max",
    name: "MAX",
    price: 90,
    currency: "PLN",
    masters: -1,
    popular: false,
    subtitle: { ru: "Для сети", en: "Chain" },
    featureList: { ru: ["Безлимит"], en: ["Unlimited"] },
  },
];

const embeddedMutate = vi.fn();
const redirectMutate = vi.fn();
const portalMutate = vi.fn();

// Force the embedded checkout path regardless of NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
// being set at module-init time. Mocks the modal as an empty marker.
vi.mock("~/components/dashboard/BillingTab/EmbeddedCheckoutModal", () => ({
  EmbeddedCheckoutModal: ({ clientSecret }: { clientSecret: string | null }) =>
    clientSecret ? <div data-testid="checkout-modal">{clientSecret}</div> : null,
  hasEmbeddedCheckout: true,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      salon: { getBillingStatus: { invalidate: vi.fn() } },
    }),
    salon: {
      getPlans: {
        useQuery: () => ({ data: plansData, isLoading: false, isError: false }),
      },
      createEmbeddedCheckout: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            embeddedMutate(vars);
            opts?.onSuccess?.({ clientSecret: "cs_test_123" });
          },
          isPending: false,
          error: null,
        }),
      },
      createCheckoutSession: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            redirectMutate(vars);
            opts?.onSuccess?.({ url: "https://checkout.stripe.com/c/pay_x" });
          },
          isPending: false,
          error: null,
        }),
      },
      createBillingPortalSession: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            portalMutate(vars);
            opts?.onSuccess?.({ url: "https://billing.stripe.com/p_test" });
          },
          isPending: false,
        }),
      },
    },
  },
}));

// Stripe.js publishable key must be present for embedded modal to be used.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_123");
  embeddedMutate.mockClear();
  redirectMutate.mockClear();
  portalMutate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

import { BillingTabContent } from "~/components/dashboard/BillingTabContent";

function renderTab(billingData: Record<string, unknown> = {}, lang: "ru" | "en" = "ru") {
  const billing = {
    data: {
      plan: "start",
      billingStatus: "trialing",
      trialEndsAt: Math.floor(Date.now() / 1000) + 10 * 86400,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      stripeCustomerId: null,
      ...billingData,
    },
    isLoading: false,
    isError: false,
  };
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      <BillingTabContent tenantId="t_demo" billing={billing} lang={lang} />
    </LangContext.Provider>,
  );
}

describe("BillingTabContent", () => {
  describe("trial state", () => {
    it("renders TrialBanner with days-left headline", () => {
      renderTab();
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.getByText(/Пробный период/)).toBeTruthy();
    });

    // ── KEY BUG-FIX REGRESSION ─────────────────────────────────────────────
    it("CTA on the current Start plan is ENABLED on trial — fixes #user-cannot-select", () => {
      renderTab();
      const startCta = screen.getByTestId("select-start") as HTMLButtonElement;
      expect(startCta.disabled).toBe(false);
    });

    it("clicking 'Выбрать' on Start fires createEmbeddedCheckout with billingCycle=monthly", () => {
      renderTab();
      fireEvent.click(screen.getByTestId("select-start"));
      expect(embeddedMutate).toHaveBeenCalledWith({
        tenantId: "t_demo",
        plan: "start",
        locale: "ru",
        billingCycle: "monthly",
      });
    });

    it("does NOT render SubscriptionManagement for trial users (no Stripe customer yet)", () => {
      renderTab();
      expect(screen.queryByTestId("subscription-management")).toBeNull();
    });
  });

  describe("active subscription state", () => {
    it("renders SubscriptionManagement when subscription is active and stripeCustomerId exists", () => {
      renderTab({
        billingStatus: "active",
        stripeCustomerId: "cus_x",
        currentPeriodEnd: 1_900_000_000,
        trialEndsAt: null,
      });
      expect(screen.getByTestId("subscription-management")).toBeTruthy();
    });

    it("does NOT render the trial banner when subscription is active", () => {
      renderTab({
        billingStatus: "active",
        stripeCustomerId: "cus_x",
        trialEndsAt: null,
      });
      // Status banner with role=status is gone (trial state)
      expect(screen.queryByText(/Пробный период/)).toBeNull();
    });

    it("CTA on current active plan + matching cycle is DISABLED", () => {
      renderTab({
        plan: "pro",
        billingStatus: "active",
        stripeCustomerId: "cus_x",
      });
      // Default cycle is monthly. Current plan = pro, cycle = monthly → disabled.
      const proCta = screen.getByTestId("select-pro") as HTMLButtonElement;
      expect(proCta.disabled).toBe(true);
    });
  });

  describe("cycle toggle", () => {
    it("flipping to annual updates the plan card prices to the discounted amount", () => {
      renderTab();
      // Default monthly: see "45" (Start)
      expect(screen.getByText("45")).toBeTruthy();
      // Switch to annual
      fireEvent.click(screen.getByRole("tab", { name: /Годовая/ }));
      // 45 × 0.8 = 36
      expect(screen.getByText("36")).toBeTruthy();
      // Annual total shows 36 × 12 = 432
      expect(screen.getAllByText(/432/)[0]).toBeTruthy();
    });

    it("subsequent embedded checkout call carries the selected cycle", () => {
      renderTab();
      fireEvent.click(screen.getByRole("tab", { name: /Годовая/ }));
      fireEvent.click(screen.getByTestId("select-pro"));
      expect(embeddedMutate).toHaveBeenCalledWith(
        expect.objectContaining({ billingCycle: "annual", plan: "pro" }),
      );
    });
  });

  describe("payment success banner", () => {
    it("shows success banner when URL has ?checkout=success", () => {
      window.history.replaceState({}, "", "/?tab=billing&checkout=success");
      renderTab();
      expect(screen.getByText(/Подписка активирована/)).toBeTruthy();
    });

    it("scrubs the checkout=success param from the URL", () => {
      window.history.replaceState({}, "", "/?tab=billing&checkout=success");
      renderTab();
      expect(window.location.search).not.toContain("checkout=success");
    });
  });

  describe("error handling", () => {
    it("renders the loading skeleton when billing.isLoading is true", () => {
      render(
        <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
          <BillingTabContent
            tenantId="t_demo"
            billing={{ data: undefined, isLoading: true, isError: false }}
            lang="ru"
          />
        </LangContext.Provider>,
      );
      // A spinner should be visible
      expect(document.querySelector(".animate-spin")).toBeTruthy();
    });
  });
});
