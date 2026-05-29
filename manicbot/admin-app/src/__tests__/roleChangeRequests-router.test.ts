/**
 * roleChangeRequests router — auth gate + email-OTP confirmation.
 *
 * A role / ownership change is a sensitive action: it must be confirmed with a
 * one-time code emailed to the user's CURRENT account address (reusing the
 * global_otp_codes framework, action "change_role"). Pins:
 *   - protectedProcedure auth gate (unauth → UNAUTHORIZED)
 *   - otpCode is a required input (missing → BAD_REQUEST at the zod boundary)
 *   - no issued code → requireOtpConfirmation throws PRECONDITION_FAILED
 *   - source-pin: the mutation is wired through requireOtpConfirmation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { roleChangeRequestsRouter } from "~/server/api/routers/roleChangeRequests";
import {
  createDbMock,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(roleChangeRequestsRouter);

describe("roleChangeRequests.requestRoleChange — auth + OTP gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.requestRoleChange({
        requestedRole: "master",
        otpCode: "123456",
      } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires an otpCode (input boundary)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.requestRoleChange({ requestedRole: "master" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when no matching OTP was issued (otp_required)", async () => {
    // Empty DB → the global_otp_codes lookup finds nothing → PRECONDITION_FAILED.
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.requestRoleChange({
        requestedRole: "master",
        otpCode: "123456",
      } as never),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("source pin: gated via requireOtpConfirmation(action: change_role)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/roleChangeRequests.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /requireOtpConfirmation\(\{[\s\S]*?action:\s*"change_role"/,
    );
  });
});
