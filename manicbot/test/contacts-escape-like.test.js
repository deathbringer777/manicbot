/**
 * YELLOW-3 — escapeLikePattern pins the LIKE-metacharacter escaping used by the
 * tg/ig handle fallback in lookupContact. A handle is a bound parameter (no SQL
 * injection), but `_` is a legal handle char; unescaped it acts as a single-char
 * wildcard and could merge into the wrong same-tenant contact.
 */
import { describe, it, expect } from "vitest";
import { escapeLikePattern } from "../src/services/marketing/contacts.js";

describe("escapeLikePattern", () => {
  it("escapes underscore (single-char wildcard)", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });
  it("escapes percent (multi-char wildcard)", () => {
    expect(escapeLikePattern("50%off")).toBe("50\\%off");
  });
  it("escapes a literal backslash (the escape char itself)", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });
  it("leaves ordinary handle characters untouched", () => {
    expect(escapeLikePattern("john.doe")).toBe("john.doe");
    expect(escapeLikePattern("salon_master.99")).toBe("salon\\_master.99");
  });
  it("coerces non-strings without throwing", () => {
    expect(escapeLikePattern(123)).toBe("123");
  });
});
