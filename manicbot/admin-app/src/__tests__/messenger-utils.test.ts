import { describe, it, expect } from "vitest";
import { ulid, isUlid } from "~/lib/ulid";
import { computeDmKey } from "~/server/api/messenger/dmKey";

describe("ulid()", () => {
  it("returns a 26-char Crockford base32 string", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it("produces monotonically increasing ids over time", () => {
    // Use explicit timestamps to avoid same-millisecond flake.
    const a = ulid(1700000000000);
    const b = ulid(1700000000001);
    expect(a < b).toBe(true);
  });

  it("two ids at the same timestamp differ in the random tail", () => {
    const t = 1700000000000;
    const a = ulid(t);
    const b = ulid(t);
    // Timestamps identical → first 10 chars match; random differs.
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a.slice(10)).not.toBe(b.slice(10));
  });

  it("isUlid rejects non-base32 strings", () => {
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FA*")).toBe(false); // wrong charset
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false); // wrong length
  });
});

describe("computeDmKey()", () => {
  it("orders ids deterministically regardless of arg order", () => {
    expect(computeDmKey("a", "b")).toBe("a:b");
    expect(computeDmKey("b", "a")).toBe("a:b");
  });

  it("works on realistic web_user ids (sorts lexicographically)", () => {
    const k1 = computeDmKey("w_owner_xyz", "w_master_abc");
    const k2 = computeDmKey("w_master_abc", "w_owner_xyz");
    expect(k1).toBe(k2);
    expect(k1).toBe("w_master_abc:w_owner_xyz"); // 'master' < 'owner'
  });

  it("throws on empty inputs", () => {
    expect(() => computeDmKey("", "b")).toThrow();
    expect(() => computeDmKey("a", "")).toThrow();
  });

  it("throws when a user tries to DM themselves", () => {
    expect(() => computeDmKey("w_x", "w_x")).toThrow(/yourself/i);
  });
});
