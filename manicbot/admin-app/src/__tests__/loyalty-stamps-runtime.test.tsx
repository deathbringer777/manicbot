// @vitest-environment happy-dom
/**
 * Tests for LoyaltyStampsRuntime — Phase 3 Variant A plugin.
 *
 * Validates the contract that this plugin doesn't need a custom tRPC router:
 *   - settings are persisted via the generic plugins.updateSettings mutation
 *   - client list is fetched via the existing clients.list procedure (sort=visits)
 *   - stamps progress is computed client-side from users.lifetime_visits
 *   - reward can be a linked service or custom freeform text
 *   - client rows show avatar emoji, tags, and a notes snippet
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

interface MockClientRow {
  chatId: number;
  name: string | null;
  phone: string | null;
  tgUsername: string | null;
  lifetimeVisits: number;
  avatarEmoji?: string | null;
  tags?: string | null;
  notes?: string | null;
}

let mockClientsRows: MockClientRow[] = [];

let mockServices: Array<{
  svcId: string;
  names: string | null;
  emoji: string | null;
  price: number;
  active: number;
  hidden: number;
}> = [];

const updateSettingsCalls: Array<{ installationId: string; settings: Record<string, unknown> }> = [];

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: "t_pro", role: "tenant_owner" }),
}));

vi.mock("~/lib/clientAvatar", () => ({
  resolveAvatarEmoji: (emoji: string | null | undefined) => emoji?.trim() || "👩",
  DEFAULT_CLIENT_EMOJI: "👩",
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
          mutate: (
            input: { installationId: string; settings: Record<string, unknown> },
            opts?: { onSuccess?: () => void; onError?: (e: { message: string }) => void },
          ) => {
            updateSettingsCalls.push(input);
            mockInstall = { ...mockInstall, settingsJson: JSON.stringify(input.settings) };
            opts?.onSuccess?.();
            onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    salon: {
      getServices: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          if (opts?.enabled === false) return { data: [], isLoading: false };
          return { data: mockServices, isLoading: false };
        },
      },
    },
    clients: {
      list: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          if (opts?.enabled === false) return { data: undefined, isLoading: false };
          return {
            data: { rows: mockClientsRows, nextOffset: null, total: mockClientsRows.length },
            isLoading: false,
          };
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
  mockServices = [];
});

afterEach(() => cleanup());

function render() {
  return renderWithLang(<LoyaltyStampsRuntime installationId="inst_loyalty_1" slug="loyalty-stamps" />);
}

// ── Settings form ────────────────────────────────────────────────────────────

describe("LoyaltyStampsRuntime — settings form", () => {
  it("defaults to 7 stamps required when settings not yet persisted", () => {
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    expect(input.value).toBe("7");
  });

  it("hydrates stamps count from persisted settings_json", () => {
    mockInstall.settingsJson = JSON.stringify({ stampsRequired: 10, rewardText: "Скидка 50%" });
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    expect(input.value).toBe("10");
  });

  it("shows custom text input when no rewardServiceId is saved (backward compat)", () => {
    mockInstall.settingsJson = JSON.stringify({ stampsRequired: 10, rewardText: "Скидка 50%" });
    render();
    const rewardInput = screen.getByTestId("loyalty-reward-input") as HTMLInputElement;
    expect(rewardInput.value).toBe("Скидка 50%");
  });

  it("shows custom text input when rewardServiceId is null (explicitly custom)", () => {
    mockInstall.settingsJson = JSON.stringify({ rewardServiceId: null, rewardText: "Мой текст" });
    render();
    const rewardInput = screen.getByTestId("loyalty-reward-input") as HTMLInputElement;
    expect(rewardInput.value).toBe("Мой текст");
  });

  it("hides custom text input when a service is selected", () => {
    mockServices = [{ svcId: "svc_1", names: JSON.stringify({ ru: "Маникюр" }), emoji: "💅", price: 80, active: 1, hidden: 0 }];
    mockInstall.settingsJson = JSON.stringify({ rewardServiceId: "svc_1", rewardText: "Маникюр" });
    render();
    expect(screen.queryByTestId("loyalty-reward-input")).toBeNull();
  });

  it("renders active services as options in the service selector", () => {
    mockServices = [
      { svcId: "svc_1", names: JSON.stringify({ ru: "Маникюр" }), emoji: "💅", price: 80, active: 1, hidden: 0 },
      { svcId: "svc_2", names: JSON.stringify({ ru: "Педикюр" }), emoji: "🦶", price: 100, active: 1, hidden: 0 },
      { svcId: "svc_3", names: JSON.stringify({ ru: "Скрытый" }), emoji: null, price: 50, active: 1, hidden: 1 },
      { svcId: "svc_4", names: JSON.stringify({ ru: "Неактивный" }), emoji: null, price: 60, active: 0, hidden: 0 },
    ];
    render();
    const select = screen.getByTestId("loyalty-reward-service-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("svc_1");
    expect(options).toContain("svc_2");
    expect(options).not.toContain("svc_3"); // hidden
    expect(options).not.toContain("svc_4"); // inactive
    expect(options).toContain("__custom__");
  });

  it("Save with custom text persists rewardServiceId=null + trimmed text", () => {
    render();
    const input = screen.getByTestId("loyalty-stamps-input") as HTMLInputElement;
    const rewardInput = screen.getByTestId("loyalty-reward-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(rewardInput, { target: { value: "  Free manicure  " } });
    fireEvent.click(screen.getByTestId("loyalty-save-button"));

    expect(updateSettingsCalls).toHaveLength(1);
    expect(updateSettingsCalls[0]!.installationId).toBe("inst_loyalty_1");
    expect(updateSettingsCalls[0]!.settings).toEqual({
      stampsRequired: 12,
      rewardServiceId: null,
      rewardText: "Free manicure",
    });
  });

  it("Save with a service selected persists rewardServiceId + derived rewardText", () => {
    mockServices = [
      { svcId: "svc_1", names: JSON.stringify({ ru: "Маникюр" }), emoji: "💅", price: 80, active: 1, hidden: 0 },
    ];
    render();
    const select = screen.getByTestId("loyalty-reward-service-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "svc_1" } });
    fireEvent.click(screen.getByTestId("loyalty-save-button"));

    expect(updateSettingsCalls[0]!.settings).toMatchObject({
      rewardServiceId: "svc_1",
      rewardText: "Маникюр",
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

// ── Client list ──────────────────────────────────────────────────────────────

describe("LoyaltyStampsRuntime — client list", () => {
  it("renders the empty state when no clients exist", () => {
    render();
    expect(screen.getByTestId("loyalty-empty")).toBeTruthy();
  });

  it("renders progress for each client with a clamped current/total bar", () => {
    mockClientsRows = [
      { chatId: 1, name: "Alice", phone: null, tgUsername: null, lifetimeVisits: 3 },
      { chatId: 2, name: "Bob", phone: "+48", tgUsername: null, lifetimeVisits: 14 },
      { chatId: 3, name: null, phone: null, tgUsername: "@vip", lifetimeVisits: 0 },
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

  it("renders avatar emoji from the row; falls back to default 👩 when null", () => {
    mockClientsRows = [
      { chatId: 1, name: "Аня", phone: null, tgUsername: null, lifetimeVisits: 1, avatarEmoji: "🌸" },
      { chatId: 2, name: "Поля", phone: null, tgUsername: null, lifetimeVisits: 1, avatarEmoji: null },
    ];
    render();
    const avatars = screen.getAllByTestId("loyalty-client-avatar");
    expect(avatars[0]!.textContent).toContain("🌸");
    expect(avatars[1]!.textContent).toContain("👩");
  });

  it("renders up to 3 tags as chips", () => {
    mockClientsRows = [
      {
        chatId: 1, name: "Вера", phone: null, tgUsername: null, lifetimeVisits: 2,
        tags: "vip,постоянная,нарощенные,четвёртый",
      },
    ];
    render();
    const tagChips = screen.getAllByTestId("loyalty-client-tag");
    expect(tagChips).toHaveLength(3); // sliced at 3
    expect(tagChips[0]!.textContent).toBe("vip");
    expect(tagChips[1]!.textContent).toBe("постоянная");
    expect(tagChips[2]!.textContent).toBe("нарощенные");
  });

  it("does not render tag chips when tags is null", () => {
    mockClientsRows = [
      { chatId: 1, name: "Катя", phone: null, tgUsername: null, lifetimeVisits: 1, tags: null },
    ];
    render();
    expect(screen.queryAllByTestId("loyalty-client-tag")).toHaveLength(0);
  });

  it("renders a truncated notes snippet", () => {
    const longNote = "Любит яркие оттенки, приходит каждые 3 недели, предпочитает утренние слоты";
    mockClientsRows = [
      { chatId: 1, name: "Оля", phone: null, tgUsername: null, lifetimeVisits: 1, notes: longNote },
    ];
    render();
    const noteEl = screen.getByTestId("loyalty-client-note");
    expect(noteEl.textContent).toContain(longNote.slice(0, 60));
    expect(noteEl.textContent).toContain("…");
  });

  it("does not render notes element when notes is null", () => {
    mockClientsRows = [
      { chatId: 1, name: "Рита", phone: null, tgUsername: null, lifetimeVisits: 1, notes: null },
    ];
    render();
    expect(screen.queryAllByTestId("loyalty-client-note")).toHaveLength(0);
  });
});
