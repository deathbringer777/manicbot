// @vitest-environment happy-dom
/**
 * 0072 — Salon-side master pairing table (lives inside Channels → Telegram).
 *
 * Pins:
 *   - Empty-state placeholder when the tenant has no masters.
 *   - Per-row badge: synthetic → "Сгенерировать ссылку"; legacy real TG →
 *     read-only "TG: <chatId>" badge; paired synthetic → "TG: <telegramChatId>"
 *     + Unpair button; pending code → amber "pending <dur>" badge.
 *   - "Сгенерировать ссылку" fires `salon.createMasterPairingCode` with
 *     the correct input.
 *   - "Отвязать" fires `salon.setMasterTelegramChatId` with telegramChatId: null.
 *   - "Ввести вручную" reveals an inline editor; saving fires
 *     `salon.setMasterTelegramChatId` with the typed number.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

const mintMutate = vi.fn();
const setChatIdMutate = vi.fn();

const TENANT = "t_pair_table";
const SYN_NEW = 10_000_000_001;
const SYN_PAIRED = 10_000_000_002;
const LEGACY_REAL = 555;

let listData: {
  botUsername: string | null;
  masters: Array<{
    chatId: number;
    name: string | null;
    isSynthetic: boolean;
    origin: string;
    archived: boolean;
    telegramChatId: number | null;
    hasActiveCode: boolean;
    activeCodeExpiresAt: number | null;
  }>;
} = { botUsername: "manicbot", masters: [] };

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      salon: { listMasterPairingStates: { invalidate: () => Promise.resolve() } },
    }),
    salon: {
      listMasterPairingStates: {
        useQuery: () => ({ data: listData, isLoading: false }),
      },
      createMasterPairingCode: {
        useMutation: () => ({
          mutate: mintMutate,
          isPending: false,
          variables: undefined,
        }),
      },
      setMasterTelegramChatId: {
        useMutation: () => ({
          mutate: setChatIdMutate,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import { SalonMasterPairingTable } from "~/components/salon/SalonMasterPairingTable";

afterEach(() => {
  cleanup();
  mintMutate.mockReset();
  setChatIdMutate.mockReset();
  listData = { botUsername: "manicbot", masters: [] };
});

describe("SalonMasterPairingTable", () => {
  it("renders the empty-state placeholder when the tenant has no masters", () => {
    listData = { botUsername: "manicbot", masters: [] };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    expect(screen.getByText(/В салоне пока нет мастеров/)).toBeTruthy();
  });

  it("renders one row per master with the correct badge / actions", () => {
    listData = {
      botUsername: "manicbot",
      masters: [
        {
          chatId: SYN_NEW,
          name: "Anna",
          isSynthetic: true,
          origin: "salon_created",
          archived: false,
          telegramChatId: null,
          hasActiveCode: false,
          activeCodeExpiresAt: null,
        },
        {
          chatId: SYN_PAIRED,
          name: "Boris",
          isSynthetic: true,
          origin: "invited_email",
          archived: false,
          telegramChatId: 9999,
          hasActiveCode: false,
          activeCodeExpiresAt: null,
        },
        {
          chatId: LEGACY_REAL,
          name: "Carla (legacy TG)",
          isSynthetic: false,
          origin: "invited_telegram",
          archived: false,
          telegramChatId: null,
          hasActiveCode: false,
          activeCodeExpiresAt: null,
        },
      ],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);

    // Anna — needs pairing, has the "Сгенерировать ссылку" button.
    expect(screen.getByTestId(`master-pair-row-${SYN_NEW}`)).toBeTruthy();
    expect(screen.getByTestId(`mint-link-${SYN_NEW}`)).toBeTruthy();

    // Boris — paired. Has TG badge + Unpair button.
    const borisRow = screen.getByTestId(`master-pair-row-${SYN_PAIRED}`);
    expect(borisRow.textContent).toMatch(/TG:\s*9999/);
    expect(borisRow.textContent).toMatch(/Отвязать/);

    // Carla — legacy real TG. Read-only badge, no mint button.
    const carlaRow = screen.getByTestId(`master-pair-row-${LEGACY_REAL}`);
    expect(carlaRow.textContent).toMatch(/TG:\s*555/);
    // No "Сгенерировать ссылку" button on the legacy-TG row.
    expect(screen.queryByTestId(`mint-link-${LEGACY_REAL}`)).toBeNull();
  });

  it("clicking 'Сгенерировать ссылку' fires createMasterPairingCode", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: false,
        telegramChatId: null,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    fireEvent.click(screen.getByTestId(`mint-link-${SYN_NEW}`));
    expect(mintMutate).toHaveBeenCalledTimes(1);
    expect(mintMutate).toHaveBeenCalledWith({
      tenantId: TENANT,
      masterChatId: SYN_NEW,
    });
  });

  it("clicking 'Отвязать' fires setMasterTelegramChatId with null", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_PAIRED,
        name: "Boris",
        isSynthetic: true,
        origin: "invited_email",
        archived: false,
        telegramChatId: 9999,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    fireEvent.click(screen.getByText(/Отвязать/));
    expect(setChatIdMutate).toHaveBeenCalledTimes(1);
    expect(setChatIdMutate).toHaveBeenCalledWith({
      tenantId: TENANT,
      masterChatId: SYN_PAIRED,
      telegramChatId: null,
    });
  });

  it("'Ввести вручную' reveals the editor; saving fires setMasterTelegramChatId with the number", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: false,
        telegramChatId: null,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    fireEvent.click(screen.getByText(/Ввести вручную/));

    const input = screen.getByPlaceholderText("123456789") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7777777" } });
    fireEvent.click(screen.getByText(/Сохранить/));

    expect(setChatIdMutate).toHaveBeenCalledTimes(1);
    expect(setChatIdMutate).toHaveBeenCalledWith({
      tenantId: TENANT,
      masterChatId: SYN_NEW,
      telegramChatId: 7777777,
    });
  });

  it("manual editor rejects empty / non-numeric input without firing the mutation", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: false,
        telegramChatId: null,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    fireEvent.click(screen.getByText(/Ввести вручную/));
    const input = screen.getByPlaceholderText("123456789") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByText(/Сохранить/));
    expect(setChatIdMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/положительное целое число/)).toBeTruthy();
  });

  it("renders the archived row dimmed and hides action buttons", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: true,
        telegramChatId: null,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    const row = screen.getByTestId(`master-pair-row-${SYN_NEW}`);
    expect(row.className).toMatch(/opacity-50/);
    expect(row.textContent).toMatch(/archived/);
    expect(screen.queryByTestId(`mint-link-${SYN_NEW}`)).toBeNull();
  });

  it("shows an amber 'pending' badge when hasActiveCode is true", () => {
    listData = {
      botUsername: "manicbot",
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: false,
        telegramChatId: null,
        hasActiveCode: true,
        activeCodeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    expect(screen.getByText(/pending/)).toBeTruthy();
  });

  it("warns when botUsername is null but masters exist", () => {
    listData = {
      botUsername: null,
      masters: [{
        chatId: SYN_NEW,
        name: "Anna",
        isSynthetic: true,
        origin: "salon_created",
        archived: false,
        telegramChatId: null,
        hasActiveCode: false,
        activeCodeExpiresAt: null,
      }],
    };
    renderWithLang(<SalonMasterPairingTable tenantId={TENANT} />);
    expect(screen.getByText(/не подключён Telegram-бот/)).toBeTruthy();
  });
});
