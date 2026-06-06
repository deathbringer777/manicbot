"use client";

/**
 * NotificationsSection — settings panel for the bell + browser-push fanout.
 *
 * Three blocks:
 *
 *  1. **Push toggle** — wraps the same usePushSubscription hook the bell
 *     footer uses, but gives the user a permanent, discoverable place to
 *     opt in. Surfaces "blocked by browser" + "VAPID not deployed" states
 *     explicitly so the user knows whether they can re-enable. Test-fire
 *     button lets them sanity-check the pipeline without waiting for a
 *     real event.
 *
 *  2. **Category preferences** — per-category in-app + push toggles. The
 *     server fans out everything by default; turning a row off writes the
 *     opt-out into `web_users.notification_prefs` and both Worker and
 *     admin-app writers honour it at fanout time.
 *
 *  3. **Scenarios** — read-only reference of what events land in each
 *     category. Solves the "I don't know what shows up here" complaint —
 *     the user can see at a glance which writers fire what kinds.
 */

import { useState } from "react";
import { Bell, BellOff, Check, RotateCcw, Sparkles, Info } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type TranslationKey } from "~/lib/i18n";
import { api } from "~/trpc/react";
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPrefs,
} from "~/lib/notifications/prefs";
import { usePushSubscription } from "~/lib/notifications/usePushSubscription";

/**
 * One-line description of which writers fire for each category. The
 * authoritative kind list lives in lib/notifications/kindMeta.ts —
 * this is the user-facing summary, not a kind catalog.
 */
type Scenario = { kind: string; descKey: TranslationKey };

const SCENARIOS: Record<NotificationCategory, Scenario[]> = {
  appointment: [
    { kind: "appointment.created", descKey: "notif.scn.appointment.created" },
    { kind: "appointment.confirmed", descKey: "notif.scn.appointment.confirmed" },
    { kind: "appointment.cancelled", descKey: "notif.scn.appointment.cancelled" },
    { kind: "appointment.rescheduled", descKey: "notif.scn.appointment.rescheduled" },
    { kind: "appointment.done", descKey: "notif.scn.appointment.done" },
    { kind: "appointment.no_show_client", descKey: "notif.scn.appointment.no_show_client" },
    { kind: "appointment.no_show_master", descKey: "notif.scn.appointment.no_show_master" },
  ],
  support: [
    { kind: "support.reply", descKey: "notif.scn.support.reply" },
    { kind: "support.ticket.new", descKey: "notif.scn.support.ticket.new" },
    { kind: "support.ticket.reply", descKey: "notif.scn.support.ticket.reply" },
    { kind: "support.test", descKey: "notif.scn.support.test" },
  ],
  birthday: [
    { kind: "birthday.client", descKey: "notif.scn.birthday.client" },
  ],
  platform: [
    { kind: "platform.message", descKey: "notif.scn.platform.message" },
    { kind: "platform.reply", descKey: "notif.scn.platform.reply" },
  ],
  master: [
    { kind: "master.invite", descKey: "notif.scn.master.invite" },
  ],
  reminder: [
    { kind: "reminder.fired", descKey: "notif.scn.reminder.fired" },
  ],
  messenger: [
    { kind: "messenger.* / thread.*", descKey: "notif.scn.messenger" },
  ],
  billing: [
    { kind: "billing.payment_failed", descKey: "notif.scn.billing.payment_failed" },
    { kind: "billing.trial_expiring_soon", descKey: "notif.scn.billing.trial_expiring_soon" },
    { kind: "billing.grace_started", descKey: "notif.scn.billing.grace_started" },
    { kind: "billing.subscription_renewed", descKey: "notif.scn.billing.subscription_renewed" },
  ],
  marketing: [
    { kind: "marketing.campaign.sent", descKey: "notif.scn.marketing.campaign.sent" },
  ],
  // PR-B (Notification Center 2.0) additions.
  channel: [
    { kind: "channel.broken", descKey: "notif.scn.channel.broken" },
    { kind: "channel.degraded", descKey: "notif.scn.channel.degraded" },
  ],
  client: [
    { kind: "client.new", descKey: "notif.scn.client.new" },
  ],
};

