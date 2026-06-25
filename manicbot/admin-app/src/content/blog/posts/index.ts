import type { BlogArticle } from "../types";
import { aiBeautyTrends2026 } from "./ai-beauty-trends-2026";
import { aiReceptionist247 } from "./ai-receptionist-247";
import { automateSalonBooking } from "./automate-salon-booking";
import { bookingConversion } from "./booking-conversion";
import { channelsCompared2026 } from "./channels-compared-2026";
import { clientRetentionLoyalty } from "./client-retention-loyalty";
import { dynamicPricingSalon } from "./dynamic-pricing-salon";
import { firstClientIn10Minutes } from "./first-client-in-10-minutes";
import { googleCalendarSync } from "./google-calendar-sync";
import { instagramBookings2026 } from "./instagram-bookings-2026";
import { localSeoNailSalon } from "./local-seo-nail-salon";
import { nailClientsSurvey2026 } from "./nail-clients-survey-2026";
import { nailSalonPricingGuide } from "./nail-salon-pricing-guide";
import { nailTrends2026 } from "./nail-trends-2026";
import { reduceNoShows } from "./reduce-no-shows";
import { salonBookingSoftwarePoland2026 } from "./salon-booking-software-poland-2026";
import { salonReviewsReputation } from "./salon-reviews-reputation";
import { scaleSoloToTeam } from "./scale-solo-to-team";
import { seasonalMarketingCalendar } from "./seasonal-marketing-calendar";
import { tiktokForNailSalons } from "./tiktok-for-nail-salons";
import { whatsappInstagramChannels } from "./whatsapp-instagram-channels";

/**
 * Editorial ordering decision: newest first when displayed; declared here in
 * date order so a `git diff` after adding a new article shows up as an append.
 * BlogClient re-sorts by `date.localeCompare` on render — the array order here
 * is for editor sanity, not for the UI.
 */
export const ALL_BLOG_ARTICLES: BlogArticle[] = [
  salonBookingSoftwarePoland2026, // 2026-06-25
  instagramBookings2026, // 2026-06-01
  tiktokForNailSalons, // 2026-05-30
  localSeoNailSalon, // 2026-05-29
  salonReviewsReputation, // 2026-05-28
  nailSalonPricingGuide, // 2026-05-27
  clientRetentionLoyalty, // 2026-05-26
  scaleSoloToTeam, // 2026-05-23
  seasonalMarketingCalendar, // 2026-05-22
  aiBeautyTrends2026, // 2026-05-21
  bookingConversion, // 2026-05-19
  channelsCompared2026, // 2026-05-15
  nailClientsSurvey2026, // 2026-05-12
  aiReceptionist247, // 2026-05-08
  dynamicPricingSalon, // 2026-05-01
  automateSalonBooking, // 2026-04-01
  reduceNoShows, // 2026-03-25
  nailTrends2026, // 2026-03-18
  whatsappInstagramChannels, // 2026-03-10
  googleCalendarSync, // 2026-03-03
  firstClientIn10Minutes, // 2026-02-24
];
