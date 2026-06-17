// @vitest-environment happy-dom
/**
 * ManualBookingModal — validation feedback contract.
 *
 * The bottom-of-form per-issue list ("Чтобы создать запись:" with bullet
 * points) was removed 2026-05-16 per user feedback — the disabled submit
 * button is signal enough, and the explicit list cluttered the dialog
 * after every other piece of validation context was already inline
 * (placeholders, dropdown empty states, slot-conflict error banner).
 *
 * What we still pin:
 *   - The two inline per-dropdown empty-state hints
 *     (`manual-booking-need-masters` / `manual-booking-need-services`)
 *     which appear under each select when the tenant has nothing to
 *     pick yet. Those are useful even with a clean form — the user
 *     can't progress without filling them in elsewhere.
 *
 * What we explicitly do NOT pin any more:
 *   - `manual-booking-issues` — gone. A regression that re-adds the
 *     amber bullet list at the bottom of the form should NOT make
 *     this file go green.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ManualBookingModal } from "~/components/dashboard/ManualBookingModal";

const mastersRef: { data: Array<{ chatId: number; name: string }>; isLoading: boolean } = {
  data: [],
  isLoading: false,
};
const servicesRef: {
  data: Array<{ svcId: string; names: string; duration: number; price: number }>;
  isLoading: boolean;
} = { data: [], isLoading: false };
const clientsRef: { data: Array<{ chatId: number; name: string; phone: string }> } = { data: [] };

vi.mock("~/trpc/react", () => ({
  api: {
    salon: {
      getMasters: { useQuery: () => ({ data: mastersRef.data, isLoading: mastersRef.isLoading }) },
      getServices: { useQuery: () => ({ data: servicesRef.data, isLoading: servicesRef.isLoading }) },
      getClients: { useQuery: () => ({ data: clientsRef.data }) },
      // 0074 — favorite-master suggest toggle (defaults ON both channels).
      getAutoSuggestFavoriteSettings: {
        useQuery: () => ({ data: { web: true, telegram: true }, isLoading: false }),
      },
      getNoShowPolicy: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    clients: {
      // 0074 — manual + derived favorite-master lookup for the picked client.
      getFavoriteMasterSuggestion: {
        useQuery: () => ({ data: { manual: null, derived: null }, isLoading: false }),
      },
    },
    appointments: {
      createManual: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function renderModal() {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <ManualBookingModal tenantId="t_x" onClose={() => {}} />
    </LangContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  mastersRef.data = [];
  mastersRef.isLoading = false;
  servicesRef.data = [];
  servicesRef.isLoading = false;
  clientsRef.data = [];
});

describe("ManualBookingModal — empty masters/services hints", () => {
  it("renders the 'add a master first' hint when masters list is empty", () => {
    mastersRef.data = [];
    servicesRef.data = [{ svcId: "s1", names: JSON.stringify({ ru: "Маникюр" }), duration: 60, price: 100 }];
    renderModal();
    expect(screen.getByTestId("manual-booking-need-masters")).toBeTruthy();
    expect(screen.queryByTestId("manual-booking-need-services")).toBeNull();
  });

  it("renders the 'add a service first' hint when services list is empty", () => {
    mastersRef.data = [{ chatId: 1, name: "Анна" }];
    servicesRef.data = [];
    renderModal();
    expect(screen.getByTestId("manual-booking-need-services")).toBeTruthy();
    expect(screen.queryByTestId("manual-booking-need-masters")).toBeNull();
  });

  it("renders both hints when the tenant has no masters AND no services", () => {
    mastersRef.data = [];
    servicesRef.data = [];
    renderModal();
    expect(screen.getByTestId("manual-booking-need-masters")).toBeTruthy();
    expect(screen.getByTestId("manual-booking-need-services")).toBeTruthy();
  });
});

describe("ManualBookingModal — bottom 'fix to continue' hint is gone", () => {
  it("does NOT render the amber bullet list, even after the user starts typing", () => {
    mastersRef.data = [{ chatId: 1, name: "Анна" }];
    servicesRef.data = [{ svcId: "s1", names: JSON.stringify({ ru: "Маникюр" }), duration: 60, price: 100 }];
    renderModal();
    const nameInput = screen.getByPlaceholderText("Имя клиента") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "a" } });
    expect(screen.queryByTestId("manual-booking-issues")).toBeNull();
  });
});
