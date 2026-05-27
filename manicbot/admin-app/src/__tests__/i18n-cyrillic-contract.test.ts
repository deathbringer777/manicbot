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

  // Manual booking modal (PR i18n/ManualBookingModal)
  "appointments.manual.title",
  "appointments.manual.slotConflict",
  "appointments.manual.somethingWrong",
  "appointments.manual.fillRequired",
  "appointments.manual.pickClient",
  "appointments.manual.client",
  "appointments.manual.newClient",
  "appointments.manual.noName",
  "appointments.manual.clientNamePh",
  "appointments.manual.master",
  "appointments.manual.pickPlaceholder",
  "appointments.manual.service",
  "appointments.manual.date",
  "appointments.manual.time",
  "appointments.manual.note",
  "appointments.manual.create",
  "appointments.manual.creating",
  "appointments.manual.fixToContinue",
  "appointments.manual.issues.master",
  "appointments.manual.issues.service",
  "appointments.manual.issues.date",
  "appointments.manual.issues.time",
  "appointments.manual.issues.clientName",
  "appointments.manual.issues.clientPhone",
  "appointments.manual.needMasters",
  "appointments.manual.needServices",

  // Common
  "common.add",
  "common.edit",
  "common.cancel",
  "common.description",
  "common.errorLoading",

  // Salon dashboard body (auto-confirm, channels[], public profile, branding)
  "salon.autoConfirm.title", "salon.autoConfirm.body",
  "salon.channels.web.label", "salon.channels.web.hint",
  "salon.channels.telegram.hint", "salon.channels.whatsapp.hint",
  "salon.channels.instagram.label", "salon.channels.instagram.hint",
  "salon.publicProfile.title", "salon.publicProfile.visibleInCatalog",
  "salon.publicProfile.hiddenFromCatalog", "salon.publicProfile.hide",
  "salon.publicProfile.publish", "salon.publicProfile.cantPublish",
  "salon.publicProfile.editProfile", "salon.publicProfile.slugReq",
  "salon.publicProfile.nameReq", "salon.publicProfile.servicesReq",
  "salon.publicProfile.slugError", "salon.publicProfile.setSlugFirst",
  "salon.publicProfile.showInCatalog", "salon.publicProfile.findInSearch",
  "salon.publicProfile.taken", "salon.publicProfile.city",
  "salon.publicProfile.descriptionPlaceholder", "salon.publicProfile.mapsLabel",
  "salon.publicProfile.mapsPlaceholder", "salon.publicProfile.coords",
  "salon.publicProfile.coordsBad", "salon.publicProfile.gallery",
  "salon.publicProfile.gallerySimple", "salon.publicProfile.savePublic",
  "salon.branding.displayName", "salon.branding.displayNameOptional",
  "salon.branding.displayNameHint", "salon.branding.logo",
  "salon.branding.logoHint", "salon.branding.cover",
  "salon.branding.coverHint", "salon.branding.brandColor",
  "salon.cal.calendar", "salon.cal.list", "salon.cal.todaySmall",
  "salon.cal.today", "salon.cal.pending", "salon.cal.confirmed",
  "salon.empty.masters",

  // Channels tab (SalonChannelsTab)
  "channels.copied", "channels.copy", "channels.botConnected", "channels.status",
  "channels.active", "channels.openBot", "channels.disconnectBotConfirm",
  "channels.disconnectBot", "channels.botNotConnected", "channels.botToken",
  "channels.botTokenPlaceholder", "channels.connecting", "channels.connectBot",
  "channels.igConnected", "channels.igDisconnectConfirm", "channels.disconnectIg",
  "channels.igAccountId", "channels.igBusinessId", "channels.igNotConnected",
  "channels.connectIg", "channels.metaContactSupport", "channels.webhookUnavailable",
  "channels.waConnected", "channels.waDisconnectConfirm", "channels.disconnectWa",
  "channels.webNotSet", "channels.setupWebInTab",
  "channels.webProfile", "channels.published", "channels.hiddenFromCatalog",
  "channels.open", "channels.profileUrl", "channels.qrCode", "channels.qrHint",
  "channels.downloadPng", "channels.tabWeb",

  // Charts / referral / billing / asset / tracking
  "charts.tooltipBookings", "charts.tooltipSignups", "charts.signupsTitle",
  "charts.noPeriodData", "charts.byDayStack", "charts.noDailySignups",
  "referral.friends", "referral.other", "referral.unspecified",
  "billing.openFailed", "billing.changePlan", "billing.monthly",
  "billing.yearly", "billing.current", "billing.perMonth",
  "billing.switchToYearly", "billing.choose", "billing.yearlyDiscount",
  "asset.uploading", "asset.replace", "asset.upload", "asset.remove",
  "tracking.source", "tracking.channel", "tracking.campaign",
  "tracking.content", "tracking.connectFirst", "tracking.copy",
  "tracking.qrCode", "tracking.token",

  // Analytics tab
  "analytics.title", "analytics.daysShort", "analytics.empty.title",
  "analytics.empty.text", "analytics.createLink", "analytics.newClients",
  "analytics.lastNDays", "analytics.daysWord", "analytics.bookings",
  "analytics.uniqueHint", "analytics.conversion", "analytics.touchToBookHint",
  "analytics.trafficSources", "analytics.noDataPeriod", "analytics.funnel",
  "analytics.topCampaigns", "analytics.colSource", "analytics.colCampaign",
  "analytics.colClients", "analytics.colBookings", "analytics.colConv",
  "analytics.noCampaigns",
  "analytics.source.qr", "analytics.source.website", "analytics.source.flyer",
  "analytics.source.direct", "analytics.source.other",

  // Stamp card + Promo codes (PromoCodesTab)
  "stamp.title", "stamp.subtitle", "stamp.disable", "stamp.enable",
  "stamp.visitsRequired", "stamp.rewardType", "stamp.freeService",
  "stamp.percentOff", "stamp.fixedOff", "stamp.discountPercent",
  "stamp.discountAmount", "stamp.saving",
  "promo.requiredFields", "promo.createError", "promo.newTitle",
  "promo.random", "promo.discountType", "promo.percent", "promo.fixedPln",
  "promo.value", "promo.validDays", "promo.maxUses", "promo.creating",
  "promo.create", "promo.activeTitle", "promo.loading", "promo.empty",
  "promo.expired", "promo.until", "promo.uses", "promo.confirmDelete",

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
