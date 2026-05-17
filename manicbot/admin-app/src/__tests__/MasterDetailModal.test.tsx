// @vitest-environment happy-dom
/**
 * MasterDetailModal — owner-side detail + edit modal for the Masters tab.
 *
 * Pins:
 *   * Renders the master name + the right badges (Web / hidden / vacation).
 *   * For an editable origin (salon_created), clicking Edit reveals the
 *     name / tg / bio / photo / vacation form, and Save calls
 *     `salon.updateMaster` with the form payload.
 *   * For a self_registered master, the Edit button is hidden and a lock
 *     notice is shown ("master owns profile").
 *   * Visibility toggle calls `salon.setMasterPublicHidden`.
 *   * Delete inline confirm calls `salon.removeMaster`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { MasterDetailModal } from "~/components/salon/tabs/masters/MasterDetailModal";

const updateMutate = vi.fn();
const setHiddenMutate = vi.fn();
const removeMutate = vi.fn();
let masterFixture: any = null;

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      salon: {
        getMasters: { invalidate: vi.fn() },
        getMasterDetail: { invalidate: vi.fn() },
        getMasterPairingState: { invalidate: vi.fn() },
      },
    }),
    salon: {
      getMasterDetail: {
        useQuery: () => ({
          data: masterFixture,
          isLoading: false,
          isError: false,
        }),
      },
      // The inline Telegram-pairing section mounted inside ViewMode reads
      // this. Stub it out — the dedicated MasterTelegramInlineSection.test
      // covers state-driven rendering. Here we just need the modal to not
      // crash when its child queries.
      getMasterPairingState: {
        useQuery: () => ({
          data: {
            chatId: 10_000_000_001,
            isSynthetic: true,
            origin: "salon_created",
            archived: false,
            telegramChatId: null,
            hasActiveCode: false,
            activeCodeExpiresAt: null,
            botUsername: "demo_salon_bot",
          },
          isLoading: false,
          isError: false,
        }),
      },
      updateMaster: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            updateMutate(vars);
            opts?.onSuccess?.({ success: true });
          },
          isPending: false,
        }),
      },
      setMasterPublicHidden: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            setHiddenMutate(vars);
            opts?.onSuccess?.({ success: true });
          },
          isPending: false,
        }),
      },
      removeMaster: {
        useMutation: (opts: any) => ({
          mutate: (vars: any) => {
            removeMutate(vars);
            opts?.onSuccess?.({ ok: true });
          },
          isPending: false,
        }),
      },
      // Avatar picker mutation (0075) — stubbed so the picker can mount.
      updateMasterAvatar: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      mintUploadToken: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      // Pairing mutations used by the inline section. Stubbed no-ops here.
      createMasterPairingCode: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      setMasterTelegramChatId: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

function setMaster(overrides: Record<string, unknown> = {}) {
  masterFixture = {
    chatId: 10_000_000_001,
    name: "Ольга",
    tgUsername: null,
    bio: "Top-tier nail tech",
    photo: null,
    portfolio: null,
    workHours: null,
    workDays: null,
    publicHidden: 0,
    active: 1,
    archivedAt: null,
    origin: "salon_created" as const,
    isSynthetic: 1,
    webUserId: "w_olga",
    vacationFrom: null,
    vacationUntil: null,
    onVacation: 0,
    allowDelegation: 0,
    avatarEmoji: null,
    avatarUrl: null,
    webUser: {
      email: "olga@manicbot.com",
      emailVerified: 1,
      lastLoginAt: null,
      hasVaultedPassword: true,
    },
    ...overrides,
  };
}

function renderModal() {
  return render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <MasterDetailModal tenantId="t_demo" chatId={10_000_000_001} onClose={() => {}} />
    </LangContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  updateMutate.mockClear();
  setHiddenMutate.mockClear();
  removeMutate.mockClear();
  masterFixture = null;
});

describe("MasterDetailModal — salon_created (editable)", () => {
  it("renders the master name + Web badge", () => {
    setMaster();
    renderModal();
    expect(screen.getByText("Ольга")).toBeTruthy();
    expect(screen.getByText("Web")).toBeTruthy();
  });

  it("Edit button is visible and opens the edit form", () => {
    setMaster();
    renderModal();
    const editBtn = screen.getByTestId("master-detail-edit");
    fireEvent.click(editBtn);
    // Name field must be present in edit mode
    const nameInput = screen.getByTestId("master-detail-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Ольга");
  });

  it("Save calls updateMaster with the form payload", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-edit"));
    const nameInput = screen.getByTestId("master-detail-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Olga V" } });
    fireEvent.click(screen.getByTestId("master-detail-save"));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const call = updateMutate.mock.calls[0]![0];
    expect(call.tenantId).toBe("t_demo");
    expect(call.chatId).toBe(10_000_000_001);
    expect(call.name).toBe("Olga V");
    expect(call.bio).toBe("Top-tier nail tech");
    // Vacation cleared when both inputs are empty (handled as both-null clear)
    expect(call.vacationFrom).toBeNull();
    expect(call.vacationUntil).toBeNull();
  });

  it("Visibility toggle calls setMasterPublicHidden with hidden=1", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-visibility"));
    expect(setHiddenMutate).toHaveBeenCalledWith({
      tenantId: "t_demo",
      chatId: 10_000_000_001,
      hidden: 1,
    });
  });

  it("Delete → confirm → calls removeMaster", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-delete"));
    fireEvent.click(screen.getByTestId("master-detail-delete-confirm"));
    expect(removeMutate).toHaveBeenCalledWith({
      tenantId: "t_demo",
      chatId: 10_000_000_001,
    });
  });
});

describe("MasterDetailModal — non-editable origins", () => {
  it("self_registered hides the Edit button and shows the lock notice", () => {
    setMaster({ origin: "self_registered", allowDelegation: 1 });
    renderModal();
    expect(screen.queryByTestId("master-detail-edit")).toBeNull();
    // Lock copy includes "сам и управляет" (matches the ru lock string)
    expect(screen.getByText(/самостоятельно|сам/i)).toBeTruthy();
  });

  it("invited_email without allowDelegation hides Edit + shows delegation notice", () => {
    setMaster({ origin: "invited_email", allowDelegation: 0 });
    renderModal();
    expect(screen.queryByTestId("master-detail-edit")).toBeNull();
    expect(screen.getByText(/делегиров/i)).toBeTruthy();
  });

  it("invited_email WITH allowDelegation=1 shows the Edit button", () => {
    setMaster({ origin: "invited_email", allowDelegation: 1 });
    renderModal();
    expect(screen.getByTestId("master-detail-edit")).toBeTruthy();
  });
});
