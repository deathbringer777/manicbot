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

vi.mock("~/trpc/react", () => ({
  api: {
    otp: {
      request: {
        useMutation: () => ({
          mutateAsync: (vars: any) => {
            otpRequest(vars);
            return Promise.resolve({ otpId: "otp_1" });
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
            return Promise.resolve({ password: "S3cretPass-XYZ" });
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

  it("disables Show when password is not vaulted, keeps Reset enabled", () => {
    renderSection({
      webUser: { email: "x@y", emailVerified: 1, hasVaultedPassword: false },
    });
    const show = screen.getByTestId("master-password-show") as HTMLButtonElement;
    const reset = screen.getByTestId("master-password-reset") as HTMLButtonElement;
    expect(show.disabled).toBe(true);
    expect(reset.disabled).toBe(false);
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
      expect(screen.getByTestId("master-password-reveal").textContent).toBe("S3cretPass-XYZ");
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
