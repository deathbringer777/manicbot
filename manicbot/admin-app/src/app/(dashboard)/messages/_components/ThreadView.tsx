"use client";

import { useEffect, useRef } from "react";
import { Archive, StickyNote } from "lucide-react";
import { api } from "~/trpc/react";
import { MessageComposer } from "./MessageComposer";

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
        Не удалось загрузить
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
        ? "Клиент"
        : "Чат");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            {thread.kind === "staff_dm"
              ? "Прямое сообщение"
              : thread.kind === "staff_group"
                ? `Группа · ${members.filter((m) => m.memberKind === "web_user").length}`
                : thread.kind === "client_conv"
                  ? "Клиентская беседа"
                  : "Системные"}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            archiveMutation.mutate({ tenantId, threadId, archived: thread.archived === 0 })
          }
          data-testid="archive-thread-button"
          disabled={archiveMutation.isPending}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title={thread.archived === 0 ? "Архивировать" : "Разархивировать"}
        >
          <Archive className="h-3 w-3" />
          {thread.archived === 0 ? "В архив" : "Из архива"}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto bg-slate-50 px-3 py-3 dark:bg-slate-950">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            Пока нет сообщений
          </div>
        ) : (
          messages.map((m) => {
            const isOwn = m.senderKind === "web_user" && m.senderRef === viewerWebUserId;
            const isExternal = m.senderKind === "external_client";
            const isSystem = m.senderKind === "system";
            const isNote = m.isInternalNote === 1;
            const senderName =
              m.senderKind === "web_user"
                ? memberMap.get(m.senderRef) ?? "Сотрудник"
                : m.senderKind === "external_client"
                  ? "Клиент"
                  : "Система";
            const atts = parseAttachments((m as { attachmentsJson?: unknown }).attachmentsJson);
            // Body is "(вложение)" placeholder when the user sent an
            // attachment without text — hide it in the bubble so the image
            // stands alone.
            const showBody = m.body && m.body !== "(вложение)";
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
                          заметка
                        </span>
                      )}
                    </p>
                  )}
                  {isOwn && isNote && (
                    <p className="mb-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold opacity-80">
                      <StickyNote className="h-2.5 w-2.5" />
                      заметка
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
                    className={`mt-0.5 text-right text-[9px] ${
                      isOwn ? "text-white/70" : "text-slate-400"
                    }`}
                  >
                    {fmtFull(m.createdAt)}
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
