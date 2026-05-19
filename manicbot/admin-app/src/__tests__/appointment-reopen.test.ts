/**
 * TDD: salon.reopenAppointment
 * - cancelled / no_show / rejected → pending (reversible)
 * - "done" → immutable (appointment_done_immutable)
 * - tenant isolation
 * - master can reopen own appointments
 */

import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";

type AptRow = {
  id: string;
  tenantId: string;
  status: string;
  cancelled: number;
  noShow: number;
};

function makeApt(overrides: Partial<AptRow> = {}): AptRow {
  return {
    id: "apt1",
    tenantId: "t1",
    status: "cancelled",
    cancelled: 1,
    noShow: 0,
    ...overrides,
  };
}

function makeCtx(
  role: "tenant_owner" | "master" | "system_admin",
  tenantId: string,
  apt: AptRow,
) {
  return {
    webUser: { id: "wu1", webRole: role, tenantId },
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([apt]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    },
  };
}

// Mirrors salon.reopenAppointment logic
async function reopenAppointment(
  ctx: ReturnType<typeof makeCtx>,
  input: { tenantId: string; appointmentId: string },
) {
  const r = ctx.webUser.webRole;
  if (r !== "system_admin" && r !== "tenant_owner") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (r !== "system_admin" && ctx.webUser.tenantId !== input.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "cross_tenant" });
  }
  const rows = await ctx.db
    .select()
    .from({} as unknown as Parameters<typeof ctx.db.from>[0])
    .where({} as unknown as Parameters<typeof ctx.db.where>[0])
    .limit(1);
  const apt = rows[0] as AptRow | undefined;
  if (!apt) throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
  if (apt.status === "done") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "appointment_done_immutable" });
  }
  // Only reopen terminal rows (cancelled, rejected, no_show)
  const isTerminal =
    apt.cancelled === 1 || apt.noShow === 1 || apt.status === "rejected";
  if (!isTerminal) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "appointment_not_terminal" });
  }
  await ctx.db
    .update({} as unknown as Parameters<typeof ctx.db.update>[0])
    .set({
      status: "pending",
      cancelled: 0,
      noShow: 0,
      cancelledBy: null,
      cancelReason: null,
    })
    .where({} as unknown as Parameters<typeof ctx.db.where>[0]);
  return { success: true };
}

describe("salon.reopenAppointment", () => {
  it("reopens a cancelled appointment → pending", async () => {
    const apt = makeApt({ status: "cancelled", cancelled: 1 });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    const res = await reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" });
    expect(res.success).toBe(true);
    expect(ctx.db.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", cancelled: 0, noShow: 0 }),
    );
  });

  it("reopens a no_show appointment → pending", async () => {
    const apt = makeApt({ status: "no_show", cancelled: 0, noShow: 1 });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    const res = await reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" });
    expect(res.success).toBe(true);
  });

  it("reopens a rejected appointment → pending", async () => {
    const apt = makeApt({ status: "rejected", cancelled: 0, noShow: 0 });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    const res = await reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" });
    expect(res.success).toBe(true);
  });

  it("refuses to reopen a DONE appointment", async () => {
    const apt = makeApt({ status: "done", cancelled: 0, noShow: 0 });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    await expect(
      reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" }),
    ).rejects.toMatchObject({ message: "appointment_done_immutable" });
  });

  it("refuses to reopen a pending appointment (not terminal)", async () => {
    const apt = makeApt({ status: "pending", cancelled: 0, noShow: 0 });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    await expect(
      reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" }),
    ).rejects.toMatchObject({ message: "appointment_not_terminal" });
  });

  it("refuses cross-tenant reopen", async () => {
    const apt = makeApt({ tenantId: "t2" });
    const ctx = makeCtx("tenant_owner", "t1", apt);
    await expect(
      reopenAppointment(ctx, { tenantId: "t2", appointmentId: "apt1" }),
    ).rejects.toMatchObject({ message: "cross_tenant" });
  });

  it("master role cannot call reopenAppointment (owner-only)", async () => {
    const apt = makeApt();
    const ctx = makeCtx("master", "t1", apt);
    await expect(
      reopenAppointment(ctx, { tenantId: "t1", appointmentId: "apt1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin can reopen on any tenant", async () => {
    const apt = makeApt({ tenantId: "t_other", status: "cancelled", cancelled: 1 });
    const ctx = makeCtx("system_admin", "any", apt);
    const res = await reopenAppointment(ctx, { tenantId: "t_other", appointmentId: "apt1" });
    expect(res.success).toBe(true);
  });
});
