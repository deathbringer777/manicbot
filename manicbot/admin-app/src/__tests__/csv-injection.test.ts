/**
 * #M-07-1 / #M-07-5 — CSV formula-injection guard for all exporters.
 * A booking client's display name (`=cmd|'/c calc'!A1`) flows to
 * marketing_contacts and detonates as a spreadsheet formula when the operator
 * opens an export. csvCell prefixes a quote to neutralize it.
 */
import { describe, it, expect } from "vitest";
import { csvCell } from "~/server/lib/csvSafe";

describe("csvCell — CSV formula-injection guard", () => {
  it("prefixes a quote so spreadsheets don't execute formula-leading cells", () => {
    expect(csvCell("=cmd|'/c calc'!A1").startsWith("'=")).toBe(true);
    expect(csvCell("+48500")).toBe("'+48500");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=evil")).toBe("'\t=evil");
  });

  it("quote-wraps a formula cell that also contains a comma/quote", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });

  it("leaves safe values unchanged", () => {
    expect(csvCell("Karina")).toBe("Karina");
    expect(csvCell("karina@example.com")).toBe("karina@example.com");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("still applies RFC-4180 quoting for commas/quotes/newlines", () => {
    expect(csvCell("vip,returning")).toBe(`"vip,returning"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(csvCell("a\nb")).toBe(`"a\nb"`);
  });
});
