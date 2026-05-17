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
import {
  parseClientsCsv,
  clientsToCsv,
  clientsToGoogleCsv,
  clientsToVcard,
  clientsToFormat,
  CLIENT_CSV_TEMPLATE,
  GOOGLE_EXPORT_HEADERS,
} from "~/server/clients/csv";

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

// 0072: Google Contacts CSV + Apple vCard formats.

describe("parseClientsCsv — Google Contacts headers", () => {
  it("composes name from First Name + Last Name", () => {
    const csv = "First Name,Last Name,Phone 1 - Value\nKarina,Sokolova,+48500152948\n";
    const r = parseClientsCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]).toMatchObject({ name: "Karina Sokolova", phone: "+48500152948" });
  });

  it("falls back to Nickname when First / Last are missing", () => {
    const csv = "Nickname,Phone 1 - Value\nKaroline,+48000111\n";
    const r = parseClientsCsv(csv);
    expect(r.rows[0]).toMatchObject({ name: "Karoline", phone: "+48000111" });
  });

  it("recognizes `E-mail 1 - Value` + `Phone 1 - Value` columns", () => {
    const csv = "First Name,E-mail 1 - Value,Phone 1 - Value\nAnna,foo@bar.com,+48000222\n";
    const r = parseClientsCsv(csv);
    expect(r.rows[0]).toMatchObject({
      name: "Anna",
      email: "foo@bar.com",
      phone: "+48000222",
    });
  });

  it("maps Labels column to tags + Birthday column to dob", () => {
    const csv = "First Name,Labels,Birthday\nIra,vip,1992-03-10\n";
    const r = parseClientsCsv(csv);
    expect(r.rows[0]).toMatchObject({ name: "Ira", tags: "vip", dob: "1992-03-10" });
  });
});

describe("parseClientsCsv — vCard 3.0 input (Apple Contacts)", () => {
  const SAMPLE = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Karina Sokolova",
    "N:Sokolova;Karina;;;",
    "TEL;TYPE=CELL:+48500152948",
    "EMAIL;TYPE=INTERNET:karina@example.com",
    "BDAY:1990-05-15",
    "NOTE:Allergic to acetone\\nTelegram: @karina\\nInstagram: @kar_nails",
    "CATEGORIES:vip,returning",
    "END:VCARD",
  ].join("\r\n");

  it("parses a single vCard block into one row", () => {
    const r = parseClientsCsv(SAMPLE);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      name: "Karina Sokolova",
      phone: "+48500152948",
      email: "karina@example.com",
      dob: "1990-05-15",
      tags: "vip,returning",
      tgUsername: "karina",
      igUsername: "kar_nails",
    });
  });

  it("parses multiple stacked vCards", () => {
    const multi = SAMPLE + "\r\n" + SAMPLE.replace("Karina", "Ira");
    const r = parseClientsCsv(multi);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.name).toContain("Karina");
    expect(r.rows[1]!.name).toContain("Ira");
  });

  it("falls back to N when FN is missing", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Doe;Jane;;;",
      "TEL:+48000",
      "END:VCARD",
    ].join("\r\n");
    const r = parseClientsCsv(vcf);
    expect(r.rows[0]!.name).toBe("Jane Doe");
  });

  it("accepts X-TELEGRAM / X-INSTAGRAM properties as preferred over NOTE regex", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Test",
      "TEL:+48111",
      "X-TELEGRAM:explicit_tg",
      "X-INSTAGRAM:explicit_ig",
      "NOTE:Telegram: @nope",
      "END:VCARD",
    ].join("\r\n");
    const r = parseClientsCsv(vcf);
    expect(r.rows[0]).toMatchObject({
      tgUsername: "explicit_tg",
      igUsername: "explicit_ig",
    });
  });
});

