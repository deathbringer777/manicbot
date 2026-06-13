"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Megaphone, MessageSquare, Send, Users } from "lucide-react";
import { api } from "~/trpc/react";
import { BroadcastComposer } from "./BroadcastComposer";
import { useLang } from "~/components/LangContext";
import { formatRelativeTime, t } from "~/lib/i18n";

function fmtFull(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.toLocaleDateString()} ${hh}:${mm}`;
}

/**
 * Sysadmin platform-messenger surface. Two-column layout mirroring the
 * tenant messenger:
 *   - Left: thread list + "+ Broadcast" button + filter tab (all / unread).
 *   - Right: selected thread with composer.
 */
export function PlatformAdminPane({
  initialThreadId,
}: {
  initialThreadId?: string | null;
}) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    initialThreadId ?? null,
  );
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { lang } = useLang();

  const utils = api.useUtils();
  const listQ = api.platformMessenger.listThreads.useQuery(
    { unreadOnly, limit: 50 },
    { refetchInterval: 10000, refetchOnWindowFocus: true },
  );

  return (
    <>
      <div
        className="grid h-full grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[320px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900"
        data-testid="platform-admin-shell"
      >
        <div className={selectedThreadId ? "hidden md:flex md:flex-col" : "flex flex-col"}>
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-fuchsia-500/15 text-fuchsia-600">
                  <Megaphone className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t("messenger.platform.title", lang)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBroadcast(true)}
                className="flex items-center gap-1 rounded-lg bg-fuchsia-500 px-2 py-1 text-xs font-medium text-white hover:bg-fuchsia-600"
                data-testid="platform-broadcast-open"
              >
                <Send className="h-3 w-3" />
                {t("messenger.platform.broadcast", lang)}
              </button>
            </div>
            <div className="flex gap-1 text-[11px]">
              <button
                type="button"
                aria-pressed={!unreadOnly}
                onClick={() => setUnreadOnly(false)}
                className={`flex-1 rounded-md px-2 py-1 ${
                  !unreadOnly
                    ? "bg-slate-100 font-medium dark:bg-slate-800"
                    : "text-slate-500"
                }`}
              >
                {t("messenger.filter.all", lang)}
              </button>
              <button
                type="button"
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly(true)}
                className={`flex-1 rounded-md px-2 py-1 ${
                  unreadOnly
                    ? "bg-slate-100 font-medium dark:bg-slate-800"
                    : "text-slate-500"
                }`}
              >
                {t("messenger.platform.unread", lang)}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto" data-testid="platform-thread-list">
            {listQ.isLoading && (
              <div className="p-6 text-center text-xs text-slate-500">
                {t("messenger.platform.loading", lang)}
              </div>
            )}
            {listQ.data && listQ.data.items.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                {t("messenger.platform.emptyList", lang)}
                <br />
                {t("messenger.platform.emptyListHint", lang)}
              </div>
            )}
            {listQ.data?.items.map((thread) => {
              const isSelected = thread.id === selectedThreadId;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${
                    isSelected ? "bg-slate-50 dark:bg-slate-800/60" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {thread.recipientName || thread.recipientEmail || thread.recipientWebUserId}
                      </div>
                      {thread.lastMessageAt && (
                        <div className="shrink-0 text-[10px] text-slate-400">
                          {formatRelativeTime(thread.lastMessageAt, lang)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-xs text-slate-500">
                        {thread.lastSenderKind === "owner" && "↩ "}
                        {thread.lastMessagePreview ?? t("messenger.platform.previewEmpty", lang)}
                      </div>
                      {thread.unread > 0 && (
                        <div className="shrink-0 rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                          {t("messenger.platform.new", lang)}
                        </div>
                      )}
                    </div>
                    {thread.recipientEmail && thread.recipientEmail !== thread.recipientName && (
                      <div className="truncate text-[10px] text-slate-400">
                        {thread.recipientEmail}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={selectedThreadId ? "block" : "hidden md:block"}>
          {selectedThreadId ? (
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => setSelectedThreadId(null)}
                className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md bg-white/80 px-2 text-xs text-slate-600 backdrop-blur md:hidden dark:bg-slate-900/80 dark:text-slate-300"
              >
                <ArrowLeft className="h-3 w-3" />
                {t("messenger.back", lang)}
              </button>
              <PlatformAdminThreadView
                threadId={selectedThreadId}
                onAfterSend={() =>
                  utils.platformMessenger.listThreads.invalidate({ unreadOnly })
                }
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <MessageSquare className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t("messenger.platform.selectSalon", lang)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {t("messenger.platform.selectSalonHint", lang)}
              </p>
            </div>
          )}
        </div>
      </div>

      {showBroadcast && (
        <BroadcastComposer
          onClose={() => setShowBroadcast(false)}
          onSent={() => {
            setShowBroadcast(false);
            utils.platformMessenger.listThreads.invalidate({ unreadOnly });
            utils.platformMessenger.listBroadcasts.invalidate();
          }}
        />
      )}
    </>
  );
}

// ── Inner: detail + composer for a single platform thread ────────────────

function PlatformAdminThreadView({
  threadId,
  onAfterSend,
}: {
  threadId: string;
  onAfterSend: () => void;
}) {
  const utils = api.useUtils();
  const { lang } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");

  const detailQ = api.platformMessenger.getThread.useQuery(
    { threadId, limit: 50 },
    { refetchInterval: 5000, refetchOnWindowFocus: true, enabled: !!threadId },
  );

  const sendMutation = api.platformMessenger.sendDirectMessage.useMutation({
    onSuccess: async () => {
      setBody("");
      await utils.platformMessenger.getThread.invalidate({ threadId });
      onAfterSend();
    },
  });

  const markReadMutation = api.platformMessenger.markThreadReadAsPlatform.useMutation();

  const messages = detailQ.data?.messages ?? [];
  const recipient = detailQ.data?.recipient ?? null;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (threadId) markReadMutation.mutate({ threadId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function onSend() {
    const trimmed = body.trim();
    if (!trimmed || !recipient || sendMutation.isPending) return;
    sendMutation.mutate({ recipientWebUserId: recipient.id, body: trimmed });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {recipient?.name || recipient?.email || "..."}
          </div>
          {recipient?.email && recipient.email !== recipient.name && (
            <div className="truncate text-[11px] text-slate-500">{recipient.email}</div>
          )}
          {recipient?.tenantId && (
            <div className="truncate text-[10px] text-slate-400">
              tenant: {recipient.tenantId}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 space-y-2 overflow-y-auto bg-slate-50/40 p-4 dark:bg-slate-950/40"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
            {t("messenger.platform.threadEmpty", lang)}
          </div>
        ) : (
          messages.map((m) => {
            const isPlatform = m.senderKind === "platform";
            return (
              <div
                key={m.id}
                className={`flex ${isPlatform ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isPlatform
                      ? "bg-fuchsia-500 text-white"
                      : "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div
                    className={`mt-1 text-right text-[10px] ${
                      isPlatform ? "text-fuchsia-100" : "text-slate-400"
                    }`}
                  >
                    {fmtFull(m.createdAt)}
                  </div>
                  {m.broadcastId && (
                    <div
                      className={`mt-1 text-[10px] ${
                        isPlatform ? "text-fuchsia-200" : "text-slate-400"
                      }`}
                    >
                      {t("messenger.platform.fromBroadcast", lang)}
                      <BroadcastRetractAction
                        broadcastId={m.broadcastId}
                        threadId={threadId}
                        isPlatform={isPlatform}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t("messenger.platform.replyPlaceholder", lang)}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-fuchsia-400 focus:outline-none focus:ring-1 focus:ring-fuchsia-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            maxLength={4000}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!body.trim() || !recipient || sendMutation.isPending}
            className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendMutation.isPending ? "…" : t("messenger.composer.send", lang)}
          </button>
        </div>
        {sendMutation.error && (
          <div className="mt-1 text-xs text-rose-500">{sendMutation.error.message}</div>
        )}
      </div>
    </div>
  );
}

