"use client";

import { useState } from "react";
import { MessageSquare, Loader2, RefreshCw, MessageCircle, Filter } from "lucide-react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";

type ChannelFilter = "all" | "telegram" | "whatsapp" | "instagram";
type StatusFilter = "open" | "closed" | "all";

const CHANNEL_BADGE: Record<string, { label: string; color: string }> = {
  telegram: { label: "TG", color: "bg-sky-500/20 text-sky-400 border-sky-500/30" },
  whatsapp: { label: "WA", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  instagram: { label: "IG", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  closed: "bg-slate-500/15 text-slate-400 border-slate-500/20",
};

function timeAgo(ts: number | null | undefined) {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ConversationsPage() {
  const { tenantId, role } = useRole();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [selected, setSelected] = useState<string | null>(null);

  // For system_admin, use first available tenantId (or null for all)
  const effectiveTenantId = tenantId ?? "";

  const convs = api.conversations.list.useQuery(
    {
      tenantId: effectiveTenantId,
      channelType: channelFilter,
      status: statusFilter,
      limit: 30,
    },
    { enabled: !!effectiveTenantId }
  );

  const setStatus = api.conversations.setStatus.useMutation({
    onSuccess: () => void convs.refetch(),
  });

  const selectedConv = convs.data?.items.find(c => c.id === selected);

  if (!effectiveTenantId) {
    return (
      <Shell navItems={[]} title="Conversations" subtitle="Unified inbox">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <MessageSquare className="h-10 w-10 text-slate-600" />
          <p className="text-slate-500 text-sm">No tenant selected</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell navItems={[]} title="Conversations" subtitle="Unified multi-channel inbox">
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Channel filter */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1">
          {(["all", "telegram", "whatsapp", "instagram"] as ChannelFilter[]).map(ch => (
            <button key={ch} onClick={() => setChannelFilter(ch)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                channelFilter === ch
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}>
              {ch === "all" ? "All" : ch === "telegram" ? "TG" : ch === "whatsapp" ? "WA" : "IG"}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1">
          {(["open", "closed", "all"] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize ${
                statusFilter === s
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}>
              {s}
            </button>
          ))}
        </div>

        <button onClick={() => void convs.refetch()}
          className="ml-auto text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw className={`h-4 w-4 ${convs.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Conversation list */}
      {convs.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-brand-400 h-6 w-6" />
        </div>
      ) : convs.data?.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <MessageCircle className="h-10 w-10 text-slate-600" />
          <p className="text-slate-500 text-sm">No conversations found</p>
          <p className="text-slate-600 text-xs">Messages from clients will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {convs.data?.items.map(conv => {
            const badge = CHANNEL_BADGE[conv.channelType] ?? { label: conv.channelType, color: "bg-slate-500/20 text-slate-400 border-slate-500/30" };
            const isSelected = selected === conv.id;
            return (
              <div key={conv.id}
                onClick={() => setSelected(isSelected ? null : conv.id)}
                className={`glass-card rounded-xl p-3 cursor-pointer transition-all ${
                  isSelected ? "border border-brand-500/40 bg-brand-500/5" : "hover:bg-white/5"
                }`}>
                <div className="flex items-center gap-3">
                  {/* Channel badge */}
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg border ${badge.color}`}>
                    {badge.label}
                  </span>

                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {conv.channelUserId}
                    </p>
                    <p className="text-xs text-slate-500">{timeAgo(conv.lastMessageAt)}</p>
                  </div>

                  {/* Status */}
                  <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE[conv.status ?? "open"]}`}>
                    {conv.status ?? "open"}
                  </span>
                </div>

                {/* Expanded actions */}
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
                    <p className="text-xs text-slate-500 flex-1">
                      ID: <span className="font-mono text-slate-400">{conv.id}</span>
                    </p>
                    {conv.status === "open" ? (
                      <button
                        onClick={e => { e.stopPropagation(); setStatus.mutate({ tenantId: effectiveTenantId, id: conv.id, status: "closed" }); }}
                        className="text-xs text-slate-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1 transition-colors"
                      >
                        Close
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setStatus.mutate({ tenantId: effectiveTenantId, id: conv.id, status: "open" }); }}
                        className="text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 rounded-lg px-2.5 py-1 transition-colors"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Load more hint */}
          {convs.data?.nextCursor && (
            <p className="text-center text-xs text-slate-600 py-2">Scroll for more</p>
          )}
        </div>
      )}
    </Shell>
  );
}
