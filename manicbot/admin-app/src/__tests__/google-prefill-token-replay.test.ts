/**
 * Security audit P0 (#1, 2026-05-24) — Google prefill replay protection.
 *
 * `webUsers.register` must reject a second consume of the same jti within
 * the 15-min TTL. The atomic claim is INSERT OR IGNORE on
 * `google_prefill_consumed`; the second call sees `returning()` come back
 * empty and throws the same error string as an invalid/expired token (so
 * an attacker can't distinguish replay from expiry).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test-secret-at-least-32-chars-long!!",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { webUsersRouter } from "~/server/api/routers/webUsers";
import { signGooglePrefillToken } from "~/server/auth/googlePrefillToken";

const AUTH_SECRET = "test-secret-at-least-32-chars-long!!";
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.RESEND_API_KEY = ""; // skip email verification path

const callerFactory = createCallerFactory(webUsersRouter);

/**
 * Minimal Drizzle stub tailored to webUsers.register.
 *
 * Behavioural switches:
 *   - claimReturning: array returned by the `googlePrefillConsumed` INSERT
 *     .returning() — empty array models a replay (jti already present).
 *   - existingWebUser: when true, the `select webUsers WHERE email=?` query
 *     returns one row (existing-email CONFLICT branch).
 */
function makeDb(opts: {
  existingWebUser?: boolean;
  claimReturning?: Array<{ jti: string }>;
}) {
  const calls: Array<{ op: string; table?: string }> = [];
  let selectCounter = 0;

  // Two select sites in register that route through this stub:
  //   1. checkRateLimit() → SELECT from rate_limits — return [] (no prior window).
  //   2. existing-email check → SELECT from web_users — return [] or [row]
  //      depending on opts.existingWebUser.
  // We disambiguate by call order — rate-limit always fires first.
  const selectChain = () => {
    const idx = selectCounter++;
    const rows = idx === 0 ? [] : (opts.existingWebUser ? [{ id: "existing-user-id" }] : []);
    const limit: any = {
      offset: () => Promise.resolve(rows),
      then: (r: any) => Promise.resolve(rows).then(r),
    };
    const chain: any = {
      from: (table: any) => {
        calls.push({ op: "select.from", table: table?.[Symbol.for("drizzle:Name")] });
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => limit,
      then: (r: any) => Promise.resolve(rows).then(r),
    };
    return chain;
  };

  const insertChain = (table: any) => {
    const tableName = table?.[Symbol.for("drizzle:Name")] ?? "unknown";
    calls.push({ op: "insert", table: tableName });

    // The full chain shape register / rate-limit might invoke:
    //   .values(...).onConflictDoNothing().returning()  (claim INSERT)
    //   .values(...).onConflictDoUpdate(...).run()      (rate-limit upsert)
    //   .values(...)                                    (plain INSERT)
    const valuesObj: any = {
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () =>
          tableName === "google_prefill_consumed"
            ? (opts.claimReturning ?? [{ jti: "x" }])
            : [],
        ),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
        then: (r: any) => Promise.resolve({ ok: true }).then(r),
      })),
      onConflictDoUpdate: vi.fn(() => ({
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
      returning: vi.fn(async () => [{ id: "inserted" }]),
      then: (resolve: any) => Promise.resolve({ ok: true }).then(resolve),
    };
    return { values: vi.fn(() => valuesObj) };
  };

  const deleteChain = () => ({
    where: vi.fn(() => ({
      run: vi.fn(async () => ({ meta: { changes: 0 } })),
      catch: vi.fn(),
      then: (r: any) => Promise.resolve({ ok: true }).then(r),
    })),
  });

  const updateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
        then: (r: any) => Promise.resolve({ ok: true }).then(r),
      })),
    })),
  });

  const db: any = {
    select: vi.fn(selectChain),
    insert: vi.fn(insertChain),
    update: vi.fn(updateChain),
    delete: vi.fn(deleteChain),
  };

  return { db, calls };
}

function makeCtx(db: any) {
  return {
    db,
    webUser: null,
    headers: new Headers({ "x-forwarded-for": "1.2.3.4" }),
  };
}

describe("webUsers.register — Google prefill replay (P0 #1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a second consume of the same token with the same error as expiry", async () => {
    const token = await signGooglePrefillToken(AUTH_SECRET, {
      email: "replay@example.com",
      name: "Replay User",
      sub: "google-sub-replay",
      ttlSec: 600,
      jti: "fixed-jti-for-test-1234",
    });

    // Second consume — claim INSERT OR IGNORE returns empty rowset
    // (jti already in google_prefill_consumed).
    const { db } = makeDb({ claimReturning: [] });
    const caller = callerFactory(makeCtx(db) as never);

    await expect(
      caller.register({
        email: "replay@example.com",
        role: "tenant_owner",
        lang: "en",
        tosAccepted: true,
        googlePrefillToken: token,
      } as never),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Invalid or expired Google sign-in"),
    });
  });

  it("passes the claim step on a fresh jti (insert chain called on google_prefill_consumed)", async () => {
    const token = await signGooglePrefillToken(AUTH_SECRET, {
      email: "first@example.com",
      name: "First User",
      sub: "google-sub-first",
      ttlSec: 600,
      jti: "fresh-jti-for-test-5678",
    });

    const { db, calls } = makeDb({
      claimReturning: [{ jti: "fresh-jti-for-test-5678" }],
    });
    const caller = callerFactory(makeCtx(db) as never);

    // We don't assert success of the full register — the mock doesn't model
    // every downstream insert. Instead we assert the claim INSERT happened
    // on the right table BEFORE the request would crash on something else.
    await caller.register({
      email: "first@example.com",
      role: "tenant_owner",
      lang: "en",
      tosAccepted: true,
      googlePrefillToken: token,
    } as never).catch(() => { /* downstream mock gaps are fine */ });

    const claimInserts = calls.filter(
      (c) => c.op === "insert" && c.table === "google_prefill_consumed",
    );
    expect(claimInserts.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects when the token has an invalid signature (no claim attempted)", async () => {
    const goodToken = await signGooglePrefillToken(AUTH_SECRET, {
      email: "invalid@example.com",
      name: null,
      sub: "google-sub",
      ttlSec: 600,
      jti: "any-jti",
    });
    const tampered = goodToken.slice(0, -4) + "xxxx";

    const { db, calls } = makeDb({ claimReturning: [{ jti: "any-jti" }] });
    const caller = callerFactory(makeCtx(db) as never);

    await expect(
      caller.register({
        email: "invalid@example.com",
        role: "tenant_owner",
        lang: "en",
        tosAccepted: true,
        googlePrefillToken: tampered,
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Tampered token must fail BEFORE reaching the claim INSERT.
    const claimInserts = calls.filter(
      (c) => c.op === "insert" && c.table === "google_prefill_consumed",
    );
    expect(claimInserts.length).toBe(0);
  });
});
