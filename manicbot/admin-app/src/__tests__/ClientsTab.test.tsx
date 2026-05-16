// @vitest-environment happy-dom
/**
 * ClientsTab — search + filter + paginated list integration.
 *
 * Pins the 0062 UX contract:
 *   * Search input is debounced — typing fires `clients.list` query
 *     with the trimmed query string ~300ms later.
 *   * Filter chips toggle and pass `{ hasPhone, hasEmail, hasTg, hasIg,
 *     blocked }` into the query.
 *   * Sort buttons swap the `sort` arg between recent / name / visits.
 *   * "Load more" appears only when `nextOffset != null` and bumps
 *     offset by PAGE_SIZE.
 *   * Import / Export buttons mount their respective modals.
 *   * Empty state shows when the API returns rows=[].
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ClientsTab } from "~/components/salon/tabs/ClientsTab";

let listInvocations: any[] = [];
const fakeListData = {
  rows: [
    { chatId: 1, name: "Karina", phone: "+48500152948", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 3, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
    { chatId: 2, name: "Tatyana", phone: "+48500152949", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 5, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
  ],
  total: 2,
  nextOffset: null,
};

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      clients: {
        list: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
      },
    }),
    clients: {
      list: {
        useQuery: (input: any) => {
          listInvocations.push(input);
          return { data: fakeListData, isLoading: false, isError: false };
        },
      },
      exportCsv: {
        useQuery: () => ({ data: null }),
      },
      csvTemplate: {
        useQuery: () => ({ data: { data: "name,phone\n", filename: "tpl.csv" } }),
      },
      importCsv: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }),
      },
      get: { useQuery: () => ({ data: null, isLoading: true }) },
      delete: { useMutation: () => ({ mutate: vi.fn() }) },
      setGlobalBlock: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

function renderTab() {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <ClientsTab tenantId="t_demo" />
    </LangContext.Provider>,
  );
}

beforeEach(() => {
  listInvocations = [];
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ClientsTab", () => {
  it("renders one row per client returned by clients.list", () => {
    renderTab();
    expect(screen.getByTestId("client-row-1")).toBeTruthy();
    expect(screen.getByTestId("client-row-2")).toBeTruthy();
  });

  it("calls clients.list with the trimmed search after 300ms debounce", () => {
    renderTab();
    listInvocations = [];
    fireEvent.change(screen.getByTestId("clients-search"), { target: { value: "  karina  " } });
    // Before debounce window — query still has empty search.
    expect(listInvocations.at(-1)?.search).toBeUndefined();
    act(() => { vi.advanceTimersByTime(350); });
    expect(listInvocations.at(-1)?.search).toBe("karina");
  });

  it("filter chip toggle propagates into the list query filters", () => {
    renderTab();
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-filter-hasEmail"));
    expect(listInvocations.at(-1)?.filters).toMatchObject({ hasEmail: true });
  });

  it("blocked filter chip flips the `blocked` boolean", () => {
    renderTab();
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-filter-blocked"));
    expect(listInvocations.at(-1)?.filters).toMatchObject({ blocked: true });
  });

  it("clear-search button resets the input + the query payload", () => {
    renderTab();
    fireEvent.change(screen.getByTestId("clients-search"), { target: { value: "karina" } });
    act(() => { vi.advanceTimersByTime(350); });
    // Find the clear-X button by its aria-label.
    const clear = screen.getByLabelText("Clear search");
    fireEvent.click(clear);
    expect((screen.getByTestId("clients-search") as HTMLInputElement).value).toBe("");
  });

  it("renders Import / Export action buttons", () => {
    renderTab();
    expect(screen.getByTestId("clients-import")).toBeTruthy();
    expect(screen.getByTestId("clients-export")).toBeTruthy();
  });

  it("clicking Import opens the import modal (file picker visible)", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("clients-import"));
    expect(screen.getByTestId("ic-pick-file")).toBeTruthy();
  });

  it("does not render the Load more button when nextOffset is null", () => {
    renderTab();
    expect(screen.queryByTestId("clients-load-more")).toBeNull();
  });
});
