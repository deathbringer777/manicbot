"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, StickyNote, Users, Clock, Check, CheckCheck, AlertCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { MessageComposer, ATTACHMENT_ONLY_BODY } from "./MessageComposer";
import { GroupMembersModal } from "./GroupMembersModal";

interface Props {
  tenantId: string;
  threadId: string;
}

function fmtFull(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.toLocaleDateString()} ${hh}:${mm}`;
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
  // Members drawer is opt-in — staff_group only — and is owner-only
  // edits-wise (the drawer itself respects the role via useRole inside it).
  const [membersOpen, setMembersOpen] = useState(false);

  const detailQ = api.messenger.getThread.useQuery(
    { tenantId, threadId, limit: 50 },
    {
      refetchInterval: 5000,
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
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-500 dark:border-slate-800" />
      </div>
    );
  }

  if (!detailQ.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        {t("messenger.loadError", lang)}
      </div>
    );
  }

  const { thread, messages, members, viewerWebUserId } = detailQ.data;
  const memberMap = new Map(members.map((m) => [m.memberRef, m.displayName]));

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
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto bg-slate-50 px-3 py-3 dark:bg-slate-950">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            {t("messenger.noMessages", lang)}
          </div>
        ) : (
          messages.map((m) => {
            const isOwn = m.senderKind === "web_user" && m.senderRef === viewerWebUserId;
            const isExternal = m.senderKind === "external_client";
            const isSystem = m.senderKind === "system";
            const isNote = m.isInternalNote === 1;
            const senderName =
              m.senderKind === "web_user"
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
                  {!isOwn && (
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
                  {isOwn && isNote && (
                    <p className="mb-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold opacity-80">
                      <StickyNote className="h-2.5 w-2.5" />
                      {t("messenger.note", lang)}
                    </p>
                  )}
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
                  <p
                    className={`mt-0.5 flex items-center justify-end gap-1 text-[9px] ${
                      isOwn ? "text-white/70" : "text-slate-400"
                    }`}
                  >
                    <span>{fmtFull(m.createdAt)}</span>
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
      </div>

      <MessageComposer
        tenantId={tenantId}
        threadId={threadId}
        threadKind={thread.kind}
        disabled={thread.archived === 1}
      />
    </div>
  );
}
