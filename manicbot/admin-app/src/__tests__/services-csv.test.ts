/**
 * servicesCsv — pure parse + export logic for the Services import/export UI.
 *
 * Pins:
 *   - Header aliases (name/service_name, price/cost, duration/time_min)
 *   - Round-trip: export → parse → same data
 *   - svc_id matching (present in export, optional on import)
 *   - Invalid price/duration → RowError, not silent drop
 *   - Empty rows skipped silently
 *   - active defaults to 1 when column missing
 *   - category column preserved
 *   - emoji column preserved
 */
import { describe, it, expect } from "vitest";
import {
  parseServicesCsv,
  servicesToCsv,
  SERVICES_CSV_TEMPLATE,
} from "~/server/services/servicesCsv";

describe("parseServicesCsv", () => {
  it("returns empty result on empty input", () => {
    const r = parseServicesCsv("");
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it("parses canonical header + single row", () => {
    const csv =
      "svc_id,name,price,duration,emoji,category,description,active\n" +
      "svc_abc,Маникюр,500,60,💅,Маникюр,Классический маникюр,1\n";
    const r = parseServicesCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({
      svcId: "svc_abc",
      name: "Маникюр",
      price: 500,
      duration: 60,
      emoji: "💅",
      category: "Маникюр",
      description: "Классический маникюр",
      active: true,
    });
  });

  it("recognizes header aliases (service_name→name, cost→price, time_min→duration)", () => {
    const csv = "service_name,cost,time_min\nПедикюр,600,90\n";
    const r = parseServicesCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({ name: "Педикюр", price: 600, duration: 90 });
  });

  it("defaults active to true when column is missing", () => {
    const csv = "name,price,duration\nМаникюр,500,60\n";
    const r = parseServicesCsv(csv);
    expect(r.rows[0]!.active).toBe(true);
  });

  it("treats active=0 as false", () => {
    const csv = "name,price,duration,active\nМаникюр,500,60,0\n";
    const r = parseServicesCsv(csv);
    expect(r.rows[0]!.active).toBe(false);
  });

  it("reports error on non-numeric price but keeps other rows", () => {
    const csv =
      "name,price,duration\n" +
      "Good,500,60\n" +
      "Bad,not_a_price,60\n" +
      "Also good,300,30\n";
    const r = parseServicesCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.row).toBe(2); // 0-indexed after header
  });

  it("reports error on non-numeric duration but keeps other rows", () => {
    const csv = "name,price,duration\nGood,500,sixty\n";
    const r = parseServicesCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it("reports error when name is missing", () => {
    const csv = "name,price,duration\n,500,60\n";
    const r = parseServicesCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it("skips empty rows silently", () => {
    const csv = "name,price,duration\n\nМаникюр,500,60\n\n";
    const r = parseServicesCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  it("handles quoted cells with commas", () => {
    const csv = `name,price,duration,description\n"Маникюр, гель",500,60,"Долгосрочное, стойкое"\n`;
    const r = parseServicesCsv(csv);
    expect(r.rows[0]!.name).toBe("Маникюр, гель");
    expect(r.rows[0]!.description).toBe("Долгосрочное, стойкое");
  });

  it("null svcId when column missing", () => {
    const csv = "name,price,duration\nМаникюр,500,60\n";
    const r = parseServicesCsv(csv);
    expect(r.rows[0]!.svcId).toBeNull();
  });
});

describe("servicesToCsv", () => {
  it("produces a header row + data rows", () => {
    const rows = [
      {
        svcId: "svc_1",
        names: JSON.stringify({ ru: "Маникюр", en: "Manicure" }),
        price: 500,
        duration: 60,
        emoji: "💅",
        category: "Маникюр",
        description: "Классический",
        active: 1,
      },
    ];
    const csv = servicesToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("svc_id");
    expect(lines[0]).toContain("name");
    expect(lines[0]).toContain("category");
    expect(lines[1]).toContain("svc_1");
    expect(lines[1]).toContain("Маникюр");
    expect(lines[1]).toContain("500");
  });

  it("round-trips: export → parse → same data", () => {
    const rows = [
      {
        svcId: "svc_42",
        names: JSON.stringify({ ru: "Педикюр" }),
        price: 700,
        duration: 90,
        emoji: "🦶",
        category: "Педикюр",
        description: "Медицинский педикюр",
        active: 1,
      },
      {
        svcId: "svc_43",
        names: JSON.stringify({ en: "Gel" }),
        price: 400,
        duration: 45,
        emoji: "💅",
        category: null,
        description: null,
        active: 0,
      },
    ];
    const csv = servicesToCsv(rows);
    const parsed = parseServicesCsv(csv);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ svcId: "svc_42", name: "Педикюр", price: 700, duration: 90, category: "Педикюр" });
    expect(parsed.rows[1]).toMatchObject({ svcId: "svc_43", name: "Gel", price: 400, active: false });
  });

  it("quotes fields containing commas", () => {
    const rows = [
      {
        svcId: "svc_1",
        names: JSON.stringify({ ru: "Маникюр, гель" }),
        price: 500,
        duration: 60,
        emoji: "💅",
        category: null,
        description: null,
        active: 1,
      },
    ];
    const csv = servicesToCsv(rows);
    expect(csv).toContain('"Маникюр, гель"');
  });
});

describe("SERVICES_CSV_TEMPLATE", () => {
  it("is parseable with no errors", () => {
    const r = parseServicesCsv(SERVICES_CSV_TEMPLATE);
    expect(r.errors).toHaveLength(0);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
