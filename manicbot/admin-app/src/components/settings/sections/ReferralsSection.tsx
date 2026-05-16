"use client";

/**
 * Referrals settings section (PR-B / migration 0069).
 *
 * Surface for self-registered owners + personal-tenant masters to:
 *   - see + copy + share their personal referral code / URL
 *   - view invited friends (masked names, status pills)
 *   - see issued rewards + remaining annual cap (6 / 12mo sliding)
 *
 * Eligibility is enforced server-side; this client renders a friendly
 * empty state if the API throws FORBIDDEN (e.g. tenant_manager opens
 * /settings?section=referrals directly).
 */

import { useState } from "react";
import { Award, Copy, Gift, Loader2, MessageCircle, RefreshCw, Send, Share2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";

// Milestone thresholds — confirmed-referral counts that unlock a badge.
// Aligns with the CFO-locked cap (6 rewards / 12mo) — last milestone is 10
// as an aspirational marker even though the practical ceiling per year is 6.
const MILESTONES = [1, 3, 5, 10] as const;

const COPY = {
  ru: {
    title: "Поделиться с другом",
    yourCode: "Ваш код",
    yourLink: "Ваша ссылка",
    copy: "Копировать",
    copied: "Скопировано",
    share: "Поделиться",
    rotate: "Сменить код",
    rotateConfirm: "Сгенерировать новый код? Старая ссылка перестанет работать.",
    friendGets: "Друг получает",
    friendDetail: "20% off первого месяца или 10% off годовой подписки",
    youGet: "Вы получаете",
    youDetail: "1 бесплатный месяц за каждого подтверждённого друга (макс. 6 в год)",
    legalPrefix: "В соответствии с ",
    legalLinkText: "правилами пользования",
    stats: "Статистика",
    invited: "Приглашено",
    confirmed: "Подтверждено",
    earned: "Заработано",
    capUsed: "Использовано в этом году",
    cap: "Лимит",
    invitedFriends: "Приглашённые друзья",
    noInvitedFriends: "Пока никого не пригласили. Скопируйте ссылку и поделитесь в WhatsApp / Telegram / IG.",
    statusPending: "Ожидает оплаты",
    statusFirstPaid: "Оплатил",
    statusRewarded: "Награда выдана",
    statusInvalidated: "Не засчитан",
    statusClawback: "Возврат",
    rewards: "Награды",
    forbidden: "Реферальная программа доступна только владельцам и индивидуальным мастерам.",
    error: "Не удалось загрузить данные",
    milestones: "Достижения",
    milestoneLabel: "{n} приглашённых",
    shareWhatsApp: "WhatsApp",
    shareTelegram: "Telegram",
    shareIG: "Instagram",
    shareTemplate: "Привет! Записываю клиентов через ManicBot — реально удобно (TG/WA/IG, напоминания, Google Calendar). По моей ссылке тебе 20% off первого месяца:",
  },
  ua: {
    title: "Поділитися з другом",
    yourCode: "Ваш код",
    yourLink: "Ваше посилання",
    copy: "Копіювати",
    copied: "Скопійовано",
    share: "Поділитися",
    rotate: "Змінити код",
    rotateConfirm: "Згенерувати новий код? Старе посилання перестане працювати.",
    friendGets: "Друг отримує",
    friendDetail: "20% off першого місяця або 10% off річної підписки",
    youGet: "Ви отримуєте",
    youDetail: "1 безкоштовний місяць за кожного підтвердженого друга (макс. 6 на рік)",
    legalPrefix: "Згідно з ",
    legalLinkText: "правилами користування",
    stats: "Статистика",
    invited: "Запрошено",
    confirmed: "Підтверджено",
    earned: "Зароблено",
    capUsed: "Використано цього року",
    cap: "Ліміт",
    invitedFriends: "Запрошені друзі",
    noInvitedFriends: "Поки нікого не запросили. Скопіюйте посилання та поділіться в WhatsApp / Telegram / IG.",
    statusPending: "Чекає оплати",
    statusFirstPaid: "Оплатив",
    statusRewarded: "Винагороду видано",
    statusInvalidated: "Не зараховано",
    statusClawback: "Повернення",
    rewards: "Винагороди",
    forbidden: "Реферальна програма доступна тільки власникам та індивідуальним майстрам.",
    error: "Не вдалося завантажити дані",
    milestones: "Досягнення",
    milestoneLabel: "{n} запрошених",
    shareWhatsApp: "WhatsApp",
    shareTelegram: "Telegram",
    shareIG: "Instagram",
    shareTemplate: "Привіт! Записую клієнтів через ManicBot — реально зручно (TG/WA/IG, нагадування, Google Calendar). За моїм посиланням тобі 20% off першого місяця:",
  },
  en: {
    title: "Refer a friend",
    yourCode: "Your code",
    yourLink: "Your link",
    copy: "Copy",
    copied: "Copied",
    share: "Share",
    rotate: "Rotate code",
    rotateConfirm: "Generate a new code? The old link will stop working.",
    friendGets: "Your friend gets",
    friendDetail: "20% off their first month or 10% off yearly",
    youGet: "You get",
    youDetail: "1 free month per confirmed friend (max 6 per year)",
    legalPrefix: "As described in the ",
    legalLinkText: "terms of use",
    stats: "Stats",
    invited: "Invited",
    confirmed: "Confirmed",
    earned: "Earned",
    capUsed: "Used this year",
    cap: "Cap",
    invitedFriends: "Invited friends",
    noInvitedFriends: "No friends invited yet. Copy your link and share via WhatsApp / Telegram / IG.",
    statusPending: "Awaiting payment",
    statusFirstPaid: "Paid first invoice",
    statusRewarded: "Reward issued",
    statusInvalidated: "Not counted",
    statusClawback: "Reversed",
    rewards: "Rewards",
    forbidden: "Referrals are only available to owners and independent masters.",
    error: "Could not load data",
    milestones: "Milestones",
    milestoneLabel: "{n} invited",
    shareWhatsApp: "WhatsApp",
    shareTelegram: "Telegram",
    shareIG: "Instagram",
    shareTemplate: "Hey! I run my client bookings through ManicBot — really nice (TG/WA/IG, reminders, Google Calendar sync). My link gets you 20% off your first month:",
  },
  pl: {
    title: "Poleć znajomemu",
    yourCode: "Twój kod",
    yourLink: "Twój link",
    copy: "Kopiuj",
    copied: "Skopiowano",
    share: "Udostępnij",
    rotate: "Zmień kod",
    rotateConfirm: "Wygenerować nowy kod? Stary link przestanie działać.",
    friendGets: "Znajomy dostaje",
    friendDetail: "20% zniżki w pierwszym miesiącu lub 10% zniżki rocznie",
    youGet: "Ty dostajesz",
    youDetail: "1 darmowy miesiąc za każdego potwierdzonego znajomego (maks. 6 rocznie)",
    legalPrefix: "Zgodnie z ",
    legalLinkText: "zasadami korzystania",
    stats: "Statystyki",
    invited: "Zaproszeni",
    confirmed: "Potwierdzeni",
    earned: "Zarobione",
    capUsed: "Wykorzystane w tym roku",
    cap: "Limit",
    invitedFriends: "Zaproszeni znajomi",
    noInvitedFriends: "Jeszcze nikogo nie zaproszono. Skopiuj link i udostępnij w WhatsApp / Telegram / IG.",
    statusPending: "Oczekuje płatności",
    statusFirstPaid: "Zapłacił",
    statusRewarded: "Nagroda wydana",
    statusInvalidated: "Nie zaliczono",
    statusClawback: "Cofnięto",
    rewards: "Nagrody",
    forbidden: "Polecenia są dostępne tylko dla właścicieli i niezależnych mistrzów.",
    error: "Nie udało się załadować danych",
    milestones: "Osiągnięcia",
    milestoneLabel: "{n} zaproszonych",
    shareWhatsApp: "WhatsApp",
    shareTelegram: "Telegram",
    shareIG: "Instagram",
    shareTemplate: "Cześć! Umawiam klientów przez ManicBota — naprawdę wygodne (TG/WA/IG, przypomnienia, Google Calendar). Z mojego linku dostaniesz 20% zniżki w pierwszym miesiącu:",
  },
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  first_paid: "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  rewarded: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  invalidated: "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  clawback: "bg-slate-500/15 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.10]"
      title={label}
    >
      <Copy className="h-3.5 w-3.5" />
      {done ? copiedLabel : label}
    </button>
  );
}

