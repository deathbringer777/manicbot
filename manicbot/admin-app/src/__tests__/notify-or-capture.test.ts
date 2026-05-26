/**
 * notifyOrCapture — unit tests for the shared notify-and-capture wrapper.
 *
 * Covers three contracts:
 *   1. Happy path returns `{ bellQueued: true }`, no captureError.
 *   2. Opt-out returns `{ bellQueued: true, bellSkippedByPrefs: true }`,
 *      no captureError (opt-out is a legitimate user choice).
 *   3. notifyWebUser failure returns `{ bellQueued: false, bellError }`
 *      AND fires captureError with the expected errorType + context.
 *   4. A throw from notifyWebUser is caught (defensive — notifyWebUser
 *      itself swallows internal throws, but the wrapper must not regress
 *      if a future refactor stops doing that).
 *   5. A throw from captureError is caught — sidecar must never break
 *      the caller's primary mutation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type MockNotifyResult = {
  ok: boolean;
  id: string | null;
  deduped?: boolean;
  skippedByPrefs?: boolean;
  error?: string;
};
const notifyWebUserMock = vi.fn<(...args: unknown[]) => Promise<MockNotifyResult>>();
const captureErrorMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; id?: number }>>(
  async () => ({ ok: true, id: 1 }),
);

vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: (...args: unknown[]) => notifyWebUserMock(...args),
}));

vi.mock("~/server/utils/captureError", () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

import { notifyOrCapture } from "~/server/services/notifyOrCapture";

const FAKE_DB = {} as never;

describe("notifyOrCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bellQueued=true on happy path and does NOT call captureError", async () => {
    notifyWebUserMock.mockResolvedValueOnce({ ok: true, id: "n_x" });

    const out = await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "master.invite",
        title: "Test",
        tenantId: "t_demo",
        sourceSlug: "master_invitations",
        sourceId: "inv_1",
      },
      { path: "salon.sendMasterInvitation", userId: "w_caller" },
    );

    expect(out).toEqual({ bellQueued: true });
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("returns bellQueued=true + bellSkippedByPrefs when invitee opted out (no captureError)", async () => {
    notifyWebUserMock.mockResolvedValueOnce({ ok: true, id: null, skippedByPrefs: true });

    const out = await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "master.invite",
        title: "Test",
        tenantId: "t_demo",
      },
      { path: "salon.sendMasterInvitation" },
    );

    expect(out).toEqual({ bellQueued: true, bellSkippedByPrefs: true });
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("returns bellQueued=false + bellError + calls captureError on notifyWebUser failure", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: false,
      id: null,
      error: "db_insert_failed",
    });

    const out = await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "master.invite",
        title: "Test",
        tenantId: "t_demo",
        sourceSlug: "master_invitations",
        sourceId: "inv_1",
      },
      {
        path: "salon.sendMasterInvitation",
        userId: "w_caller",
        extraContext: { invitationId: "inv_1", scenario: "existing_user" },
      },
    );

    expect(out).toEqual({ bellQueued: false, bellError: "db_insert_failed" });
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, payload] = captureErrorMock.mock.calls[0]! as unknown as [
      unknown,
      {
        errorType: string;
        severity: string;
        tenantId: string | null;
        userId: string | null;
        path: string;
        context: Record<string, unknown>;
      },
    ];
    expect(payload.errorType).toBe("notify.bell_write_failed");
    expect(payload.severity).toBe("error");
    expect(payload.tenantId).toBe("t_demo");
    expect(payload.userId).toBe("w_caller");
    expect(payload.path).toBe("salon.sendMasterInvitation");
    expect(payload.context).toMatchObject({
      webUserId: "w_target",
      kind: "master.invite",
      reason: "db_insert_failed",
      sourceSlug: "master_invitations",
      sourceId: "inv_1",
      invitationId: "inv_1",
      scenario: "existing_user",
    });
  });

  it("catches an internal notifyWebUser throw and reports notify_threw", async () => {
    notifyWebUserMock.mockRejectedValueOnce(new Error("binding torn down"));

    const out = await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "master.invite",
        title: "Test",
        tenantId: "t_demo",
      },
      { path: "salon.sendMasterInvitation" },
    );

    expect(out).toEqual({ bellQueued: false, bellError: "notify_threw" });
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when captureError itself fails (sidecar contract)", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: false,
      id: null,
      error: "db_insert_failed",
    });
    captureErrorMock.mockRejectedValueOnce(new Error("D1 unavailable"));

    const out = await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "master.invite",
        title: "Test",
        tenantId: "t_demo",
      },
      { path: "salon.sendMasterInvitation" },
    );

    expect(out).toEqual({ bellQueued: false, bellError: "db_insert_failed" });
  });

  it("falls back tenantId=null when caller omits it", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: false,
      id: null,
      error: "db_insert_failed",
    });

    await notifyOrCapture(
      FAKE_DB,
      {
        webUserId: "w_target",
        kind: "system.test",
        title: "Test",
      },
      { path: "test.path" },
    );

    const [, payload] = captureErrorMock.mock.calls[0]! as unknown as [
      unknown,
      { tenantId: string | null },
    ];
    expect(payload.tenantId).toBeNull();
  });
});
