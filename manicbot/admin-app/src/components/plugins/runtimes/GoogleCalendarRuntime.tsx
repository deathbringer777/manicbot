"use client";

import { ExternalLink, CheckCircle2, AlertCircle, Loader2, Link as LinkIcon, Power } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { api } from "~/trpc/react";
import { toast } from "~/lib/toast";
import type { PluginRuntimeProps } from "../runtimePanels";

const T = {
  title: { ru: "Google Календарь", ua: "Google Календар", en: "Google Calendar", pl: "Kalendarz Google" },
  subtitle: {
    ru: "Двусторонняя синхронизация записей между ManicBot и вашим Google Календарём.",
    ua: "Двостороння синхронізація записів між ManicBot та вашим Google Календарем.",
    en: "Two-way sync of appointments between ManicBot and your Google Calendar.",
    pl: "Dwustronna synchronizacja wizyt między ManicBot a Kalendarzem Google.",
  },
  notConnected: { ru: "Не подключено", ua: "Не підключено", en: "Not connected", pl: "Niepodłączone" },
  howToConnect: { ru: "Как подключить", ua: "Як підключити", en: "How to connect", pl: "Jak podłączyć" },
  step1: {
    ru: "Откройте вашего бота в Telegram",
    ua: "Відкрийте вашого бота в Telegram",
    en: "Open your bot in Telegram",
    pl: "Otwórz swojego bota w Telegramie",
  },
  step2: {
    ru: "Отправьте команду /calendar или выберите «Google Календарь» в меню настроек",
    ua: "Надішліть команду /calendar або виберіть «Google Календар» у меню налаштувань",
    en: "Send /calendar command or pick 'Google Calendar' from the settings menu",
    pl: "Wyślij komendę /calendar lub wybierz 'Kalendarz Google' w menu ustawień",
  },
  step3: {
    ru: "Авторизуйтесь через Google и выберите календарь для синхронизации",
    ua: "Авторизуйтесь через Google та виберіть календар для синхронізації",
    en: "Authorize with Google and pick the calendar to sync",
    pl: "Zaloguj się przez Google i wybierz kalendarz do synchronizacji",
  },
  openBot: { ru: "Открыть бота", ua: "Відкрити бота", en: "Open bot", pl: "Otwórz bota" },
  connected: { ru: "Подключено", ua: "Підключено", en: "Connected", pl: "Podłączono" },
  syncOn: { ru: "Синхронизация вкл.", ua: "Синхронізація увімк.", en: "Sync on", pl: "Sync włączony" },
  syncOff: { ru: "Синхронизация выкл.", ua: "Синхронізація вимк.", en: "Sync off", pl: "Sync wyłączony" },
  disconnect: { ru: "Отключить", ua: "Відключити", en: "Disconnect", pl: "Odłącz" },
  confirmDisconnect: {
    ru: "Отключить этот календарь? Синхронизация остановится.",
    ua: "Відключити цей календар? Синхронізація зупиниться.",
    en: "Disconnect this calendar? Sync will stop.",
    pl: "Odłączyć ten kalendarz? Synchronizacja zatrzyma się.",
  },
  noTenant: {
    ru: "Этот плагин доступен владельцам салонов. Для персональных мастеров — создайте салон в Настройках.",
    ua: "Цей плагін доступний власникам салонів. Для персональних майстрів — створіть салон у Налаштуваннях.",
    en: "This plugin is available to salon owners. Personal masters: create a salon in Settings first.",
    pl: "Ta wtyczka jest dostępna dla właścicieli salonów. Mistrzowie prywatni: utwórz salon w Ustawieniach.",
  },
  loadError: {
    ru: "Не удалось загрузить интеграции. Попробуйте позже.",
    ua: "Не вдалося завантажити інтеграції. Спробуйте пізніше.",
    en: "Could not load integrations. Please try again later.",
    pl: "Nie udało się wczytać integracji. Spróbuj później.",
  },
} as const;

export default function GoogleCalendarRuntime({ installationId }: PluginRuntimeProps) {
  const { lang } = useLang();
  const { tenantId, role } = useRole();

  const listQ = api.googleCalendar.list.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: !!tenantId && (role === "tenant_owner" || role === "master"), retry: false }
  );
  const connectInfoQ = api.googleCalendar.getConnectInfo.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: !!tenantId, retry: false }
  );

  const utils = api.useUtils();
  const toggleSyncMut = api.googleCalendar.toggleSync.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const disconnectMut = api.googleCalendar.disconnect.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  if (!tenantId) {
    return (
      <div data-testid="google-calendar-runtime" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2">
        <AlertCircle size={16} className="flex-none mt-0.5" />
        <span>{T.noTenant[lang]}</span>
      </div>
    );
  }

  const integrations = listQ.data ?? [];
  const botLink = connectInfoQ.data?.botLink ?? null;

  return (
    <div data-testid="google-calendar-runtime" className="space-y-4">
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{T.title[lang]}</h3>
        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">{T.subtitle[lang]}</p>
      </section>

      {listQ.isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-500 p-4"><Loader2 className="animate-spin" size={14} /> …</div>
      )}

      {listQ.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle size={16} className="flex-none mt-0.5" />
          <span>{T.loadError[lang]}</span>
        </div>
      )}

      {!listQ.isLoading && !listQ.isError && integrations.length === 0 && (
        <section className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 p-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <AlertCircle size={14} /> {T.notConnected[lang]}
          </div>
          <h4 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{T.howToConnect[lang]}</h4>
          <ol className="mt-2 space-y-1.5 text-[13px] text-slate-600 dark:text-slate-300 list-decimal list-inside">
            <li>{T.step1[lang]}</li>
            <li>{T.step2[lang]}</li>
            <li>{T.step3[lang]}</li>
          </ol>
          {botLink && (
            <a
              data-testid="google-calendar-open-bot"
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs bg-brand-500 hover:bg-brand-600 text-white"
            >
              <ExternalLink size={12} /> {T.openBot[lang]}
            </a>
          )}
        </section>
      )}

      {integrations.length > 0 && (
        <ul data-testid="google-calendar-list" className="space-y-2">
          {integrations.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-3 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {it.calendarSummary ?? it.calendarId ?? it.providerAccountEmail}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {it.providerAccountEmail}{it.masterName ? ` · ${it.masterName}` : ""}
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[11px]">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  <span className="text-emerald-700 dark:text-emerald-300">{T.connected[lang]}</span>
                  <span className="text-slate-400">·</span>
                  <span className={it.syncEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                    {it.syncEnabled ? T.syncOn[lang] : T.syncOff[lang]}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-none">
                <button
                  type="button"
                  onClick={() => toggleSyncMut.mutate({ tenantId, integrationId: it.id, enabled: !it.syncEnabled })}
                  disabled={toggleSyncMut.isPending}
                  className="text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 inline-flex items-center gap-1"
                >
                  <LinkIcon size={11} /> {it.syncEnabled ? T.syncOff[lang] : T.syncOn[lang]}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(T.confirmDisconnect[lang])) return;
                    disconnectMut.mutate({ tenantId, integrationId: it.id });
                  }}
                  disabled={disconnectMut.isPending}
                  className="text-[11px] px-2 py-1 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 inline-flex items-center gap-1"
                >
                  <Power size={11} /> {T.disconnect[lang]}
                </button>
              </div>
            </li>
          ))}
          {botLink && (
            <li>
              <a
                href={botLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-brand-500 hover:underline"
              >
                <ExternalLink size={12} /> {T.openBot[lang]}
              </a>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
