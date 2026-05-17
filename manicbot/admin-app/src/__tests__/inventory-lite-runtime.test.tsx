// @vitest-environment happy-dom
/**
 * Tests for InventoryLiteRuntime — Phase 3 Variant A plugin #3.
 *
 * The plugin stores `items[]` in plugin_installations.settings_json (no D1
 * migration). Tests cover hydration, add/edit/delete in-memory state, save
 * mutation, low-stock highlighting, search, and the 80-item cap.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

let mockInstall = {
  id: "inst_inv_1",
  pluginSlug: "inventory-lite" as string,
  enabled: 1,
  tenantId: "t_pro" as string | null,
  settingsJson: null as string | null,
  version: "1.0.0",
  installedBy: "w_owner",
  installedAt: 1000,
  updatedAt: 1000,
  billingState: "not_applicable" as const,
  stripeSubscriptionItemId: null,
  stripePaymentIntentId: null,
};

const updateCalls: Array<{ installationId: string; settings: Record<string, unknown> }> = [];

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: "t_pro", role: "tenant_owner" }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: { getInstalled: { invalidate: () => Promise.resolve() } },
    }),
    plugins: {
      getInstalled: {
        useQuery: () => ({ data: [mockInstall], isLoading: false }),
      },
      updateSettings: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void } = {}) => ({
          mutate: (
            input: { installationId: string; settings: Record<string, unknown> },
            opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void },
          ) => {
            updateCalls.push(input);
            mockInstall = { ...mockInstall, settingsJson: JSON.stringify(input.settings) };
            opts?.onSuccess?.();
            onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import InventoryLiteRuntime from "~/components/plugins/runtimes/InventoryLiteRuntime";

beforeEach(() => {
  updateCalls.length = 0;
  mockInstall = {
    id: "inst_inv_1",
    pluginSlug: "inventory-lite",
    enabled: 1,
    tenantId: "t_pro",
    settingsJson: null,
    version: "1.0.0",
    installedBy: "w_owner",
    installedAt: 1000,
    updatedAt: 1000,
    billingState: "not_applicable",
    stripeSubscriptionItemId: null,
    stripePaymentIntentId: null,
  };
});

afterEach(() => cleanup());

function render() {
  return renderWithLang(<InventoryLiteRuntime installationId="inst_inv_1" slug="inventory-lite" />);
}

describe("InventoryLiteRuntime — hydration & empty state", () => {
  it("shows empty-state hint when settings_json is null", () => {
    render();
    expect(screen.getByTestId("inventory-empty").textContent).toContain("Пока пусто");
    expect(screen.getByTestId("inventory-total").textContent).toBe("0/80");
  });

  it("hydrates from persisted settings_json", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [
        { id: "i1", name: "Гель розовый", quantity: 5, threshold: 3, unit: "шт" },
        { id: "i2", name: "База",        quantity: 2, threshold: 5, unit: "шт" },
      ],
    });
    render();
    const rows = screen.getAllByTestId("inventory-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("inventory-total").textContent).toBe("2/80");
    // i2 has quantity 2 ≤ threshold 5 — low stock
    expect(rows[1]!.getAttribute("data-low")).toBe("true");
    expect(rows[0]!.getAttribute("data-low")).toBe("false");
  });

  it("ignores malformed settings_json without crashing", () => {
    mockInstall.settingsJson = "{ not json";
    render();
    expect(screen.getByTestId("inventory-empty")).toBeTruthy();
  });

  it("filters out items with empty names on hydration", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [
        { id: "i1", name: "База", quantity: 1, threshold: 0, unit: "шт" },
        { id: "i2", name: "",     quantity: 1, threshold: 0, unit: "шт" }, // stub, dropped
        { id: "i3", name: "Гель", quantity: 1, threshold: 0, unit: "шт" },
      ],
    });
    render();
    expect(screen.getAllByTestId("inventory-row")).toHaveLength(2);
  });
});

describe("InventoryLiteRuntime — add/edit/delete", () => {
  it("Add button appends an empty row + total count bumps", () => {
    render();
    fireEvent.click(screen.getByTestId("inventory-add-button"));
    expect(screen.getAllByTestId("inventory-row")).toHaveLength(1);
    expect(screen.getByTestId("inventory-total").textContent).toBe("1/80");
  });

  it("editing name + quantity updates in-memory state", () => {
    render();
    fireEvent.click(screen.getByTestId("inventory-add-button"));
    const nameInput = screen.getByTestId("inventory-name") as HTMLInputElement;
    const qtyInput = screen.getByTestId("inventory-quantity") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Топ" } });
    fireEvent.change(qtyInput,  { target: { value: "7" } });
    expect((screen.getByTestId("inventory-name") as HTMLInputElement).value).toBe("Топ");
    expect((screen.getByTestId("inventory-quantity") as HTMLInputElement).value).toBe("7");
  });

  it("Delete button removes the row", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [{ id: "i1", name: "Гель", quantity: 5, threshold: 3, unit: "шт" }],
    });
    render();
    expect(screen.getAllByTestId("inventory-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("inventory-remove"));
    expect(screen.queryAllByTestId("inventory-row")).toHaveLength(0);
  });
});

describe("InventoryLiteRuntime — low-stock badge", () => {
  it("shows the low-stock badge in the header when at least one item is low", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [
        { id: "i1", name: "Топ",  quantity: 10, threshold: 3, unit: "шт" },
        { id: "i2", name: "База", quantity: 2,  threshold: 5, unit: "шт" }, // low
      ],
    });
    render();
    expect(screen.getByTestId("inventory-low-count").textContent).toContain("1");
  });

  it("hides the low-stock badge when nothing is low", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [{ id: "i1", name: "Топ", quantity: 10, threshold: 3, unit: "шт" }],
    });
    render();
    expect(screen.queryByTestId("inventory-low-count")).toBeNull();
  });
});

describe("InventoryLiteRuntime — search", () => {
  it("filters the visible list by name (case-insensitive)", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [
        { id: "i1", name: "Гель розовый", quantity: 1, threshold: 0, unit: "шт" },
        { id: "i2", name: "Топ глянец",   quantity: 1, threshold: 0, unit: "шт" },
        { id: "i3", name: "База",         quantity: 1, threshold: 0, unit: "шт" },
      ],
    });
    render();
    fireEvent.change(screen.getByTestId("inventory-search"), { target: { value: "ГЕЛ" } });
    expect(screen.getAllByTestId("inventory-row")).toHaveLength(1);
    expect((screen.getByTestId("inventory-name") as HTMLInputElement).value).toBe("Гель розовый");
  });

  it("shows 'nothing found' when search has no matches", () => {
    mockInstall.settingsJson = JSON.stringify({
      items: [{ id: "i1", name: "Гель", quantity: 1, threshold: 0, unit: "шт" }],
    });
    render();
    fireEvent.change(screen.getByTestId("inventory-search"), { target: { value: "xyz" } });
    expect(screen.getByTestId("inventory-empty").textContent).toContain("Ничего не найдено");
  });
});

describe("InventoryLiteRuntime — save", () => {
  it("Save persists sanitized items via plugins.updateSettings", () => {
    render();
    fireEvent.click(screen.getByTestId("inventory-add-button"));
    fireEvent.change(screen.getByTestId("inventory-name"),     { target: { value: "  Гель  " } });
    fireEvent.change(screen.getByTestId("inventory-quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("inventory-unit"),     { target: { value: " шт " } });
    fireEvent.change(screen.getByTestId("inventory-threshold"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("inventory-save"));

    expect(updateCalls).toHaveLength(1);
    const { items } = updateCalls[0]!.settings as { items: Array<Record<string, unknown>> };
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Гель");
    expect(items[0]!.quantity).toBe(10);
    expect(items[0]!.threshold).toBe(3);
    expect(items[0]!.unit).toBe("шт");
  });

  it("Save drops rows with empty names (stubs)", () => {
    render();
    fireEvent.click(screen.getByTestId("inventory-add-button"));
    fireEvent.click(screen.getByTestId("inventory-add-button"));
    // First row gets a name, second stays blank
    const nameInputs = screen.getAllByTestId("inventory-name") as HTMLInputElement[];
    fireEvent.change(nameInputs[0]!, { target: { value: "Топ" } });
    fireEvent.click(screen.getByTestId("inventory-save"));

    const { items } = updateCalls[0]!.settings as { items: unknown[] };
    expect(items).toHaveLength(1);
  });
});
