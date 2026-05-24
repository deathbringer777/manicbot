// @vitest-environment happy-dom
/**
 * RetentionFlow RTL tests (migration 0086).
 *
 * Verifies the 3-stage state machine:
 *   * Stage 1 (offer)  — accept routes to acceptRetentionOffer; decline → Stage 2
 *   * Stage 2 (reason) — at least 1 reason required to advance; photo upload chip
 *   * Stage 3 (confirm) — explicit red confirm calls confirmCancellation
 *
 * ESC behaviour: closes on Stage 1/2 but NOT Stage 3.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// Capture mutation invocations so we can assert downstream effects.
const requestMut = vi.fn();
const acceptMut = vi.fn();
const confirmMut = vi.fn();
const mintTokenMut = vi.fn();

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("~/lib/toast", () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
  },
}));

vi.mock("~/lib/uploadAsset", () => ({
  UPLOAD_ACCEPT_MIME: ["image/png", "image/jpeg", "image/webp"],
  uploadAssetFile: vi.fn(async () => ({
    ok: true,
    key: "k",
    url: "https://worker.test/r2/t/t_demo/cancellation_feedback-abc.png",
  })),
  validateUploadFile: vi.fn(() => null),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    billing: {
      requestCancellation: {
        useMutation: () => ({
          mutateAsync: requestMut,
          isPending: false,
        }),
      },
      acceptRetentionOffer: {
        useMutation: () => ({
          mutateAsync: acceptMut,
          isPending: false,
        }),
      },
      confirmCancellation: {
        useMutation: () => ({
          mutateAsync: confirmMut,
          isPending: false,
        }),
      },
    },
    salon: {
      mintUploadToken: {
        useMutation: () => ({
          mutateAsync: mintTokenMut,
          isPending: false,
        }),
      },
    },
  },
}));

// Pull in component AFTER mocks are registered.
import { RetentionFlow } from "~/components/billing/RetentionFlow";

function renderFlow(extraProps: Partial<React.ComponentProps<typeof RetentionFlow>> = {}) {
  const onClose = vi.fn();
  const onCancelled = vi.fn();
  const onRetained = vi.fn();
  render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <RetentionFlow
        tenantId="t_demo"
        onClose={onClose}
        onCancelled={onCancelled}
        onRetained={onRetained}
        {...extraProps}
      />
    </LangContext.Provider>,
  );
  return { onClose, onCancelled, onRetained };
}

const ELIGIBLE_RESPONSE = {
  eligibleForOffer: true,
  offerType: "monthly_50_3m",
  currentPlan: "pro",
  currentInterval: "month",
  stripeSubId: "sub_demo",
};

const COOLDOWN_RESPONSE = {
  eligibleForOffer: false,
  offerType: null,
  currentPlan: "pro",
  currentInterval: "month",
  stripeSubId: "sub_demo",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ─── Stage 1 → Stage 2 transition ────────────────────────────────────────────

describe("RetentionFlow — Stage 1 (offer)", () => {
  it("renders the offer card when the user is eligible", async () => {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    expect(screen.getByTestId("offer-accept-btn").textContent).toMatch(/Принять предложение/);
    expect(screen.getByTestId("offer-decline-btn").textContent).toMatch(/Всё равно отменить/);
  });

  it("skips Stage 1 when the user is in cooldown", async () => {
    requestMut.mockResolvedValueOnce(COOLDOWN_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-reason")).toBeTruthy());
    expect(screen.queryByTestId("stage-offer")).toBeNull();
  });

  it("accepting the offer calls acceptRetentionOffer with the matching offerType + closes", async () => {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    acceptMut.mockResolvedValueOnce({
      applied: true,
      couponCode: "RETENTION_MONTHLY_50_3M",
      percentOff: 50,
    });

    const { onClose, onRetained } = renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());

    fireEvent.click(screen.getByTestId("offer-accept-btn"));
    await waitFor(() => expect(acceptMut).toHaveBeenCalled());

    expect(acceptMut).toHaveBeenCalledWith({
      tenantId: "t_demo",
      offerType: "monthly_50_3m",
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(onRetained).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("declining the offer advances to Stage 2 without firing any mutation", async () => {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());

    fireEvent.click(screen.getByTestId("offer-decline-btn"));
    expect(screen.queryByTestId("stage-reason")).toBeTruthy();
    expect(acceptMut).not.toHaveBeenCalled();
    expect(confirmMut).not.toHaveBeenCalled();
  });

  it("renders the annual offer heading when offerType=annual_25_1y", async () => {
    requestMut.mockResolvedValueOnce({
      ...ELIGIBLE_RESPONSE,
      offerType: "annual_25_1y",
      currentInterval: "year",
    });
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    expect(screen.getByText(/-25%/)).toBeTruthy();
  });
});

// ─── Stage 2 advance gate ───────────────────────────────────────────────────

describe("RetentionFlow — Stage 2 (reason)", () => {
  async function getToReason(): Promise<void> {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("offer-decline-btn"));
  }

  it("Next is disabled until at least 1 reason is checked", async () => {
    await getToReason();
    const next = screen.getByTestId("reason-next-btn") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("reason-too_expensive"));
    expect(next.disabled).toBe(false);
  });

  it("can check multiple reasons", async () => {
    await getToReason();
    fireEvent.click(screen.getByTestId("reason-too_expensive"));
    fireEvent.click(screen.getByTestId("reason-no_clients"));
    expect((screen.getByTestId("reason-too_expensive") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("reason-no_clients") as HTMLInputElement).checked).toBe(true);
  });

  it("free text counter updates", async () => {
    await getToReason();
    const ta = screen.getByTestId("reason-free-text");
    fireEvent.change(ta, { target: { value: "test feedback" } });
    expect(screen.getByText(/13\/2000/)).toBeTruthy();
  });

  it("photo upload chip renders before upload", async () => {
    await getToReason();
    expect(screen.getByTestId("reason-photo-add")).toBeTruthy();
    expect(screen.queryByTestId("reason-photo-remove")).toBeNull();
  });

  it("photo upload happy path → chip switches to preview + remove", async () => {
    mintTokenMut.mockResolvedValueOnce({
      uploadUrl: "https://worker.test/upload/asset?t=tok",
    });
    await getToReason();

    const fileInput = screen.getByTestId("reason-photo-input") as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });
    // happy-dom doesn't synthesize a real File on the input — we have to set
    // it via a defined property.
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);

    await waitFor(() => expect(screen.queryByTestId("reason-photo-remove")).toBeTruthy());
    expect(mintTokenMut).toHaveBeenCalledWith({
      tenantId: "t_demo",
      kind: "cancellation_feedback",
    });
  });

  it("Back from Stage 2 returns to Stage 1 (when offer was shown)", async () => {
    await getToReason();
    fireEvent.click(screen.getByTestId("reason-back-btn"));
    expect(screen.queryByTestId("stage-offer")).toBeTruthy();
  });

  it("Back from Stage 2 closes the modal when there was no offer (cooldown)", async () => {
    requestMut.mockResolvedValueOnce(COOLDOWN_RESPONSE);
    const { onClose } = renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-reason")).toBeTruthy());
    fireEvent.click(screen.getByTestId("reason-back-btn"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ─── Stage 3 confirm ────────────────────────────────────────────────────────

describe("RetentionFlow — Stage 3 (confirm)", () => {
  async function getToConfirm(): Promise<void> {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("offer-decline-btn"));
    fireEvent.click(screen.getByTestId("reason-too_expensive"));
    fireEvent.click(screen.getByTestId("reason-next-btn"));
    await waitFor(() => expect(screen.queryByTestId("stage-confirm")).toBeTruthy());
  }

  it("confirm calls confirmCancellation with the right payload", async () => {
    confirmMut.mockResolvedValueOnce({ ok: true, cancelAt: 1234567890 });
    await getToConfirm();

    fireEvent.click(screen.getByTestId("confirm-yes-btn"));
    await waitFor(() => expect(confirmMut).toHaveBeenCalled());

    expect(confirmMut).toHaveBeenCalledWith({
      tenantId: "t_demo",
      reasonTags: ["too_expensive"],
      freeText: undefined,
      photoUrl: undefined,
      retentionOfferShown: true,
    });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("Back from confirm returns to Stage 2", async () => {
    await getToConfirm();
    fireEvent.click(screen.getByTestId("confirm-back-btn"));
    expect(screen.queryByTestId("stage-reason")).toBeTruthy();
  });

  it("ESC does NOT close the modal on Stage 3", async () => {
    // Get to Stage 3 within a single render so we can assert the onClose
    // captured by THIS render isn't called.
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    const onClose = vi.fn();
    render(
      <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
        <RetentionFlow tenantId="t_demo" onClose={onClose} />
      </LangContext.Provider>,
    );
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("offer-decline-btn"));
    fireEvent.click(screen.getByTestId("reason-too_expensive"));
    fireEvent.click(screen.getByTestId("reason-next-btn"));
    await waitFor(() => expect(screen.queryByTestId("stage-confirm")).toBeTruthy());

    // On Stage 3 the close button (X) is hidden — the user must use the
    // explicit Back / Yes-cancel buttons.
    expect(screen.queryByTestId("retention-flow-close")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    // Modal is still on Stage 3 (didn't close)
    expect(screen.queryByTestId("stage-confirm")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the overlay backdrop does NOT close on Stage 3", async () => {
    await getToConfirm();
    fireEvent.click(screen.getByTestId("retention-flow-overlay"));
    // Still on Stage 3 — overlay click is no-op
    expect(screen.queryByTestId("stage-confirm")).toBeTruthy();
  });

  it("ESC closes the modal on Stage 1", async () => {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    const { onClose } = renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ESC closes the modal on Stage 2", async () => {
    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    const { onClose } = renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("offer-decline-btn"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("confirmation submit includes free_text and photoUrl when provided", async () => {
    mintTokenMut.mockResolvedValueOnce({
      uploadUrl: "https://worker.test/upload/asset?t=tok",
    });
    confirmMut.mockResolvedValueOnce({ ok: true, cancelAt: 1234567890 });

    requestMut.mockResolvedValueOnce(ELIGIBLE_RESPONSE);
    renderFlow();
    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("offer-decline-btn"));
    fireEvent.click(screen.getByTestId("reason-confusing_ui"));
    fireEvent.change(screen.getByTestId("reason-free-text"), {
      target: { value: "Buttons are tiny" },
    });

    const fileInput = screen.getByTestId("reason-photo-input") as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
      type: "image/png",
    });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.queryByTestId("reason-photo-remove")).toBeTruthy());

    fireEvent.click(screen.getByTestId("reason-next-btn"));
    await waitFor(() => expect(screen.queryByTestId("stage-confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("confirm-yes-btn"));

    await waitFor(() => expect(confirmMut).toHaveBeenCalled());
    const payload = confirmMut.mock.calls[0]?.[0] as {
      reasonTags: string[];
      freeText?: string;
      photoUrl?: string;
    } | undefined;
    expect(payload).toBeDefined();
    expect(payload!.reasonTags).toContain("confusing_ui");
    expect(payload!.freeText).toBe("Buttons are tiny");
    expect(payload!.photoUrl).toMatch(/cancellation_feedback/);
  });
});
