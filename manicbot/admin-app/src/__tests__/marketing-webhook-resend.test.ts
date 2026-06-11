/**
 * Pure-function tests for the Resend webhook event processor.
 *
 * Pin every type in the event matrix described in
 * `~/server/marketing/webhooks/processResendEvent.ts`. The processor is
 * pure, so we can map event payloads → expected D1 ops without touching
 * a database.
 */
import { describe, it, expect } from "vitest";
import { processResendEvent, type ResendEvent } from "~/server/marketing/webhooks/processResendEvent";

const NOW = 1_700_000_000;

function ev(type: string, data: Partial<ResendEvent["data"]> = {}): ResendEvent {
  return { type, created_at: "2024-12-01T00:00:00Z", data };
}

describe("processResendEvent", () => {
  it("email.sent is a no-op (we already wrote sent_at at send time)", () => {
    const r = processResendEvent(ev("email.sent", { email_id: "re_1" }), NOW);
    expect(r.outcome).toBe("sent");
    expect(r.sendUpdate).toBeUndefined();
    expect(r.suppress).toBeUndefined();
  });

  it("email.delivered patches status + deliveredAt", () => {
    const r = processResendEvent(ev("email.delivered", { email_id: "re_42" }), NOW);
    expect(r.outcome).toBe("delivered");
    expect(r.sendUpdate?.providerMessageId).toBe("re_42");
    expect(r.sendUpdate?.set.status).toBe("delivered");
    expect(r.sendUpdate?.set.deliveredAt).toBe(NOW);
    expect(r.suppress).toBeUndefined();
  });

  it("email.opened patches openedAt and promotes status to 'opened'", () => {
    const r = processResendEvent(ev("email.opened", { email_id: "re_42" }), NOW);
    expect(r.outcome).toBe("opened");
    expect(r.sendUpdate?.set.openedAt).toBe(NOW);
    expect(r.sendUpdate?.set.status).toBe("opened");
    expect(r.sendUpdate?.statusRank).toBeGreaterThan(2);
  });

  it("email.clicked patches clickedAt and promotes status to 'clicked'", () => {
    const r = processResendEvent(ev("email.clicked", { email_id: "re_42" }), NOW);
    expect(r.outcome).toBe("clicked");
    expect(r.sendUpdate?.set.clickedAt).toBe(NOW);
    expect(r.sendUpdate?.set.status).toBe("clicked");
  });

  it("email.bounced writes bouncedAt, terminal status, AND a suppression row", () => {
    const r = processResendEvent(
      ev("email.bounced", { email_id: "re_42", to: "Alice@Example.com" }),
      NOW,
    );
    expect(r.outcome).toBe("bounced");
    expect(r.sendUpdate?.set.bouncedAt).toBe(NOW);
    expect(r.sendUpdate?.set.status).toBe("bounced");
    expect(r.suppress?.emails).toEqual(["alice@example.com"]); // normalized
    expect(r.suppress?.reason).toBe("email.bounced");
    expect(r.sendUpdate?.statusRank).toBeGreaterThan(5); // ranks above positive states
  });

  it("email.complained writes complainedAt + suppression row", () => {
    const r = processResendEvent(
      ev("email.complained", { email_id: "re_42", to: ["bob@example.com", "carol@example.com"] }),
      NOW,
    );
    expect(r.outcome).toBe("complained");
    expect(r.sendUpdate?.set.complainedAt).toBe(NOW);
    expect(r.sendUpdate?.set.status).toBe("complained");
    expect(r.suppress?.emails).toEqual(["bob@example.com", "carol@example.com"]);
    expect(r.suppress?.reason).toBe("email.complained");
  });

  it("email.delivery_delayed yields only a suppression op (no marketing_sends update)", () => {
    const r = processResendEvent(
      ev("email.delivery_delayed", { to: "alice@example.com" }),
      NOW,
    );
    expect(r.outcome).toBe("delivery_delayed");
    expect(r.sendUpdate).toBeUndefined();
    expect(r.suppress?.reason).toBe("email.delivery_delayed");
  });

  it("email.failed updates marketing_sends status without bounce timestamp", () => {
    const r = processResendEvent(ev("email.failed", { email_id: "re_42" }), NOW);
    expect(r.outcome).toBe("failed");
    expect(r.sendUpdate?.set.status).toBe("failed");
    expect(r.sendUpdate?.set.bouncedAt).toBeUndefined();
    expect(r.suppress).toBeUndefined();
  });

  it("unknown event types are ignored (no-op)", () => {
    const r = processResendEvent(ev("email.something.weird", { email_id: "re_42" }), NOW);
    expect(r.outcome).toBe("ignored");
    expect(r.sendUpdate).toBeUndefined();
    expect(r.suppress).toBeUndefined();
  });

  it("missing email_id skips marketing_sends update but still suppresses on bounce", () => {
    const r = processResendEvent(
      ev("email.bounced", { to: "alice@example.com" }),
      NOW,
    );
    expect(r.sendUpdate).toBeUndefined();
    expect(r.suppress?.emails).toEqual(["alice@example.com"]);
  });

  it("missing `to` skips the suppression op", () => {
    const r = processResendEvent(ev("email.bounced", { email_id: "re_42" }), NOW);
    expect(r.suppress).toBeUndefined();
    expect(r.sendUpdate?.set.status).toBe("bounced");
  });

  it("nowSec is honoured (deterministic clock)", () => {
    const r1 = processResendEvent(ev("email.delivered", { email_id: "x" }), 1000);
    const r2 = processResendEvent(ev("email.delivered", { email_id: "x" }), 2000);
    expect(r1.sendUpdate?.set.deliveredAt).toBe(1000);
    expect(r2.sendUpdate?.set.deliveredAt).toBe(2000);
  });

  it("STATUS_RANK monotonicity: terminal events outrank positive ones", () => {
    const delivered = processResendEvent(ev("email.delivered", { email_id: "x" }), NOW);
    const bounced = processResendEvent(ev("email.bounced", { email_id: "x", to: "a@b.c" }), NOW);
    const complained = processResendEvent(ev("email.complained", { email_id: "x", to: "a@b.c" }), NOW);
    expect(bounced.sendUpdate!.statusRank!).toBeGreaterThan(delivered.sendUpdate!.statusRank!);
    expect(complained.sendUpdate!.statusRank!).toBeGreaterThan(bounced.sendUpdate!.statusRank!);
  });
});

