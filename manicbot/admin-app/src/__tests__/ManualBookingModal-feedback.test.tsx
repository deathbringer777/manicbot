// @vitest-environment happy-dom
/**
 * ManualBookingModal — validation feedback contract.
 *
 * The "Создать запись" button used to silently grey out without telling the
 * user which field was incomplete. After the 2026-05-16 fix the modal now:
 *   - shows an explicit hint under the master / service dropdowns when the
 *     tenant has none configured yet (so the user knows to set them up first)
 *   - shows a per-issue list under the form once the user has started typing,
 *     so the disabled state is no longer a black box.
 *
 * These tests pin both behaviors so we don't regress back to silent failure.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ManualBookingModal } from "~/components/dashboard/ManualBookingModal";

// ── tRPC mocks ────────────────────────────────────────────────────────────
//
// Each test controls what `getMasters`/`getServices` return by mutating the
// mutable refs below before render. `createManual` is a noop — these tests
// only exercise client-side validation feedback.

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

describe("ManualBookingModal — per-issue feedback for disabled submit", () => {
  it("stays silent before the user types anything (no issue spam on open)", () => {
    mastersRef.data = [{ chatId: 1, name: "Анна" }];
    servicesRef.data = [{ svcId: "s1", names: JSON.stringify({ ru: "Маникюр" }), duration: 60, price: 100 }];
    renderModal();
    expect(screen.queryByTestId("manual-booking-issues")).toBeNull();
  });

  it("reveals the per-issue list once the user starts filling the form", () => {
    mastersRef.data = [{ chatId: 1, name: "Анна" }];
    servicesRef.data = [{ svcId: "s1", names: JSON.stringify({ ru: "Маникюр" }), duration: 60, price: 100 }];
    renderModal();

    // Type a 3-char name — clientName is no longer empty, so feedback should
    // appear and call out everything else that is still missing.
    const nameInput = screen.getByPlaceholderText("Имя клиента") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "a" } });

    const issues = screen.getByTestId("manual-booking-issues");
    expect(issues).toBeTruthy();
    const text = issues.textContent ?? "";
    // Must list the still-missing fields (master/service/date/time/phone).
    expect(text).toContain("выберите мастера");
    expect(text).toContain("выберите услугу");
    expect(text).toContain("укажите дату");
    expect(text).toContain("укажите время");
    expect(text).toContain("телефон от 6 символов");
  });

  it("does NOT pin master/service issues when the lists themselves are empty (the per-dropdown hint covers that)", () => {
    // Empty masters AND services — issues list should not double up on those
    // four lines (we already show a dedicated empty-state hint per dropdown).
    mastersRef.data = [];
    servicesRef.data = [];
    renderModal();

    const nameInput = screen.getByPlaceholderText("Имя клиента") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "a" } });

    const issues = screen.getByTestId("manual-booking-issues");
    expect(issues.textContent ?? "").not.toContain("выберите мастера");
    expect(issues.textContent ?? "").not.toContain("выберите услугу");
  });
});
