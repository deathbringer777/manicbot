// @vitest-environment happy-dom
/**
 * ClientsTab — search + filter + selection + bulk-actions integration.
 *
 * Pins the 0062 + 0109 UX contract:
 *   * Search input is debounced — typing fires `clients.list` ~300ms later.
 *   * Filters live behind a "Filters ▾" dropdown; toggling an option passes
 *     `{ hasPhone, hasEmail, … }` into the query and shows a count badge.
 *   * Sort buttons swap the `sort` arg.
 *   * Per-row checkboxes + a master "select all" header (with indeterminate).
 *   * When more rows match than are loaded, a banner offers "select all N
 *     matching" — fetched via `clients.listMatchingIds`.
 *   * Bulk bar: add-to-list, remove-from-list (list active only), and a "More"
 *     menu with delete (danger confirm) / unblock.
 *   * Import / Export buttons mount their respective modals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { ClientsTab } from "~/components/salon/tabs/ClientsTab";

let listInvocations: any[] = [];
let addToListInvocations: any[] = [];
let removeFromListInvocations: any[] = [];
let bulkDeleteInvocations: any[] = [];
let bulkBlockInvocations: any[] = [];
let matchingFetchInvocations: any[] = [];
let pushInvocations: string[] = [];

const DEFAULT_ROWS = [
  { chatId: 1, name: "Karina", phone: "+48500152948", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 3, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
  { chatId: 2, name: "Tatyana", phone: "+48500152949", email: null, tgUsername: null, igUsername: null, tags: null, lifetimeVisits: 5, lastVisitAt: 1700000000, isBlockedGlobal: 0 },
];
let listData: any;
let matchingIds: number[];

const fakeLists = [
  { id: "seg_vip", name: "VIP", kind: "manual", contactCount: 3 },
  { id: "seg_filter", name: "Active 30d", kind: "filter", contactCount: 0 },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => pushInvocations.push(url) }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      clients: {
        list: { invalidate: vi.fn() },
        get: { invalidate: vi.fn() },
        listMatchingIds: {
          fetch: vi.fn(async (input: any) => {
            matchingFetchInvocations.push(input);
            return { chatIds: matchingIds, capped: false };
          }),
        },
        exportCsv: {
          fetch: vi.fn(async () => ({ data: "csv", mime: "text/csv", filename: "c.csv" })),
        },
      },
      marketingTenant: { segmentsList: { invalidate: vi.fn() } },
    }),
    clients: {
      list: {
        useQuery: (input: any) => {
          listInvocations.push(input);
          return { data: listData, isLoading: false, isError: false };
        },
      },
      addToList: {
        useMutation: () => ({
          mutateAsync: async (input: any) => { addToListInvocations.push(input); return { added: input.chatIds.length, skipped: 0, synced: 0 }; },
          isPending: false,
        }),
      },
      removeFromList: {
        useMutation: () => ({
          mutateAsync: async (input: any) => { removeFromListInvocations.push(input); return { ok: true }; },
          isPending: false,
        }),
      },
      bulkDelete: {
        useMutation: () => ({
          mutateAsync: async (input: any) => { bulkDeleteInvocations.push(input); return { ok: true, deleted: input.chatIds.length }; },
          isPending: false,
        }),
      },
      bulkSetGlobalBlock: {
        useMutation: () => ({
          mutateAsync: async (input: any) => { bulkBlockInvocations.push(input); return { ok: true, updated: input.chatIds.length }; },
          isPending: false,
        }),
      },
      csvTemplate: { useQuery: () => ({ data: { data: "name,phone\n", filename: "tpl.csv" } }) },
      importCsv: { useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }) },
      get: { useQuery: () => ({ data: null, isLoading: true }) },
      delete: { useMutation: () => ({ mutate: vi.fn() }) },
      setGlobalBlock: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    marketingTenant: {
      segmentsList: { useQuery: () => ({ data: fakeLists, isLoading: false }) },
      segmentCreate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
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
  bulkDeleteInvocations = [];
  bulkBlockInvocations = [];
  matchingFetchInvocations = [];
  pushInvocations = [];
  listData = { rows: DEFAULT_ROWS, total: 2, nextOffset: null };
  matchingIds = [1, 2];
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
    expect(listInvocations.at(-1)?.search).toBeUndefined();
    act(() => { vi.advanceTimersByTime(350); });
    expect(listInvocations.at(-1)?.search).toBe("karina");
  });

  it("Filters dropdown: toggling an option propagates into the query + shows a count badge", () => {
    renderTab();
    listInvocations = [];
    // Options live inside the dropdown — open it first.
    fireEvent.click(screen.getByTestId("clients-filter-trigger"));
    fireEvent.click(screen.getByTestId("clients-filter-hasEmail"));
    expect(listInvocations.at(-1)?.filters).toMatchObject({ hasEmail: true });
    // The trigger shows the active-count badge.
    expect(screen.getByTestId("clients-filter-trigger").textContent).toContain("1");
  });

  it("blocked filter option flips the `blocked` boolean", () => {
    renderTab();
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-filter-trigger"));
    fireEvent.click(screen.getByTestId("clients-filter-blocked"));
    expect(listInvocations.at(-1)?.filters).toMatchObject({ blocked: true });
  });

  it("Filters reset clears every active filter", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("clients-filter-trigger"));
    fireEvent.click(screen.getByTestId("clients-filter-hasEmail"));
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-filter-reset"));
    expect(listInvocations.at(-1)?.filters).toBeUndefined();
  });

  it("clear-search button resets the input", () => {
    renderTab();
    fireEvent.change(screen.getByTestId("clients-search"), { target: { value: "karina" } });
    act(() => { vi.advanceTimersByTime(350); });
    fireEvent.click(screen.getByLabelText("Clear search"));
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
    expect(screen.queryByTestId("clients-list-chip-seg_filter")).toBeNull();
    expect(screen.getByTestId("clients-list-new")).toBeTruthy();
  });

  it("selecting a list chip passes listId into the clients.list query", () => {
    renderTab();
    listInvocations = [];
    fireEvent.click(screen.getByTestId("clients-list-chip-seg_vip"));
    expect(listInvocations.at(-1)?.listId).toBe("seg_vip");
  });

  // ── Selection ────────────────────────────────────────────────────────────
  it("master checkbox selects every loaded row", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("clients-select-all"));
    expect(screen.getByTestId("clients-bulk-bar").textContent).toContain("2");
    expect(screen.getByTestId("clients-select-all").getAttribute("aria-checked")).toBe("true");
  });

  it("master checkbox is indeterminate when only some rows are selected", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("client-select-1"));
    expect(screen.getByTestId("clients-select-all").getAttribute("aria-checked")).toBe("mixed");
  });

  it("offers 'select all matching' when more rows match than are loaded", async () => {
    listData = { rows: DEFAULT_ROWS, total: 25, nextOffset: 2 };
    matchingIds = [1, 2, 3, 4, 5];
    renderTab();
    // Tick the whole loaded page → banner appears.
    fireEvent.click(screen.getByTestId("clients-select-all"));
    expect(screen.getByTestId("clients-select-all-banner")).toBeTruthy();
    expect(screen.getByTestId("clients-select-all-matching")).toBeTruthy();
    // Click it → fetch the full match set + flip into "all matching" mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId("clients-select-all-matching"));
    });
    expect(matchingFetchInvocations.length).toBe(1);
    expect(matchingFetchInvocations[0]).toMatchObject({ tenantId: "t_demo" });
    expect(screen.getByTestId("clients-clear-all-matching")).toBeTruthy();
  });

  // ── Bulk actions ─────────────────────────────────────────────────────────
  it("ticking clients reveals the bulk bar and 'add to list' targets the chosen list", () => {
    renderTab();
    expect(screen.queryByTestId("clients-bulk-bar")).toBeNull();
    fireEvent.click(screen.getByTestId("client-select-1"));
    expect(screen.getByTestId("clients-bulk-bar")).toBeTruthy();
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
    fireEvent.click(screen.getByTestId("client-select-1"));
    expect(screen.queryByTestId("clients-bulk-remove")).toBeNull();
    fireEvent.click(screen.getByTestId("clients-list-chip-seg_vip"));
    fireEvent.click(screen.getByTestId("client-select-2"));
    fireEvent.click(screen.getByTestId("clients-bulk-remove"));
    expect(removeFromListInvocations.at(-1)).toMatchObject({ chatIds: [2], listId: "seg_vip" });
  });

  it("delete via the More menu opens a confirm, then calls bulkDelete with the selection", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("client-select-1"));
    fireEvent.click(screen.getByTestId("clients-bulk-more"));
    fireEvent.click(screen.getByTestId("clients-more-delete"));
    // The More menu closed; the only "Удалить выбранных" left is the confirm button.
    fireEvent.click(screen.getByText("Удалить выбранных"));
    expect(bulkDeleteInvocations.at(-1)).toMatchObject({ tenantId: "t_demo", chatIds: [1] });
  });

  it("unblock via the More menu calls bulkSetGlobalBlock(false) immediately", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("client-select-1"));
    fireEvent.click(screen.getByTestId("clients-bulk-more"));
    fireEvent.click(screen.getByTestId("clients-more-unblock"));
    expect(bulkBlockInvocations.at(-1)).toMatchObject({ chatIds: [1], blocked: false });
  });
});
