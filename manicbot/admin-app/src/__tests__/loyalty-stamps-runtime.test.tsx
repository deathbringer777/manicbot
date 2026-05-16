// @vitest-environment happy-dom
/**
 * Tests for LoyaltyStampsRuntime — Phase 3 Variant A plugin.
 *
 * Validates the contract that this plugin doesn't need a custom tRPC router:
 *   - settings are persisted via the generic plugins.updateSettings mutation
 *   - client list is fetched via the existing clients.list procedure (sort=visits)
 *   - stamps progress is computed client-side from users.lifetime_visits
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// ── Mutable state shared across tests via the api mock ──────────────────────
let mockInstall = {
  id: "inst_loyalty_1",
  pluginSlug: "loyalty-stamps" as string,
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

let mockClientsRows: Array<{
  chatId: number;
  name: string | null;
  phone: string | null;
  tgUsername: string | null;
  lifetimeVisits: number;
}> = [];

const updateSettingsCalls: Array<{ installationId: string; settings: Record<string, unknown> }> = [];

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: "t_pro", role: "tenant_owner" }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        getInstalled: { invalidate: () => Promise.resolve() },
      },
    }),
    plugins: {
      getInstalled: {
        useQuery: () => ({ data: [mockInstall], isLoading: false }),
      },
      updateSettings: {
        useMutation: ({ onSuccess }: { onSuccess?: () => void } = {}) => ({
          mutate: (input: { installationId: string; settings: Record<string, unknown> }, opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => {
            updateSettingsCalls.push(input);
            // Mirror the persisted state so the runtime re-hydrates.
            mockInstall = { ...mockInstall, settingsJson: JSON.stringify(input.settings) };
            opts?.onSuccess?.();
            onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    clients: {
      list: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          if (opts?.enabled === false) return { data: undefined, isLoading: false };
          return { data: { rows: mockClientsRows, nextOffset: null, total: mockClientsRows.length }, isLoading: false };
        },
      },
    },
  },
}));

import LoyaltyStampsRuntime from "~/components/plugins/runtimes/LoyaltyStampsRuntime";

beforeEach(() => {
  updateSettingsCalls.length = 0;
  mockInstall = {
    id: "inst_loyalty_1",
    pluginSlug: "loyalty-stamps",
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
  mockClientsRows = [];
});

afterEach(() => cleanup());

function render() {
  return renderWithLang(<LoyaltyStampsRuntime installationId="inst_loyalty_1" slug="loyalty-stamps" />);
}

describe("LoyaltyStampsRuntime — settings form", () => {
  it("defaults to 7 stamps required when settings not yet persisted", () => {
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    expect(input.value).toBe("7");
  });

  it("hydrates from persisted settings_json on the install row", () => {
    mockInstall.settingsJson = JSON.stringify({ stampsRequired: 10, rewardText: "Скидка 50%" });
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    const reward = screen.getByTestId("loyalty-reward-input") as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(reward.value).toBe("Скидка 50%");
  });

  it("Save mutation persists clamped + trimmed settings via plugins.updateSettings", () => {
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    const reward = screen.getByTestId("loyalty-reward-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(reward, { target: { value: "  Free manicure  " } });
    fireEvent.click(screen.getByTestId("loyalty-save-button"));

    expect(updateSettingsCalls).toHaveLength(1);
    expect(updateSettingsCalls[0]!.installationId).toBe("inst_loyalty_1");
    expect(updateSettingsCalls[0]!.settings).toEqual({
      stampsRequired: 12,
      rewardText: "Free manicure",
    });
  });

  it("clamps stamps-required to [3, 15] when persisting", () => {
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByTestId("loyalty-save-button"));
    expect(updateSettingsCalls[0]!.settings.stampsRequired).toBe(15);

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("loyalty-save-button"));
    expect(updateSettingsCalls[1]!.settings.stampsRequired).toBe(3);
  });

  it("shows the OK flash after a successful save", async () => {
    render();
    fireEvent.click(screen.getByTestId("loyalty-save-button"));
    await waitFor(() => {
      const flash = screen.getByTestId("plugin-runtime-flash");
      expect(flash.getAttribute("data-kind")).toBe("ok");
      expect(flash.textContent).toContain("сохранены");
    });
  });
});

describe("LoyaltyStampsRuntime — client list", () => {
  it("renders the empty state when no clients exist", () => {
    render();
    expect(screen.getByTestId("loyalty-empty")).toBeTruthy();
  });

  it("renders progress for each client with a clamped current/total bar", () => {
    mockClientsRows = [
      { chatId: 1, name: "Alice", phone: null, tgUsername: null, lifetimeVisits: 3 },
      { chatId: 2, name: "Bob",   phone: "+48", tgUsername: null, lifetimeVisits: 14 },
      { chatId: 3, name: null,    phone: null, tgUsername: "@vip", lifetimeVisits: 0 },
    ];
    render();
    const rows = screen.getAllByTestId("loyalty-client-row");
    expect(rows.length).toBe(3);
    // Default stampsRequired = 7. Bob = 14 visits → 2 cycles, current=0.
    expect(rows[1]!.textContent).toContain("0/7");
    expect(rows[1]!.querySelector('[data-testid="loyalty-reward-badge"]')?.textContent).toContain("2");
    // Alice = 3 visits → 0 cycles, current=3.
    expect(rows[0]!.textContent).toContain("3/7");
    expect(rows[0]!.querySelector('[data-testid="loyalty-reward-badge"]')).toBeNull();
  });

  it("falls back to phone, then tg username, then 'Без имени' when name is empty", () => {
    mockClientsRows = [
      { chatId: 10, name: "", phone: "+48 600 111 222", tgUsername: null, lifetimeVisits: 1 },
      { chatId: 11, name: null, phone: null, tgUsername: "@vipclient", lifetimeVisits: 2 },
      { chatId: 12, name: null, phone: null, tgUsername: null, lifetimeVisits: 0 },
    ];
    render();
    const rows = screen.getAllByTestId("loyalty-client-row");
    expect(rows[0]!.textContent).toContain("+48 600 111 222");
    expect(rows[1]!.textContent).toContain("@vipclient");
    expect(rows[2]!.textContent).toContain("Без имени");
  });
});