export function NotificationsSection() {
  const { lang } = useLang();
  const push = usePushSubscription();
  const utils = api.useUtils();

  const prefsQuery = api.notifications.getMyPrefs.useQuery(undefined, {
    staleTime: 60_000,
  });

  const setPrefsMut = api.notifications.setMyPrefs.useMutation({
    onSuccess: (next) => {
      utils.notifications.getMyPrefs.setData(undefined, next);
    },
  });
  const resetPrefsMut = api.notifications.resetMyPrefs.useMutation({
    onSuccess: (next) => {
      utils.notifications.getMyPrefs.setData(undefined, next);
    },
  });
  const testMut = api.notifications.sendTestNotification.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });

  const [testSent, setTestSent] = useState(false);

  const prefs: NotificationPrefs = prefsQuery.data ?? DEFAULT_PREFS;

  function toggle(cat: NotificationCategory, channel: "inapp" | "push") {
    setPrefsMut.mutate({
      categories: {
        [cat]: {
          ...prefs.categories[cat],
          [channel]: !prefs.categories[cat][channel],
        },
      },
    });
  }

  async function handleTest(category?: NotificationCategory) {
    await testMut.mutateAsync(category ? { category } : undefined);
    setTestSent(true);
    setTimeout(() => setTestSent(false), 4000);
  }

  return (
    <div className="space-y-6">
      {/* ────────────────── Push toggle card ────────────────── */}
      <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 shrink-0">
              <Bell className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t("notifications.settings.push.title", lang)}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t("notifications.settings.push.desc", lang)}
              </p>
            </div>
          </div>

          {!push.support && (
            <p className="text-xs text-slate-400 mt-2">
              {t("notifications.settings.push.unsupported", lang)}
            </p>
          )}

          {push.support && !push.vapidEnabled && (
            <p className="text-xs text-slate-400 mt-2">
              {t("notifications.settings.push.notConfigured", lang)}
            </p>
          )}

          {push.support && push.vapidEnabled && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {push.enabled ? (
                <button
                  type="button"
                  onClick={() => void push.unsubscribe()}
                  disabled={push.loading}
                  data-testid="notifications-section-push-off"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  {t("notifications.push.off", lang)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void push.subscribe()}
                  disabled={push.loading || push.permission === "denied"}
                  data-testid="notifications-section-push-on"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {push.permission === "denied"
                    ? t("notifications.push.denied", lang)
                    : push.loading
                    ? t("notifications.push.connecting", lang)
                    : t("notifications.push.on", lang)}
                </button>
              )}

              {push.enabled && (
                <button
                  type="button"
                  onClick={() => handleTest()}
                  disabled={testMut.isPending}
                  data-testid="notifications-section-test"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-300 bg-indigo-500/5 hover:bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("notifications.settings.push.testBtn", lang)}
                </button>
              )}

              {testSent && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-300">
                  <Check className="h-3 w-3" />
                  {t("notifications.settings.push.testSent", lang)}
                </span>
              )}

              {push.permission === "denied" && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 w-full">
                  {t("notifications.settings.push.deniedHint", lang)}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ────────────────── Categories card ────────────────── */}
      <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-hidden">
        <header className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("notifications.settings.categories.title", lang)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t("notifications.settings.categories.desc", lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => resetPrefsMut.mutate()}
            disabled={resetPrefsMut.isPending}
            data-testid="notifications-section-reset"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            {t("notifications.settings.reset", lang)}
          </button>
        </header>
        <div className="px-3 sm:px-5">
          <div className="hidden sm:grid grid-cols-[1fr,auto,auto,auto] gap-x-6 px-2 pb-1 text-[10px] uppercase tracking-wider font-bold text-slate-400">
            <span></span>
            <span className="text-center">{t("notifications.settings.col.inapp", lang)}</span>
            <span className="text-center">{t("notifications.settings.col.push", lang)}</span>
            <span className="text-center">{t("notifications.settings.col.test", lang)}</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {NOTIFICATION_CATEGORIES.map((cat) => {
              const pref = prefs.categories[cat];
              return (
                <li
                  key={cat}
                  className="grid grid-cols-[1fr,auto,auto,auto] gap-x-6 items-center py-3 px-2"
                  data-testid={`notifications-section-row-${cat}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {t(`notifications.cat.${cat}` as never, lang)}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {t(`notifications.cat.${cat}.desc` as never, lang)}
                    </p>
                  </div>
                  <Toggle
                    checked={pref.inapp}
                    onChange={() => toggle(cat, "inapp")}
                    label={t("notifications.settings.col.inapp", lang)}
                    testId={`toggle-${cat}-inapp`}
                  />
                  <Toggle
                    checked={pref.push}
                    onChange={() => toggle(cat, "push")}
                    label={t("notifications.settings.col.push", lang)}
                    disabled={!push.enabled && !pref.push}
                    testId={`toggle-${cat}-push`}
                  />
                  {/*
                    PR-D: per-category test fire. Click drops a
                    <category>.test row into the bell so the user can
                    verify the in-app+push pipeline end-to-end. The
                    notifyWebUser prefs gate is honoured — if the user
                    has the in-app toggle off for this category, the
                    row will be silently skipped (the returned
                    skippedByPrefs flag confirms it landed at the
                    server but was deliberately not delivered).
                  */}
                  <button
                    type="button"
                    onClick={() => void handleTest(cat)}
                    disabled={testMut.isPending}
                    data-testid={`notifications-section-test-${cat}`}
                    title={t("notifications.settings.testBtnTitle", lang)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-50 transition-colors"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ────────────────── Scenarios reference card ────────────────── */}
      <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-hidden">
        <header className="p-5 pb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 shrink-0">
            <Info className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("notifications.settings.scenarios.title", lang)}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t("notifications.settings.scenarios.desc", lang)}
            </p>
          </div>
        </header>
        <div className="px-5 pb-5 space-y-3">
          {NOTIFICATION_CATEGORIES.map((cat) => (
            <div key={cat} className="rounded-xl bg-slate-50 dark:bg-white/[0.02] p-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                {t(`notifications.cat.${cat}` as never, lang)}
              </p>
              <ul className="space-y-1">
                {SCENARIOS[cat].map((s) => (
                  <li
                    key={s.kind}
                    className="text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed"
                  >
                    {s.kind} — {t(s.descKey, lang)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      data-checked={checked ? "true" : "false"}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mx-auto disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-brand-500" : "bg-slate-300 dark:bg-white/10"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