describe("clientsToGoogleCsv", () => {
  it("emits the canonical Google header row", () => {
    expect(clientsToGoogleCsv([])).toBe(GOOGLE_EXPORT_HEADERS.join(","));
  });

  it("splits name into First / Last on first whitespace", () => {
    const csv = clientsToGoogleCsv([{ name: "Karina Sokolova", phone: "+48000" }]);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("Karina");
    expect(lines[1]).toContain("Sokolova");
  });

  it("appends Telegram / Instagram handles into Notes column", () => {
    const csv = clientsToGoogleCsv([
      { name: "Ira", tgUsername: "ira_tg", igUsername: "ira_ig", notes: "VIP" },
    ]);
    expect(csv).toContain("Telegram: @ira_tg");
    expect(csv).toContain("Instagram: @ira_ig");
    expect(csv).toContain("VIP");
  });

  it("round-trips through parse — Google export then re-import", () => {
    const original = [
      { name: "Karina Sokolova", phone: "+48000", email: "k@x.com", tgUsername: "k", igUsername: "kk", tags: "vip", dob: "1990-05-15" },
    ];
    const csv = clientsToGoogleCsv(original);
    const re = parseClientsCsv(csv);
    expect(re.errors).toHaveLength(0);
    expect(re.rows[0]).toMatchObject({
      name: "Karina Sokolova",
      phone: "+48000",
      email: "k@x.com",
      tgUsername: "k",
      igUsername: "kk",
      tags: "vip",
      dob: "1990-05-15",
    });
  });
});

describe("clientsToVcard", () => {
  it("emits a BEGIN/END VCARD pair per client", () => {
    const vcf = clientsToVcard([
      { name: "A", phone: "+48111" },
      { name: "B", phone: "+48222" },
    ]);
    expect((vcf.match(/BEGIN:VCARD/g) ?? []).length).toBe(2);
    expect((vcf.match(/END:VCARD/g) ?? []).length).toBe(2);
  });

  it("escapes commas / semicolons / newlines per RFC 6350", () => {
    const vcf = clientsToVcard([
      { name: "Karina, the great", notes: "line1\nline2; with semicolon" },
    ]);
    expect(vcf).toContain("Karina\\, the great");
    expect(vcf).toContain("line1\\nline2\\; with semicolon");
  });

  it("round-trips name + phone + email + handles + dob + tags", () => {
    const original = [
      { name: "Karina Sokolova", phone: "+48000", email: "k@x.com", tgUsername: "k", igUsername: "kk", tags: "vip", dob: "1990-05-15", notes: "Allergic" },
    ];
    const vcf = clientsToVcard(original);
    const re = parseClientsCsv(vcf);
    expect(re.errors).toHaveLength(0);
    expect(re.rows[0]).toMatchObject({
      name: "Karina Sokolova",
      phone: "+48000",
      email: "k@x.com",
      tgUsername: "k",
      igUsername: "kk",
      tags: "vip",
      dob: "1990-05-15",
    });
  });
});

describe("clientsToFormat dispatch", () => {
  const sample = [{ name: "X", phone: "+48000" }];

  it("manicbot → CSV with the legacy header", () => {
    const r = clientsToFormat(sample, "manicbot");
    expect(r.extension).toBe("csv");
    expect(r.mime).toMatch(/text\/csv/);
    expect(r.data.split("\n")[0]).toBe("name,phone,email,telegram,instagram,tags,notes,dob,lifetime_visits,last_visit_at");
  });

  it("google → CSV with Google headers", () => {
    const r = clientsToFormat(sample, "google");
    expect(r.extension).toBe("csv");
    expect(r.data.split("\n")[0]).toBe(GOOGLE_EXPORT_HEADERS.join(","));
  });

  it("apple → vCard 3.0 with .vcf extension", () => {
    const r = clientsToFormat(sample, "apple");
    expect(r.extension).toBe("vcf");
    expect(r.mime).toMatch(/vcard/);
    expect(r.data).toContain("BEGIN:VCARD");
    expect(r.data).toContain("VERSION:3.0");
  });
});
