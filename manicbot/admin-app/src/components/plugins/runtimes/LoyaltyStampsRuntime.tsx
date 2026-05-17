"use client";

/**
 * Loyalty Stamps runtime — Phase 3 plugin (Variant A item #5, "real rebuild").
 *
 * The plugin reads `users.lifetime_visits` (migration 0062) and visualizes
 * stamp-card progress per client. Stamp threshold + reward text are stored
 * in `plugin_installations.settings_json` via the generic
 * `plugins.updateSettings` mutation — no new tRPC router needed.
 *
 * Reward redemption is intentionally manual for the MVP: the owner sees
 * "client X earned a reward" and applies the discount during the next
 * booking. Auto-coupon issuance is a follow-up once we ship a coupons
 * table + booking-flow integration.
 */

import { useEffect, useMemo, useState } from "react";
import { Star, Save, Gift } from "lucide-react";
import { api } from "~/trpc/react";
import { PluginRuntimeShell } from "~/components/plugins/PluginRuntimeShell";
import { useRole } from "~/components/RoleContext";
import type { PluginRuntimeProps } from "../runtimePanels";

const DEFAULT_STAMPS_REQUIRED = 7;
const DEFAULT_REWARD_TEXT = "Бесплатная процедура";

interface LoyaltySettings {
  stampsRequired?: number;
  rewardText?: string;
}

export default function LoyaltyStampsRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { tenantId } = useRole();

  const installedQ = api.plugins.getInstalled.useQuery();
  const updateSettings = api.plugins.updateSettings.useMutation();
  const utils = api.useUtils();

  const myInstall = installedQ.data?.find((x) => x.id === installationId);
  const persisted = useMemo<LoyaltySettings>(() => {
    if (!myInstall?.settingsJson) return {};
    try {
      return JSON.parse(myInstall.settingsJson) as LoyaltySettings;
    } catch {
      return {};
    }
  }, [myInstall?.settingsJson]);

  const [stampsRequired, setStampsRequired] = useState<number>(
    persisted.stampsRequired ?? DEFAULT_STAMPS_REQUIRED,
  );
  const [rewardText, setRewardText] = useState<string>(persisted.rewardText ?? DEFAULT_REWARD_TEXT);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Hydrate state once settings arrive
  useEffect(() => {
    if (persisted.stampsRequired !== undefined) setStampsRequired(persisted.stampsRequired);
    if (persisted.rewardText !== undefined) setRewardText(persisted.rewardText);
  }, [persisted.stampsRequired, persisted.rewardText]);

  const clientsQ = api.clients.list.useQuery(
    { tenantId: tenantId ?? "", sort: "visits", limit: 50 },
    { enabled: !!tenantId },
  );

  const onSave = () => {
    const clamped = Math.max(3, Math.min(15, Math.floor(stampsRequired)));
    const trimmed = rewardText.trim().slice(0, 200);
    updateSettings.mutate(
      { installationId, settings: { stampsRequired: clamped, rewardText: trimmed } },
      {
        onSuccess: () => {
          setFlash({ kind: "ok", text: "Настройки сохранены" });
          void utils.plugins.getInstalled.invalidate();
        },
        onError: (e) => setFlash({ kind: "err", text: e.message }),
      },
    );
  };

  const rows = (clientsQ.data?.rows ?? []).map((c) => {
    const visits = c.lifetimeVisits ?? 0;
    const cycles = Math.floor(visits / stampsRequired);
    const current = visits % stampsRequired;
    return { row: c, visits, cycles, current };
  });

  return (
    <PluginRuntimeShell slug={slug} flash={flash}>
      <div className="space-y-4">
        <section className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-500 shrink-0" />
            Настройки карты лояльности
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Визитов до награды
              <input
                type="number"
                min={3}
                max={15}
                value={stampsRequired}
                onChange={(e) => setStampsRequired(parseInt(e.target.value, 10) || DEFAULT_STAMPS_REQUIRED)}
                data-testid="loyalty-stamps-input"
                className="mt-1 block w-24 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </label>

            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 sm:col-span-1">
              Что получит клиент
              <input
                type="text"
                value={rewardText}
                onChange={(e) => setRewardText(e.target.value)}
                maxLength={200}
                data-testid="loyalty-reward-input"
                className="mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={updateSettings.isPending}
            data-testid="loyalty-save-button"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {updateSettings.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        </section>

        <section className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <Gift className="w-4 h-4 text-yellow-500 shrink-0" />
            Клиенты по штампам (топ-50)
          </h3>

          {clientsQ.isLoading && (
            <p className="text-sm text-slate-500" data-testid="loyalty-loading">Загружаем…</p>
          )}

          {!clientsQ.isLoading && rows.length === 0 && (
            <p className="text-sm text-slate-500" data-testid="loyalty-empty">
              Пока нет клиентов с визитами. Карта начнёт заполняться, как только клиенты придут на услуги.
            </p>
          )}

          <div className="space-y-1.5" data-testid="loyalty-client-list">
            {rows.map(({ row, visits, cycles, current }) => (
              <div
                key={row.chatId}
                className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                data-testid="loyalty-client-row"
              >
                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 truncate">
                  {row.name?.trim() || row.phone || row.tgUsername || "Без имени"}
                </span>
                <span className="text-xs text-slate-400 tabular-nums shrink-0 w-12 text-right">
                  {current}/{stampsRequired}
                </span>
                <div className="w-24 sm:w-32 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden shrink-0">
                  <div
                    className="h-full bg-yellow-500 transition-all"
                    style={{ width: `${Math.min(100, (current / stampsRequired) * 100)}%` }}
                  />
                </div>
                {cycles > 0 && (
                  <span
                    className="text-[10px] font-bold text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full px-2 py-0.5 shrink-0"
                    title={`Заработано наград: ${cycles}. Текущая: ${rewardText}`}
                    data-testid="loyalty-reward-badge"
                  >
                    🎁 {cycles}
                  </span>
                )}
                <span className="text-[10px] text-slate-400 shrink-0 tabular-nums w-12 text-right" title={`Всего визитов: ${visits}`}>
                  {visits} viz.
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PluginRuntimeShell>
  );
}
