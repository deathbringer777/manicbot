/**
 * csvClients — tolerant parse + canonical export for the Clients import UI.
 *
 * Pins the contract that:
 *   * Header aliases (phone/tel/mobile, email/mail, tg/telegram, ig/instagram)
 *     all map to the canonical field name.
 *   * Quoted cells with commas survive a round-trip.
 *   * Doubled quotes inside quoted cells decode to a single quote.
 *   * Empty rows are skipped silently.
 *   * Rows with no usable contact are reported as errors, not silently
 *     accepted.
 *   * Invalid DoB strings emit an error but don't drop the row.
 *   * `@handle` prefixes are stripped from tg/ig handles.
 */
import { describe, it, expect } from "vitest";
import { parseClientsCsv, clientsToCsv, CLIENT_CSV_TEMPLATE } from "~/server/clients/csv";

describe("parseClientsCsv", () => {
  it("returns empty result on empty input", () => {
    const r = parseClientsCsv("");
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
  });

  it("parses canonical header + a single row", () => {
    const csv =
      "name,phone,email,telegram,instagram,tags,notes,dob\n" +
      "Karina,+48500152948,kar@nails.com,@karina,@kar_nails,vip,Loyal,1990-05-15\n";
    const r = parseClientsCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({
      name: "Karina",
      phone: "+48500152948",
      email: "kar@nails.com",
      tgUsername: "karina",
      igUsername: "kar_nails",
      tags: "vip",
      notes: "Loyal",
      dob: "1990-05-15",
    });
  });

  it("recognizes header aliases (tel→phone, mail→email, tg→telegram, ig→instagram)", () => {
    const csv = "name,tel,mail,tg,ig\nFoo,+48000,a@b,bar,baz\n";
    const r = parseClientsCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({
      name: "Foo",
      phone: "+48000",
      email: "a@b",
      tgUsername: "bar",
      igUsername: "baz",
    });
  });

  it("handles quoted commas and doubled quotes", () => {
    const csv =
      'name,tags,notes\n' +
      '"Karina, the great","vip,returning","She said ""hi"""\n';
    const r = parseClientsCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({
      name: "Karina, the great",
      tags: "vip,returning",
      notes: 'She said "hi"',
    });
  });

  it("strips @ prefix from telegram and instagram handles", () => {
    const csv = "name,tg,ig\nA,@user,@@@inst\n";
    const r = parseClientsCsv(csv);
    expect(r.rows[0]).toMatchObject({ tgUsername: "user", igUsername: "inst" });
  });

  it("lowercases email", () => {
    const csv = "name,email\nA,Foo@Bar.COM\n";
    const r = parseClientsCsv(csv);
    expect(r.rows[0]!.email).toBe("foo@bar.com");
  });

  it("reports an error for invalid DoB but keeps the row", () => {
    const csv = "name,phone,dob\nA,+48000,15/05/1990\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.dob).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.reason).toMatch(/invalid date/);
    expect(r.errors[0]!.row).toBe(1);
  });

  it("rejects rows with no usable contact at all", () => {
    const csv = "name,phone,email,telegram,instagram\n,,,,\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.reason).toMatch(/no recognizable contact/);
  });

  it("skips blank rows silently", () => {
    const csv = "name,phone\nA,+48111\n\n\nB,+48222\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it("returns an error for completely unrecognized headers", () => {
    const csv = "foo,bar,baz\n1,2,3\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.reason).toMatch(/no recognized column/);
  });

  it("handles CRLF line endings", () => {
    const csv = "name,phone\r\nA,+48111\r\nB,+48222\r\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.name).toBe("A");
    expect(r.rows[1]!.name).toBe("B");
  });

  it("strips BOM at start of file", () => {
    const csv = "﻿name,phone\nA,+48111\n";
    const r = parseClientsCsv(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.name).toBe("A");
  });
});

describe("clientsToCsv", () => {
  it("emits canonical header row", () => {
    const csv = clientsToCsv([]);
    expect(csv).toBe("name,phone,email,telegram,instagram,tags,notes,dob,lifetime_visits,last_visit_at");
  });

  it("escapes commas, quotes, and newlines inside cells", () => {
    const csv = clientsToCsv([
      { name: 'Karina "K"', notes: "line1\nline2", tags: "vip,returning" },
    ]);
    expect(csv).toContain('"Karina ""K"""');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain('"vip,returning"');
  });

  it("round-trips through parse → emit (canonical case)", () => {
    const original = [
      {
        name: "A",
        phone: "+48000",
        email: "a@b.com",
        tgUsername: "tg1",
        igUsername: "ig1",
        tags: "vip",
        notes: "note",
        dob: "1990-01-01",
        lifetimeVisits: 3,
        lastVisitAt: null,
      },
    ];
    const csv = clientsToCsv(original);
    const reparsed = parseClientsCsv(csv);
    // Round-trip: the canonical fields survive. (lifetime_visits/last_visit_at
    // are export-only — parser doesn't ingest them, that's intentional.)
    expect(reparsed.rows[0]).toMatchObject({
      name: "A",
      phone: "+48000",
      email: "a@b.com",
      tgUsername: "tg1",
      igUsername: "ig1",
      tags: "vip",
      notes: "note",
      dob: "1990-01-01",
    });
  });
});

describe("CLIENT_CSV_TEMPLATE", () => {
  it("is parseable without errors and has at least one example row", () => {
    const r = parseClientsCsv(CLIENT_CSV_TEMPLATE);
    expect(r.errors).toHaveLength(0);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
