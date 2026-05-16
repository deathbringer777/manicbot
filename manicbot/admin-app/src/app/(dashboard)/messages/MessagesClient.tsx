"use client";

import { useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useMessagesTenantId } from "./useMessagesTenantId";
import { ThreadList } from "./_components/ThreadList";
import { ThreadView } from "./_components/ThreadView";
import { NewThreadModal } from "./_components/NewThreadModal";

export default function MessagesClient() {
  const { tenantId, isSystemAdminNoPreview } = useMessagesTenantId();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  if (isSystemAdminNoPreview) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10">
          <MessageSquare className="h-6 w-6 text-brand-500" />
        </div>
        <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Мессенджер привязан к салону
        </h2>
        <p className="max-w-sm text-xs text-slate-500">
          Включите preview какого-нибудь тенанта в переключателе ролей сверху,
          чтобы открыть его /messages.
        </p>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500">
        Нет привязанного салона — мессенджер недоступен
      </div>
    );
  }

  return (
    <>
      <div
        className="grid h-[calc(100vh-8rem)] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[320px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900"
        data-testid="messages-shell"
      >
        {/* On mobile: show ThreadList until a thread is selected; then swap to ThreadView */}
        <div className={selectedThreadId ? "hidden md:block" : "block"}>
          <ThreadList
            tenantId={tenantId}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
            onNewThread={() => setModalOpen(true)}
          />
        </div>

        <div className={selectedThreadId ? "block" : "hidden md:block"}>
          {selectedThreadId ? (
            <div className="relative h-full">
              {/* Mobile back button */}
              <button
                type="button"
                onClick={() => setSelectedThreadId(null)}
                className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md bg-white/80 px-2 text-xs text-slate-600 backdrop-blur md:hidden dark:bg-slate-900/80 dark:text-slate-300"
                data-testid="messages-mobile-back"
              >
                <ArrowLeft className="h-3 w-3" />
                Назад
              </button>
              <ThreadView tenantId={tenantId} threadId={selectedThreadId} />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <MessageSquare className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Выберите чат или создайте новый
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Сообщения между сотрудниками и клиентами в одном месте
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
          }}
        />
      )}
    </>
  );
}
