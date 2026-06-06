"use client";

import { useEffect, useRef } from "react";
import { Megaphone } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, formatDate, type Lang } from "~/lib/i18n";

function fmtFull(ts: number, lang: Lang): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d, lang)} ${hh}:${mm}`;
}

/**
 * Owner-side view of the ManicBot channel.
 *
 * Read-only, one-way feed (like a Telegram channel): the platform broadcasts
 * news and announcements, the owner only reads. There is no composer — replies
 * are disabled (the server rejects `sendMyReply` with FORBIDDEN). Single-thread
 * surface — one platform thread per owner, so we skip the list. We still mark
 * the thread read so the unread badge clears. Owner support lives separately in
 * Settings → Help → "Write to support".
 */
export function PlatformOwnerView() {
  const utils = api.useUtils();
  const { lang } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);

  const detailQ = api.platformMessenger.getMyThread.useQuery(
    { limit: 50 },
    { refetchInterval: 5000, refetchOnWindowFocus: true },
  );

  const markReadMutation = api.platformMessenger.markMyThreadRead.useMutation();

  const messages = detailQ.data?.messages ?? [];
  const thread = detailQ.data?.thread ?? null;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (thread && (detailQ.data?.unreadCount ?? 0) > 0) {
      markReadMutation.mutate(undefined, {
        onSuccess: () => utils.platformMessenger.getMyThread.invalidate(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, detailQ.data?.unreadCount]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-600">
          <Megaphone className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            ManicBot
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {t("messenger.platformSubtitle", lang)}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto bg-slate-50/40 p-4 dark:bg-slate-950/40"
        data-testid="platform-owner-messages"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs text-slate-500">
            {t("messenger.platformEmpty", lang)}
          </div>
        ) : (
          messages.map((m) => {
            const isPlatform = m.senderKind === "platform";
            return (
              <div
                key={m.id}
                className={`flex ${isPlatform ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isPlatform
                      ? "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                      : "bg-fuchsia-500 text-white"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div
                    className={`mt-1 text-right text-[10px] ${
                      isPlatform ? "text-slate-400" : "text-fuchsia-100"
                    }`}
                  >
                    {fmtFull(m.createdAt, lang)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
