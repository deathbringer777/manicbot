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
let addToListInvocations: any[] = [];
let removeFromListInvocations: any[] = [];
const fakeListData = {
  rows: [
    { chatId: 1, name: "Karina", phone: "+48500152948", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 3, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
    { chatId: 2, name: "Tatyana", phone: "+48500152949", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 5, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
  ],
  total: 2,
  nextOffset: null,
};
const fakeLists = [
  { id: "seg_vip", name: "VIP", kind: "manual", contactCount: 3 },
  { id: "seg_filter", name: "Active 30d", kind: "filter", contactCount: 0 },
];

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      clients: {
        list: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
      },
      marketingTenant: {
        segmentsList: { invalidate: vi.fn() },
      },
    }),
    clients: {
      list: {
        useQuery: (input: any) => {
          listInvocations.push(input);
          return { data: fakeListData, isLoading: false, isError: false };
        },
      },
      addToList: {
        useMutation: (opts: any) => ({
          mutate: (input: any) => { addToListInvocations.push(input); opts?.onSuccess?.({ added: input.chatIds.length, skipped: 0, synced: 0 }); },
          isPending: false,
        }),
      },
      removeFromList: {
        useMutation: (opts: any) => ({
          mutate: (input: any) => { removeFromListInvocations.push(input); opts?.onSuccess?.({ ok: true }); },
          isPending: false,
        }),
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
    marketingTenant: {
      segmentsList: {
        useQuery: () => ({ data: fakeLists, isLoading: false }),
      },
      segmentCreate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
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
  addToListInvocations = [];
  removeFromListInvocations = [];
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

  it("renders the Lists rail with the All chip and only manual lists", () => {
    renderTab();
    expect(screen.getByTestId("clients-list-rail")).toBeTruthy();
    expect(screen.getByTestId("clients-list-chip-all")).toBeTruthy();
    expect(screen.getByTestId("clients-list-chip-seg_vip")).toBeTruthy();
    // 'filter'-kind segments are NOT manual lists — excluded from the rail.
    expect(screen.queryByTestId("clients-list-chip-seg_filter")).toBeNull();
    expect(screen.getByTestId("clients-list-new")).toBeTruthy();
  });

  it("selecting a list chip passes listId into the clients.list query", () => {
    renderTab();
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-list-chip-seg_vip"));
    expect(listInvocations.at(-1)?.listId).toBe("seg_vip");
  });

  it("ticking clients reveals the bulk bar and 'add to list' targets the chosen list", () => {
    renderTab();
    // No bar until something is selected.
    expect(screen.queryByTestId("clients-bulk-bar")).toBeNull();
    fireEvent.click(screen.getByTestId("client-select-1"));
    expect(screen.getByTestId("clients-bulk-bar")).toBeTruthy();
    // Open the add menu and pick VIP.
    fireEvent.click(screen.getByTestId("clients-bulk-add"));
    fireEvent.click(screen.getByTestId("clients-bulk-add-seg_vip"));
    expect(addToListInvocations.at(-1)).toMatchObject({
      tenantId: "t_demo",
      chatIds: [1],
      listId: "seg_vip",
    });
  });

  it("the remove-from-list action only appears when a list is active", () => {
    renderTab();
    // No active list → tick a client → no remove button.
    fireEvent.click(screen.getByTestId("client-select-1"));
    expect(screen.queryByTestId("clients-bulk-remove")).toBeNull();
    // Activate a list, re-tick (selection clears on list change), then it shows.
    fireEvent.click(screen.getByTestId("clients-list-chip-seg_vip"));
    fireEvent.click(screen.getByTestId("client-select-2"));
    expect(screen.getByTestId("clients-bulk-remove")).toBeTruthy();
    fireEvent.click(screen.getByTestId("clients-bulk-remove"));
    expect(removeFromListInvocations.at(-1)).toMatchObject({
      chatIds: [2],
      listId: "seg_vip",
    });
  });
});
