import type { BlogArticle } from "../types";
import { aiReceptionist247 } from "./ai-receptionist-247";
import { automateSalonBooking } from "./automate-salon-booking";
import { channelsCompared2026 } from "./channels-compared-2026";
import { dynamicPricingSalon } from "./dynamic-pricing-salon";
import { firstClientIn10Minutes } from "./first-client-in-10-minutes";
import { googleCalendarSync } from "./google-calendar-sync";
import { nailClientsSurvey2026 } from "./nail-clients-survey-2026";
import { nailTrends2026 } from "./nail-trends-2026";
import { reduceNoShows } from "./reduce-no-shows";
import { whatsappInstagramChannels } from "./whatsapp-instagram-channels";

/**
 * Editorial ordering decision: newest first when displayed; declared here in
 * date order so a `git diff` after adding a new article shows up as an append.
 * BlogClient re-sorts by `date.localeCompare` on render — the array order here
 * is for editor sanity, not for the UI.
 */
export const ALL_BLOG_ARTICLES: BlogArticle[] = [
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
