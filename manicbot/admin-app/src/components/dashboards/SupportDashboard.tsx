"use client";

import { useState } from "react";
import { MessageSquare, Loader2, ArrowLeft, Send, UserCheck, AlertTriangle, XCircle, ChevronRight } from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  claimed: "bg-brand-500/20 text-brand-400 border border-brand-500/30",
  escalated: "bg-red-500/20 text-red-400 border border-red-500/30",
  closed: "bg-slate-700 text-slate-400",
};

const TICKET_BORDER: Record<string, string> = {
  open:      "border-l-amber-400",
  claimed:   "border-l-brand-400",
  escalated: "border-l-red-500",
  closed:    "border-l-slate-700",
};

type FilterStatus = "all" | "open" | "claimed" | "escalated" | "closed";

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}

export function SupportDashboard() {
  const { lang } = useLang();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("open");
  const [replyText, setReplyText] = useState("");

  const supportNavItems: NavItem[] = [
    { href: "#tickets", icon: MessageSquare, label: t("support.tickets", lang) },
  ];

  const allTickets = api.support.getAllTickets.useQuery(
    { status: filter === "all" ? undefined : filter },
    { refetchInterval: 15000 }
  );
  const ticketDetail = api.support.getTicket.useQuery(
    { ticketId: selectedId! },
    { enabled: !!selectedId, refetchInterval: 5000 }
  );

  const utils = api.useUtils();
  const claim = api.support.claimTicket.useMutation({ onSuccess: () => utils.support.getTicket.invalidate() });
  const close = api.support.closeTicket.useMutation({
    onSuccess: () => { utils.support.getAllTickets.invalidate(); setSelectedId(null); }
  });
  const escalate = api.support.escalateTicket.useMutation({
    onSuccess: () => { utils.support.getTicket.invalidate(); utils.support.getAllTickets.invalidate(); }
  });
  const reply = api.support.replyToTicket.useMutation({
    onSuccess: () => { setReplyText(""); utils.support.getTicket.invalidate(); }
  });

  const filterLabels: Record<FilterStatus, string> = {
    all: t("support.all", lang),
    open: t("status.open", lang),
    claimed: t("status.claimed", lang),
    escalated: t("status.escalated", lang),
    closed: t("status.closed", lang),
  };

  // Ticket detail view
  if (selectedId) {
    return (
      <Shell navItems={supportNavItems} title={t("support.title", lang)} subtitle="ManicBot Support">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors">
              <ArrowLeft className="h-4 w-4" /> {t("common.back", lang)}
            </button>
          </div>

          {ticketDetail.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}

          {ticketDetail.data && (
            <>
              {/* Ticket header */}
              <div className="glass-card rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-white">{ticketDetail.data.ticket.clientName ?? `#${ticketDetail.data.ticket.clientChatId}`}</p>
                    <p className="text-xs text-slate-500">
                      {ticketDetail.data.ticket.tenantId ?? t("support.platform", lang)} · {relativeTime(ticketDetail.data.ticket.createdAt)}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[ticketDetail.data.ticket.status] ?? ""}`}>
                    {t(`status.${ticketDetail.data.ticket.status}` as any, lang) ?? ticketDetail.data.ticket.status}
                  </span>
                </div>
                {/* Action buttons */}
                <div className="flex gap-2 pt-1 flex-wrap">
                  {ticketDetail.data.ticket.status === "open" && !ticketDetail.data.ticket.claimedBy && (
                    <button onClick={() => claim.mutate({ ticketId: selectedId })}
                      disabled={claim.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50">
                      <UserCheck className="h-3.5 w-3.5" /> {t("support.claim", lang)}
                    </button>
                  )}
                  {ticketDetail.data.ticket.status !== "closed" && ticketDetail.data.ticket.status !== "escalated" && (
                    <button onClick={() => escalate.mutate({ ticketId: selectedId })}
                      disabled={escalate.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50">
                      <AlertTriangle className="h-3.5 w-3.5" /> {t("support.escalate", lang)}
                    </button>
                  )}
                  {ticketDetail.data.ticket.status !== "closed" && (
                    <button onClick={() => close.mutate({ ticketId: selectedId })}
                      disabled={close.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50">
                      <XCircle className="h-3.5 w-3.5" /> {t("status.closed", lang)}
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="space-y-2">
                {ticketDetail.data.messages.map((msg: any) => {
                  const isSupport = msg.sender.startsWith("support:");
                  return (
                    <div key={msg.id} className={`flex ${isSupport ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isSupport
                          ? "bg-brand-500/20 text-brand-100 border border-brand-500/30"
                          : "glass-card text-slate-200"
                      }`}>
                        <p className="text-sm">{msg.text}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{relativeTime(msg.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
                {ticketDetail.data.messages.length === 0 && (
                  <p className="text-slate-500 text-sm text-center py-4">{t("support.noMessages", lang)}</p>
                )}
              </div>

              {/* Reply input */}
              {ticketDetail.data.ticket.status !== "closed" && (
                <div className="flex gap-2 pt-2">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={t("support.replyPlaceholder", lang)}
                    rows={2}
                    className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500/50"
                  />
                  <button
                    onClick={() => reply.mutate({ ticketId: selectedId, text: replyText })}
                    disabled={reply.isPending || !replyText.trim()}
                    className="flex items-center justify-center h-full px-3 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 disabled:opacity-50 hover:opacity-80 transition-opacity"
                  >
                    {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Shell>
    );
  }

  // Ticket list view
  return (
    <Shell navItems={supportNavItems} title={t("support.title", lang)} subtitle="ManicBot Support">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white flex-1">{t("support.tickets", lang)}</h2>
          {allTickets.isRefetching && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 overflow-x-auto scrollbar-none pb-1">
          {(["open", "claimed", "escalated", "all", "closed"] as FilterStatus[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filter === f
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}>
              {filterLabels[f]}
            </button>
          ))}
        </div>

        {allTickets.isLoading && (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />)}</div>
        )}

        <div className="space-y-2">
          {allTickets.data?.map((ticket: any) => {
            const nameStr = ticket.clientName ?? `#${ticket.clientChatId}`;
            const words = nameStr.trim().split(/\s+/);
            const initials = words.length >= 2
              ? (words[0]![0]! + words[1]![0]!).toUpperCase()
              : nameStr.slice(0, 2).toUpperCase();
            const border = TICKET_BORDER[ticket.status] ?? "border-l-slate-700";
            return (
              <button key={ticket.id} onClick={() => setSelectedId(ticket.id)}
                className={`w-full glass-card rounded-xl border-l-2 ${border} flex items-center gap-3 text-left hover:bg-slate-800/60 transition-colors overflow-hidden`}>
                <div className="p-3 flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-white text-sm truncate">{nameStr}</p>
                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLES[ticket.status] ?? ""}`}>
                        {t(`status.${ticket.status}` as any, lang) ?? ticket.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {ticket.tenantId ?? t("support.platform", lang)} · {relativeTime(ticket.createdAt)}
                      {ticket.claimedBy ? ` · #${ticket.claimedBy}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-600 shrink-0" />
                </div>
              </button>
            );
          })}
          {allTickets.data?.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <MessageSquare className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">{t("support.noTickets", lang)}</p>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
