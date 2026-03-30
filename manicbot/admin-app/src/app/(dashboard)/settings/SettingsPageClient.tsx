"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import { Shell, RoleSwitcherInline, LangPickerInline } from "~/components/layout/Shell";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import {
  Save,
  Bot,
  Key,
  Power,
  Clock,
  CheckCircle,
  Zap,
  Globe,
  User,
} from "lucide-react";

// ─── Toggle ───────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-12 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
        value ? "bg-brand-600" : "bg-slate-700"
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

// ─── Types ────────────────────────────────────────────────────────

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

type ActiveTab = "account" | "platform" | "appearance";

// ─── Tab button ───────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold transition-colors rounded-t-lg ${
        active
          ? "text-brand-400 border-b-2 border-brand-400"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────

export default function SettingsPageClient() {
  const { role } = useRole();
  const { lang } = useLang();

  const [activeTab, setActiveTab] = useState<ActiveTab>("account");

  // Platform settings
  const { data: config, isLoading } = api.settings.getGlobalSettings.useQuery();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config && !form) setForm(config);
  }, [config]);

  const updateMut = api.settings.updateGlobalSettings.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => {
    if (!form) return;
    updateMut.mutate(form);
  };

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  // Change password form
  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changePasswordMut = (api as any).webUsers.changePassword.useMutation({
    onSuccess: () => {
      setPwSuccess(true);
      setPwError(null);
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setTimeout(() => setPwSuccess(false), 3000);
    },
    onError: (err: { message?: string }) => {
      setPwError(err.message ?? "Ошибка изменения пароля");
    },
  }) as { mutate: (args: { currentPassword: string; newPassword: string }) => void; isPending: boolean };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError("Пароли не совпадают");
      return;
    }
    changePasswordMut.mutate({
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
    });
  };

  // Loading skeleton (only relevant for Platform tab data)
  if (isLoading && activeTab === "platform") {
    return (
      <Shell>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
            <p className="text-xs text-slate-400 mt-1">Настройки аккаунта и платформы</p>
          </div>
          {activeTab === "platform" && role === "system_admin" && (
            <button
              onClick={handleSave}
              disabled={updateMut.isPending}
              className="flex items-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70"
            >
              {saved ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Сохранено!
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {updateMut.isPending ? "..." : "Сохранить"}
                </>
              )}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-800 mb-6">
          <TabButton
            label="Аккаунт"
            active={activeTab === "account"}
            onClick={() => setActiveTab("account")}
          />
          {role === "system_admin" && (
            <TabButton
              label="Платформа"
              active={activeTab === "platform"}
              onClick={() => setActiveTab("platform")}
            />
          )}
          <TabButton
            label="Внешний вид"
            active={activeTab === "appearance"}
            onClick={() => setActiveTab("appearance")}
          />
        </div>

        {/* ── Account tab ─────────────────────────────────────────── */}
        {activeTab === "account" && (
          <div className="space-y-4">
            {/* Account info */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-brand-400 shrink-0" />
                <h2 className="text-sm font-bold text-white">Аккаунт</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Email
                  </label>
                  <input
                    type="text"
                    readOnly
                    value="(недоступно в Telegram)"
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-500 outline-none cursor-default select-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Роль
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={role ?? "—"}
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-400 outline-none cursor-default select-none"
                  />
                </div>
              </div>
            </section>

            {/* Change password */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-4 h-4 text-amber-400 shrink-0" />
                <h2 className="text-sm font-bold text-white">Изменить пароль</h2>
              </div>
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Текущий пароль
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={pwForm.currentPassword}
                    onChange={(e) =>
                      setPwForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                    }
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Новый пароль
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pwForm.newPassword}
                    onChange={(e) =>
                      setPwForm((prev) => ({ ...prev, newPassword: e.target.value }))
                    }
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Подтвердите новый пароль
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pwForm.confirmPassword}
                    onChange={(e) => {
                      setPwForm((prev) => ({ ...prev, confirmPassword: e.target.value }));
                      if (pwError === "Пароли не совпадают") setPwError(null);
                    }}
                    className={`w-full bg-slate-900/70 border rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white ${
                      pwError === "Пароли не совпадают"
                        ? "border-red-500/60"
                        : "border-slate-700/50"
                    }`}
                    required
                  />
                </div>

                {/* Inline error */}
                {pwError && (
                  <p className="text-xs text-red-400">{pwError}</p>
                )}

                {/* Success */}
                {pwSuccess && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Пароль успешно изменён
                  </p>
                )}

                <button
                  type="submit"
                  disabled={changePasswordMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70 mt-1"
                >
                  <Save className="w-4 h-4" />
                  {changePasswordMut.isPending ? "Сохранение..." : "Изменить пароль"}
                </button>
              </form>
            </section>
          </div>
        )}

        {/* ── Platform tab (system_admin only) ────────────────────── */}
        {activeTab === "platform" && role === "system_admin" && (
          <div className="space-y-4">
            {/* Role switcher */}
            <section className="glass-card rounded-2xl p-4 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <h2 className="text-sm font-bold text-white">{t("roleSwitch.title", lang)}</h2>
                </div>
                <RoleSwitcherInline placement="settings" />
              </div>
            </section>

            {/* Switches */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Power className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-bold text-white">Режимы</h2>
              </div>
              <div className="space-y-2">
                {[
                  { key: "maintenanceMode" as const, label: "Режим обслуживания", sub: "Бот не отвечает" },
                  { key: "registrationOpen" as const, label: "Регистрация открыта", sub: "Новые тенанты" },
                  { key: "aiEnabled" as const, label: "AI включён", sub: "Обработка через AI" },
                  { key: "notifyOnNew" as const, label: "Уведомления: новая запись", sub: "Мастеру" },
                  { key: "notifyOnCancel" as const, label: "Уведомления: отмена", sub: "Мастеру" },
                ].map(({ key, label, sub }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-border/30"
                  >
                    <div className="min-w-0 mr-3">
                      <p className="text-sm font-medium text-white">{label}</p>
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
                <h2 className="text-sm font-bold text-white">Основные</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Username бота
                  </label>
                  <input
                    type="text"
                    value={form?.botUsername ?? ""}
                    onChange={(e) => set("botUsername", e.target.value)}
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Контакт поддержки
                  </label>
                  <input
                    type="text"
                    value={form?.supportUsername ?? ""}
                    onChange={(e) => set("supportUsername", e.target.value)}
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Часовой пояс
                  </label>
                  <input
                    type="text"
                    value={form?.timezone ?? ""}
                    onChange={(e) => set("timezone", e.target.value)}
                    placeholder="Europe/Warsaw"
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                  />
                </div>
              </div>
            </section>

            {/* Appointments */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-bold text-white">Записи</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                    Макс. записей на пользователя
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form?.maxAppointmentsPerUser ?? 10}
                    onChange={(e) => set("maxAppointmentsPerUser", parseInt(e.target.value) || 10)}
                    className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                      Работа с (ч)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={form?.workingHoursFrom ?? 9}
                      onChange={(e) => set("workingHoursFrom", parseInt(e.target.value))}
                      className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                      до (ч)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={form?.workingHoursTo ?? 21}
                      onChange={(e) => set("workingHoursTo", parseInt(e.target.value))}
                      className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* System Prompt */}
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white">System Prompt</h2>
              </div>
              <textarea
                rows={5}
                value={form?.systemPrompt ?? ""}
                onChange={(e) => set("systemPrompt", e.target.value)}
                className="w-full bg-slate-900/70 border border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-white resize-y"
              />
            </section>

            {/* Danger zone */}
            <section className="glass-card rounded-2xl p-4 border border-red-500/20">
              <h2 className="text-sm font-bold text-red-400 mb-1">Danger Zone</h2>
              <p className="text-[10px] text-slate-400 mb-3">Необратимые действия</p>
              <button
                onClick={() => {
                  set("maintenanceMode", true);
                  handleSave();
                }}
                className="w-full py-3 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium active:bg-red-500/10 transition-colors"
              >
                Включить тех. обслуживание
              </button>
            </section>
          </div>
        )}

        {/* ── Appearance tab ───────────────────────────────────────── */}
        {activeTab === "appearance" && (
          <div className="space-y-4">
            <section className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                <h2 className="text-sm font-bold text-white">{t("settings.language", lang)}</h2>
              </div>
              <LangPickerInline placement="settings" />
            </section>
          </div>
        )}
      </div>
    </Shell>
  );
}
