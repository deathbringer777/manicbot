// @vitest-environment happy-dom
/**
 * MasterDetailModal — owner-side detail + tabbed Settings modal for the
 * Masters tab.
 *
 * Pins the new contract:
 *   * Bottom CTA is "Настройки" (was "Редактировать"). Clicking it switches
 *     the modal to the editing view with a TabBar at the top.
 *   * Default tab inside Settings is "Редактирование" (profile data).
 *   * "Редактирование" pane saves name / tg / bio / photo (no vacation fields).
 *   * "Настройки" pane carries vacation range + password vault. Vacation save
 *     fires `updateMaster` with vacationFrom / vacationUntil ONLY (no profile
 *     fields in the payload).
 *   * Non-editable origins (self_registered / invited_* without delegation)
 *     hide the Settings button and show the lock notice.
 *   * Visibility toggle calls `salon.setMasterPublicHidden`.
 *   * Delete inline confirm calls `salon.removeMaster`.
 *   * Password vault section is visible for salon_created with a vaulted
 *     password; absent for self_registered.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
          mutate: (vars: any, perCallOpts?: any) => {
            updateMutate(vars);
            opts?.onSuccess?.({ success: true });
            perCallOpts?.onSuccess?.({ success: true });
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
      // Password vault mutations — stubbed; dedicated MasterPasswordVault
      // test covers the OTP flow end-to-end.
      peekMasterPassword: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      resetMasterPassword: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    otp: {
      request: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

  it("Settings button is visible and opens the tabbed editor on Profile tab", () => {
    setMaster();
    renderModal();
    const settingsBtn = screen.getByTestId("master-detail-settings");
    fireEvent.click(settingsBtn);
    // TabBar present
    expect(screen.getByTestId("master-detail-tabbar")).toBeTruthy();
    // Profile tab is the default — name field must be present
    const nameInput = screen.getByTestId("master-detail-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Ольга");
  });

  it("Switching to Настройки tab shows vacation fields + password vault", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-settings"));
    fireEvent.click(screen.getByTestId("master-detail-tab-settings"));
    expect(screen.getByTestId("master-detail-vacation-section")).toBeTruthy();
    expect(screen.getByTestId("master-detail-vacation-from")).toBeTruthy();
    expect(screen.getByTestId("master-detail-vacation-save")).toBeTruthy();
    expect(screen.getByTestId("master-password-vault")).toBeTruthy();
  });

  it("Profile Save calls updateMaster with profile fields only (no vacation)", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-settings"));
    const nameInput = screen.getByTestId("master-detail-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Olga V" } });
    fireEvent.click(screen.getByTestId("master-detail-save"));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const call = updateMutate.mock.calls[0]![0];
    expect(call.tenantId).toBe("t_demo");
    expect(call.chatId).toBe(10_000_000_001);
    expect(call.name).toBe("Olga V");
    expect(call.bio).toBe("Top-tier nail tech");
    // The new contract: Profile pane does NOT touch vacation.
    expect(call).not.toHaveProperty("vacationFrom");
    expect(call).not.toHaveProperty("vacationUntil");
  });

  it("Vacation Save calls updateMaster with vacation fields only (no profile)", () => {
    // Pin "today" so the picker's initial visible month is deterministic.
    // May 1 2026 falls on a Friday — June 1..7 are visible as spillover in
    // the May grid, so we can pick 2026-06-01 without stepping months and
    // 2026-06-10 after exactly one next-month click.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    try {
      setMaster();
      renderModal();
      fireEvent.click(screen.getByTestId("master-detail-settings"));
      fireEvent.click(screen.getByTestId("master-detail-tab-settings"));

      // From picker
      const fromWrap = screen.getByTestId("master-detail-vacation-from");
      fireEvent.click(within(fromWrap).getByTestId("master-detail-vacation-from-trigger"));
      const fromCells = within(fromWrap)
        .getAllByTestId("master-detail-vacation-from-day")
        .filter((el) => el.getAttribute("data-iso") === "2026-06-01");
      expect(fromCells.length).toBe(1);
      fireEvent.click(fromCells[0]!);

      // Until picker — step to June, then click 2026-06-10
      const untilWrap = screen.getByTestId("master-detail-vacation-until");
      fireEvent.click(within(untilWrap).getByTestId("master-detail-vacation-until-trigger"));
      fireEvent.click(within(untilWrap).getByTestId("master-detail-vacation-until-next-month"));
      const untilCells = within(untilWrap)
        .getAllByTestId("master-detail-vacation-until-day")
        .filter(
          (el) =>
            el.getAttribute("data-iso") === "2026-06-10" &&
            el.getAttribute("data-in-month") === "1",
        );
      expect(untilCells.length).toBe(1);
      fireEvent.click(untilCells[0]!);

      fireEvent.click(screen.getByTestId("master-detail-vacation-save"));
      expect(updateMutate).toHaveBeenCalledTimes(1);
      const call = updateMutate.mock.calls[0]![0];
      expect(call.tenantId).toBe("t_demo");
      expect(call.chatId).toBe(10_000_000_001);
      expect(typeof call.vacationFrom).toBe("number");
      expect(typeof call.vacationUntil).toBe("number");
      expect(call.vacationUntil).toBeGreaterThan(call.vacationFrom);
      // The new contract: Vacation save does NOT touch profile fields.
      expect(call).not.toHaveProperty("name");
      expect(call).not.toHaveProperty("bio");
    } finally {
      vi.useRealTimers();
    }
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

  it("Back button returns from Settings to View mode", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-settings"));
    expect(screen.getByTestId("master-detail-tabbar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("master-detail-settings-back"));
    // Back to view → Settings CTA is visible again, TabBar gone
    expect(screen.getByTestId("master-detail-settings")).toBeTruthy();
    expect(screen.queryByTestId("master-detail-tabbar")).toBeNull();
  });
});

describe("MasterDetailModal — non-editable origins", () => {
  it("self_registered hides the Settings button and shows the lock notice", () => {
    setMaster({ origin: "self_registered", allowDelegation: 1 });
    renderModal();
    expect(screen.queryByTestId("master-detail-settings")).toBeNull();
    // Lock copy includes "сам и управляет" (matches the ru lock string)
    expect(screen.getByText(/самостоятельно|сам/i)).toBeTruthy();
  });

  it("invited_email without allowDelegation hides Settings + shows delegation notice", () => {
    setMaster({ origin: "invited_email", allowDelegation: 0 });
    renderModal();
    expect(screen.queryByTestId("master-detail-settings")).toBeNull();
    expect(screen.getByText(/делегиров/i)).toBeTruthy();
  });

  it("invited_email WITH allowDelegation=1 shows the Settings button", () => {
    setMaster({ origin: "invited_email", allowDelegation: 1 });
    renderModal();
    expect(screen.getByTestId("master-detail-settings")).toBeTruthy();
  });
});

describe("MasterDetailModal — password vault visibility", () => {
  it("salon_created with vaulted password renders the password vault inside Настройки", () => {
    setMaster();
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-settings"));
    fireEvent.click(screen.getByTestId("master-detail-tab-settings"));
    expect(screen.getByTestId("master-password-vault")).toBeTruthy();
    // Both action buttons present in idle state
    expect(screen.getByTestId("master-password-show")).toBeTruthy();
    expect(screen.getByTestId("master-password-reset")).toBeTruthy();
  });

  it("self_registered does not show the editor at all (no vault accessible)", () => {
    setMaster({ origin: "self_registered" });
    renderModal();
    // No way to open Settings for non-editable accounts
    expect(screen.queryByTestId("master-detail-settings")).toBeNull();
    expect(screen.queryByTestId("master-password-vault")).toBeNull();
  });

  it("salon_created WITHOUT vaulted password keeps Show enabled (bootstrap-on-peek flow takes over)", () => {
    // Post bootstrap-on-empty-vault landing: legacy accounts whose
    // password_encrypted blob is NULL no longer hit a dead-end. The Show
    // button stays interactive — clicking it surfaces a rotate-and-reveal
    // confirm before firing OTP. Reset stays enabled too (it's the
    // alternative path that emails the new password to the master instead
    // of revealing it to the salon owner).
    setMaster({ webUser: {
      email: "olga@manicbot.com",
      emailVerified: 1,
      lastLoginAt: null,
      hasVaultedPassword: false,
    }});
    renderModal();
    fireEvent.click(screen.getByTestId("master-detail-settings"));
    fireEvent.click(screen.getByTestId("master-detail-tab-settings"));
    const showBtn = screen.getByTestId("master-password-show") as HTMLButtonElement;
    const resetBtn = screen.getByTestId("master-password-reset") as HTMLButtonElement;
    expect(showBtn.disabled).toBe(false);
    expect(resetBtn.disabled).toBe(false);
  });
});
