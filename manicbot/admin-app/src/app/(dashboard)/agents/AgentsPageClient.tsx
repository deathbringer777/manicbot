"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Headphones, Wrench, Shield, Plus, Trash2, X, UserCog } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, pluralCount, type Lang } from "~/lib/i18n";

type AgentType = "support" | "technical_support";

const TAB_ICONS: Record<AgentType, React.ReactNode> = {
  support: <Headphones className="h-4 w-4" />,
  technical_support: <Wrench className="h-4 w-4" />,
};

function getAgentTypes(lang: Lang): { key: AgentType; label: string; desc: string; icon: React.ElementType; color: string }[] {
  return [
    {
      key: "support",
      label: t("gmAgents.supportLabel", lang),
      desc: t("gmAgents.supportDesc", lang),
      icon: Headphones,
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    },
    {
      key: "technical_support",
      label: t("gmAgents.techSupportLabel", lang),
      desc: t("gmAgents.techSupportDesc", lang),
      icon: Wrench,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
  ];
}

export default function AgentsPageClient() {
  const { lang } = useLang();
  const [activeTab, setActiveTab] = useState<AgentType>("support");
  const [showAdd, setShowAdd] = useState(false);
  const [addChatId, setAddChatId] = useState("");
  const [addType, setAddType] = useState<AgentType>("support");

  const AGENT_TYPES = getAgentTypes(lang);

  const utils = api.useUtils();
  const { data, isLoading } = api.provisioning.listAgents.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const addMut = api.provisioning.addAgent.useMutation({
    onSuccess: () => { utils.provisioning.listAgents.invalidate(); setShowAdd(false); setAddChatId(""); },
  });
  const removeMut = api.provisioning.removeAgent.useMutation({
    onSuccess: () => utils.provisioning.listAgents.invalidate(),
  });

  type AgentInfo = { chatId: number; name: string | null; username: string | null };

  function getListForType(type: AgentType): AgentInfo[] {
    if (!data) return [];
    if (type === "support") return data.support;
    if (type === "technical_support") return data.techSupport;
    return [];
  }

  const totalCount = data
    ? [...new Set([...data.support.map((a) => a.chatId), ...data.techSupport.map((a) => a.chatId)])].length
    : 0;
  const legacyAdmins: AgentInfo[] = data?.platformAdmins ?? [];

  const activeType = AGENT_TYPES.find((tt) => tt.key === activeTab)!;
  const activeList = getListForType(activeTab);

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("gmAgents.titleHeader", lang)}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {pluralCount(totalCount, "count.agents", lang)}
              {legacyAdmins.length > 0 ? ` · ${legacyAdmins.length} ${t("gmAgents.legacyAdminsSuffix", lang)}` : ""}
            </p>
          </div>
          <button
            onClick={() => { setAddType(activeTab); setShowAdd(true); }}
            className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20"
          >
            <Plus className="w-4 h-4" />
            {t("gmAgents.addPrefix", lang)}
          </button>
        </div>

        {/* Info banner */}
        <div className="glass-card rounded-2xl p-4 border-l-4 border-purple-500/60">
          <div className="flex items-start gap-3">
            <UserCog className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{t("gmAgents.platformRoles", lang)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t("gmAgents.platformInfo", lang)}
              </p>
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-white/[0.06]">
          {AGENT_TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === key
                  ? "bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-white"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              {TAB_ICONS[key]}
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {isLoading ? (
          <div className="glass-card rounded-2xl h-28 animate-pulse" />
        ) : (
          <div className="glass-card rounded-2xl overflow-hidden">
            {/* Type header */}
            <div className="px-4 py-3 flex items-center gap-3 border-b border-border/30">
              <div className={`p-2 rounded-xl border ${activeType.color}`}>
                <activeType.icon className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{activeType.label}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{activeType.desc}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${activeType.color}`}>{activeList.length}</span>
            </div>

            {/* Agents list */}
            {activeList.length > 0 ? (
              <div className="divide-y divide-border/20">
                {activeList.map((agent) => (
                  <div key={agent.chatId} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-400">
                        {agent.name ? agent.name.charAt(0).toUpperCase() : <activeType.icon className="w-3.5 h-3.5" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {agent.name || `#${agent.chatId}`}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {agent.username ? `@${agent.username} · ` : ""}#{agent.chatId}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeMut.mutate({ chatId: agent.chatId })}
                      disabled={removeMut.isPending}
                      className="p-2 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                {t("gmAgents.noAgentsOfType", lang)}
              </div>
            )}

            {/* Quick add button */}
            <div className="px-4 py-3 border-t border-border/20">
              <button
                onClick={() => { setAddType(activeTab); setShowAdd(true); }}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100/50 dark:bg-slate-800/50 active:bg-slate-200 dark:active:bg-slate-700/50 text-slate-500 dark:text-slate-400 text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("gmAgents.addPrefix", lang)} {activeType.label.toLowerCase()}
              </button>
            </div>
          </div>
        )}

        {/* Legacy admins — outside tabs */}
        {legacyAdmins.length > 0 && (
          <div className="glass-card rounded-2xl overflow-hidden border border-amber-500/20">
            <div className="px-4 py-3 flex items-center gap-3 border-b border-border/30 bg-amber-500/5">
              <Shield className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{t("gmAgents.legacyAdminsTitle", lang)}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t("gmAgents.legacyAdminsDesc", lang)}
                </p>
              </div>
            </div>
            <div className="divide-y divide-border/20">
              {legacyAdmins.map((agent) => (
                <div key={agent.chatId} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {agent.name || `#${agent.chatId}`}
                    </p>
                    {agent.username && <p className="text-[10px] text-slate-500">@{agent.username}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMut.mutate({ chatId: agent.chatId })}
                    disabled={removeMut.isPending}
                    className="p-2 rounded-xl bg-red-500/10 active:bg-red-500/20 text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Add Agent Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/60 rounded-3xl p-6 w-full max-w-md shadow-2xl max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("gmAgents.addAgent", lang)}</h3>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">Telegram Chat ID</label>
                <input
                  type="number"
                  value={addChatId}
                  onChange={(e) => setAddChatId(e.target.value)}
                  placeholder="321706035"
                  autoFocus
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-brand-500/60 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t("gmAgents.tgIdHint", lang)}</p>
              </div>

              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-2">{t("gmAgents.roleType", lang)}</label>
                <div className="space-y-2">
                  {AGENT_TYPES.map(({ key, label, desc, icon: Icon, color }) => (
                    <button
                      key={key}
                      onClick={() => setAddType(key)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                        addType === key ? color : "border-slate-200 dark:border-slate-700/30 bg-slate-100 dark:bg-slate-800/30 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="text-xs font-bold">{label}</p>
                        <p className="text-[10px] opacity-70">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => addMut.mutate({ chatId: parseInt(addChatId), type: addType })}
                disabled={!addChatId || addMut.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 text-white font-semibold text-sm active:bg-brand-500 disabled:opacity-50"
              >
                {addMut.isPending ? t("gmAgents.adding", lang) : t("gmAgents.addAgent", lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
