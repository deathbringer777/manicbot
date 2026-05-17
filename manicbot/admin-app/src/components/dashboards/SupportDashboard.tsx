"use client";

import { useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { MessageSquare, Loader2, ArrowLeft, Send, UserCheck, AlertTriangle, XCircle, ChevronRight, Search, X } from "lucide-react";
import { api } from "~/trpc/react";
import { Shell, type NavItem } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { relativeTime } from "~/lib/appointments";
import { ChatAttachButton } from "~/components/chat/ChatAttachButton";
import {
  uploadChatAttachment,
  validateChatAttachmentFile,
  describeChatAttachmentError,
  ChatAttachmentUploadError,
} from "~/lib/chatAttachments";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  claimed: "bg-brand-500/20 text-brand-400 border border-brand-500/30",
  escalated: "bg-red-500/20 text-red-400 border border-red-500/30",
  closed: "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400",
};

const TICKET_BORDER: Record<string, string> = {
  open:      "border-l-amber-400",
  claimed:   "border-l-brand-400",
  escalated: "border-l-red-500",
  closed:    "border-l-slate-300 dark:border-l-slate-700",
};

type FilterStatus = "all" | "open" | "claimed" | "escalated" | "closed";

export function SupportDashboard() {
  const { lang } = useLang();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("open");
  const [replyText, setReplyText] = useState("");
  const [replyAttachmentUrl, setReplyAttachmentUrl] = useState("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pasteUploading, setPasteUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  const supportNavItems: NavItem[] = [
    { href: "#tickets", icon: MessageSquare, label: t("support.tickets", lang) },
  ];

  const allTickets = api.support.getAllTickets.useQuery(
    {
      status: filter === "all" ? undefined : filter,
      q: searchQ.trim() || undefined,
    },
    { refetchInterval: !selectedId ? 15000 : false, refetchIntervalInBackground: false }
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
    onSuccess: () => {
      setReplyText("");
      setReplyAttachmentUrl("");
      setAttachmentError(null);
      utils.support.getTicket.invalidate();
    },
  });

  const mintTokenMut = api.support.mintTicketUploadToken.useMutation();

  async function mintTokenForTicket() {
    if (!selectedId) throw new Error("no ticket selected");
    return await mintTokenMut.mutateAsync({ ticketId: selectedId });
  }

  async function uploadOne(file: File) {
    const validation = validateChatAttachmentFile(file);
    if (validation) {
      setAttachmentError(describeChatAttachmentError(validation));
      return;
    }
    setAttachmentError(null);
    setPasteUploading(true);
    try {
      const { uploadUrl } = await mintTokenForTicket();
      const url = await uploadChatAttachment(file, uploadUrl);
      setReplyAttachmentUrl(url);
    } catch (e) {
      const code = e instanceof ChatAttachmentUploadError ? e.code : "upload_failed";
      setAttachmentError(describeChatAttachmentError(code as never));
    } finally {
      setPasteUploading(false);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void uploadOne(f);
          return;
        }
      }
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void uploadOne(f);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }

  function submitReply() {
    const trimmed = replyText.trim();
    if (!selectedId || reply.isPending) return;
    if (!trimmed && !replyAttachmentUrl.trim()) return;
    reply.mutate({
      ticketId: selectedId,
      text: trimmed || "(вложение)",
      attachmentUrl: replyAttachmentUrl.trim() || undefined,
    });
  }

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
              className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm transition-colors">
              <ArrowLeft className="h-4 w-4" /> {t("common.back", lang)}
            </button>
          </div>

          {ticketDetail.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
          {ticketDetail.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}

          {ticketDetail.data && (
            <>
              {/* Ticket header */}
              <div className="glass-card rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{ticketDetail.data.ticket.clientName ?? `#${ticketDetail.data.ticket.clientChatId}`}</p>
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
                  const isSupport = typeof msg.sender === "string" && msg.sender.startsWith("support:");
                  const att = (msg.attachmentUrl ?? "") as string;
                  const attIsImage = att.startsWith("http") &&
                    /\.(png|jpe?g|webp)(\?|$)/i.test(att);
                  const attIsHttp = att.startsWith("http");
                  const attIsTg = att.startsWith("telegram:");
                  return (
                    <div key={msg.id} className={`flex ${isSupport ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                        isSupport
                          ? "bg-brand-500/20 text-brand-700 dark:text-brand-100 border border-brand-500/30"
                          : "glass-card text-slate-800 dark:text-slate-200"
                      }`}>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                        {attIsImage && (
                          <a
                            href={att}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={att}
                              alt="attachment"
                              className="max-h-64 w-auto object-contain"
                            />
                          </a>
                        )}
                        {attIsHttp && !attIsImage && (
                          <a
                            href={att}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-sky-400 underline mt-1 block truncate"
                          >
                            {att}
                          </a>
                        )}
                        {attIsTg && (
                          <p className="text-[10px] text-slate-500 mt-1">Вложение в Telegram (откройте диалог в боте)</p>
                        )}
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
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`space-y-2 pt-2 rounded-xl transition-colors ${
                    isDragging
                      ? "ring-2 ring-brand-500/60 ring-offset-2 ring-offset-white dark:ring-offset-slate-900"
                      : ""
                  }`}
                >
                  {replyAttachmentUrl && (
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2">
                      {/\.(png|jpe?g|webp)(\?|$)/i.test(replyAttachmentUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={replyAttachmentUrl} alt="preview" className="h-12 w-12 rounded object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] text-slate-500">URL</div>
                      )}
                      <span className="flex-1 text-xs text-slate-500 dark:text-slate-400 truncate" title={replyAttachmentUrl}>
                        {replyAttachmentUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyAttachmentUrl("")}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                        aria-label="Убрать вложение"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {attachmentError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{attachmentError}</p>
                  )}
                  {pasteUploading && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Загружаю изображение…
                    </p>
                  )}
                  <input
                    type="url"
                    value={replyAttachmentUrl}
                    onChange={(e) => setReplyAttachmentUrl(e.target.value)}
                    placeholder="Attachment URL (optional)"
                    className="w-full bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-brand-500/50"
                  />
                  <div className="flex gap-2">
                    <textarea
                      data-testid="support-ticket-reply-input"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onPaste={handlePaste}
                      onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitReply();
                        }
                      }}
                      placeholder={t("support.replyPlaceholder", lang)}
                      rows={2}
                      className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-brand-500/50"
                    />
                    <ChatAttachButton
                      mintToken={mintTokenForTicket}
                      onUploaded={(url) => {
                        setReplyAttachmentUrl(url);
                        setAttachmentError(null);
                      }}
                      onError={(msg) => setAttachmentError(msg)}
                      disabled={reply.isPending}
                    />
                    <button
                      onClick={submitReply}
                      disabled={reply.isPending || (!replyText.trim() && !replyAttachmentUrl.trim())}
                      className="flex items-center justify-center h-full px-3 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 disabled:opacity-50 hover:opacity-80 transition-opacity"
                    >
                      {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
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
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">{t("support.tickets", lang)}</h2>
          {allTickets.isRefetching && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        </div>

        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-500 shrink-0" />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t("support.search.placeholder", lang)}
            className="flex-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-brand-500/40"
          />
        </div>

        {/* Filter tabs */}
        <div data-tour="support-filters" className="flex gap-1 overflow-x-auto scrollbar-none pb-1">
          {(["open", "claimed", "escalated", "all", "closed"] as FilterStatus[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filter === f
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}>
              {filterLabels[f]}
            </button>
          ))}
        </div>

        {allTickets.isLoading && (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-xl h-16 animate-pulse" />)}</div>
        )}
        {allTickets.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}

        <div data-tour="support-list" className="space-y-2">
          {allTickets.data?.map((ticket: any) => {
            const nameStr = ticket.clientName ?? `#${ticket.clientChatId}`;
            const words = nameStr.trim().split(/\s+/);
            const initials = words.length >= 2
              ? (words[0]![0]! + words[1]![0]!).toUpperCase()
              : nameStr.slice(0, 2).toUpperCase();
            const border = TICKET_BORDER[ticket.status] ?? "border-l-slate-700";
            return (
              <button key={ticket.id} onClick={() => setSelectedId(ticket.id)}
                className={`w-full glass-card rounded-xl border-l-2 ${border} flex items-center gap-3 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors overflow-hidden`}>
                <div className="p-3 flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 shrink-0 rounded-xl bg-brand-500/20 flex items-center justify-center text-[11px] font-bold text-brand-400">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{nameStr}</p>
                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLES[ticket.status] ?? ""}`}>
                        {t(`status.${ticket.status}` as any, lang) ?? ticket.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {ticket.tenantId ?? t("support.platform", lang)} · {relativeTime(ticket.createdAt)}
                      {ticket.claimedByWebUserId ? " · web" : ticket.claimedBy ? ` · #${ticket.claimedBy}` : ""}
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