// ── Inline broadcast-retract action (shown under a broadcast message) ─────
//
// God-Mode: retracting one broadcast message removes EVERY copy across all
// recipient threads and recomputes their inbox previews. Confirm-gated. Calls
// the same systemAdminProcedure the Worker seam wraps (one shared semantics).
function BroadcastRetractAction({
  broadcastId,
  threadId,
  isPlatform,
}: {
  broadcastId: string;
  threadId: string;
  isPlatform: boolean;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const retractMutation = api.platformMessenger.retractBroadcast.useMutation({
    onSuccess: async () => {
      setConfirming(false);
      await utils.platformMessenger.getThread.invalidate({ threadId });
      await utils.platformMessenger.listThreads.invalidate();
      await utils.platformMessenger.listBroadcasts.invalidate();
    },
  });

  if (retractMutation.isSuccess) {
    return (
      <span className={`ml-2 ${isPlatform ? "text-fuchsia-100" : "text-slate-500"}`}>
        · {t("messenger.platform.retractDone", lang)} ({retractMutation.data.removed})
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`ml-2 underline-offset-2 hover:underline ${
          isPlatform ? "text-fuchsia-100" : "text-slate-500"
        }`}
      >
        {t("messenger.platform.retract", lang)}
      </button>
    );
  }

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1">
      <span className={isPlatform ? "text-fuchsia-100" : "text-slate-500"}>
        {t("messenger.platform.retractConfirm", lang)}
      </span>
      <button
        type="button"
        disabled={retractMutation.isPending}
        onClick={() => retractMutation.mutate({ broadcastId })}
        className="rounded bg-rose-500 px-1.5 py-0.5 font-medium text-white hover:bg-rose-600 disabled:opacity-50"
      >
        {retractMutation.isPending ? "…" : t("messenger.platform.retractYes", lang)}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="px-1 underline"
      >
        {t("messenger.platform.retractCancel", lang)}
      </button>
      {retractMutation.error && (
        <span className="text-rose-400">{retractMutation.error.message}</span>
      )}
    </span>
  );
}
