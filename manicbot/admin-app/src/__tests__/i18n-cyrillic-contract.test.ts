/**
 * Contract test — every dictionary key that we add for cleaning EN-leakage
 * bugs MUST resolve to a non-Cyrillic string in en/pl. ua/ru naturally use
 * Cyrillic and are not checked.
 *
 * When you fix a new EN-leak by routing it through `t()`, append the key
 * here so the test locks the translation in.
 */
import { describe, it, expect } from "vitest";
import { t, type TranslationKey } from "~/lib/i18n";

const KEYS: TranslationKey[] = [
  // Onboarding checklist (PR cd66d9b)
  "onboarding.checklist.title",
  "onboarding.checklist.add_service",
  "onboarding.checklist.connect_bot",
  "onboarding.checklist.invite_master",
  "onboarding.checklist.set_schedule",
  "onboarding.checklist.share_link",
  "onboarding.checklist.first_booking",

  // Appointments quick actions
  "appointments.newBooking",

  // Common
  "common.add",
  "common.edit",
  "common.cancel",
  "common.description",
  "common.errorLoading",

  // Salon dashboard tab labels
  "salon.tabs.channels",
  "salon.tabs.reviews",
  "salon.tabs.analytics",
  "salon.tabs.promoCodes",
  "salon.tabs.publicProfile",
  "salon.tabs.staff",

  // Master dashboard — appointment status / period labels
  "master.noShow.client",
  "master.noShow.master",
  "master.noShow.fallback",
  "master.cancelled.client",
  "master.cancelled.master",
  "master.cancelled.admin",

  // Master dashboard — banners / placeholders / forms
  "master.testAccountBanner",
  "master.fallbackName",
  "master.svcNamePlaceholder",
  "master.svcDescriptionPlaceholder",
  "master.promoSticker",
  "master.svcPromoPlaceholder",
  "master.servicePhotos",
  "master.photoUploadError",
  "master.bioLabel",
  "master.bioPlaceholder",
  "master.portfolioLabel",
  "master.saveProfile",
  "master.promoPresetHit",
  "master.promoPresetNew",
  "master.promoPresetDiscount",
];

const CYRILLIC = /[А-Яа-яЁёЇїІіЄєҐґ]/;

describe("i18n — EN/PL strings have no Cyrillic leakage", () => {
  it.each(KEYS)("%s — en is non-Cyrillic", (key) => {
    const v = t(key, "en");
    expect(v, `key ${key} returned empty/missing on EN`).toBeTruthy();
    expect(v).not.toMatch(CYRILLIC);
  });

  it.each(KEYS)("%s — pl is non-Cyrillic", (key) => {
    const v = t(key, "pl");
    expect(v, `key ${key} returned empty/missing on PL`).toBeTruthy();
    expect(v).not.toMatch(CYRILLIC);
  });
});
