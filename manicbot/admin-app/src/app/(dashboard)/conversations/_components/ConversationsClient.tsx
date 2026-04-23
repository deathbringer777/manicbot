"use client";

import { useState } from "react";
import { MessageSquare, RefreshCw, MessageCircle, Search } from "lucide-react";
import { EmptyState } from "~/components/ui/EmptyState";
import { SkeletonCard } from "~/components/ui/Skeleton";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";

type ChannelFilter = "all" | "telegram" | "whatsapp" | "instagram";
type StatusFilter = "open" | "closed" | "all";

const CHANNEL_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  telegram: { label: "TG", color: "bg-sky-500/20 text-sky-400 border-sky-500/30", icon: "✈️" },
  whatsapp: { label: "WA", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: "💬" },
  instagram: { label: "IG", color: "bg-pink-500/20 text-pink-400 border-pink-500/30", icon: "📷" },
  web: { label: "WEB", color: "bg-violet-500/20 text-violet-400 border-violet-500/30", icon: "🌐" },
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
  const [godTenantFilter, setGodTenantFilter] = useState("");
  const [convSearch, setConvSearch] = useState("");

  const isGod = role === "system_admin";

  const tenants = api.tenants.getAll.useQuery(undefined, { enabled: isGod });

  const convsSalon = api.conversations.list.useQuery(
    {
      tenantId: tenantId ?? "",
      channelType: channelFilter,
      status: statusFilter,
      limit: 30,
    },
    { enabled: !isGod && !!tenantId },
  );

  const convsGod = api.conversations.listAdmin.useQuery(
    {
      tenantId: godTenantFilter || undefined,
      channelType: channelFilter,
      status: statusFilter,
      search: convSearch.trim() || undefined,
      limit: 40,
    },
    { enabled: isGod },
  );

  const convs = isGod ? convsGod : convsSalon;

  const setStatus = api.conversations.setStatus.useMutation({
    onSuccess: () => void convs.refetch(),
  });

  const items = convs.data?.items ?? [];

  if (!isGod && !tenantId) {
    return (
      <Shell navItems={[]} title="Conversations" subtitle="Unified inbox">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <MessageSquare className="h-10 w-10 text-slate-600" />
          <p className="text-slate-500 text-sm">No salon context</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      navItems={[]}
      title="Conversations"
      subtitle="Unified inbox: client chats (TG / WA / IG). Platform staff mail lives in Support tickets."
    >
      {isGod && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search className="h-4 w-4 text-slate-500 shrink-0" />
            <input
              type="search"
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="Search channel user id…"
              className="flex-1 min-w-0 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/40"
            />
          </div>
          <select
            value={godTenantFilter}
            onChange={(e) => setGodTenantFilter(e.target.value)}
            className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500/40"
          >
            <option value="">All salons</option>
            {(tenants.data ?? []).map((t: { id: string; name: string | null }) => (
              <option key={t.id} value={t.id}>
                {t.name ?? t.id}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 bg-slate-50 dark:bg-white/5 rounded-xl p-1">
          {(["all", "telegram", "whatsapp", "instagram"] as ChannelFilter[]).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                channelFilter === ch
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {ch === "all" ? "All" : ch === "telegram" ? "TG" : ch === "whatsapp" ? "WA" : "IG"}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-slate-50 dark:bg-white/5 rounded-xl p-1">
          {(["open", "closed", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all capitalize ${
                statusFilter === s
                  ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={() => void convs.refetch()}
          className="ml-auto text-slate-500 hover:text-slate-300 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${convs.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {convs.isLoading ? (
        <div className="space-y-2.5 mt-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No conversations found"
          description="Messages from clients via Telegram, WhatsApp, and Instagram will appear here"
        />
      ) : (
        <div className="space-y-2">
          {items.map((conv) => {
            const badge = CHANNEL_BADGE[conv.channelType] ?? {
              label: conv.channelType,
              color: "bg-slate-500/20 text-slate-400 border-slate-500/30",
            };
            const isSelected = selected === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => setSelected(isSelected ? null : conv.id)}
                className={`glass-card rounded-xl p-3 cursor-pointer transition-all ${
                  isSelected ? "border border-brand-500/40 bg-brand-500/5" : "hover:bg-slate-50 dark:hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg border ${badge.color}`}>
                    {badge.label}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {conv.displayName || conv.channelUserId}
                    </p>
                    <p className="text-xs text-slate-500">
                      {isGod && (
                        <span className="text-slate-600 mr-2">
                          {conv.tenantName || conv.tenantId}
                        </span>
                      )}
                      {conv.displayName && (
                        <span className="font-mono text-slate-600 mr-2">{conv.channelUserId}</span>
                      )}
                      {timeAgo(conv.lastMessageAt)}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE[conv.status ?? "open"]}`}
                  >
                    {conv.status ?? "open"}
                  </span>
                </div>

                {isSelected && (isGod ? conv.tenantId : tenantId) && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5 flex items-center gap-2">
                    <p className="text-xs text-slate-500 flex-1">
                      ID: <span className="font-mono text-slate-400">{conv.id}</span>
                    </p>
                    {conv.status === "open" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatus.mutate({
                            tenantId: (isGod ? conv.tenantId : tenantId) as string,
                            id: conv.id,
                            status: "closed",
                          });
                        }}
                        className="text-xs text-slate-400 hover:text-white border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1 transition-colors"
                      >
                        Close
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setStatus.mutate({
                            tenantId: (isGod ? conv.tenantId : tenantId) as string,
                            id: conv.id,
                            status: "open",
                          });
                        }}
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

          {!isGod && "nextCursor" in (convs.data ?? {}) && (convs.data as { nextCursor?: number }).nextCursor && (
            <p className="text-center text-xs text-slate-600 py-2">Scroll for more</p>
          )}
        </div>
      )}
    </Shell>
  );
}
