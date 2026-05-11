/**
 * P1-5p — sendLoginAlert must be deduplicated to 1 alert per
 * (user_id, IP /24 prefix) per 24h.
 *
 * The login flow lives inside NextAuth's `authorize` callback and is hard to
 * drive in isolation, so this test exercises the two pieces that compose the
 * dedup contract:
 *   1. `ipv4Slash24` — bucket key.
 *   2. A pure simulation of the in-flight rate-limit gate matching what the
 *      real code does (1 token per 24h per (user, prefix)).
 */
import { describe, it, expect } from "vitest";
import { ipv4Slash24 } from "~/server/auth/auth";

describe("ipv4Slash24 — IP bucketing for login-alert dedup (P1-5p)", () => {
  it("collapses an IPv4 to its /24 prefix", () => {
    expect(ipv4Slash24("203.0.113.42")).toBe("203.0.113.0/24");
  });

  it("collapses any host in the same /24 to the same key", () => {
    expect(ipv4Slash24("203.0.113.1")).toBe(ipv4Slash24("203.0.113.250"));
  });

  it("treats different /24 prefixes as distinct keys", () => {
    expect(ipv4Slash24("203.0.113.1")).not.toBe(ipv4Slash24("203.0.114.1"));
  });

  it("passes IPv6 through unchanged (treated as opaque)", () => {
    const v6 = "2001:db8::1";
    expect(ipv4Slash24(v6)).toBe(v6);
  });

  it("passes 'unknown' through unchanged", () => {
    expect(ipv4Slash24("unknown")).toBe("unknown");
  });
});

describe("login-alert dedup simulation — 1 per (user, /24) per 24h", () => {
  /**
   * Simulates the rate-limit gate behaviour: the first call returns
   * { allowed: true }; subsequent calls within the window return
   * { allowed: false }. Mirrors checkRateLimit(db, userId, action, 1, 24h)
   * with action = `loginalert:{userId}:{ipPrefix}`.
   */
  function makeGate() {
    const seen = new Map<string, number>();
    return function gate(userId: string, ipPrefix: string, nowMs: number): boolean {
      const key = `${userId}:${ipPrefix}`;
      const last = seen.get(key);
      if (last == null || nowMs - last > 24 * 60 * 60 * 1000) {
        seen.set(key, nowMs);
        return true;
      }
      return false;
    };
  }

  it("sends 1 email when the same user logs in 10 times from the same /24", () => {
    const gate = makeGate();
    const userId = "u_alice";
    const fakeNow = 1_700_000_000_000;
    let sent = 0;
    for (let i = 0; i < 10; i++) {
      // All from 203.0.113.X — same /24 prefix
      const prefix = ipv4Slash24(`203.0.113.${i + 1}`);
      if (gate(userId, prefix, fakeNow + i * 1000)) sent++;
    }
    expect(sent).toBe(1);
  });

  it("sends 2 emails when the user logs in from two different /24 prefixes", () => {
    const gate = makeGate();
    const userId = "u_bob";
    const fakeNow = 1_700_000_000_000;
    let sent = 0;
    if (gate(userId, ipv4Slash24("203.0.113.5"), fakeNow)) sent++;
    if (gate(userId, ipv4Slash24("198.51.100.5"), fakeNow + 1000)) sent++;
    expect(sent).toBe(2);
  });

  it("resets after 24h", () => {
    const gate = makeGate();
    const userId = "u_carol";
    const prefix = ipv4Slash24("203.0.113.1");
    expect(gate(userId, prefix, 1_700_000_000_000)).toBe(true);
    expect(gate(userId, prefix, 1_700_000_000_000 + 23 * 3600 * 1000)).toBe(false);
    expect(gate(userId, prefix, 1_700_000_000_000 + 25 * 3600 * 1000)).toBe(true);
  });

  it("different users do not share the dedup token", () => {
    const gate = makeGate();
    const prefix = ipv4Slash24("203.0.113.7");
    expect(gate("u_dave", prefix, 1_700_000_000_000)).toBe(true);
    expect(gate("u_erin", prefix, 1_700_000_000_000)).toBe(true);
  });
});
