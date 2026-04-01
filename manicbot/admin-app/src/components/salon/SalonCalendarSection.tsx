"use client";

import { useState } from "react";
import {
  CalendarDays, CheckCircle2, XCircle, Loader2, ExternalLink, X, Trash2,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader, Btn } from "./SalonShared";

export function SalonCalendarSection({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const integrations = api.googleCalendar.list.useQuery({ tenantId });
  const connectInfo = api.googleCalendar.getConnectInfo.useQuery({ tenantId });
  const utils = api.useUtils();
  const toggleSync = api.googleCalendar.toggleSync.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
  });
  const disconnect = api.googleCalendar.disconnect.useMutation({
    onSuccess: () => utils.googleCalendar.list.invalidate(),
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  const rows = integrations.data ?? [];
  const connectButtonLabel = t("gcal.openBotToConnect", lang);
  const connectHint = t("gcal.connectHint", lang);
  const salonScopeLabel = t("gcal.scopeSalon", lang);
  const masterScopeLabel = t("gcal.scopeMaster", lang);

  return (
    <div className="space-y-4 mt-6">
      <SectionHeader
        title="Google Calendar"
        action={connectInfo.data?.botLink ? (
          <Btn
            onClick={() => window.open(connectInfo.data?.botLink ?? "", "_blank", "noopener,noreferrer")}
            className="shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {connectButtonLabel}
          </Btn>
        ) : undefined}
      />
      <div className="glass-card rounded-2xl p-4 space-y-2">
        <p className="text-xs text-slate-400">{connectHint}</p>
        {connectInfo.data?.botUsername ? (
          <p className="text-[11px] text-slate-500">
            @{connectInfo.data.botUsername}
          </p>
        ) : (
          <p className="text-[11px] text-amber-400">
            {t("gcal.noBotUsername", lang)}
          </p>
        )}
      </div>
      {integrations.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {!integrations.isLoading && rows.length === 0 && (
        <div className="glass-card rounded-2xl p-4 text-center">
          <CalendarDays className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {t("gcal.noCalendars", lang)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {t("gcal.connectionHint", lang)}
          </p>
        </div>
      )}
      {rows.map((row) => (
        <div key={row.id} className="glass-card rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarDays className="h-4 w-4 text-brand-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-white font-medium truncate">
                  {row.calendarSummary || row.calendarId}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-wide">
                    {row.scope === "tenant" ? salonScopeLabel : masterScopeLabel}
                  </span>
                  {row.masterName && <span>{row.masterName}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {row.syncEnabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-500" />
              )}
            </div>
          </div>
          {row.providerAccountEmail && (
            <p className="text-[10px] text-slate-500">{row.providerAccountEmail}</p>
          )}
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            {row.lastSyncAt && (
              <span>
                {t("gcal.lastSync", lang)}: {new Date(row.lastSyncAt).toLocaleString()}
              </span>
            )}
            {row.lastSyncStatus && (
              <span className={row.lastSyncStatus === "ok" ? "text-emerald-400" : "text-amber-400"}>
                ({row.lastSyncStatus})
              </span>
            )}
          </div>
          {row.lastSyncError && (
            <p className="text-[11px] text-amber-400">{row.lastSyncError}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Btn
              variant={row.syncEnabled ? "ghost" : "primary"}
              onClick={() => toggleSync.mutate({ tenantId, integrationId: row.id, enabled: !row.syncEnabled })}
              disabled={toggleSync.isPending || disconnect.isPending}
            >
              {row.syncEnabled
                ? t("gcal.pauseSync", lang)
                : t("gcal.resumeSync", lang)}
            </Btn>
            {confirmDisconnect === row.id ? (
              <>
                <Btn
                  variant="danger"
                  onClick={() => { disconnect.mutate({ tenantId, integrationId: row.id }); setConfirmDisconnect(null); }}
                  disabled={disconnect.isPending}
                >
                  {t("gcal.confirmDisconnect", lang)}
                </Btn>
                <Btn variant="ghost" onClick={() => setConfirmDisconnect(null)} disabled={disconnect.isPending}>
                  <X className="h-3 w-3" />
                </Btn>
              </>
            ) : (
              <Btn variant="danger" onClick={() => setConfirmDisconnect(row.id)} disabled={disconnect.isPending}>
                <Trash2 className="h-3 w-3" />
                {t("gcal.disconnect", lang)}
              </Btn>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
