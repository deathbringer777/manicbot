/**
 * lib/notifications/kindMeta — pure helpers shared between the bell
 * dropdown and the /notifications full-history page. Pinning the
 * contract here prevents one surface from drifting from the other.
 */
import { describe, it, expect } from "vitest";
import {
  BELL_GROUP_TITLE,
  bellGroup,
  bellGroupTitle,
  formatRelative,
  kindMeta,
  TIME_BUCKET_TITLE,
  timeBucket,
  timeBucketTitle,
} from "~/lib/notifications/kindMeta";

describe("kindMeta — per-kind UI mapping", () => {
  it.each([
    ["support.reply", "support"],
    ["support.ticket.new", "support"],
    ["appointment.created", "appointment"],
    ["appointment.confirmed", "appointment"],
    ["birthday.client", "birthday"],
    ["billing.alert", "billing"],
    ["marketing.campaign.sent", "marketing"],
    ["messenger.thread.new", "messenger"],
    ["thread.message.new", "messenger"],
    ["reminder.fired", "reminder"],
  ])("maps %s → category %s", (kind, expected) => {
    expect(kindMeta(kind).category).toBe(expected);
  });

  it("falls back to generic for unknown kinds", () => {
    expect(kindMeta("totally.unknown").category).toBe("generic");
    expect(kindMeta("").category).toBe("generic");
  });

  it("returns a usable icon component for every category", () => {
    const samples = [
      "support.x",
      "appointment.x",
      "birthday.x",
      "billing.x",
      "marketing.x",
      "messenger.x",
      "reminder.x",
      "unknown.x",
    ];
    for (const k of samples) {
      const m = kindMeta(k);
      expect(typeof m.icon).toBe("object");
      expect(m.accent).toMatch(/text-.+ bg-.+\/10/);
    }
  });
});

describe("formatRelative (Russian default)", () => {
  const NOW = 1_700_000_000;

  it("under 60 s → 'только что'", () => {
    expect(formatRelative(NOW - 5, "ru", NOW)).toBe("только что");
    expect(formatRelative(NOW - 59, "ru", NOW)).toBe("только что");
  });

  it("60 s..1 h → '{n} мин'", () => {
    expect(formatRelative(NOW - 60, "ru", NOW)).toBe("1 мин");
    expect(formatRelative(NOW - 60 * 45, "ru", NOW)).toBe("45 мин");
  });

  it("1 h..24 h → '{n} ч'", () => {
    expect(formatRelative(NOW - 3600, "ru", NOW)).toBe("1 ч");
    expect(formatRelative(NOW - 3600 * 23, "ru", NOW)).toBe("23 ч");
  });

  it("1 d..7 d → '{n} д'", () => {
    expect(formatRelative(NOW - 86400, "ru", NOW)).toBe("1 д");
    expect(formatRelative(NOW - 86400 * 6, "ru", NOW)).toBe("6 д");
  });

  it("7 d..30 d → '{n} нед'", () => {
    expect(formatRelative(NOW - 86400 * 14, "ru", NOW)).toBe("2 нед");
  });

  it("30 d+ → localized date string", () => {
    const out = formatRelative(NOW - 86400 * 60, "ru", NOW);
    expect(out).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/);
  });

  it("clamps negative diffs (clock skew) to 'только что'", () => {
    expect(formatRelative(NOW + 100, "ru", NOW)).toBe("только что");
  });
});

describe("formatRelative (English / Polish / Ukrainian)", () => {
  const NOW = 1_700_000_000;

  it("English renders English copy", () => {
    expect(formatRelative(NOW - 5, "en", NOW)).toBe("just now");
    expect(formatRelative(NOW - 60, "en", NOW)).toBe("1m");
    expect(formatRelative(NOW - 3600, "en", NOW)).toBe("1h");
    expect(formatRelative(NOW - 86400, "en", NOW)).toBe("1d");
  });

  it("Polish renders Polish copy", () => {
    expect(formatRelative(NOW - 5, "pl", NOW)).toBe("przed chwilą");
    expect(formatRelative(NOW - 60, "pl", NOW)).toBe("1 min");
    expect(formatRelative(NOW - 3600, "pl", NOW)).toBe("1 godz.");
  });

  it("Ukrainian renders Ukrainian copy", () => {
    expect(formatRelative(NOW - 5, "ua", NOW)).toBe("щойно");
    expect(formatRelative(NOW - 60, "ua", NOW)).toBe("1 хв");
  });
});

describe("timeBucket (/notifications page splits)", () => {
  const NOW = 1_700_000_000;

  it("< 24 h → today", () => {
    expect(timeBucket(NOW - 60, NOW)).toBe("today");
    expect(timeBucket(NOW - 86399, NOW)).toBe("today");
  });

  it("1 d..7 d → week", () => {
    expect(timeBucket(NOW - 86400, NOW)).toBe("week");
    expect(timeBucket(NOW - 86400 * 6, NOW)).toBe("week");
  });

  it("7 d+ → older", () => {
    expect(timeBucket(NOW - 86400 * 7, NOW)).toBe("older");
    expect(timeBucket(NOW - 86400 * 365, NOW)).toBe("older");
  });

  it("Localized titles via timeBucketTitle()", () => {
    expect(timeBucketTitle("today", "ru")).toBe("Сегодня");
    expect(timeBucketTitle("today", "pl")).toBe("Dziś");
    expect(timeBucketTitle("today", "en")).toBe("Today");
    expect(timeBucketTitle("today", "ua")).toBe("Сьогодні");
    expect(timeBucketTitle("week", "pl")).toBe("W tym tygodniu");
    expect(timeBucketTitle("older", "en")).toBe("Earlier");
  });

  it("Deprecated TIME_BUCKET_TITLE map still resolves to Russian", () => {
    expect(TIME_BUCKET_TITLE.today).toBe("Сегодня");
    expect(TIME_BUCKET_TITLE.week).toBe("На этой неделе");
    expect(TIME_BUCKET_TITLE.older).toBe("Ранее");
  });
});

describe("bellGroup (dropdown splits)", () => {
  const NOW = 1_700_000_000;

  it("< 24 h → new", () => {
    expect(bellGroup(NOW - 60, NOW)).toBe("new");
    expect(bellGroup(NOW - 86399, NOW)).toBe("new");
  });

  it("24 h+ → earlier", () => {
    expect(bellGroup(NOW - 86400, NOW)).toBe("earlier");
  });

  it("Localized titles via bellGroupTitle()", () => {
    expect(bellGroupTitle("new", "ru")).toBe("Новые");
    expect(bellGroupTitle("new", "pl")).toBe("Nowe");
    expect(bellGroupTitle("new", "en")).toBe("New");
    expect(bellGroupTitle("earlier", "ua")).toBe("Раніше");
  });

  it("Deprecated BELL_GROUP_TITLE map still resolves to Russian", () => {
    expect(BELL_GROUP_TITLE.new).toBe("Новые");
    expect(BELL_GROUP_TITLE.earlier).toBe("Ранее");
  });
});
