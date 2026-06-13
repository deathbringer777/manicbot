"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, StickyNote, Users, Clock, Check, CheckCheck, AlertCircle, Pencil, Trash2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, formatDate, formatTime, type Lang } from "~/lib/i18n";
import { MessageComposer, ATTACHMENT_ONLY_BODY } from "./MessageComposer";
import { GroupMembersModal } from "./GroupMembersModal";
import { useMessengerSocketCtx } from "./socketContext";
import { RequestCard } from "./RequestCard";

interface Props {
  tenantId: string;
  threadId: string;
}

function fmtFull(ts: number, lang: Lang): string {
  const d = new Date(ts * 1000);
  return `${formatDate(d, lang)} ${formatTime(d, lang)}`;
}

/**
 * `thread_messages.attachments_json` is `{ attachments: [{ url, kind }, …] }`
 * — see `messenger.sendMessage`. Returns an empty array for null / invalid
 * JSON / unrecognised shape so the renderer never throws on malformed rows.
 */
function parseAttachments(raw: unknown): Array<{ url: string; kind: string }> {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as { attachments?: Array<{ url?: unknown; kind?: unknown }> };
    if (!parsed || !Array.isArray(parsed.attachments)) return [];
    return parsed.attachments.flatMap((a) => {
      if (typeof a?.url !== "string") return [];
      return [{ url: a.url, kind: typeof a.kind === "string" ? a.kind : "image" }];
    });
  } catch {
    return [];
  }
}

