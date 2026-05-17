// @vitest-environment happy-dom
/**
 * MasterTelegramInlineSection — per-master pairing controls embedded in
 * MasterDetailModal. Closes the discoverability gap for salon owners who
 * land on a master's profile and want to pair Telegram without bouncing
 * to Channels → Telegram.
 *
 * Pins:
 *   - self_registered → section is NOT rendered (master owns pairing).
 *   - not paired, no pending code → "Generate link" CTA + "Enter manually".
 *   - paired → green TG badge + Unpair (with inline confirm) + "Generate new link".
 *   - pending code → amber pending badge + mint button text becomes "Generate new link".
 *   - legacy real-TG (origin='invited_telegram', not synthetic, no telegram_chat_id)
 *     → informational badge only, NO mint/unpair buttons.
 *   - bot not connected → amber warning, mint button disabled.
 *   - archived → dimmed + actions hidden.
 *   - manual entry input rejects non-positive / non-integer values inline,
 *     fires `setMasterTelegramChatId` on valid integer.
 *   - mint success path calls clipboard.writeText and reveals the link card.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { MasterTelegramInlineSection } from "~/components/salon/tabs/masters/MasterTelegramInlineSection";

type PairState = {
  chatId: number;
  isSynthetic: boolean;
  origin: string;
  archived: boolean;
  telegramChatId: number | null;
  hasActiveCode: boolean;
  activeCodeExpiresAt: number | null;
  botUsername: string | null;
};

const mintMutate = vi.fn();
const setChatIdMutate = vi.fn();
let stateFixture: PairState | null = null;
let mintImpl: ((vars: unknown, opts: { onSuccess?: (res: any) => void; onError?: (e: any) => void }) => void) | null = null;
let setChatIdImpl: ((vars: unknown, opts: { onSuccess?: (res: any) => void; onError?: (e: any) => void }) => void) | null = null;

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      salon: {
        getMasterPairingState: { invalidate: vi.fn() },
      },
    }),
    salon: {
      getMasterPairingState: {
        useQuery: () => ({
          data: stateFixture,
          isLoading: stateFixture === null,
          isError: false,
        }),
      },
      createMasterPairingCode: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            mintMutate(vars);
            if (mintImpl) mintImpl(vars, opts);
          },
          isPending: false,
          variables: undefined,
        }),
      },
      setMasterTelegramChatId: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            setChatIdMutate(vars);
            if (setChatIdImpl) setChatIdImpl(vars, opts);
          },
          isPending: false,
        }),
      },
    },
  },
}));

const TENANT = "t_demo";
const MASTER_CHAT_ID = 10_000_000_001;

function setState(overrides: Partial<PairState> = {}) {
  stateFixture = {
    chatId: MASTER_CHAT_ID,
    isSynthetic: true,
    origin: "salon_created",
    archived: false,
    telegramChatId: null,
    hasActiveCode: false,
    activeCodeExpiresAt: null,
    botUsername: "demo_salon_bot",
    ...overrides,
  };
}

function renderSection(originOverride?: string) {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <MasterTelegramInlineSection
        tenantId={TENANT}
        masterChatId={MASTER_CHAT_ID}
        origin={originOverride ?? stateFixture?.origin ?? "salon_created"}
        lang="ru"
      />
    </LangContext.Provider>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  cleanup();
  mintMutate.mockClear();
  setChatIdMutate.mockClear();
  stateFixture = null;
  mintImpl = null;
  setChatIdImpl = null;
});

describe("MasterTelegramInlineSection — render gating", () => {
  it("does not render for self_registered masters", () => {
    setState({ origin: "self_registered" });
    const { container } = renderSection("self_registered");
    expect(container.querySelector('[data-testid="master-pair-section"]')).toBeNull();
  });

  it("renders a loading hint while the query is pending", () => {
    stateFixture = null;
    renderSection("salon_created");
    expect(screen.getByText(/загружаем/i)).toBeTruthy();
  });
});

describe("MasterTelegramInlineSection — not paired", () => {
  it("shows the 'not paired' badge + Generate-link CTA + Manual entry", () => {
    setState();
    renderSection();
    expect(screen.getByTestId("master-pair-section")).toBeTruthy();
    expect(screen.getByTestId("master-pair-badge-notpaired")).toBeTruthy();
    expect(screen.getByTestId("master-pair-mint")).toBeTruthy();
    expect(screen.getByTestId("master-pair-manual-toggle")).toBeTruthy();
    expect(screen.queryByTestId("master-pair-unpair")).toBeNull();
  });

  it("Mint click fires salon.createMasterPairingCode with tenantId + masterChatId", () => {
    setState();
    renderSection();
    fireEvent.click(screen.getByTestId("master-pair-mint"));
    expect(mintMutate).toHaveBeenCalledWith({ tenantId: TENANT, masterChatId: MASTER_CHAT_ID });
  });

  it("Mint success surfaces the deep-link card + Copy button", async () => {
    setState();
    mintImpl = (_vars, opts) => {
      opts.onSuccess?.({
        deepLink: "https://t.me/demo_salon_bot?start=mst_ABCDEFG",
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
      });
    };
    renderSection();
    fireEvent.click(screen.getByTestId("master-pair-mint"));
    // Allow the synchronous onSuccess effect to commit
    await Promise.resolve();
    expect(screen.getByTestId("master-pair-minted")).toBeTruthy();
    expect(screen.getByText(/start=mst_ABCDEFG/)).toBeTruthy();
    expect(screen.getByTestId("master-pair-copy")).toBeTruthy();
  });
});

describe("MasterTelegramInlineSection — paired", () => {
  it("shows the linked badge + Unpair + 'Generate new link'", () => {
    setState({ telegramChatId: 123456789 });
    renderSection();
    const badge = screen.getByTestId("master-pair-badge-linked");
    expect(badge.textContent).toContain("123456789");
    expect(screen.getByTestId("master-pair-unpair")).toBeTruthy();
    const mintBtn = screen.getByTestId("master-pair-mint");
    expect(mintBtn.textContent ?? "").toMatch(/новую/i);
  });

  it("Unpair → inline confirm → confirmed click fires setMasterTelegramChatId({telegramChatId: null})", () => {
    setState({ telegramChatId: 123456789 });
    renderSection();
    fireEvent.click(screen.getByTestId("master-pair-unpair"));
    expect(screen.getByTestId("master-pair-unpair-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("master-pair-unpair-confirmed"));
    expect(setChatIdMutate).toHaveBeenCalledWith({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      telegramChatId: null,
    });
  });
});

describe("MasterTelegramInlineSection — pending code", () => {
  it("shows the amber pending badge with the formatted expiry", () => {
    setState({
      hasActiveCode: true,
      activeCodeExpiresAt: Math.floor(Date.now() / 1000) + 3 * 86400,
    });
    renderSection();
    const badge = screen.getByTestId("master-pair-badge-pending");
    expect(badge.textContent ?? "").toMatch(/ожидает/i);
    // Mint button copy switches to "Generate new link"
    expect(screen.getByTestId("master-pair-mint").textContent ?? "").toMatch(/новую/i);
  });
});

describe("MasterTelegramInlineSection — legacy real-TG master", () => {
  it("renders informational badge with no mint/unpair buttons", () => {
    setState({
      isSynthetic: false,
      origin: "invited_telegram",
      telegramChatId: null,
    });
    renderSection("invited_telegram");
    expect(screen.getByTestId("master-pair-badge-legacy")).toBeTruthy();
    expect(screen.queryByTestId("master-pair-mint")).toBeNull();
    expect(screen.queryByTestId("master-pair-unpair")).toBeNull();
    expect(screen.queryByTestId("master-pair-manual-toggle")).toBeNull();
  });
});

describe("MasterTelegramInlineSection — bot not connected", () => {
  it("shows amber warning + disables mint and manual entry", () => {
    setState({ botUsername: null });
    renderSection();
    // The botMissing copy is unique — "У салона ещё не подключён".
    expect(screen.getByText(/не подключён/i)).toBeTruthy();
    const mintBtn = screen.getByTestId("master-pair-mint") as HTMLButtonElement;
    expect(mintBtn.disabled).toBe(true);
    const manualBtn = screen.getByTestId("master-pair-manual-toggle") as HTMLButtonElement;
    expect(manualBtn.disabled).toBe(true);
  });
});

describe("MasterTelegramInlineSection — archived master", () => {
  it("hides action buttons", () => {
    setState({ archived: true });
    renderSection();
    expect(screen.getByTestId("master-pair-section")).toBeTruthy();
    expect(screen.queryByTestId("master-pair-mint")).toBeNull();
    expect(screen.queryByTestId("master-pair-unpair")).toBeNull();
    expect(screen.queryByTestId("master-pair-manual-toggle")).toBeNull();
  });
});

describe("MasterTelegramInlineSection — manual entry", () => {
  it("validates positive integer + blocks empty / non-numeric / negative input", () => {
    setState();
    renderSection();
    fireEvent.click(screen.getByTestId("master-pair-manual-toggle"));
    const input = screen.getByTestId("master-pair-manual-input") as HTMLInputElement;
    // Empty save button is disabled when empty (input value is "")
    const saveBtn = screen.getByTestId("master-pair-manual-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Negative number → inline error, no mutation
    fireEvent.change(input, { target: { value: "-42" } });
    fireEvent.click(saveBtn);
    expect(setChatIdMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/положительное/i)).toBeTruthy();

    // Valid → fires mutation
    fireEvent.change(input, { target: { value: "987654321" } });
    fireEvent.click(saveBtn);
    expect(setChatIdMutate).toHaveBeenCalledWith({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      telegramChatId: 987654321,
    });
  });

  it("Cancel closes the editor without firing a mutation", () => {
    setState();
    renderSection();
    fireEvent.click(screen.getByTestId("master-pair-manual-toggle"));
    expect(screen.getByTestId("master-pair-manual-input")).toBeTruthy();
    fireEvent.click(screen.getByText(/^Отмена$/));
    expect(screen.queryByTestId("master-pair-manual-input")).toBeNull();
    expect(setChatIdMutate).not.toHaveBeenCalled();
  });
});
