/**
 * TDD: Worker bot "Add comment to appointment" callback.
 * Tests: saves note to D1, cross-user guard, terminal guard.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const APT_NOTE_PREFIX = "APT_ADD_NOTE_";
const MAX_NOTE_LEN = 500;
const STEP_APT_NOTE = "APT_NOTE";

/**
 * Simplified version of the CB.APT_ADD_NOTE handler logic.
 * Returns { ok, error?, nextStep? }
 */
async function handleAptAddNoteCallback(
  { aptId, callerChatId, ctx },
) {
  // Load appointment — must belong to caller and be active
  const apt = await ctx.loadApt(aptId);

  if (!apt) return { ok: false, error: "apt_not_found" };

  // Cross-user guard: only the booking owner can add a note
  if (apt.chatId !== callerChatId) {
    return { ok: false, error: "not_your_apt" };
  }

  // Terminal guard: can't add notes to past/cancelled appointments
  const terminalStatuses = ["cancelled", "rejected", "no_show", "done"];
  if (terminalStatuses.includes(apt.status) || apt.cancelled === 1) {
    return { ok: false, error: "apt_terminal" };
  }

  // Past guard: appointment time has passed
  const nowSec = Math.floor(Date.now() / 1000);
  if (apt.ts < nowSec) {
    return { ok: false, error: "apt_past" };
  }

  // Enter state STEP_APT_NOTE — next message from user will be the note
  await ctx.setState(callerChatId, { step: STEP_APT_NOTE, aptId });
  return { ok: true, nextStep: STEP_APT_NOTE };
}

/**
 * Simplified note-save handler (called when user sends message in STEP_APT_NOTE).
 */
async function handleAptNoteInput({ callerChatId, text, ctx }) {
  const state = await ctx.getState(callerChatId);
  if (state?.step !== STEP_APT_NOTE || !state?.aptId) {
    return { ok: false, error: "wrong_state" };
  }

  const trimmed = text.trim().slice(0, MAX_NOTE_LEN);

  // Re-verify ownership before writing
  const apt = await ctx.loadApt(state.aptId);
  if (!apt || apt.chatId !== callerChatId) {
    return { ok: false, error: "not_your_apt" };
  }

  await ctx.db
    .prepare("UPDATE appointments SET note=? WHERE id=? AND tenant_id=?")
    .bind(trimmed, state.aptId, apt.tenantId)
    .run();

  await ctx.clearState(callerChatId);
  return { ok: true, note: trimmed };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CB.APT_ADD_NOTE — callback handler", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  function makeCtx({ apt }) {
    const state = {};
    return {
      loadApt: vi.fn().mockResolvedValue(apt),
      setState: vi.fn().mockImplementation((chatId, s) => {
        state[chatId] = s;
        return Promise.resolve();
      }),
      getState: vi.fn().mockImplementation((chatId) => Promise.resolve(state[chatId])),
      clearState: vi.fn().mockResolvedValue(undefined),
      db: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ changes: 1 }),
          }),
        }),
      },
    };
  }

  it("enters STEP_APT_NOTE state for a valid pending appointment", async () => {
    const apt = { id: "a1", chatId: 100, status: "pending", cancelled: 0, ts: nowSec + 3600, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 100, ctx });
    expect(res.ok).toBe(true);
    expect(res.nextStep).toBe(STEP_APT_NOTE);
    expect(ctx.setState).toHaveBeenCalledWith(100, { step: STEP_APT_NOTE, aptId: "a1" });
  });

  it("enters STEP_APT_NOTE for a confirmed appointment", async () => {
    const apt = { id: "a1", chatId: 100, status: "confirmed", cancelled: 0, ts: nowSec + 3600, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 100, ctx });
    expect(res.ok).toBe(true);
  });

  it("rejects cross-user attempt (different chatId)", async () => {
    const apt = { id: "a1", chatId: 100, status: "pending", cancelled: 0, ts: nowSec + 3600, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 999, ctx });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_your_apt");
  });

  it("rejects cancelled appointment", async () => {
    const apt = { id: "a1", chatId: 100, status: "cancelled", cancelled: 1, ts: nowSec + 3600, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 100, ctx });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("apt_terminal");
  });

  it("rejects past appointment (ts < now)", async () => {
    const apt = { id: "a1", chatId: 100, status: "pending", cancelled: 0, ts: nowSec - 7200, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 100, ctx });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("apt_past");
  });

  it("rejects done appointment", async () => {
    const apt = { id: "a1", chatId: 100, status: "done", cancelled: 0, ts: nowSec - 3600, tenantId: "t1" };
    const ctx = makeCtx({ apt });
    const res = await handleAptAddNoteCallback({ aptId: "a1", callerChatId: 100, ctx });
    expect(res.ok).toBe(false);
    // Can be "apt_terminal" or "apt_past" — both are valid guards
    expect(["apt_terminal", "apt_past"]).toContain(res.error);
  });
});

describe("STEP_APT_NOTE — note input handler", () => {
  const nowSec = Math.floor(Date.now() / 1000);

  function makeNoteCtx({ apt }) {
    return {
      loadApt: vi.fn().mockResolvedValue(apt),
      getState: vi.fn().mockResolvedValue({ step: STEP_APT_NOTE, aptId: apt.id }),
      clearState: vi.fn().mockResolvedValue(undefined),
      db: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ changes: 1 }),
          }),
        }),
      },
    };
  }

  it("saves note to appointments table", async () => {
    const apt = { id: "a1", chatId: 100, tenantId: "t1" };
    const ctx = makeNoteCtx({ apt });
    const res = await handleAptNoteInput({ callerChatId: 100, text: "Без топа", ctx });
    expect(res.ok).toBe(true);
    expect(res.note).toBe("Без топа");
    expect(ctx.db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE appointments SET note=?"),
    );
  });

  it("truncates note at 500 chars", async () => {
    const apt = { id: "a1", chatId: 100, tenantId: "t1" };
    const ctx = makeNoteCtx({ apt });
    const longText = "x".repeat(600);
    const res = await handleAptNoteInput({ callerChatId: 100, text: longText, ctx });
    expect(res.ok).toBe(true);
    expect(String(res.note ?? "").length).toBe(MAX_NOTE_LEN);
  });

  it("clears state after saving", async () => {
    const apt = { id: "a1", chatId: 100, tenantId: "t1" };
    const ctx = makeNoteCtx({ apt });
    await handleAptNoteInput({ callerChatId: 100, text: "ok", ctx });
    expect(ctx.clearState).toHaveBeenCalledWith(100);
  });

  it("rejects if caller chatId doesn't match apt.chatId (re-verification)", async () => {
    const apt = { id: "a1", chatId: 100, tenantId: "t1" };
    const ctx = makeNoteCtx({ apt });
    const res = await handleAptNoteInput({ callerChatId: 999, text: "steal note", ctx });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_your_apt");
  });
});
