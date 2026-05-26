/**
 * Per-`kind` UI metadata for the notification feed (bell + /notifications).
 *
 * Single source of truth so the bell dropdown and the full-history page
 * cannot drift. New writers add their domain prefix here; the UI
 * automatically picks up the icon + accent + group bucket.
 *
 * Kind convention: `<domain>.<event>`. Current writers:
 *   - reminder.fired         (reminders plugin cron)
 *   - support.reply          (support replyToTicket)
 *   - support.ticket.new     (support createTicket fan-out)
 *   - support.ticket.reply   (support replyToMyTicket fan-out)
 *   - birthday.client        (birthday cron — tenant_owner)
 *   - appointment.created    (notifyAptStaff — master in-app)
 *   - appointment.confirmed  (notifyAptStaffAutoConfirmed)
 *   - appointment.cancelled  (notifyStaffAptCancelled)
 *   - appointment.rescheduled(reschedule notify)
 *   - appointment.no_show_client (post-visit dispatcher)
 *   - appointment.no_show_master (post-visit dispatcher)
 *   - appointment.done       (post-visit dispatcher)
 *   - master.invite          (salon.sendMasterInvitation + auth backfill)
 *   - platform.message       (platformMessenger sendDirectMessage / broadcast)
 *   - platform.reply         (platformMessenger sendMyReply — fans to all sysadmins)
 *   - billing.alert          (billing status flip — see Worker writer)
 *   - marketing.campaign.sent(future — campaign delivery report)
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Cake,
  Calendar,
  CreditCard,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  Star,
  UserPlus,
  // PR-B additions: channel = urgent operator signal, client = informational.
  AlertTriangle,
  Users,
} from "lucide-react";
import { formatRelativeShort, t, type Lang } from "~/lib/i18n";

export type NotifKind = string;

export interface KindMeta {
  icon: LucideIcon;
  /** Tailwind classes for the small circular icon container. */
  accent: string;
  /** Stable visual category — also used by prefs / settings. */
  category:
    | "support"
    | "appointment"
    | "birthday"
    | "billing"
    | "marketing"
    | "messenger"
    | "platform"
    | "reminder"
    | "master"
    | "channel"
    | "client"
    | "generic";
}

const META_BY_PREFIX: Array<[string, KindMeta]> = [
  ["support.", { icon: LifeBuoy, accent: "text-emerald-500 bg-emerald-500/10", category: "support" }],
  ["appointment.", { icon: Calendar, accent: "text-sky-500 bg-sky-500/10", category: "appointment" }],
  ["birthday.", { icon: Cake, accent: "text-pink-500 bg-pink-500/10", category: "birthday" }],
  ["billing.", { icon: CreditCard, accent: "text-amber-500 bg-amber-500/10", category: "billing" }],
  ["marketing.", { icon: Star, accent: "text-violet-500 bg-violet-500/10", category: "marketing" }],
  ["platform.", { icon: Megaphone, accent: "text-fuchsia-500 bg-fuchsia-500/10", category: "platform" }],
  ["messenger.", { icon: MessageCircle, accent: "text-indigo-500 bg-indigo-500/10", category: "messenger" }],
  ["thread.", { icon: MessageCircle, accent: "text-indigo-500 bg-indigo-500/10", category: "messenger" }],
  ["reminder.", { icon: Bell, accent: "text-cyan-500 bg-cyan-500/10", category: "reminder" }],
  ["master.", { icon: UserPlus, accent: "text-emerald-500 bg-emerald-500/10", category: "master" }],
  // PR-B: channel.broken / channel.degraded — red triangle, urgent operator action.
  ["channel.", { icon: AlertTriangle, accent: "text-rose-500 bg-rose-500/10", category: "channel" }],
  // PR-B: client.new / client.first_booking — neutral teal, informational.
  ["client.", { icon: Users, accent: "text-teal-500 bg-teal-500/10", category: "client" }],
];

const GENERIC: KindMeta = { icon: Bell, accent: "text-slate-500 bg-slate-500/10", category: "generic" };

export function kindMeta(kind: NotifKind): KindMeta {
  for (const [prefix, meta] of META_BY_PREFIX) {
    if (kind.startsWith(prefix)) return meta;
  }
  return GENERIC;
}

/**
 * Render unix-seconds timestamp as a short, locale-aware relative label.
 * Delegates to formatRelativeShort in lib/i18n so all callers pick up the
 * same plural/format treatment.
 */
export function formatRelative(
  unix: number,
  lang: Lang = "ru",
  now: number = Math.floor(Date.now() / 1000),
): string {
  return formatRelativeShort(unix, lang, now * 1000);
}

export type TimeBucket = "today" | "week" | "older";

/** Used by the full-history page for the «Сегодня / На этой неделе / Ранее» splits. */
export function timeBucket(
  unix: number,
  now: number = Math.floor(Date.now() / 1000),
): TimeBucket {
  const diff = now - unix;
  if (diff < 86400) return "today";
  if (diff < 7 * 86400) return "week";
  return "older";
}

/** Localized bucket headings — pass the active Lang. */
export function timeBucketTitle(bucket: TimeBucket, lang: Lang): string {
  if (bucket === "today") return t("notifications.bucket.today", lang);
  if (bucket === "week") return t("notifications.bucket.week", lang);
  return t("notifications.bucket.older", lang);
}

/**
 * Bell dropdown groups: rows from the last 24h land in «Новые», older in
 * «Ранее». FB / VK use this exact split, and it works better than splitting
 * by read/unread because a row stays "новое" even after the user has
 * scanned the bell once.
 */
export type BellGroup = "new" | "earlier";

export function bellGroup(
  unix: number,
  now: number = Math.floor(Date.now() / 1000),
): BellGroup {
  return now - unix < 86400 ? "new" : "earlier";
}

export function bellGroupTitle(group: BellGroup, lang: Lang): string {
  return group === "new"
    ? t("notifications.group.new", lang)
    : t("notifications.group.earlier", lang);
}

/**
 * @deprecated Use `timeBucketTitle(bucket, lang)` instead. Kept for backward
 *  compatibility with anything still importing this Record (tests, old
 *  consumers). The default value matches the historical Russian copy.
 */
export const TIME_BUCKET_TITLE: Record<TimeBucket, string> = {
  today: "Сегодня",
  week: "На этой неделе",
  older: "Ранее",
};

/**
 * @deprecated Use `bellGroupTitle(group, lang)` instead. Kept for backward
 *  compatibility.
 */
export const BELL_GROUP_TITLE: Record<BellGroup, string> = {
  new: "Новые",
  earlier: "Ранее",
};
