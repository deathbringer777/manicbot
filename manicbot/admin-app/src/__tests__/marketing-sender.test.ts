/**
 * Unit tests for the admin-app marketing sender stack.
 *
 *   1. `renderTemplate` — pure substitution + HTML wrap + unsub footer.
 *   2. `runCampaignSend` — flips campaign status, calls provider, inserts
 *      marketing_sends rows. Provider is mocked via the providers module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: {} }));

// Provider mock: pickProvider returns a stub that ALWAYS succeeds.
type EmailPayload = { to: string; subject: string; html: string; text?: string };
type SendResult = { ok: boolean; messageId?: string; error?: string };
const mockSendEmail = vi.fn<(p: EmailPayload) => Promise<SendResult>>(
  async () => ({ ok: true, messageId: "mid-stub" }),
);
vi.mock("~/server/marketing/providers", () => ({
  pickProvider: (_channel: string) => ({
    name: "resend",
    channels: ["email"],
    isConfigured: () => true,
    sendEmail: mockSendEmail,
    checkHealth: async () => ({ status: "ok" as const }),
  }),
  listProviders: () => [],
  getProvider: () => null,
}));

// Audience helper — return a controlled fixture so runCampaignSend has work to do.
type ResolvedContactRow = {
  id: number; email: string | null; phone: string | null; name: string | null; unsubscribeToken: string | null;
};
const mockResolveAudience = vi.fn<(args: unknown) => Promise<{ contacts: ResolvedContactRow[]; totalCount: number }>>(
  async () => ({
    contacts: [
      { id: 1, email: "alice@example.com", phone: null, name: "Alice Smith", unsubscribeToken: "tok-alice-existing" },
      { id: 2, email: "bob@example.com",   phone: null, name: "Bob Jones",   unsubscribeToken: null },
    ],
    totalCount: 2,
  }),
);
vi.mock("~/server/marketing/audience", () => ({
  resolveAudience: (a: unknown) => mockResolveAudience(a),
  parseFilterJson: (s: string | null | undefined) => {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return {}; }
  },
}));

// Unsubscribe URL helper — return a fixed URL so we don't touch the db.
vi.mock("~/server/marketing/unsubscribeUrl", () => ({
  getUnsubscribeUrl: async (_db: unknown, contactId: number, existing?: string | null) =>
    existing ? `https://manicbot.com/u/${existing}` : `https://manicbot.com/u/fresh-${contactId}`,
  buildUnsubscribeUrl: (t: string) => `https://manicbot.com/u/${t}`,
  ensureUnsubscribeToken: async (_db: unknown, contactId: number, existing?: string | null) =>
    existing ?? `fresh-${contactId}`,
}));

import { renderTemplate } from "~/server/marketing/templateRender";
import { runCampaignSend } from "~/server/marketing/sender";
import { createDbMock } from "./helpers/db-mock";

describe("renderTemplate — merge variable substitution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("substitutes {{name}}, {{first_name}}, {{email}}, {{salon}}", () => {
    const out = renderTemplate(
      { channel: "email", subject: "Hi {{first_name}}", body: "<p>Hi {{name}}, write to {{salon}}!</p>" },
      { name: "Alice Smith", email: "alice@example.com" },
      { salonName: "ManicLab", unsubscribeUrl: "https://manicbot.com/u/tok-x", locale: "en" },
    );
    expect(out.subject).toBe("Hi Alice");
    expect(out.html).toContain("Hi Alice Smith, write to ManicLab!");
    // text alternative present
    expect(out.text).toContain("Hi Alice Smith, write to ManicLab!");
  });

  it("email body wraps in HTML shell + injects unsubscribe footer link", () => {
    const out = renderTemplate(
      { channel: "email", subject: "Sub", body: "Hello world" },
      { name: "X", email: "x@y" },
      { unsubscribeUrl: "https://manicbot.com/u/abc123", locale: "ru" },
    );
    expect(out.html).toMatch(/<!doctype html>/i);
    expect(out.html).toContain("https://manicbot.com/u/abc123");
    expect(out.html).toContain("отписаться");
  });

  it("does NOT wrap a fully-formed HTML doc — injects footer before </body>", () => {
    const fullDoc = "<!doctype html><html><body><h1>Hi</h1></body></html>";
    const out = renderTemplate(
      { channel: "email", subject: "x", body: fullDoc },
      { name: "X" },
      { unsubscribeUrl: "https://manicbot.com/u/zzz", locale: "en" },
    );
    expect(out.html.split("<!doctype html>").length).toBe(2); // exactly one shell
    expect(out.html).toMatch(/<h1>Hi<\/h1>.*https:\/\/manicbot\.com\/u\/zzz/s);
  });

  it("SMS body is plain text — no HTML wrapping, no auto unsub footer", () => {
    const out = renderTemplate(
      { channel: "sms", subject: null, body: "Hi {{first_name}}!" },
      { name: "Bob Jones" },
      { unsubscribeUrl: "https://manicbot.com/u/never-used", locale: "en" },
    );
    expect(out.html).toBe("");
    expect(out.text).toBe("Hi Bob!");
    expect(out.subject).toBe("");
  });

  it("missing values render as empty string (no `undefined` leaks)", () => {
    const out = renderTemplate(
      { channel: "email", subject: "for {{first_name}}", body: "<p>{{name}} - {{phone}} - {{email}}</p>" },
      { name: null, email: null, phone: null },
      { unsubscribeUrl: "" },
    );
    expect(out.subject).toBe("for ");
    expect(out.html).toContain("<p> -  - </p>");
    expect(out.html).not.toMatch(/undefined|null/);
  });
});

describe("runCampaignSend — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flips status, renders + sends for each contact, finalizes campaign.sent", async () => {
    // Sender selects: 1) campaign 2) template 3) tenant 4+) (audience is mocked separately)
    const campaign = {
      id: "cmp_a",
      tenantId: "t_a",
      templateId: "tpl_a",
      segmentId: null,
      channel: "email",
      status: "draft",
    };
    const template = {
      id: "tpl_a",
      tenantId: "t_a",
      channel: "email",
      subject: "Hi {{first_name}}",
      body: "Hello",
      locale: "en",
    };
    const { db, updateCalls, insertCalls } = createDbMock([
      [campaign],          // select campaign
      [template],          // select template
      [{ name: "ManicLab" }], // select tenant.name
    ]);

    const out = await runCampaignSend({
      db: db as never,
      tenantId: "t_a",
      campaignId: "cmp_a",
    });

    expect(out.ok).toBe(true);
    expect(out.total).toBe(2);
    expect(out.sent).toBe(2);
    expect(out.failed).toBe(0);
    expect(out.deferred).toBe(0);
    expect(out.campaignStatus).toBe("sent");

    // The provider was called twice — once per audience contact.
    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    // marketing_sends rows inserted (one per contact).
    const sendInserts = insertCalls.filter((c) => c.values?.campaignId === "cmp_a");
    expect(sendInserts.length).toBe(2);
    expect(sendInserts[0]!.values).toMatchObject({
      campaignId: "cmp_a",
      contactId: 1,
      recipient: "alice@example.com",
      status: "queued",
    });

    // First update: campaign status flipped to 'sending'. Last update: the
    // final campaign row, which carries statsJson (per-send rows update
    // marketingSends not marketingCampaigns).
    const statusUpdates = updateCalls.filter((c) =>
      typeof c.values?.status === "string");
    expect(statusUpdates.some((u) => u.values.status === "sending")).toBe(true);
    const finalCampaignUpdate = statusUpdates.find(
      (u) => u.values.status === "sent" && typeof u.values.statsJson === "string",
    );
    expect(finalCampaignUpdate).toBeTruthy();
    expect(finalCampaignUpdate!.values.statsJson as string).toContain('"sent":2');
  });
});

describe("runCampaignSend — failure modes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns campaign_not_found when the row is missing", async () => {
    const { db } = createDbMock([[]]);
    const out = await runCampaignSend({ db: db as never, tenantId: "t_a", campaignId: "missing" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("campaign_not_found");
  });

  it("returns tenant_mismatch when the campaign belongs to a different tenant", async () => {
    const { db } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_b", templateId: null, channel: "email", status: "draft" }],
    ]);
    const out = await runCampaignSend({ db: db as never, tenantId: "t_a", campaignId: "cmp_a" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("tenant_mismatch");
  });

  it("flips campaign to failed when there's no template id", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", templateId: null, channel: "email", status: "draft" }],
    ]);
    const out = await runCampaignSend({ db: db as never, tenantId: "t_a", campaignId: "cmp_a" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no_template");
    const failedUpdate = updateCalls.find((u) => u.values.status === "failed");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.values.error).toBe("no_template");
  });

  it("flips campaign to failed when template channel does not match campaign channel", async () => {
    const { db, updateCalls } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", templateId: "tpl_a", channel: "email", status: "draft" }],
      [{ id: "tpl_a", tenantId: "t_a", channel: "sms", subject: null, body: "x", locale: "en" }],
    ]);
    const out = await runCampaignSend({ db: db as never, tenantId: "t_a", campaignId: "cmp_a" });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("channel_mismatch");
    expect(updateCalls.some((u) => u.values.status === "failed" && u.values.error === "channel_mismatch")).toBe(true);
  });
});

describe("runCampaignSend — provider returns error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the send as failed and surfaces the error in the row", async () => {
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: "resend_rate_limited" } as never);
    mockSendEmail.mockResolvedValueOnce({ ok: true, messageId: "mid-2" });

    const { db, insertCalls, updateCalls } = createDbMock([
      [{ id: "cmp_a", tenantId: "t_a", templateId: "tpl_a", channel: "email", status: "draft" }],
      [{ id: "tpl_a", channel: "email", subject: "Hi", body: "Hello", locale: "en" }],
      [{ name: "S" }],
    ]);

    const out = await runCampaignSend({ db: db as never, tenantId: "t_a", campaignId: "cmp_a" });
    expect(out.total).toBe(2);
    expect(out.sent).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.campaignStatus).toBe("sent"); // not all failed

    // The failed row was updated with the error message.
    const errorUpdate = updateCalls.find((u) => u.values.status === "failed"
      && typeof u.values.error === "string"
      && (u.values.error as string).includes("resend_rate_limited"));
    expect(errorUpdate).toBeTruthy();
    expect(insertCalls.filter((c) => c.values?.campaignId === "cmp_a").length).toBe(2);
  });
});
