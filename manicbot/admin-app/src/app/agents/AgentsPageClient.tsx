"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Headphones, Wrench, Shield, Plus, Trash2, X, UserCog } from "lucide-react";

type AgentType = "support" | "technical_support" | "system_admin";

const AGENT_TYPES: { key: AgentType; label: string; desc: string; icon: React.ElementType; color: string }[] = [
  {
    key: "support",
    label: "Поддержка",
    desc: "Может отвечать на обращения клиентов в Live Chat",
    icon: Headphones,
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  {
    key: "technical_support",
    label: "Техподдержка",
    desc: "Доступ к техническим вопросам от владельцев салонов",
    icon: Wrench,
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    key: "system_admin",
    label: "Системный Администратор",
    desc: "Полный доступ к платформе (God Mode в боте)",
    icon: Shield,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
];

export default function AgentsPageClient() {
  const [showAdd, setShowAdd] = useState(false);
  const [addChatId, setAddChatId] = useState("");
  const [addType, setAddType] = useState<AgentType>("support");

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

  function getListForType(type: AgentType): number[] {
    if (!data) return [];
    if (type === "support") return data.support;
    if (type === "technical_support") return data.techSupport;
    if (type === "system_admin") return data.platformAdmins;
    return [];
  }

  const totalCount = data
    ? [...new Set([...data.support, ...data.techSupport, ...data.platformAdmins])].length
    : 0;

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Агенты</h1>
            <p className="text-sm text-slate-400 mt-1">{totalCount} агентов на платформе</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>

        {/* Info banner */}
        <div className="glass-card rounded-2xl p-4 border-l-4 border-purple-500/60">
          <div className="flex items-start gap-3">
            <UserCog className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-white">Платформенные роли</p>
              <p className="text-xs text-slate-400 mt-1">
                Здесь управляются роли платформы — аналог команд /grant_support, /grant_tech_support в боте.
                Роли на уровне тенантов (мастер, владелец) настраиваются в разделе Tenants.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="glass-card rounded-2xl h-28 animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-4">
            {AGENT_TYPES.map(({ key, label, desc, icon: Icon, color }) => {
              const list = getListForType(key);
              return (
                <div key={key} className="glass-card rounded-2xl overflow-hidden">
                  {/* Type header */}
                  <div className={`px-4 py-3 flex items-center gap-3 border-b border-border/30`}>
                    <div className={`p-2 rounded-xl border ${color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-white">{label}</p>
                      <p className="text-[11px] text-slate-400">{desc}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>{list.length}</span>
                  </div>

                  {/* Agents list */}
                  {list.length > 0 ? (
                    <div className="divide-y divide-border/20">
                      {list.map((chatId) => (
                        <div key={chatId} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center">
                              <Icon className="w-3.5 h-3.5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-mono font-semibold text-white">#{chatId}</p>
                              <p className="text-[10px] text-slate-500">Telegram User ID</p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeMut.mutate({ chatId })}
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
                      Нет агентов этого типа
                    </div>
                  )}

                  {/* Quick add button */}
                  <div className="px-4 py-3 border-t border-border/20">
                    <button
                      onClick={() => { setAddType(key); setShowAdd(true); }}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800/50 active:bg-slate-700/50 text-slate-400 text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Добавить {label.toLowerCase()}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add Agent Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-900 border border-slate-700/60 rounded-t-3xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-slate-700 mx-auto mb-5" />
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white">Добавить агента</h3>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Telegram Chat ID</label>
                <input
                  type="number"
                  value={addChatId}
                  onChange={(e) => setAddChatId(e.target.value)}
                  placeholder="321706035"
                  autoFocus
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-brand-500/60 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">Числовой ID пользователя в Telegram (не username)</p>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-2">Тип роли</label>
                <div className="space-y-2">
                  {AGENT_TYPES.map(({ key, label, desc, icon: Icon, color }) => (
                    <button
                      key={key}
                      onClick={() => setAddType(key)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                        addType === key ? color : "border-slate-700/30 bg-slate-800/30 text-slate-400"
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
                {addMut.isPending ? "Добавляю..." : "Добавить агента"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
