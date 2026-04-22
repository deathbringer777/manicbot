/**
 * Tests for src/server/security/audit.ts
 *
 * Verifies writeAudit inserts a row, ctxIp extracts IP correctly,
 * and that errors are swallowed (non-blocking).
 */
import { describe, it, expect, vi } from "vitest";
import { writeAudit, ctxIp } from "../server/security/audit";

// ─── ctxIp ───────────────────────────────────────────────────────────────────
describe("ctxIp", () => {
  it("prefers cf-connecting-ip", () => {
    const h = new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" });
    expect(ctxIp({ headers: h })).toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for (first entry)", () => {
    const h = new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" });
    expect(ctxIp({ headers: h })).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no headers present", () => {
    expect(ctxIp({})).toBe("unknown");
    expect(ctxIp({ headers: null })).toBe("unknown");
  });
});

// ─── writeAudit ──────────────────────────────────────────────────────────────
describe("writeAudit", () => {
  it("calls db.insert with the correct values", async () => {
    const runMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ run: runMock });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    const db = { insert: insertMock } as any;

    await writeAudit(db, {
      actor: "admin@example.com",
      action: "export.users",
      tenantId: "t_abc",
      detail: "format=csv",
      ip: "1.2.3.4",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    const [auditLogTable] = insertMock.mock.calls[0]!;
    expect(auditLogTable).toBeDefined();

    const inserted = valuesMock.mock.calls[0]![0];
    expect(inserted.actor).toBe("admin@example.com");
    expect(inserted.action).toBe("export.users");
    expect(inserted.tenantId).toBe("t_abc");
    expect(inserted.detail).toBe("format=csv");
    expect(inserted.ip).toBe("1.2.3.4");
    expect(typeof inserted.createdAt).toBe("number");
  });

  it("does not throw when db.insert rejects (non-blocking)", async () => {
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error("D1 error")),
        }),
      }),
    } as any;

    // Should resolve without throwing
    await expect(writeAudit(db, { actor: null, action: "test" })).resolves.toBeUndefined();
  });
});
