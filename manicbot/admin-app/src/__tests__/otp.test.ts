import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  canonicalize,
  hashPayload,
  generate6DigitCode,
  requestActionOtp,
  requireOtpConfirmation,
} from "~/server/auth/otp";

// ── Pure-logic primitives ────────────────────────────────────────────────────

describe("canonicalize", () => {
  it("returns same string regardless of key order (the whole point)", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("handles nested objects deterministically", () => {
    const a = { nested: { z: 1, a: 2 }, top: "x" };
    const b = { top: "x", nested: { a: 2, z: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("preserves array order (arrays are sequenced, not sets)", () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("handles primitives", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("x")).toBe('"x"');
  });
});

describe("hashPayload", () => {
  it("returns the same hash for differently-ordered keys", async () => {
    const h1 = await hashPayload({ tenantId: "t1", masterId: "m1" });
    const h2 = await hashPayload({ masterId: "m1", tenantId: "t1" });
    expect(h1).toBe(h2);
  });

  it("returns different hashes for different payloads", async () => {
    const h1 = await hashPayload({ masterId: "A" });
    const h2 = await hashPayload({ masterId: "B" });
    expect(h1).not.toBe(h2);
  });

  it("returns 64-char hex string (SHA-256)", async () => {
    const h = await hashPayload({ x: 1 });
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
});

describe("generate6DigitCode", () => {
  it("returns a 6-character zero-padded string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generate6DigitCode();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    }
  });

  it("produces varied output (not the same code 5 times in a row)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add(generate6DigitCode());
    // At least 2 distinct values in 5 draws — vanishingly small chance of false fail.
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ── In-memory DB stub for the request+verify flow ────────────────────────────
//
// The OTP helper takes a Drizzle-like `db` with `insert(...).values()`,
// `select().from().where().limit()`, and `update(...).set().where()`.
// We don't need a real DB to validate the logic — just a stub that
// mimics the surface area.

interface OtpRow {
  id: string;
  webUserId: string;
  action: string;
  payloadHash: string;
  codeHash: string;
  expiresAt: number;
  consumedAt: number | null;
  attempts: number;
  createdAt: number;
}

function makeDb() {
  const rows: OtpRow[] = [];
  return {
    rows,
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        rows.push({ ...(v as unknown as OtpRow), consumedAt: null });
      },
    }),
    select: () => ({
      from: () => ({
        where: (predicate: WherePred) => ({
          limit: async (_n: number) => {
            // The OTP helper passes an `and(eq(...), eq(...), eq(...))` shape.
            // The stub's `eq` and `and` capture the (col, val) pairs as a flat
            // map; we match all-or-nothing.
            const match = rows.filter((r) => predicate.match(r));
            return match.slice(0, 1);
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: Partial<OtpRow>) => ({
        where: async (predicate: WherePred) => {
          for (const r of rows) {
            if (predicate.match(r)) Object.assign(r, v);
          }
        },
      }),
    }),
  };
}

// Tiny shim of drizzle's `eq` / `and` for the stub. The OTP helper imports the
// real ones, but at runtime they just return predicate objects. We re-mock at
// the module level so the helper's `eq(col, val)` returns something our stub
// understands.
type WherePred = { match: (r: OtpRow) => boolean };

vi.mock("drizzle-orm", async () => {
  const realModule = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...realModule,
    eq: (col: { name: string }, val: unknown): WherePred => ({
      match: (r: OtpRow) => {
        // Drizzle column → row key mapping. The column name on the Drizzle
        // schema lookup objects is the SQL column name; row keys above are
        // camelCase. Map the known fields used by the OTP helper.
        const map: Record<string, keyof OtpRow> = {
          web_user_id: "webUserId",
          action: "action",
          payload_hash: "payloadHash",
          id: "id",
        };
        const colName = (col as { name?: string }).name;
        if (!colName) return false;
        const key = map[colName];
        if (!key) return false;
        return r[key] === val;
      },
    }),
    and: (...preds: WherePred[]): WherePred => ({
      match: (r: OtpRow) => preds.every((p) => p.match(r)),
    }),
  };
});

import { vi } from "vitest";

describe("requestActionOtp + requireOtpConfirmation", () => {
  it("happy path: request → verify with correct code → consumed", async () => {
    const db = makeDb();
    const { code, otpId } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { tenantId: "t1", masterId: "m1" },
    });
    expect(otpId).toBeTruthy();
    expect(code).toHaveLength(6);

    await requireOtpConfirmation({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { tenantId: "t1", masterId: "m1" },
      code,
    });

    // Row is marked consumed
    expect(db.rows[0]!.consumedAt).not.toBeNull();
  });

  it("rejects wrong code with otp_invalid + increments attempts", async () => {
    const db = makeDb();
    await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
    });
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "m1" },
        code: "000000",
      }),
    ).rejects.toThrow("otp_invalid");
    expect(db.rows[0]!.attempts).toBe(1);
  });

  it("rejects expired code with otp_expired", async () => {
    const db = makeDb();
    const { code } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
      now: 1000,
    });
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "m1" },
        code,
        now: 1000 + 16 * 60, // past 15-min TTL
      }),
    ).rejects.toThrow("otp_expired");
  });

  it("rejects replay (consumed row) with otp_consumed", async () => {
    const db = makeDb();
    const { code } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
    });
    await requireOtpConfirmation({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
      code,
    });
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "m1" },
        code,
      }),
    ).rejects.toThrow("otp_consumed");
  });

  it("rejects when no row exists with otp_required", async () => {
    const db = makeDb();
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "m1" },
        code: "123456",
      }),
    ).rejects.toThrow("otp_required");
  });

  it("rejects mismatched payload (binding works) with otp_required", async () => {
    const db = makeDb();
    const { code } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "A" },
    });
    // Same code, same action, DIFFERENT payload → no matching row → otp_required
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "B" },
        code,
      }),
    ).rejects.toThrow("otp_required");
  });

  it("rejects mismatched action (binding works) with otp_required", async () => {
    const db = makeDb();
    const { code } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
    });
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "reset_master_password",
        payload: { masterId: "m1" },
        code,
      }),
    ).rejects.toThrow("otp_required");
  });

  it("rejects exhausted attempts with otp_exhausted", async () => {
    const db = makeDb();
    const { code } = await requestActionOtp({
      db,
      webUserId: "u1",
      action: "archive_master",
      payload: { masterId: "m1" },
    });
    // Use up the 5-attempt budget with wrong codes
    for (let i = 0; i < 5; i++) {
      await expect(
        requireOtpConfirmation({
          db,
          webUserId: "u1",
          action: "archive_master",
          payload: { masterId: "m1" },
          code: "000000",
        }),
      ).rejects.toThrow("otp_invalid");
    }
    // 6th attempt — even with the CORRECT code — fails with exhausted
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "archive_master",
        payload: { masterId: "m1" },
        code,
      }),
    ).rejects.toThrow("otp_exhausted");
  });

  it("throws TRPCError (not plain Error) so tRPC can propagate code/message", async () => {
    const db = makeDb();
    await expect(
      requireOtpConfirmation({
        db,
        webUserId: "u1",
        action: "x",
        payload: {},
        code: "",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
