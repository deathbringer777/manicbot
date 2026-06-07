"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Loader2, Mail, Phone, User, Clock, Trash2, Check, MessageCircle } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";

type StatusFilter = "all" | "new" | "contacted" | "closed";

function getTabs(lang: Lang): { key: StatusFilter; label: string }[] {
  return [
    { key: "new", label: t("gmLeads.statusNew", lang) },
    { key: "contacted", label: t("gmLeads.statusInProgress", lang) },
    { key: "closed", label: t("gmLeads.statusClosed", lang) },
    { key: "all", label: t("gmLeads.statusAll", lang) },
  ];
}

function StatusBadge({ status, lang }: { status: string; lang: Lang }) {
  const map: Record<string, string> = {
    new: "bg-amber-500/20 text-amber-400",
    contacted: "bg-cyan-500/20 text-cyan-400",
    closed: "bg-slate-500/20 text-slate-400",
  };
  const labels: Record<string, string> = {
    new: t("gmLeads.badgeNew", lang),
    contacted: t("gmLeads.badgeInProgress", lang),
    closed: t("gmLeads.badgeClosed", lang),
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${map[status] ?? "bg-slate-500/20 text-slate-400"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function LeadsPageClient() {
  const { lang } = useLang();
  const [filter, setFilter] = useState<StatusFilter>("new");
  const [deleteConfirm, setDeleteConfirm] = useState<{ active: boolean; leadId: number | null }>({ active: false, leadId: null });
  const utils = api.useUtils();
  const listQ = api.leads.list.useQuery({ status: filter, limit: 100, offset: 0 });
  const countsQ = api.leads.counts.useQuery();

  const TABS = getTabs(lang);

  const updateMut = api.leads.updateStatus.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.leads.counts.invalidate();
    },
  });
  const removeMut = api.leads.remove.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      utils.leads.counts.invalidate();
    },
  });

  const rows = (listQ.data?.items ?? []) as Array<{
    id: number;
    name: string;
    email: string;
    phone: string;
    salonType: string | null;
    mastersCount: number | null;
    note: string | null;
    source: string;
    ip: string | null;
    status: string;
    createdAt: number;
  }>;

  const counts = (countsQ.data as Record<string, number> | undefined) ?? { new: 0, contacted: 0, closed: 0, all: 0 };

  // Delete lead confirmation modal
  const deleteConfirmModal = deleteConfirm.active && (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      onClick={() => setDeleteConfirm({ active: false, leadId: null })}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmLeads.deleteConfirm", lang)}</h3>
        <div className="flex gap-2">
          <button onClick={() => setDeleteConfirm({ active: false, leadId: null })}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            {t("common.cancel", lang)}
          </button>
          <button onClick={() => {
            if (deleteConfirm.leadId) removeMut.mutate({ id: deleteConfirm.leadId });
            setDeleteConfirm({ active: false, leadId: null });
          }}
            className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors">
            {t("gmLeads.delete", lang)}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <Shell title={t("gmLeads.titleApps", lang)} subtitle={counts.new ? `${counts.new} ${t("gmLeads.newSuffix", lang)}` : undefined}>
      <div className="space-y-4">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                filter === tab.key
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {tab.label}
              {counts[tab.key] ? (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-900/70 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                  {counts[tab.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {listQ.isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        )}

        {!listQ.isLoading && rows.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">{t("gmLeads.empty", lang)}</div>
        )}

        {rows.map((lead) => (
          <div key={lead.id} className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center text-sm font-bold text-white">
                  {lead.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white truncate flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {lead.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3 mt-0.5">
                    <a href={`tel:${lead.phone}`} className="flex items-center gap-1 hover:text-cyan-500">
                      <Phone className="w-3 h-3" />
                      {lead.phone}
                    </a>
                    <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-cyan-500 truncate">
                      <Mail className="w-3 h-3" />
                      <span className="truncate">{lead.email}</span>
                    </a>
                  </div>
                </div>
              </div>
              <StatusBadge status={lead.status} lang={lang} />
            </div>

            {(lead.salonType || lead.mastersCount != null) && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {lead.salonType && <span className="mr-3">🏷 {lead.salonType}</span>}
                {lead.mastersCount != null && <span>{t("gmLeads.mastersPrefix", lang)} {lead.mastersCount}</span>}
              </div>
            )}

            {lead.note && (
              <div className="bg-slate-50 dark:bg-slate-900/70 rounded-xl p-3 border border-slate-200 dark:border-slate-700/50">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" /> {t("gmLeads.message", lang)}
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{lead.note}</p>
              </div>
            )}

            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Clock className="w-3 h-3" />
              {formatDate(lead.createdAt)}
              {lead.source && <span className="ml-2">· {lead.source}</span>}
              {lead.ip && <span className="ml-2">· {lead.ip}</span>}
            </div>

            <div className="flex gap-2 pt-1">
              {lead.status !== "contacted" && (
                <button
                  onClick={() => updateMut.mutate({ id: lead.id, status: "contacted" })}
                  disabled={updateMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-600 active:bg-cyan-500 text-white px-3 py-2 text-xs font-semibold rounded-xl transition-all disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" />
                  {t("gmLeads.contacted", lang)}
                </button>
              )}
              {lead.status !== "closed" && (
                <button
                  onClick={() => updateMut.mutate({ id: lead.id, status: "closed" })}
                  disabled={updateMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 text-xs font-semibold rounded-xl transition-all disabled:opacity-60"
                >
                  {t("gmLeads.close", lang)}
                </button>
              )}
              <button
                onClick={() => setDeleteConfirm({ active: true, leadId: lead.id })}
                disabled={removeMut.isPending}
                className="flex items-center justify-center gap-1.5 bg-red-600/10 text-red-500 px-3 py-2 text-xs font-semibold rounded-xl transition-all disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {deleteConfirmModal}
    </Shell>
  );
}