export function ThreadView({ tenantId, threadId }: Props) {
  const utils = api.useUtils();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const socket = useMessengerSocketCtx();
  const lastTypingRef = useRef(0);
  // Members drawer is opt-in — staff_group only — and is owner-only
  // edits-wise (the drawer itself respects the role via useRole inside it).
  const [membersOpen, setMembersOpen] = useState(false);

  const detailQ = api.messenger.getThread.useQuery(
    { tenantId, threadId, limit: 50 },
    {
      // Poll slowly while the realtime socket is healthy; fast when it's down.
      refetchInterval: socket.status === "open" ? 15000 : 5000,
      refetchOnWindowFocus: true,
      enabled: !!tenantId && !!threadId,
    },
  );

  const archiveMutation = api.messenger.archiveThread.useMutation({
    onSuccess: async () => {
      await utils.messenger.listThreads.invalidate({ tenantId });
    },
  });

  const markReadMutation = api.messenger.markRead.useMutation();

  // Retry a failed staff→client send (re-relays through the Worker).
  const retryMutation = api.messenger.retryMessage.useMutation({
    onSuccess: async () => {
      await utils.messenger.getThread.invalidate({ tenantId, threadId });
    },
  });

  // Inline edit + soft delete of own messages.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editMutation = api.messenger.editMessage.useMutation({
    onSuccess: async () => {
      setEditingId(null);
      await utils.messenger.getThread.invalidate({ tenantId, threadId });
    },
  });
  const deleteMutation = api.messenger.deleteMessage.useMutation({
    onSuccess: async () => {
      await utils.messenger.getThread.invalidate({ tenantId, threadId });
    },
  });

  // Auto-mark read on the latest message we see
  useEffect(() => {
    const msgs = detailQ.data?.messages;
    if (!msgs?.length) return;
    const latestId = msgs[msgs.length - 1]?.id;
    if (!latestId) return;
    markReadMutation.mutate({ tenantId, threadId, lastSeenMessageId: latestId });
    // Refresh inbox unread badges
    void utils.messenger.listThreads.invalidate({ tenantId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, threadId, detailQ.data?.messages?.length]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [detailQ.data?.messages?.length]);

  if (detailQ.isLoading) {
    // Skeleton message bubbles — communicates "loading messages", not a bare spinner.
    return (
      <div className="flex h-full flex-col gap-2 overflow-hidden p-4" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
            <div
              className={`h-9 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800 ${
                i % 2 ? "w-40" : "w-52"
              }`}
            />
          </div>
        ))}
      </div>
    );
  }

  if (!detailQ.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        {t("messenger.loadError", lang)}
        <button
          type="button"
          onClick={() => void detailQ.refetch()}
          className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t("messenger.status.retry", lang)}
        </button>
      </div>
    );
  }

  const { thread, messages, members, viewerWebUserId } = detailQ.data;
  const memberMap = new Map(members.map((m) => [m.memberRef, m.displayName]));

  // Read receipt: only for staff threads (external clients can't report reads,
  // so a "seen" on a client_conv would be misleading). Shown when the LAST
  // message is the viewer's own and another web_user member has read past it
  // (ULID lexicographic compare — last_read_message_id >= message id).
  const lastMsg = messages[messages.length - 1];
  const lastIsOwn =
    !!lastMsg && lastMsg.senderKind === "web_user" && lastMsg.senderRef === viewerWebUserId;
  const seenByOther =
    (thread.kind === "staff_dm" || thread.kind === "staff_group") &&
    lastIsOwn &&
    members.some(
      (m) =>
        m.memberKind === "web_user" &&
        m.memberRef !== viewerWebUserId &&
        typeof m.lastReadMessageId === "string" &&
        m.lastReadMessageId >= lastMsg!.id,
    );

  // Typing: who (other than me) is typing in THIS thread, not expired.
  const typers = socket.typing.filter(
    (e) => e.threadId === threadId && e.memberRef !== viewerWebUserId && e.expiresAt > Date.now(),
  );
  const typingLabel =
    typers.length === 0
      ? null
      : typers.length === 1
        ? t("messenger.typing.one", lang).replace(
            "{name}",
            typers[0]!.displayName ?? memberMap.get(typers[0]!.memberRef) ?? "…",
          )
        : t("messenger.typing.many", lang);

  // Throttled typing emit (≤1 per 3s) — fired by the composer on input.
  const handleTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current < 3000) return;
    lastTypingRef.current = now;
    socket.sendTyping(threadId, viewerWebUserId, memberMap.get(viewerWebUserId) ?? null);
  };

  const title =
    thread.title ??
    (thread.kind === "staff_dm"
      ? members
          .filter((m) => m.memberKind === "web_user" && m.memberRef !== viewerWebUserId)
          .map((m) => m.displayName)
          .join(", ") || "DM"
      : thread.kind === "client_conv"
        ? t("messenger.threadTitle.client", lang)
        : t("messenger.threadTitle.chat", lang));

  const kindLabel =
    thread.kind === "staff_dm"
      ? t("messenger.threadKind.dm", lang)
      : thread.kind === "staff_group"
        ? t("messenger.threadKind.group", lang).replace(
            "{n}",
            String(members.filter((m) => m.memberKind === "web_user").length),
          )
        : thread.kind === "client_conv"
          ? t("messenger.threadKind.client", lang)
          : t("messenger.threadKind.system", lang);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            {kindLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {thread.kind === "staff_group" && (
            <button
              type="button"
              onClick={() => setMembersOpen(true)}
              data-testid="open-group-members"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              title={t("messenger.members", lang)}
              aria-label={t("messenger.members", lang)}
            >
              <Users className="h-3 w-3" />
              {t("messenger.members", lang)}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              archiveMutation.mutate({ tenantId, threadId, archived: thread.archived === 0 })
            }
            data-testid="archive-thread-button"
            disabled={archiveMutation.isPending}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title={thread.archived === 0
              ? t("messenger.archiveTitle", lang)
              : t("messenger.unarchiveTitle", lang)}
            aria-label={thread.archived === 0
              ? t("messenger.archiveTitle", lang)
              : t("messenger.unarchiveTitle", lang)}
          >
            <Archive className="h-3 w-3" />
            {thread.archived === 0
              ? t("messenger.archive", lang)
              : t("messenger.unarchive", lang)}
          </button>
        </div>
      </div>
      {membersOpen && (
        <GroupMembersModal
          tenantId={tenantId}
          threadId={threadId}
          onClose={() => setMembersOpen(false)}
        />
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 space-y-1 overflow-y-auto bg-slate-50 px-3 py-3 dark:bg-slate-950">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            {t("messenger.noMessages", lang)}
          </div>
        ) : (
          messages.map((m) => {
            // Booking-request cards render as an actionable card, not a bubble.
            if ((m as { refKind?: string | null }).refKind === "booking_request") {
              return (
                <RequestCard
                  key={m.id}
                  tenantId={tenantId}
                  message={m as Parameters<typeof RequestCard>[0]["message"]}
                />
              );
            }
            const isOwn = m.senderKind === "web_user" && m.senderRef === viewerWebUserId;
            const isExternal = m.senderKind === "external_client";
            const isSystem = m.senderKind === "system";
            const isNote = m.isInternalNote === 1;
            const senderName =
              m.senderKind === "web_user" || m.senderKind === "master"
                ? memberMap.get(m.senderRef) ?? t("messenger.senderStaff", lang)
                : m.senderKind === "external_client"
                  ? t("messenger.senderClient", lang)
                  : t("messenger.senderSystem", lang);
            const atts = parseAttachments((m as { attachmentsJson?: unknown }).attachmentsJson);
            // Body is "(вложение)" placeholder when the user sent an
            // attachment without text — hide it in the bubble so the image
            // stands alone.
            const showBody = m.body && m.body !== ATTACHMENT_ONLY_BODY;
            return (
              <div
                key={m.id}
                data-testid={`message-${m.id}`}
                className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    isNote
                      ? "border border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                      : isSystem
                        ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        : isOwn
                          ? "bg-brand-500 text-white"
                          : isExternal
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
                            : "bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                  }`}
                >
                  {!isOwn && !m.deletedAt && (
                    <p
                      className={`mb-0.5 text-[10px] font-semibold ${
                        isNote ? "text-amber-700 dark:text-amber-400" : "text-slate-500"
                      }`}
                    >
                      {senderName}
                      {isNote && (
                        <span className="ml-1 inline-flex items-center gap-0.5">
                          <StickyNote className="h-2.5 w-2.5" />
                          {t("messenger.note", lang)}
                        </span>
                      )}
                    </p>
                  )}
                  {isOwn && isNote && !m.deletedAt && (
                    <p className="mb-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold opacity-80">
                      <StickyNote className="h-2.5 w-2.5" />
                      {t("messenger.note", lang)}
                    </p>
                  )}
                  {m.deletedAt ? (
                    <p className="text-sm italic opacity-70">{t("messenger.msg.deleted", lang)}</p>
                  ) : editingId === m.id ? (
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        maxLength={4000}
                        className="w-full resize-none rounded-lg border border-white/30 bg-white/15 px-2 py-1 text-sm text-inherit placeholder:text-current/50 focus:outline-none"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 text-[10px]">
                        <button type="button" onClick={() => setEditingId(null)} className="opacity-80 hover:opacity-100">
                          {t("messenger.broadcast.cancel", lang)}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const v = editText.trim();
                            if (v) editMutation.mutate({ tenantId, threadId, messageId: m.id, body: v });
                          }}
                          disabled={editMutation.isPending}
                          className="font-semibold hover:underline disabled:opacity-60"
                        >
                          {t("messenger.msg.save", lang)}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {atts.length > 0 && (
                        <div className={`flex flex-wrap gap-1.5 ${showBody ? "mb-1.5" : ""}`}>
                          {atts.map((a, idx) => (
                            <a
                              key={`${a.url}-${idx}`}
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block overflow-hidden rounded-lg border border-white/10"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={a.url}
                                alt="attachment"
                                className="max-h-56 max-w-[240px] w-auto object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      {showBody && (
                        <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                      )}
                    </>
                  )}
                  <p
                    className={`mt-0.5 flex items-center justify-end gap-1 text-[9px] ${
                      isOwn ? "text-white/70" : "text-slate-400"
                    }`}
                  >
                    <span>{fmtFull(m.createdAt, lang)}</span>
                    {m.editedAt && !m.deletedAt && (
                      <span className="opacity-70">({t("messenger.msg.edited", lang)})</span>
                    )}
                    {isOwn && !m.deletedAt && editingId !== m.id && (
                      <>
                        {!m.externalMsgId && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditText(m.body);
                            }}
                            title={t("messenger.msg.edit", lang)}
                            aria-label={t("messenger.msg.edit", lang)}
                            className="opacity-60 hover:opacity-100"
                          >
                            <Pencil className="h-2.5 w-2.5 shrink-0" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              typeof window !== "undefined" &&
                              window.confirm(t("messenger.msg.deleteConfirm", lang))
                            ) {
                              deleteMutation.mutate({ tenantId, threadId, messageId: m.id });
                            }
                          }}
                          title={t("messenger.msg.delete", lang)}
                          aria-label={t("messenger.msg.delete", lang)}
                          className="opacity-60 hover:opacity-100"
                        >
                          <Trash2 className="h-2.5 w-2.5 shrink-0" />
                        </button>
                      </>
                    )}
                    {isOwn && m.deliveryState === "pending" && (
                      <Clock className="h-2.5 w-2.5 shrink-0" aria-label={t("messenger.status.sending", lang)} />
                    )}
                    {isOwn && m.deliveryState === "sent" && (
                      <Check className="h-2.5 w-2.5 shrink-0" aria-label={t("messenger.status.sent", lang)} />
                    )}
                    {isOwn && m.deliveryState === "delivered" && (
                      <CheckCheck className="h-2.5 w-2.5 shrink-0" aria-label={t("messenger.status.delivered", lang)} />
                    )}
                    {isOwn && m.deliveryState === "failed" && (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate({ tenantId, threadId, messageId: m.id })}
                        disabled={retryMutation.isPending}
                        title={m.deliveryError ?? t("messenger.status.failed", lang)}
                        className="inline-flex items-center gap-0.5 rounded bg-rose-500/90 px-1 py-0.5 font-medium text-white hover:bg-rose-500 disabled:opacity-60"
                      >
                        <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                        {t("messenger.status.retry", lang)}
                      </button>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {seenByOther && (
          <p className="px-2 pt-0.5 text-right text-[10px] text-slate-400">
            ✓ {t("messenger.seen", lang)}
          </p>
        )}
      </div>

      {typingLabel && (
        <div className="px-4 pb-1 text-[11px] italic text-slate-400" aria-live="polite">
          {typingLabel}
        </div>
      )}
      <MessageComposer
        tenantId={tenantId}
        threadId={threadId}
        threadKind={thread.kind}
        disabled={thread.archived === 1}
        onTyping={handleTyping}
      />
    </div>
  );
}
