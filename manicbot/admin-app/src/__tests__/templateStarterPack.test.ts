import { describe, it, expect } from "vitest";
import {
  STARTER_TEMPLATES,
  EXAMPLE_TEMPLATE_IDS,
  getExampleTemplates,
} from "~/components/marketing/templateStarterPack";

/**
 * `getExampleTemplates` powers the default example tiles shown on the
 * Marketing → Templates page for Pro/Max tenants. It must always resolve to a
 * stable, fully-localized set so the page is never empty or half-rendered.
 */
describe("getExampleTemplates (default example tiles for Pro/Max)", () => {
  it("returns exactly the 5 curated examples in EXAMPLE_TEMPLATE_IDS order", () => {
    expect(EXAMPLE_TEMPLATE_IDS).toHaveLength(5);
    const out = getExampleTemplates("ru");
    expect(out.map((e) => e.id)).toEqual([...EXAMPLE_TEMPLATE_IDS]);
  });

  it("references only ids that exist in STARTER_TEMPLATES", () => {
    const known = new Set(STARTER_TEMPLATES.map((s) => s.id));
    for (const id of EXAMPLE_TEMPLATE_IDS) {
      expect(known.has(id)).toBe(true);
    }
  });

  it("produces a localized, non-empty name + body for every example", () => {
    for (const e of getExampleTemplates("ru")) {
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(e.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries the channel and a subject for email examples", () => {
    for (const e of getExampleTemplates("ru")) {
      expect(["email", "sms"]).toContain(e.channel);
      if (e.channel === "email") {
        expect((e.subject ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to ru for an unknown locale", () => {
    const ru = getExampleTemplates("ru");
    const unknown = getExampleTemplates("zz");
    expect(unknown.map((e) => e.name)).toEqual(ru.map((e) => e.name));
  });
});
