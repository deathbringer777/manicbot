"use client";

/**
 * Google Calendar plugin — in-panel connect / disconnect UI.
 *
 * Replaces the old "open your Telegram bot and send /calendar" placeholder.
 * Minting the OAuth URL and saving the integration happens on the Worker;
 * this component only orchestrates the flow via tRPC.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Unplug, RefreshCw } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";

interface Props {
  installationId: string;
  slug?: string;
}

type Lang = "ru" | "ua" | "en" | "pl";

type TR = {
  title: string; subtitle: string;
  disconnectedHeadline: string; disconnectedBody: string;
  continueWithGoogle: string; connecting: string;
  connected: string; account: string; calendar: string;
  syncOn: string; syncOff: string;
  lastSync: string; never: string;
  disconnect: string; confirmDisconnect: string;
  justConnected: string;
  errorGeneric: string; errorDenied: string; errorNoCalendar: string;
};
const COPY: Record<Lang, TR> = {
  ru: {
    title: "Google Календарь",
    subtitle: "Двусторонняя синхронизация записей в реальном времени",
    disconnectedHeadline: "Подключите Google Календарь",
    disconnectedBody:
      "Записи автоматически появятся в вашем Google Календаре, а занятые слоты из календаря заблокируются в боте.",
    continueWithGoogle: "Продолжить с Google",
    connecting: "Открываем Google…",
    connected: "Подключено",
    account: "Аккаунт Google",
    calendar: "Календарь",
    syncOn: "Синхронизация включена",
    syncOff: "Синхронизация выключена",
    lastSync: "Последняя синхронизация",
    never: "ещё не было",
    disconnect: "Отключить",
    confirmDisconnect: "Отключить Google Календарь? Будущие записи больше не будут попадать в календарь.",
    justConnected: "Google Календарь подключён.",
    errorGeneric: "Не удалось подключить Google Календарь. Попробуйте ещё раз.",
    errorDenied: "Доступ отменён в Google. Подключение не завершено.",
    errorNoCalendar: "В этом Google-аккаунте нет календаря с правом записи.",
  },
  ua: {
    title: "Google Календар",
    subtitle: "Двостороння синхронізація записів у реальному часі",
    disconnectedHeadline: "Підключіть Google Календар",
    disconnectedBody:
      "Записи автоматично з'являться у вашому Google Календарі, а зайняті слоти з календаря заблокуються в боті.",
    continueWithGoogle: "Продовжити з Google",
    connecting: "Відкриваємо Google…",
    connected: "Підключено",
    account: "Акаунт Google",
    calendar: "Календар",
    syncOn: "Синхронізація увімкнена",
    syncOff: "Синхронізація вимкнена",
    lastSync: "Остання синхронізація",
    never: "ще не було",
    disconnect: "Відключити",
    confirmDisconnect: "Відключити Google Календар? Майбутні записи більше не потраплятимуть у календар.",
    justConnected: "Google Календар підключено.",
    errorGeneric: "Не вдалося підключити Google Календар. Спробуйте ще раз.",
    errorDenied: "Доступ скасовано в Google. Підключення не завершено.",
    errorNoCalendar: "У цьому Google-акаунті немає календаря з правом запису.",
  },
  en: {
    title: "Google Calendar",
    subtitle: "Two-way real-time appointment sync",
    disconnectedHeadline: "Connect Google Calendar",
    disconnectedBody:
      "Your bookings show up in Google Calendar automatically, and busy slots from your calendar block the bot.",
    continueWithGoogle: "Continue with Google",
    connecting: "Opening Google…",
    connected: "Connected",
    account: "Google account",
    calendar: "Calendar",
    syncOn: "Sync enabled",
    syncOff: "Sync paused",
    lastSync: "Last sync",
    never: "never",
    disconnect: "Disconnect",
    confirmDisconnect: "Disconnect Google Calendar? Future bookings will no longer sync to your calendar.",
    justConnected: "Google Calendar connected.",
    errorGeneric: "Couldn't connect Google Calendar. Please try again.",
    errorDenied: "Access denied in Google. Connection not completed.",
    errorNoCalendar: "No writable calendar on this Google account.",
  },
  pl: {
    title: "Kalendarz Google",
    subtitle: "Dwustronna synchronizacja wizyt w czasie rzeczywistym",
    disconnectedHeadline: "Podłącz Kalendarz Google",
    disconnectedBody:
      "Wizyty pojawią się w Kalendarzu Google automatycznie, a zajęte sloty z kalendarza zablokują bota.",
    continueWithGoogle: "Kontynuuj z Google",
    connecting: "Otwieramy Google…",
    connected: "Podłączone",
    account: "Konto Google",
    calendar: "Kalendarz",
    syncOn: "Synchronizacja włączona",
    syncOff: "Synchronizacja wstrzymana",
    lastSync: "Ostatnia synchronizacja",
    never: "jeszcze nigdy",
    disconnect: "Odłącz",
    confirmDisconnect: "Odłączyć Kalendarz Google? Przyszłe wizyty nie będą już synchronizowane.",
    justConnected: "Kalendarz Google podłączony.",
    errorGeneric: "Nie udało się podłączyć Kalendarza Google. Spróbuj ponownie.",
    errorDenied: "Dostęp odrzucony w Google. Połączenie nie zakończone.",
    errorNoCalendar: "Na tym koncie Google nie ma kalendarza z prawem zapisu.",
  },
};

function pickLang(raw: string | undefined | null): Lang {
  if (raw === "ua" || raw === "en" || raw === "pl") return raw;
  return "ru";
}

function GoogleCalendarLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" role="img">
      <path fill="#fff" d="M148.882 43.618 105 40l-48.471 3.529L53 88l3.618 45.389L105 138l44.176-2.059L152 88z" />
      <path fill="#1a73e8" d="M81.628 122.099c-3.648-2.464-6.173-6.064-7.561-10.818l8.464-3.488c.773 2.946 2.123 5.229 4.049 6.85 1.914 1.621 4.241 2.42 6.965 2.42 2.784 0 5.172-.847 7.165-2.54 1.992-1.694 2.995-3.854 2.995-6.467 0-2.673-1.051-4.857-3.152-6.55-2.1-1.694-4.736-2.54-7.884-2.54h-4.892v-8.379h4.389c2.712 0 4.995-.733 6.85-2.198 1.854-1.466 2.784-3.465 2.784-6.008 0-2.262-.833-4.066-2.496-5.421-1.662-1.355-3.768-2.039-6.322-2.039-2.496 0-4.477.66-5.941 1.999-1.46 1.324-2.556 3.019-3.152 4.917l-8.379-3.484c1.015-2.88 2.88-5.421 5.614-7.614 2.731-2.193 6.223-3.295 10.466-3.295 3.137 0 5.964.602 8.464 1.818 2.504 1.216 4.471 2.904 5.893 5.045 1.422 2.148 2.129 4.556 2.129 7.23 0 2.724-.66 5.03-1.98 6.922-1.324 1.889-2.9 3.333-4.736 4.349v.503c2.383.979 4.532 2.59 6.056 4.712 1.541 2.136 2.315 4.688 2.315 7.663 0 2.976-.757 5.628-2.27 7.951-1.516 2.324-3.609 4.148-6.259 5.47-2.661 1.324-5.647 2.001-8.96 2.001-3.841.012-7.385-1.08-10.613-3.274" />
      <path fill="#1a73e8" d="M131 77.947 121.728 84.725l-4.689-7.107 12.751-9.199h6.41v43.342H131z" />
      <path fill="#ea4335" d="m148.882 196 44.294-44.294-22.147-10.03-22.147 10.03-10.03 22.147z" />
      <path fill="#34a853" d="M32.824 171.853 42.853 196h106.029v-44.294H42.853z" />
      <path fill="#4285f4" d="M17 42.853v106.029L29.141 171.853l28.353-22.147V44.294L29.141 32.824z" />
      <path fill="#188038" d="M17 148.882V192c0 2.209 1.792 4 4 4h21.853v-44.294z" />
      <path fill="#fbbc04" d="M148.882 196H192c2.209 0 4-1.792 4-4v-43.118h-47.118z" />
      <path fill="#4285f4" d="M192 48.294V4c0-2.209-1.792-4-4-4H48.294v43.118h100.588V48.294z" />
      <path fill="#1967d2" d="M148.882 43.118V4H21c-2.209 0-4 1.791-4 4v34.853h131.882z" />
    </svg>
  );
}

function GoogleGMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function formatDate(ts: number | null | undefined, lang: Lang): string | null {
  if (!ts) return null;
  try {
    const locale = lang === "ua" ? "uk-UA" : lang === "en" ? "en-GB" : lang === "pl" ? "pl-PL" : "ru-RU";
    return new Date(ts).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(ts).toISOString();
  }
}

export default function GoogleCalendarSettingsPanel({ installationId: _installationId }: Props) {
  const { tenantId } = useRole();
  const { lang: rawLang } = useLang();
  const lang = pickLang(rawLang);
  const tr = useMemo(() => COPY[lang], [lang]);

  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const status = api.googleCalendar.getStatus.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: !!tenantId, refetchOnWindowFocus: true }
  );

  const mintUrl = api.googleCalendar.createWebConnectUrl.useMutation();
  const toggleSync = api.googleCalendar.toggleSync.useMutation({
    onSuccess: () => status.refetch(),
  });
  const disconnect = api.googleCalendar.disconnect.useMutation({
    onSuccess: () => {
      setConfirming(false);
      void status.refetch();
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setFlash({ kind: "ok", text: tr.justConnected });
      void status.refetch();
      cleanUrl();
    } else if (params.get("gcal_error")) {
      const code = params.get("gcal_error") || "";
      const msg =
        code === "access_denied"
          ? tr.errorDenied
          : code === "no_writable_calendar"
          ? tr.errorNoCalendar
          : tr.errorGeneric;
      setFlash({ kind: "err", text: msg });
      cleanUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tr]);

  const cleanUrl = () => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    u.searchParams.delete("connected");
    u.searchParams.delete("gcal_error");
    window.history.replaceState({}, "", u.toString());
  };

  const handleConnect = useCallback(async () => {
    if (!tenantId) return;
    setConnecting(true);
    setFlash(null);
    try {
      const returnUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined;
      const { connectUrl } = await mintUrl.mutateAsync({ tenantId, scope: "tenant", returnUrl });
      window.location.href = connectUrl;
    } catch (e) {
      setConnecting(false);
      setFlash({ kind: "err", text: (e as Error).message || tr.errorGeneric });
    }
  }, [tenantId, mintUrl, tr.errorGeneric]);

  if (!tenantId) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-slate-400" size={20} />
      </div>
    );
  }

  const data = status.data;
  const isConnected = data?.connected === true;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="shrink-0 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3">
          <GoogleCalendarLogo size={44} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{tr.title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr.subtitle}</p>
        </div>
      </div>

      {flash && (
        <div
          data-testid="gcal-flash"
          role="status"
          className={`mb-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${
            flash.kind === "ok"
              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-200/70 dark:border-emerald-500/20"
              : "bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-200 border border-rose-200/70 dark:border-rose-500/20"
          }`}
        >
          {flash.kind === "ok" ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          )}
          <span>{flash.text}</span>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-6 shadow-sm">
        {status.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : isConnected && data ? (
          <ConnectedState
            data={data}
            tr={tr}
            lang={lang}
            onToggle={(enabled) =>
              toggleSync.mutate({
                tenantId,
                integrationId: data.integrationId!,
                enabled,
              })
            }
            togglePending={toggleSync.isPending}
            confirming={confirming}
            setConfirming={setConfirming}
            onDisconnect={() =>
              disconnect.mutate({ tenantId, integrationId: data.integrationId! })
            }
            disconnectPending={disconnect.isPending}
          />
        ) : (
          <DisconnectedState
            tr={tr}
            connecting={connecting}
            onConnect={handleConnect}
          />
        )}
      </div>
    </div>
  );
}

function DisconnectedState({
  tr,
  connecting,
  onConnect,
}: {
  tr: TR;
  connecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="text-center py-6">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50 mb-2">
        {tr.disconnectedHeadline}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
        {tr.disconnectedBody}
      </p>
      <button
        type="button"
        data-testid="gcal-connect-btn"
        onClick={onConnect}
        disabled={connecting}
        className="inline-flex items-center gap-3 px-5 py-2.5 rounded-xl bg-white dark:bg-white text-slate-800 text-sm font-medium shadow-sm border border-slate-300 hover:shadow-md hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {connecting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span>{tr.connecting}</span>
          </>
        ) : (
          <>
            <GoogleGMark size={18} />
            <span>{tr.continueWithGoogle}</span>
          </>
        )}
      </button>
    </div>
  );
}

function ConnectedState({
  data,
  tr,
  lang,
  onToggle,
  togglePending,
  confirming,
  setConfirming,
  onDisconnect,
  disconnectPending,
}: {
  data: {
    email?: string | null;
    calendarSummary?: string | null;
    syncEnabled?: boolean;
    lastSyncAt?: number | null;
    lastSyncStatus?: string | null;
  };
  tr: TR;
  lang: Lang;
  onToggle: (enabled: boolean) => void;
  togglePending: boolean;
  confirming: boolean;
  setConfirming: (v: boolean) => void;
  onDisconnect: () => void;
  disconnectPending: boolean;
}) {
  const lastSync = formatDate(data.lastSyncAt, lang);
  const syncOk = data.lastSyncStatus === "ok" || data.lastSyncStatus === null || !data.lastSyncStatus;
  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium border border-emerald-200/70 dark:border-emerald-500/20">
          <CheckCircle2 size={12} />
          {tr.connected}
        </span>
      </div>

      <dl className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
        <Row label={tr.account}>
          <span className="font-medium text-slate-800 dark:text-slate-100">{data.email || "—"}</span>
        </Row>
        <Row label={tr.calendar}>
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {data.calendarSummary || "—"}
          </span>
        </Row>
        <Row label={tr.lastSync}>
          <span className={`${syncOk ? "text-slate-600 dark:text-slate-300" : "text-amber-600 dark:text-amber-400"} inline-flex items-center gap-1.5`}>
            <RefreshCw size={12} className={togglePending ? "animate-spin" : ""} />
            {lastSync || tr.never}
          </span>
        </Row>
      </dl>

      <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-100 dark:border-white/5">
        <label className="inline-flex items-center gap-3 cursor-pointer select-none">
          <span className="relative inline-flex">
            <input
              type="checkbox"
              data-testid="gcal-sync-toggle"
              className="peer sr-only"
              checked={!!data.syncEnabled}
              disabled={togglePending}
              onChange={(e) => onToggle(e.target.checked)}
            />
            <span className="w-10 h-6 rounded-full bg-slate-200 dark:bg-white/10 peer-checked:bg-emerald-500 transition" />
            <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
          </span>
          <span className="text-sm text-slate-700 dark:text-slate-200">
            {data.syncEnabled ? tr.syncOn : tr.syncOff}
          </span>
        </label>

        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-xs px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              ×
            </button>
            <button
              type="button"
              data-testid="gcal-disconnect-confirm"
              onClick={onDisconnect}
              disabled={disconnectPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {disconnectPending ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
              {tr.disconnect}
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="gcal-disconnect-btn"
            onClick={() => setConfirming(true)}
            className="text-xs px-3 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center gap-1.5"
            title={tr.confirmDisconnect}
          >
            <Unplug size={12} />
            {tr.disconnect}
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
