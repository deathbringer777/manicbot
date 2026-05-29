"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Megaphone, MessageSquare } from "lucide-react";
import { api } from "~/trpc/react";
import { useMessagesTenantId } from "./useMessagesTenantId";
import { useMessengerSocket } from "~/hooks/useMessengerSocket";
import { ThreadList } from "./_components/ThreadList";
import { ThreadView } from "./_components/ThreadView";
import { NewThreadModal } from "./_components/NewThreadModal";
import { PlatformAdminPane } from "./_components/PlatformAdminPane";
import { PlatformOwnerView } from "./_components/PlatformOwnerView";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

/**
 * Top-level orchestrator for `/messages`. Three modes:
 *
 *   1. system_admin without tenant preview → Platform messenger surface
 *      (cross-tenant DM list with all owners + broadcast composer).
 *   2. tenant_owner / tenant_manager / master → Tenant messenger as before,
 *      with a pinned «ManicBot» entry at the top of the thread list that
 *      opens the owner-side platform thread.
 *   3. system_admin previewing a tenant → identical to #2 (tenant messenger
 *      for that tenant — no platform surface, since the sysadmin already
 *      has the dedicated /messages without preview).
 *
 * URL state:
 *   - `?platform=1`   — owner deep-link from notification bell.
 *   - `?platformThread=<id>` — sysadmin deep-link to a specific thread.
 */
export default function MessagesClient() {
  const { tenantId, isSystemAdminNoPreview } = useMessagesTenantId();
  const searchParams = useSearchParams();
  const initialPlatformOwner = searchParams.get("platform") === "1";
  const initialPlatformThread = searchParams.get("platformThread");
  const { lang } = useLang();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [platformSelected, setPlatformSelected] = useState(initialPlatformOwner);
  const [modalOpen, setModalOpen] = useState(false);

  useMessengerSocket(tenantId);

  // Owner-side: poll unread count for the pinned ManicBot entry. Enabled
  // for all non-sysadmin web_users so the pin can show a dot.
  const platformUnreadQ = api.platformMessenger.getMyThread.useQuery(
    { limit: 1 },
    {
      enabled: !isSystemAdminNoPreview && !!tenantId,
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
    },
  );
  const platformUnread = platformUnreadQ.data?.unreadCount ?? 0;

  // Auto-open the platform thread when the URL hints at it. We only run
  // this once on mount — subsequent navigation should respect user clicks.
  useEffect(() => {
    if (initialPlatformOwner) setPlatformSelected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode 1 — sysadmin without preview gets the full platform surface.
  if (isSystemAdminNoPreview) {
    return <PlatformAdminPane initialThreadId={initialPlatformThread} />;
  }

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500">
        {t("messenger.noSalon", lang)}
      </div>
    );
  }

  // Mode 2/3 — tenant messenger with a pinned ManicBot entry.
  return (
    <>
      <div
        className="grid h-[calc(100vh-8rem)] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[320px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900"
        data-testid="messages-shell"
      >
        <div
          className={
            selectedThreadId || platformSelected
              ? "hidden md:flex md:flex-col"
              : "flex flex-col"
          }
        >
          <button
            type="button"
            onClick={() => {
              setPlatformSelected(true);
              setSelectedThreadId(null);
            }}
            className={`flex w-full items-start gap-2 border-b border-slate-200 px-3 py-3 text-left transition hover:bg-fuchsia-50 dark:border-slate-800 dark:hover:bg-fuchsia-950/20 ${
              platformSelected ? "bg-fuchsia-50 dark:bg-fuchsia-950/20" : ""
            }`}
            data-testid="platform-owner-entry"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/15 text-fuchsia-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  ManicBot
                </div>
                {platformUnread > 0 && (
                  <div className="shrink-0 rounded-full bg-fuchsia-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {platformUnread > 9 ? "9+" : platformUnread}
                  </div>
                )}
              </div>
              <div className="truncate text-xs text-slate-500">
                {t("messenger.platformSubtitle", lang)}
              </div>
            </div>
          </button>
          <div className="flex-1 overflow-hidden">
            <ThreadList
              tenantId={tenantId}
              selectedThreadId={selectedThreadId}
              onSelect={(id) => {
                setSelectedThreadId(id);
                setPlatformSelected(false);
              }}
              onNewThread={() => setModalOpen(true)}
            />
          </div>
        </div>

        <div
          className={selectedThreadId || platformSelected ? "block" : "hidden md:block"}
        >
          {platformSelected ? (
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => setPlatformSelected(false)}
                className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md bg-white/80 px-2 text-xs text-slate-600 backdrop-blur md:hidden dark:bg-slate-900/80 dark:text-slate-300"
              >
                <ArrowLeft className="h-3 w-3" />
                {t("messenger.back", lang)}
              </button>
              <PlatformOwnerView />
            </div>
          ) : selectedThreadId ? (
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => setSelectedThreadId(null)}
                className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md bg-white/80 px-2 text-xs text-slate-600 backdrop-blur md:hidden dark:bg-slate-900/80 dark:text-slate-300"
                data-testid="messages-mobile-back"
              >
                <ArrowLeft className="h-3 w-3" />
                {t("messenger.back", lang)}
              </button>
              <ThreadView tenantId={tenantId} threadId={selectedThreadId} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <MessageSquare className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t("messenger.selectChat", lang)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {t("messenger.selectChatHint", lang)}
              </p>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <NewThreadModal
          tenantId={tenantId}
          onClose={() => setModalOpen(false)}
          onCreated={(threadId) => {
            setModalOpen(false);
            setSelectedThreadId(threadId);
            setPlatformSelected(false);
          }}
        />
      )}
    </>
  );
}
