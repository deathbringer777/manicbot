/**
 * marketingSync helper — unified contact directory.
 *
 * The helper is the seam between the Salon Clients tab and the Marketing
 * module: every client create/update writes through it. These tests pin
 * the contract that:
 *
 *   * Lookup priority is email > phone > tg > ig within the tenant.
 *   * Match merges non-null user fields into empty marketing fields,
 *     bumps leadCount, refreshes lastSeenAt, and stamps linkedUserChatId.
 *   * Miss inserts a fresh row with `consent_email=0, consent_sms=0` —
 *     this is a *directory* sync, never an opt-in.
 *   * Empty contact (no email/phone/tg/ig) returns null without writing.
 *   * Normalization is idempotent: `"+48 500"` ≡ `"+48500"`,
 *     `"@User"` ≡ `"user"`, `"FOO@BAR.COM"` ≡ `"foo@bar.com"`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncMarketingContact } from "~/server/clients/marketingSync";

interface SelectCall {
  // sequence of select() call results to return, oldest first.
  results: unknown[];
}

function buildDb(selectResults: unknown[][]) {
  const state: SelectCall = { results: [...selectResults] };
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];
  const insertCalls: Array<{ values: Record<string, unknown> }> = [];

  const db = {
    select: vi.fn(() => {
      const queued = state.results.shift() ?? [];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(queued),
        then: (resolve: any, reject?: any) => Promise.resolve(queued).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertCalls.push({ values: vals });
        return {
          returning: vi.fn().mockResolvedValue([{ id: 42 }]),
          then: (resolve: any) => Promise.resolve([{ id: 42 }]).then(resolve),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updateCalls.push({ set: vals });
        return {
          where: vi.fn().mockResolvedValue({ ok: true }),
        };
      }),
    })),
  };
  return { db, updateCalls, insertCalls };
}

describe("syncMarketingContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when client has no usable contact", async () => {
    const { db, insertCalls, updateCalls } = buildDb([]);
    const id = await syncMarketingContact(db, "t_demo", { chatId: 1 }, "salon_clients_manual");
    expect(id).toBeNull();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("inserts a new contact when no match found, email-only", async () => {
    // 1 select (email lookup) returns []
    const { db, insertCalls } = buildDb([[]]);
    const id = await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 7, email: "Foo@Bar.COM", name: "Foo" },
      "salon_clients_manual",
      1700000000,
    );
    expect(id).toBe(42);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.values).toMatchObject({
      email: "foo@bar.com",        // normalized
      name: "Foo",
      tenantId: "t_demo",
      source: "salon_clients_manual",
      consentEmail: 0,             // CRITICAL: directory sync, no opt-in
      consentSms: 0,
      linkedUserChatId: 7,
      firstSeenAt: 1700000000,
      lastSeenAt: 1700000000,
      leadCount: 1,
    });
  });

  it("inserts new contact phone-only (no email), normalized digits + leading plus", async () => {
    const { db, insertCalls } = buildDb([[]]); // phone lookup miss
    await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 8, phone: "+48 500 152-948", name: "Татьяна" },
      "salon_clients_import",
    );
    expect(insertCalls[0]!.values.email).toBeNull();
    expect(insertCalls[0]!.values.phone).toBe("+48500152948");
    expect(insertCalls[0]!.values.source).toBe("salon_clients_import");
  });

  it("stores tg_username and ig_username in custom_fields JSON when no email/phone", async () => {
    // Both tg and ig lookup misses (1 select for tg, 1 for ig).
    const { db, insertCalls } = buildDb([[], []]);
    await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 9, tgUsername: "@Karina", igUsername: "@KAR_NAILS" },
      "salon_clients_manual",
    );
    expect(insertCalls).toHaveLength(1);
    const customFields = insertCalls[0]!.values.customFields as string;
    expect(customFields).toBeTruthy();
    const parsed = JSON.parse(customFields);
    expect(parsed).toEqual({ tg_username: "karina", ig_username: "kar_nails" });
  });

  it("matches existing row by email (lookup priority 1), merges name when marketing is empty", async () => {
    const existing = {
      id: 11,
      email: "kar@nails.com",
      phone: null,
      name: null,        // empty → user-side will fill
      customFields: null,
      linkedUserChatId: null,
      leadCount: 2,
    };
    const { db, insertCalls, updateCalls } = buildDb([[existing]]);
    const id = await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 99, email: "Kar@Nails.com", name: "Karina" },
      "salon_clients_manual",
    );
    expect(id).toBe(11);
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.set).toMatchObject({
      leadCount: 3,
      linkedUserChatId: 99,    // was null, set to current user
      name: "Karina",          // was null, filled from user
    });
    // Email not overwritten because it was already present.
    expect(updateCalls[0]!.set.email).toBeUndefined();
  });

  it("never overwrites existing marketing fields with user-side values", async () => {
    const existing = {
      id: 12,
      email: "old@email.com",
      phone: "+48999999999",
      name: "Curated Name",
      customFields: null,
      linkedUserChatId: 55,
      leadCount: 5,
    };
    const { db, updateCalls } = buildDb([[existing]]);
    await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 99, email: "old@email.com", phone: "+48 111 222 333", name: "Different Name" },
      "salon_clients_manual",
    );
    // Name / phone preserved — only lastSeenAt/leadCount move.
    expect(updateCalls[0]!.set.name).toBeUndefined();
    expect(updateCalls[0]!.set.phone).toBeUndefined();
    expect(updateCalls[0]!.set.linkedUserChatId).toBe(55); // existing wins
    expect(updateCalls[0]!.set.leadCount).toBe(6);
  });

  it("falls through email → phone → tg → ig lookup chain", async () => {
    // email empty → miss
    // phone empty → miss
    // tg lookup miss
    // ig lookup hit
    const igMatch = {
      id: 13,
      email: null,
      phone: null,
      name: null,
      customFields: '{"ig_username":"kar"}',
      linkedUserChatId: null,
      leadCount: 1,
    };
    const { db, updateCalls } = buildDb([[], [igMatch]]); // tg miss + ig hit (email + phone skipped — no value)
    const id = await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 50, tgUsername: "ghost", igUsername: "kar" },
      "salon_clients_manual",
    );
    expect(id).toBe(13);
    expect(updateCalls).toHaveLength(1);
  });

  it("preserves existing custom_fields keys when merging tg/ig", async () => {
    const existing = {
      id: 14,
      email: "x@y.com",
      phone: null,
      name: null,
      customFields: '{"some_other_key":"keep_me"}',
      linkedUserChatId: null,
      leadCount: 1,
    };
    const { db, updateCalls } = buildDb([[existing]]);
    await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 7, email: "X@Y.COM", tgUsername: "newtg" },
      "salon_clients_manual",
    );
    const merged = JSON.parse(updateCalls[0]!.set.customFields as string);
    expect(merged.some_other_key).toBe("keep_me");
    expect(merged.tg_username).toBe("newtg");
  });

  it("does not write to marketing_consent_log (consent stays 0/0 on insert)", async () => {
    // The helper only touches marketing_contacts. Consent log writes
    // come from real opt-in events (booking form, landing form), not
    // from this directory sync. We assert this by confirming the
    // insert.values has consentEmail=0 and consentSms=0 always.
    const { db, insertCalls } = buildDb([[]]);
    await syncMarketingContact(
      db,
      "t_demo",
      { chatId: 1, email: "a@b.com" },
      "salon_clients_manual",
    );
    expect(insertCalls[0]!.values.consentEmail).toBe(0);
    expect(insertCalls[0]!.values.consentSms).toBe(0);
  });
});
