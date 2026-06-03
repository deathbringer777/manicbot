"use client";

import { useEffect, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  HelpCircle,
  Map,
  MessageSquarePlus,
  ArrowLeft,
  Send,
  Loader2,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { TOUR_REPLAY_EVENT } from "~/lib/onboarding/constants";
import { api } from "~/trpc/react";
import { relativeTime } from "~/lib/appointments";
import { Button } from "~/components/ui/Button";
import { Pill, type PillTone } from "~/components/ui/Pill";
import { ChatAttachButton } from "~/components/chat/ChatAttachButton";
import {
  uploadChatAttachment,
  validateChatAttachmentFile,
  describeChatAttachmentError,
  ChatAttachmentUploadError,
} from "~/lib/chatAttachments";

const STATUS_TONES: Record<string, PillTone> = {
  open: "amber",
  claimed: "brand",
  escalated: "red",
  closed: "slate",
};

type View = "list" | "detail" | "create";

export function HelpSection() {
  const { role } = useRole();
  const { lang } = useLang();
  const effectiveRole = role;
  const showTourReplay =
    effectiveRole === "tenant_owner" ||
    effectiveRole === "master" ||
    effectiveRole === "support" ||
    effectiveRole === "technical_support";
  const showSupportForm =
    effectiveRole === "tenant_owner" ||
    effectiveRole === "master";

  const [view, setView] = useState<View>("list");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Deep-link: notification-bell rows link to /settings?section=help&ticket=<id>
  // so the user lands directly on the support thread. We honour the param
  // once on mount AND whenever it changes (back/forward navigation).
  const searchParams = useSearchParams();
  const ticketQuery = searchParams?.get("ticket") ?? null;
  useEffect(() => {
    if (!showSupportForm) return;
    if (!ticketQuery) return;
    if (ticketQuery === selectedTicketId && view === "detail") return;
    setSelectedTicketId(ticketQuery);
    setView("detail");
  }, [ticketQuery, showSupportForm, selectedTicketId, view]);

  // New ticket form
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Reply
  const [replyText, setReplyText] = useState("");
  const [replyAttachmentUrl, setReplyAttachmentUrl] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [pasteUploading, setPasteUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const utils = api.useUtils();

  const myTickets = api.support.getMyTickets.useQuery(undefined, {
    enabled: showSupportForm,
    refetchInterval: view === "list" ? 30_000 : false,
  });

  const ticketDetail = api.support.getMyTicket.useQuery(
    { ticketId: selectedTicketId! },
    { enabled: !!selectedTicketId && view === "detail", refetchInterval: 5_000 },
  );

  const createTicket = api.support.createTicket.useMutation({
    onSuccess(data) {
      setSubject("");
      setMessage("");
      utils.support.getMyTickets.invalidate();
      setSelectedTicketId(data.ticketId);
      setView("detail");
    },
  });

  const replyMut = api.support.replyToMyTicket.useMutation({
    onSuccess() {
      setReplyText("");
      setReplyAttachmentUrl(null);
      utils.support.getMyTicket.invalidate();
      utils.support.getMyTickets.invalidate();
    },
  });

  const mintTokenMut = api.support.mintTicketUploadToken.useMutation();

  async function mintTokenForTicket() {
    if (!selectedTicketId) throw new Error("no ticket selected");
    return await mintTokenMut.mutateAsync({ ticketId: selectedTicketId });
  }

  // Shared upload path used by the click button (via ChatAttachButton),
  // clipboard paste, and drag-drop. Single attachment per ticket reply —
  // a newer upload replaces the previous one.
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
      const code =
        e instanceof ChatAttachmentUploadError ? e.code : "upload_failed";
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

  function openTicket(id: string) {
    setSelectedTicketId(id);
    setReplyText("");
    setReplyAttachmentUrl(null);
    setAttachmentError(null);
    setView("detail");
  }

  function submitReply() {
    const trimmed = replyText.trim();
    if (!selectedTicketId || replyMut.isPending) return;
    // Allow attachment-only submits (text+attachment OR attachment alone).
    if (!trimmed && !replyAttachmentUrl) return;
    replyMut.mutate({
      ticketId: selectedTicketId,
      text: trimmed || "(вложение)",
      attachmentUrl: replyAttachmentUrl ?? undefined,
    });
  }

  function backToList() {
    setSelectedTicketId(null);
    setView("list");
  }

  return (
    <div className="space-y-4">
      {/* Help center + tour replay */}
      <section className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.helpCenter", lang)}</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.helpCenterDesc", lang)}</p>
        <Link
          href="/help"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          {t("settings.helpCenter", lang)}
        </Link>
        {showTourReplay && (
          <>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <Map className="w-4 h-4 text-brand-500 dark:text-violet-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.tourReplay", lang)}</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.tourReplayDesc", lang)}</p>
            <Button
              type="button"
              tone="violet"
              variant="soft"
              size="md"
              onClick={() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT))}
              className="w-full sm:w-auto"
            >
              {t("settings.tourReplay", lang)}
            </Button>
          </>
        )}
      </section>

      {/* Support tickets */}
      {showSupportForm && (
        <section className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.writeSupport", lang)}</h2>
          </div>

          {/* ── LIST VIEW ── */}
          {view === "list" && (
            <div className="space-y-3">
              <Button
                type="button"
                tone="emerald"
                variant="soft"
                size="md"
                onClick={() => setView("create")}
                leadingIcon={<Plus className="w-4 h-4" />}
                className="w-full sm:w-auto"
              >
                {t("settings.newTicket", lang)}
              </Button>

              {myTickets.isLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                </div>
              )}

              {myTickets.data && myTickets.data.length > 0 && (
                <div className="space-y-1.5">
                  {myTickets.data.map((ticket: any) => {
                    const border = ticket.status === "open" ? "border-l-amber-400"
                      : ticket.status === "closed" ? "border-l-slate-300 dark:border-l-slate-700"
                      : "border-l-brand-400";
                    return (
                      <button
                        key={ticket.id}
                        onClick={() => openTicket(ticket.id)}
                        className={`w-full rounded-xl border-l-2 ${border} bg-slate-100/60 dark:bg-white/[0.03] flex items-center gap-3 text-left hover:bg-slate-200/60 dark:hover:bg-white/[0.06] transition-colors overflow-hidden`}
                      >
                        <div className="p-3 flex items-center gap-3 flex-1 min-w-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="font-medium text-slate-900 dark:text-white text-sm truncate">
                                {ticket.id}
                              </p>
                              <Pill
                                tone={STATUS_TONES[ticket.status] ?? "slate"}
                                variant="soft"
                                size="xs"
                                className="shrink-0"
                              >
                                {t(`status.${ticket.status}` as any, lang) ?? ticket.status}
                              </Pill>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate">
                              {relativeTime(ticket.updatedAt)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {myTickets.data?.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">{t("settings.noTickets", lang)}</p>
              )}
            </div>
          )}

          {/* ── CREATE VIEW ── */}
          {view === "create" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={backToList}
                className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("settings.backToTickets", lang)}
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!subject.trim() || !message.trim()) return;
                  createTicket.mutate({ subject: subject.trim(), message: message.trim() });
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t("settings.supportSubject", lang)}
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t("settings.supportMessage", lang)}
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand-500/50 transition-colors resize-y"
                  />
                </div>
                {createTicket.error && (
                  <p className="text-xs text-red-700 dark:text-red-400">{createTicket.error.message}</p>
                )}
                <Button
                  type="submit"
                  tone="emerald"
                  variant="soft"
                  size="md"
                  disabled={createTicket.isPending || !subject.trim() || !message.trim()}
                  className="w-full sm:w-auto"
                >
                  {createTicket.isPending ? t("settings.saving", lang) : t("settings.supportSend", lang)}
                </Button>
              </form>
            </div>
          )}

          {/* ── DETAIL VIEW ── */}
          {view === "detail" && selectedTicketId && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={backToList}
                className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("settings.backToTickets", lang)}
              </button>

              {ticketDetail.isLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                </div>
              )}

              {ticketDetail.data && (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500 font-mono">{selectedTicketId}</p>
                    <Pill
                      tone={STATUS_TONES[ticketDetail.data.ticket.status] ?? "slate"}
                      variant="soft"
                      size="xs"
                    >
                      {t(`status.${ticketDetail.data.ticket.status}` as any, lang) ?? ticketDetail.data.ticket.status}
                    </Pill>
                  </div>

                  {/* Messages */}
                  <div className="space-y-2">
                    {ticketDetail.data.messages.map((msg: any) => {
                      const isSupport = typeof msg.sender === "string" && msg.sender.startsWith("support:");
                      const att = (msg.attachmentUrl ?? "") as string;
                      const attIsImage = att.startsWith("http") &&
                        /\.(png|jpe?g|webp)(\?|$)/i.test(att);
                      const attIsHttp = att.startsWith("http");
                      return (
                        <div key={msg.id} className={`flex ${isSupport ? "justify-start" : "justify-end"}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${
                            isSupport
                              ? "bg-brand-100 dark:bg-brand-500/10 text-slate-800 dark:text-slate-200 border border-brand-200 dark:border-brand-500/20"
                              : "bg-slate-100 dark:bg-white/[0.05] text-slate-800 dark:text-slate-200"
                          }`}>
                            <p className={`text-[10px] font-medium mb-0.5 ${isSupport ? "text-brand-700 dark:text-brand-400" : "text-slate-500 dark:text-slate-400"}`}>
                              {isSupport ? t("settings.supportTeam", lang) : t("settings.you", lang)}
                            </p>
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
                              <a href={att} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-sky-700 dark:text-sky-400 underline mt-1 block truncate">{att}</a>
                            )}
                            <p className="text-[10px] text-slate-500 mt-1">{relativeTime(msg.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reply input */}
                  {ticketDetail.data.ticket.status !== "closed" ? (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`space-y-2 pt-1 rounded-xl transition-colors ${
                        isDragging
                          ? "ring-2 ring-brand-500/60 ring-offset-2 ring-offset-white dark:ring-offset-slate-900"
                          : ""
                      }`}
                    >
                      {replyAttachmentUrl && (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={replyAttachmentUrl}
                            alt="preview"
                            className="h-12 w-12 rounded object-cover"
                          />
                          <span className="flex-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                            Изображение прикреплено
                          </span>
                          <button
                            type="button"
                            onClick={() => setReplyAttachmentUrl(null)}
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
                      <div className="flex gap-2">
                        <textarea
                          data-testid="help-ticket-reply-input"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onPaste={handlePaste}
                          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                            // Enter sends; Shift+Enter inserts a newline. Matches the
                            // /messages composer and standard chat-app convention.
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              submitReply();
                            }
                          }}
                          placeholder={t("settings.replyPlaceholder", lang)}
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
                          disabled={replyMut.isPending}
                        />
                        <Button
                          type="button"
                          tone="brand"
                          variant="soft"
                          size="md"
                          onClick={submitReply}
                          disabled={replyMut.isPending || (!replyText.trim() && !replyAttachmentUrl)}
                        >
                          {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 text-center py-2">{t("settings.ticketClosed", lang)}</p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
