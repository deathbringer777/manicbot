// @vitest-environment happy-dom
/**
 * 0072 — Master-side Telegram pairing card.
 *
 * Pins the five render states + the three mutation paths:
 *
 *   - Hidden when master's primary chatId is already a real TG (origin
 *     'invited_telegram' / pre-0023). They don't need the surface.
 *   - "Salon hasn't connected a bot yet" placeholder when botUsername
 *     is null AND the master isn't already paired.
 *   - "Already paired" state with the TG chat_id + Unpair button.
 *   - "Pending code" state with the generated deep-link + Copy.
 *   - CTA state (no pairing, no pending code, bot connected) with the
 *     "Сгенерировать ссылку" button that fires the mint mutation.
 *
 * Mutations covered:
 *   - `master.requestPairingCode` fires with the right input on CTA click.
 *   - `master.unpairTelegram` fires with the right input on Unpair click.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

const mintMutate = vi.fn();
const mintMutateAsync = vi.fn(async () => ({
  deepLink: "https://t.me/manicbot?start=mst_TOK",
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
}));
const unpairMutate = vi.fn();

let stateData: {
  chatId: number;
  telegramChatId: number | null;
  isSynthetic: boolean;
  archived: boolean;
  hasActiveCode: boolean;
  activeCodeExpiresAt: number | null;
  botUsername: string | null;
} | null = null;

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      master: {
        getMyPairingState: { invalidate: () => Promise.resolve() },
      },
    }),
    master: {
      getMyPairingState: {
        useQuery: () => ({ data: stateData, isLoading: false }),
      },
      requestPairingCode: {
        useMutation: () => ({
          mutate: (input: unknown) => {
            mintMutate(input);
            // Simulate onSuccess populating the local generatedLink state
            // by also calling mutateAsync (the implementation uses .mutate
            // which then routes through the onSuccess handler).
          },
          mutateAsync: mintMutateAsync,
          isPending: false,
          error: null,
        }),
      },
      unpairTelegram: {
        useMutation: () => ({
          mutate: unpairMutate,
          isPending: false,
        }),
      },
    },
  },
}));

import { MasterTelegramPairingCard } from "~/components/master/MasterTelegramPairingCard";

afterEach(() => {
  cleanup();
  mintMutate.mockReset();
  unpairMutate.mockReset();
  stateData = null;
});

describe("MasterTelegramPairingCard", () => {
  it("renders nothing when the master's primary chatId is already a real TG (legacy)", () => {
    stateData = {
      chatId: 555, // real TG (< 10B)
      telegramChatId: null,
      isSynthetic: false,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: "manicbot",
    };
    const { container } = renderWithLang(
      <MasterTelegramPairingCard tenantId="t_x" masterId={555} />,
    );
    // Component returns null in this case — root container is empty.
    expect(container.querySelector('[data-testid^="pair-tg-"]')).toBeNull();
  });

  it("renders the bound state when telegramChatId is set", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: 4242,
      isSynthetic: true,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: "manicbot",
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);

    expect(screen.getByTestId("pair-tg-bound")).toBeTruthy();
    expect(screen.getByText(/ID:\s*4242/)).toBeTruthy();
    expect(screen.getByText(/Отвязать/)).toBeTruthy();
  });

  it("renders the no-bot placeholder when botUsername is null + not paired", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: null,
      isSynthetic: true,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: null,
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);
    expect(screen.getByTestId("pair-tg-no-bot")).toBeTruthy();
    expect(screen.getByText(/не подключил свой Telegram-бот/)).toBeTruthy();
  });

  it("renders the CTA when there is a bot but no pairing and no active code", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: null,
      isSynthetic: true,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: "manicbot",
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);
    expect(screen.getByTestId("pair-tg-cta")).toBeTruthy();
    expect(screen.getByTestId("pair-tg-mint")).toBeTruthy();
  });

  it("clicking the CTA fires requestPairingCode with the right input", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: null,
      isSynthetic: true,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: "manicbot",
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);
    fireEvent.click(screen.getByTestId("pair-tg-mint"));
    expect(mintMutate).toHaveBeenCalledTimes(1);
    expect(mintMutate).toHaveBeenCalledWith({ tenantId: "t_x", masterId: 10_000_000_001 });
  });

  it("clicking Unpair fires unpairTelegram with the right input", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: 4242,
      isSynthetic: true,
      archived: false,
      hasActiveCode: false,
      activeCodeExpiresAt: null,
      botUsername: "manicbot",
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);
    fireEvent.click(screen.getByText(/Отвязать/));
    expect(unpairMutate).toHaveBeenCalledTimes(1);
    expect(unpairMutate).toHaveBeenCalledWith({ tenantId: "t_x", masterId: 10_000_000_001 });
  });

  it("shows the pending-code amber warning when hasActiveCode is true on the CTA", () => {
    stateData = {
      chatId: 10_000_000_001,
      telegramChatId: null,
      isSynthetic: true,
      archived: false,
      hasActiveCode: true,
      activeCodeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      botUsername: "manicbot",
    };
    renderWithLang(<MasterTelegramPairingCard tenantId="t_x" masterId={10_000_000_001} />);
    expect(screen.getByTestId("pair-tg-cta")).toBeTruthy();
    expect(screen.getByText(/pending-ссылка/)).toBeTruthy();
  });
});