// ── Svix timestamp freshness (replay protection) ────────────────────────────

import {
  isSvixTimestampFresh,
  SVIX_TIMESTAMP_TOLERANCE_SEC,
} from "~/server/marketing/webhooks/processResendEvent";

describe("isSvixTimestampFresh — replay window", () => {
  const NOW = 1_750_000_000;

  it("accepts a timestamp exactly at now", () => {
    expect(isSvixTimestampFresh(String(NOW), NOW)).toBe(true);
  });

  it("accepts timestamps at the ±tolerance boundary (inclusive)", () => {
    expect(isSvixTimestampFresh(String(NOW - SVIX_TIMESTAMP_TOLERANCE_SEC), NOW)).toBe(true);
    expect(isSvixTimestampFresh(String(NOW + SVIX_TIMESTAMP_TOLERANCE_SEC), NOW)).toBe(true);
  });

  it("rejects timestamps just outside the window (replay)", () => {
    expect(isSvixTimestampFresh(String(NOW - SVIX_TIMESTAMP_TOLERANCE_SEC - 1), NOW)).toBe(false);
    expect(isSvixTimestampFresh(String(NOW + SVIX_TIMESTAMP_TOLERANCE_SEC + 1), NOW)).toBe(false);
  });

  it("rejects an hour-old captured webhook", () => {
    expect(isSvixTimestampFresh(String(NOW - 3600), NOW)).toBe(false);
  });

  it("rejects missing / empty / non-numeric headers", () => {
    expect(isSvixTimestampFresh(null, NOW)).toBe(false);
    expect(isSvixTimestampFresh("", NOW)).toBe(false);
    expect(isSvixTimestampFresh("abc", NOW)).toBe(false);
    expect(isSvixTimestampFresh("12.5", NOW)).toBe(false);
    expect(isSvixTimestampFresh("-100", NOW)).toBe(false);
    expect(isSvixTimestampFresh("1e10", NOW)).toBe(false);
  });

  it("honours a custom tolerance", () => {
    expect(isSvixTimestampFresh(String(NOW - 10), NOW, 5)).toBe(false);
    expect(isSvixTimestampFresh(String(NOW - 4), NOW, 5)).toBe(true);
  });
});