export function ReferralsSection() {
  const { lang } = useLang();
  const c = COPY[lang];
  const utils = api.useUtils();
  const dashboard = api.referrals.getMyDashboard.useQuery(undefined, { retry: false });
  const rotate = api.referrals.rotateMyCode.useMutation({
    onSuccess: () => {
      void utils.referrals.getMyDashboard.invalidate();
    },
  });

  // Error states — gracefully render the FORBIDDEN copy without a stacktrace.
  if (dashboard.isError) {
    const isForbidden = dashboard.error?.data?.code === "FORBIDDEN";
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200">
        {isForbidden ? c.forbidden : c.error}
      </div>
    );
  }

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.03]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const d = dashboard.data;
  const { invited, rewards, counters, code, shareUrl } = d;

  // Append the inviter's UI language to the share URL so:
  //   1. The /register page generates OG/Twitter metadata in that language
  //      (Telegram, WhatsApp, Slack, iMessage previews match the message language).
  //   2. LangContext on the landing page auto-switches to it for the invitee.
  // Server-side buildShareUrl() stays language-agnostic — the lang is a
  // per-share concern, not a property of the code itself.
  const shareUrlLocalized = shareUrl ? `${shareUrl}&lang=${lang}` : null;

  const onShare = async () => {
    if (!shareUrlLocalized) return;
    try {
      if (navigator.share) {
        await navigator.share({ url: shareUrlLocalized, title: c.title, text: c.friendDetail });
      } else {
        await navigator.clipboard.writeText(shareUrlLocalized);
      }
    } catch {
      /* user cancelled */
    }
  };

  const onRotate = () => {
    if (!confirm(c.rotateConfirm)) return;
    rotate.mutate();
  };

  const statusLabel = (s: string): string => {
    if (s === "pending") return c.statusPending;
    if (s === "first_paid") return c.statusFirstPaid;
    if (s === "rewarded") return c.statusRewarded;
    if (s === "invalidated") return c.statusInvalidated;
    if (s === "clawback") return c.statusClawback;
    return s;
  };

  return (
    <div className="space-y-5">
      {/* Share card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <header className="mb-4 flex items-center gap-2">
          <Gift className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{c.title}</h2>
        </header>

        {code && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{c.yourCode}</p>
              <div className="flex items-center gap-2">
                <code className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold tracking-wider text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-white">
                  {code}
                </code>
                <CopyButton value={code} label={c.copy} copiedLabel={c.copied} />
                <button
                  type="button"
                  onClick={onRotate}
                  disabled={rotate.isPending}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.10]"
                  title={c.rotate}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${rotate.isPending ? "animate-spin" : ""}`} />
                  {c.rotate}
                </button>
              </div>
            </div>

            {shareUrlLocalized && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{c.yourLink}</p>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                    {shareUrlLocalized}
                  </span>
                  <CopyButton value={shareUrlLocalized} label={c.copy} copiedLabel={c.copied} />
                  <button
                    type="button"
                    onClick={onShare}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {c.share}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/20 dark:bg-emerald-500/5">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{c.friendGets}</p>
            <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">{c.friendDetail}</p>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-400/20 dark:bg-cyan-500/5">
            <p className="text-xs font-medium text-cyan-700 dark:text-cyan-300">{c.youGet}</p>
            <p className="mt-1 text-sm text-cyan-900 dark:text-cyan-100">{c.youDetail}</p>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
          {c.legalPrefix}
          <a
            href="/rules"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {c.legalLinkText}
          </a>
        </p>
      </section>

      {/* Counters */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">{c.stats}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={c.invited} value={counters.pending + counters.firstPaid + counters.rewarded} />
          <Stat label={c.confirmed} value={counters.rewarded} />
          <Stat label={c.earned} value={`${(counters.totalEarnedGrosz / 100).toFixed(0)} zł`} />
          <Stat
            label={`${c.cap} ${counters.monthsUsedInRollingYear}/6`}
            value={`${counters.monthsRemainingInCap} ${c.capUsed}`}
            small
          />
        </div>
      </section>

      {/* Milestones — only render once at least 1 invite (any status) exists,
          so the empty state stays clean. Auto-hides at 4/4 unlocked unless
          there are extra unlocked badges to show. */}
      {counters.rewarded > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Award className="h-4 w-4 text-amber-500" />
            {c.milestones}
          </h3>
          <div className="flex flex-wrap gap-2">
            {MILESTONES.map((n) => {
              const unlocked = counters.rewarded >= n;
              return (
                <div
                  key={n}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                    unlocked
                      ? "border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200"
                      : "border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-500"
                  }`}
                  title={c.milestoneLabel.replace("{n}", String(n))}
                >
                  <Award className={`h-3 w-3 ${unlocked ? "text-amber-500" : "text-slate-400"}`} />
                  {c.milestoneLabel.replace("{n}", String(n))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Invited friends */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">{c.invitedFriends}</h3>
        {invited.length === 0 ? (
          <>
            <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">{c.noInvitedFriends}</p>
            {shareUrlLocalized && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${c.shareTemplate} ${shareUrlLocalized}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {c.shareWhatsApp}
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(shareUrlLocalized)}&text=${encodeURIComponent(c.shareTemplate)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500"
                >
                  <Send className="h-3.5 w-3.5" />
                  {c.shareTelegram}
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${c.shareTemplate} ${shareUrlLocalized}`);
                    } catch { /* ignore */ }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                  title={c.shareIG}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {c.shareIG}
                </button>
              </div>
            )}
          </>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {invited.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-slate-700 dark:text-slate-200">{row.inviteeMaskedName}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[row.status] ?? STATUS_TONE.pending}`}>
                  {statusLabel(row.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Rewards history */}
      {rewards.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">{c.rewards}</h3>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-700 dark:text-slate-200">
                  {(r.amountGrosz / 100).toFixed(0)} zł
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  r.status === "applied"
                    ? "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : r.status === "expired" || r.status === "clawed_back" || r.status === "voided"
                      ? "bg-slate-500/15 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"
                      : "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                }`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, small = false }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 ${small ? "text-xs" : "text-lg"} font-bold text-slate-900 dark:text-white`}>{value}</p>
    </div>
  );
}
