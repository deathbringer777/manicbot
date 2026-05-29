"use client";

import { useState, useEffect } from "react";
import { Power, Bot, Clock, Key, Save, CheckCircle, User } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

type SettingsForm = {
  botUsername: string;
  supportUsername: string;
  systemPrompt: string;
  maintenanceMode: boolean;
  registrationOpen: boolean;
  maxAppointmentsPerUser: number;
  aiEnabled: boolean;
  workingHoursFrom: number;
  workingHoursTo: number;
  notifyOnNew: boolean;
  notifyOnCancel: boolean;
  timezone: string;
};

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-12 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
        value ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-700"
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-200 ${
          value ? "right-1" : "left-1"
        }`}
      />
    </button>
  );
}

function WebUsersPanel() {
  const webUsersList = api.webUsers.list.useQuery();
  const tenantsList = api.tenants.getAll.useQuery();
  const setTenant = api.webUsers.setTenant.useMutation({
    onSuccess: () => webUsersList.refetch(),
  });

  return (
    <section className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <User className="w-4 h-4 text-sky-400" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Web Users</h2>
      </div>
      {webUsersList.isLoading ? (
        <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-10 rounded-xl bg-slate-200 dark:bg-slate-700/40 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-2">
          {(webUsersList.data ?? []).map((u) => (
            <div key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-white dark:bg-slate-900/50 border border-border/30">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{u.email}</p>
                <p className="text-[10px] text-slate-500">{u.role} · {u.tenantId ?? <span className="text-amber-400">no tenant</span>}</p>
              </div>
              <select
                value={u.tenantId ?? ""}
                onChange={(e) => setTenant.mutate({ userId: u.id, tenantId: e.target.value || null })}
                className="text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-slate-600 dark:text-slate-300 focus:outline-none focus:border-brand-500 shrink-0"
              >
                <option value="">— no tenant —</option>
                {(tenantsList.data ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>
            </div>
          ))}
          {(webUsersList.data ?? []).length === 0 && (
            <p className="text-xs text-slate-500 py-2 text-center">No web users yet</p>
          )}
        </div>
      )}
    </section>
  );
}

export function PlatformSection() {
  const { lang } = useLang();
  const { data: config, isLoading } = api.settings.getGlobalSettings.useQuery();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config && !form) setForm(config);
  }, [config, form]);

  const updateMut = api.settings.updateGlobalSettings.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => { if (form) updateMut.mutate(form); };
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-5 h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const toggleDefs = [
    { key: "maintenanceMode" as const, label: t("settings.maintenanceOn", lang), sub: t("settings.maintenanceOnSub", lang) },
    { key: "registrationOpen" as const, label: t("settings.registrationOpen", lang), sub: t("settings.registrationSub", lang) },
    { key: "aiEnabled" as const, label: t("settings.aiEnabled", lang), sub: t("settings.aiEnabledSub", lang) },
    { key: "notifyOnNew" as const, label: t("settings.notifyNew", lang), sub: t("settings.notifyNewSub", lang) },
    { key: "notifyOnCancel" as const, label: t("settings.notifyCancel", lang), sub: t("settings.notifyNewSub", lang) },
  ];

  return (
    <div className="space-y-4">
      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={updateMut.isPending}
          className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70"
        >
          {saved ? (
            <><CheckCircle className="w-4 h-4" />{t("settings.savedOk", lang)}</>
          ) : (
            <><Save className="w-4 h-4" />{updateMut.isPending ? t("settings.saving", lang) : t("common.save", lang)}</>
          )}
        </button>
      </div>

      {/* Switches */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Power className="w-4 h-4 text-rose-400" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.modes", lang)}</h2>
        </div>
        <div className="space-y-2">
          {toggleDefs.map(({ key, label, sub }) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900/50 border border-border/30">
              <div className="min-w-0 mr-3">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>
              </div>
              <Toggle value={form?.[key] ?? false} onChange={(v) => set(key, v)} />
            </div>
          ))}
        </div>
      </section>

      {/* General */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.general", lang)}</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.botUsername", lang)}</label>
            <input type="text" value={form?.botUsername ?? ""} onChange={(e) => set("botUsername", e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.supportContact", lang)}</label>
            <input type="text" value={form?.supportUsername ?? ""} onChange={(e) => set("supportUsername", e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.timezone", lang)}</label>
            <input type="text" value={form?.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} placeholder="Europe/Warsaw" className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
          </div>
        </div>
      </section>

      {/* Appointments */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("salon.appointments", lang)}</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.maxApts", lang)}</label>
            <input type="number" min={1} max={50} value={form?.maxAppointmentsPerUser ?? 10} onChange={(e) => set("maxAppointmentsPerUser", parseInt(e.target.value) || 10)} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.workFrom", lang)}</label>
              <input type="number" min={0} max={23} value={form?.workingHoursFrom ?? 9} onChange={(e) => set("workingHoursFrom", parseInt(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("settings.workTo", lang)}</label>
              <input type="number" min={1} max={24} value={form?.workingHoursTo ?? 21} onChange={(e) => set("workingHoursTo", parseInt(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white" />
            </div>
          </div>
        </div>
      </section>

      {/* System Prompt */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">System Prompt</h2>
        </div>
        <textarea rows={5} value={form?.systemPrompt ?? ""} onChange={(e) => set("systemPrompt", e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white resize-y" />
      </section>

      <WebUsersPanel />

      {/* Danger zone */}
      <section className="glass-card rounded-2xl p-4 border border-red-500/20">
        <h2 className="text-sm font-bold text-red-400 mb-1">Danger Zone</h2>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3">{t("settings.dangerZoneDesc", lang)}</p>
        <button
          onClick={() => { set("maintenanceMode", true); handleSave(); }}
          className="w-full py-3 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium active:bg-red-500/10 transition-colors"
        >
          {t("settings.enableMaintenance", lang)}
        </button>
      </section>
    </div>
  );
}
