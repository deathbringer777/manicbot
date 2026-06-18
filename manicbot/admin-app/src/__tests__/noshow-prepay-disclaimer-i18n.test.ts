/**
 * AUDIT YELLOW #4 — deposit charging is deferred.
 *
 * The no-show policy lets an owner pick `deposit50` / `deposit100`, but nothing
 * is auto-charged (no online-payment integration yet — see
 * `DEPOSIT_CHARGING_ENABLED`). The mitigation for "user sets it and nothing
 * happens" is an in-UI disclaimer (`salon.noShowPolicy.prepayNote`). This test
 * locks that disclaimer so it can't be silently dropped while charging is still
 * deferred, leaving a misleading setting behind.
 *
 * The requirement is COUPLED to the constant: the moment `DEPOSIT_CHARGING_ENABLED`
 * flips to true, the disclaimer is no longer mandatory and this test relaxes —
 * exactly when the "shown as instruction" copy should be reworded anyway.
 */
import { describe, it, expect } from "vitest";
import { t, type Lang } from "~/lib/i18n";
import { DEPOSIT_CHARGING_ENABLED } from "~/server/policy/noShowPolicy";

const LANGS: Lang[] = ["ru", "ua", "en", "pl"];

// Per-locale markers: the note must convey BOTH that prepayment is currently
// advisory (instruction/message), AND that real charging is future-tense
// (online-payment integration / "for now"). Reworded copy survives as long as
// it keeps both meanings; deleting the deferral disclaimer fails.
const ADVISORY: Record<Lang, RegExp> = {
  ru: /инструкци|показыва|сообщени/i,
  ua: /інструкці|показуют|повідомлен/i,
  en: /instruction|shown|message/i,
  pl: /instrukcj|pokazywane|wiadomo/i,
};
const DEFERRED: Record<Lang, RegExp> = {
  ru: /автосписан|онлайн-оплат|интеграц|позже|пока/i,
  ua: /автосписанн|онлайн-оплат|інтеграц|пізніше|поки/i,
  en: /automatic charging|online payment|integrat|later|for now/i,
  pl: /automatyczne pobieranie|płatności online|integracj|później|na razie/i,
};

describe("no-show deposit disclaimer (AUDIT YELLOW #4)", () => {
  it("the deposit options still exist in every locale (sanity)", () => {
    for (const lang of LANGS) {
      expect(t("salon.noShowPolicy.prepay.deposit50", lang).trim()).not.toBe("");
      expect(t("salon.noShowPolicy.prepay.deposit100", lang).trim()).not.toBe("");
    }
  });

  it("prepayNote is present and conveys the deferral in all 4 locales while charging is off", () => {
    if (DEPOSIT_CHARGING_ENABLED) {
      // Real charging is live — the "shown as instruction only" disclaimer is no
      // longer required. Nothing to enforce here.
      return;
    }
    const broken: string[] = [];
    for (const lang of LANGS) {
      const note = t("salon.noShowPolicy.prepayNote", lang);
      if (!note || note.trim() === "") {
        broken.push(`${lang}: prepayNote missing/empty`);
        continue;
      }
      if (!ADVISORY[lang].test(note)) {
        broken.push(`${lang}: prepayNote lost the "advisory/instruction" meaning`);
      }
      if (!DEFERRED[lang].test(note)) {
        broken.push(`${lang}: prepayNote lost the "charging deferred" meaning`);
      }
    }
    expect(broken).toEqual([]);
  });
});
