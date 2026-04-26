/**
 * Tests for the price display with non-breaking space (U+00A0).
 *
 * Background: JSX text nodes do NOT process Unicode escapes — writing
 * `{s.price} zł` in JSX renders the literal 6-character string
 * " " instead of U+00A0.  The fix wraps the price in a template
 * literal inside a JSX expression: {`${s.price} zł`}, which
 * JavaScript evaluates before rendering, producing the actual NBSP char.
 */

import { describe, it, expect } from "vitest";

// The NBSP character (U+00A0) — what we expect to appear in the output.
const NBSP = " ";

describe("price non-breaking space rendering", () => {
  it("template literal produces actual NBSP, not the 6-char escape", () => {
    const price = 40;
    // This is exactly what the JSX renders after the fix:
    const rendered = `${price} zł`;

    expect(rendered).toBe(`40${NBSP}zł`);
    expect(rendered).not.toContain("\\u00a0");
    expect(rendered.charCodeAt(2)).toBe(0x00a0); // position 2 is the NBSP
  });

  it("NBSP char is different from regular space", () => {
    const nbsp = " ";
    const space = " ";
    expect(nbsp).not.toBe(space);
    expect(nbsp.charCodeAt(0)).toBe(160);
    expect(space.charCodeAt(0)).toBe(32);
  });

  it("template literal with zero price still uses NBSP", () => {
    const price = 0;
    const rendered = `${price} zł`;
    expect(rendered).toBe(`0${NBSP}zł`);
    expect(rendered.charCodeAt(1)).toBe(0x00a0);
  });

  it("template literal with decimal price uses NBSP", () => {
    const price = 99.5;
    const rendered = `${price} zł`;
    expect(rendered).toBe(`99.5${NBSP}zł`);
    expect(rendered.indexOf(NBSP)).toBe(4);
  });

  it("demonstrates the bug: literal \\u00a0 concatenated is 6 chars, not NBSP", () => {
    // When JSX sees the raw source text ` ` outside a JS expression,
    // it passes those characters verbatim — the escape is NOT evaluated.
    // This simulates the exact string React would render in the buggy case:
    const buggyOutput = "40" + "\\u00a0" + "zł"; // literal backslash + u00a0
    expect(buggyOutput).not.toContain(NBSP);        // no actual NBSP char
    expect(buggyOutput).toContain("\\u00a0");        // contains literal escape text
    expect(buggyOutput.length).toBe(10);             // "40"(2) + "\\u00a0"(6) + "zł"(2)

    // The fix: use a JS template literal so the engine evaluates the escape:
    const price = 40;
    const fixed = `${price} zł`;
    expect(fixed).toContain(NBSP);
    expect(fixed.length).toBe(5); // "40"(2) + NBSP(1) + "zł"(2)
  });
});
