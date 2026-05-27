// @vitest-environment happy-dom
/**
 * MasterPasswordVaultSection — OTP-gated password peek + reset.
 *
 * Pins the contract the salon-owner-facing flow relies on:
 *   * Renders nothing actionable when origin != 'salon_created' or no
 *     web_user is linked — instead shows a short explanatory hint.
 *   * Idle → Show button fires `otp.request` with action="peek_master_password",
 *     payload={tenantId, masterChatId}, and an actionLabel that includes the
 *     master name.
 *   * After OTP issue, the code-entry input + Submit appear; Submit fires
 *     `salon.peekMasterPassword` with the typed code.
 *   * On success the plaintext is revealed inside a copy-friendly block.
 *   * Reset path requires a one-step confirm, then fires
 *     `otp.request` + `salon.resetMasterPassword`; on success it shows the
 *     masked email instead of any password text.
 *   * Without a vaulted password (`hasVaultedPassword=false`), Show is disabled
 *     and a hint nudges the owner toward Reset.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MasterPasswordVaultSection } from "~/components/salon/tabs/masters/MasterPasswordVaultSection";

const otpRequest = vi.fn();
const peekMutate = vi.fn();
const resetMutate = vi.fn();
// Mutable return value for the peekMasterPassword mock — lets a single test
// flip the server response (e.g. add `bootstrapped: true`) without re-mocking
// the whole trpc module.
let peekReturn: { password: string; bootstrapped?: boolean } = {
  password: "pw-fixture",
};
// Mutable OTP server response — lets a test override the email the server
// claims it sent the code to. The default mirrors the owner's address so
// the "sentTo display" tests can pin the source explicitly.
let otpRequestReturn: { otpId: string; sentTo: string } = {
  otpId: "otp_1",
  sentTo: "owner@manicbot.com",
};

vi.mock("~/trpc/react", () => ({
  api: {
    otp: {
      request: {
        useMutation: () => ({
          mutateAsync: (vars: any) => {
            otpRequest(vars);
            return Promise.resolve(otpRequestReturn);
          },
          isPending: false,
        }),
      },
    },
    salon: {
      peekMasterPassword: {
        useMutation: () => ({
          mutateAsync: (vars: any) => {
            peekMutate(vars);
            return Promise.resolve(peekReturn);
          },
          isPending: false,
        }),
      },
      resetMasterPassword: {
        useMutation: () => ({
          mutateAsync: (vars: any) => {
            resetMutate(vars);
            return Promise.resolve({ ok: true, emailSentTo: "o***a@manicbot.com" });
          },
          isPending: false,
        }),
      },
    },
  },
}));

function renderSection(overrides: Record<string, unknown> = {}) {
  const defaults = {
    tenantId: "t_demo",
    masterChatId: 10_000_000_001,
    masterName: "Ольга",
    origin: "salon_created",
    webUser: {
      email: "owner@manicbot.com",
      emailVerified: 1,
      hasVaultedPassword: true,
    },
    lang: "ru" as const,
    ...overrides,
  };
  return render(<MasterPasswordVaultSection {...(defaults as any)} />);
}

afterEach(() => {
  cleanup();
  otpRequest.mockClear();
  peekMutate.mockClear();
  resetMutate.mockClear();
  // Reset peek payload to the default for the next test.
  peekReturn = { password: "pw-fixture" };
  // Reset OTP response so per-test overrides don't leak.
  otpRequestReturn = { otpId: "otp_1", sentTo: "owner@manicbot.com" };
});

describe("MasterPasswordVaultSection — gating", () => {
  it("renders hint only when origin is not salon_created", () => {
    renderSection({ origin: "self_registered" });
    expect(screen.queryByTestId("master-password-show")).toBeNull();
    expect(screen.queryByTestId("master-password-reset")).toBeNull();
    expect(screen.getByText(/принадлеж|майстру|owns/i)).toBeTruthy();
  });

  it("renders hint when there is no linked web_user", () => {
    renderSection({ webUser: null });
    expect(screen.queryByTestId("master-password-show")).toBeNull();
  });

  it("keeps Show enabled when vault is empty — clicking surfaces a bootstrap confirm instead of disabling", async () => {
    renderSection({
      webUser: { email: "x@y", emailVerified: 1, hasVaultedPassword: false },
    });
    const show = screen.getByTestId("master-password-show") as HTMLButtonElement;
    const reset = screen.getByTestId("master-password-reset") as HTMLButtonElement;
    expect(show.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    // Empty-vault notice is rendered above the buttons.
    expect(screen.getByTestId("master-password-not-vaulted-hint")).toBeTruthy();

    // Clicking Show with an empty vault does NOT fire the OTP request — first
    // it surfaces a confirm card so the operator understands they're rotating.
    fireEvent.click(show);
    expect(otpRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId("master-password-bootstrap-confirm-card")).toBeTruthy();

    // Confirming fires the OTP request for peek (same flow — the procedure
    // bootstraps server-side when it sees an empty blob).
    fireEvent.click(screen.getByTestId("master-password-bootstrap-confirm"));
    await waitFor(() => expect(otpRequest).toHaveBeenCalledTimes(1));
    expect(otpRequest.mock.calls[0]![0].action).toBe("peek_master_password");
  });
});

describe("MasterPasswordVaultSection — empty-vault bootstrap reveal", () => {
  it("when server returns bootstrapped=false (vault already populated), no bootstrap hint", async () => {
    // peekReturn defaults to no bootstrap flag.
    renderSection({
      webUser: { email: "owner@manicbot.com", emailVerified: 1, hasVaultedPassword: false },
    });
    fireEvent.click(screen.getByTestId("master-password-show"));
    fireEvent.click(screen.getByTestId("master-password-bootstrap-confirm"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("master-password-otp-input"), {
      target: { value: "111111" },
    });
    fireEvent.click(screen.getByTestId("master-password-otp-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("master-password-reveal").textContent).toBe(
        "pw-fixture",
      );
    });
    expect(screen.queryByTestId("master-password-bootstrap-hint")).toBeNull();
  });

  it("when server signals bootstrapped=true, reveals the new password and shows the bootstrap hint", async () => {
    peekReturn = { password: "pw-bootstrap", bootstrapped: true };
    renderSection({
      webUser: { email: "owner@manicbot.com", emailVerified: 1, hasVaultedPassword: false },
    });

    fireEvent.click(screen.getByTestId("master-password-show"));
    fireEvent.click(screen.getByTestId("master-password-bootstrap-confirm"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("master-password-otp-input"), {
      target: { value: "222222" },
    });
    fireEvent.click(screen.getByTestId("master-password-otp-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("master-password-reveal").textContent).toBe(
        "pw-bootstrap",
      );
    });
    expect(screen.getByTestId("master-password-bootstrap-hint")).toBeTruthy();
  });
});

describe("MasterPasswordVaultSection — peek flow", () => {
  it("Show → requestOtp with correct action + payload + actionLabel", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(otpRequest).toHaveBeenCalledTimes(1));
    const call = otpRequest.mock.calls[0]![0];
    expect(call.action).toBe("peek_master_password");
    expect(call.payload).toEqual({
      tenantId: "t_demo",
      masterChatId: 10_000_000_001,
    });
    expect(call.actionLabel).toContain("Ольга");
  });

  it("After OTP issue, code input + Submit appear", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    expect(screen.getByTestId("master-password-otp-submit")).toBeTruthy();
  });

  it("Submitting a 6-digit code calls peekMasterPassword + reveals the plaintext", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    const input = screen.getByTestId("master-password-otp-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("master-password-otp-submit"));
    await waitFor(() => expect(peekMutate).toHaveBeenCalledTimes(1));
    expect(peekMutate.mock.calls[0]![0]).toEqual({
      tenantId: "t_demo",
      masterChatId: 10_000_000_001,
      otpCode: "123456",
    });
    await waitFor(() => {
      expect(screen.getByTestId("master-password-reveal").textContent).toBe("pw-fixture");
    });
  });

  it("Submit is disabled until the code reaches 6 digits", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    const submit = screen.getByTestId("master-password-otp-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const input = screen.getByTestId("master-password-otp-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12345" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(submit.disabled).toBe(false);
  });

  it("OTP input strips non-digits and caps at 6 chars", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    const input = screen.getByTestId("master-password-otp-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab34cd5678" } });
    expect(input.value).toBe("123456");
  });
});

describe("MasterPasswordVaultSection — 'Code sent to' display uses SERVER's authoritative recipient", () => {
  // Pre-fix regression: the UI rendered `webUser.email` from props (the
  // MASTER's synthetic *.salon.manicbot.local mailbox) instead of the
  // address the server actually emailed (the salon OWNER). User saw
  // "Kod wysłany na test.09di@salon.manicbot.local" — a non-existent
  // mailbox — and concluded the feature was broken even though the code
  // was correctly landing in their own inbox.

  it("after Show → otp.request, renders the SERVER's sentTo (owner email), NOT the master prop email", async () => {
    otpRequestReturn = { otpId: "otp_x", sentTo: "owner@manicbot.com" };
    renderSection({
      // Master's synthetic email — must NOT appear in the "code sent to" copy.
      webUser: {
        email: "test.09di@salon.manicbot.local",
        emailVerified: 1,
        hasVaultedPassword: true,
      },
    });
    fireEvent.click(screen.getByTestId("master-password-show"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    // The owner address must be visible.
    expect(screen.getByText(/owner@manicbot\.com/)).toBeTruthy();
    // The synthetic master address must NOT appear anywhere in the section.
    expect(screen.queryByText(/test\.09di@salon\.manicbot\.local/)).toBeNull();
  });

  it("reset flow: 'Code sent to' also uses the SERVER's sentTo for the OTP step", async () => {
    otpRequestReturn = { otpId: "otp_y", sentTo: "owner@manicbot.com" };
    renderSection({
      webUser: {
        email: "test.09di@salon.manicbot.local",
        emailVerified: 1,
        hasVaultedPassword: true,
      },
    });
    fireEvent.click(screen.getByTestId("master-password-reset"));
    fireEvent.click(screen.getByTestId("master-password-reset-confirm"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    expect(screen.getByText(/owner@manicbot\.com/)).toBeTruthy();
    expect(screen.queryByText(/test\.09di@salon\.manicbot\.local/)).toBeNull();
  });
});

describe("MasterPasswordVaultSection — reset flow", () => {
  it("Reset shows an inline confirm before firing the OTP request", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-reset"));
    // Request is NOT fired yet — first a confirm must be clicked
    expect(otpRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("master-password-reset-confirm"));
    await waitFor(() => expect(otpRequest).toHaveBeenCalledTimes(1));
    expect(otpRequest.mock.calls[0]![0].action).toBe("reset_master_password");
  });

  it("After OTP submit, resetMasterPassword is called + masked email shown", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("master-password-reset"));
    fireEvent.click(screen.getByTestId("master-password-reset-confirm"));
    await waitFor(() => expect(screen.getByTestId("master-password-otp-input")).toBeTruthy());
    const input = screen.getByTestId("master-password-otp-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "654321" } });
    fireEvent.click(screen.getByTestId("master-password-otp-submit"));
    await waitFor(() => expect(resetMutate).toHaveBeenCalledTimes(1));
    expect(resetMutate.mock.calls[0]![0]).toEqual({
      tenantId: "t_demo",
      masterChatId: 10_000_000_001,
      otpCode: "654321",
    });
    await waitFor(() => {
      expect(screen.getByText(/o\*\*\*a@manicbot\.com/)).toBeTruthy();
    });
    // No plaintext password revealed on reset
    expect(screen.queryByTestId("master-password-reveal")).toBeNull();
  });
});
