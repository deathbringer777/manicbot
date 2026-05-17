"use client";

/**
 * Loyalty Stamps runtime — Phase 3 plugin (Variant A item #5, "real rebuild").
 *
 * Reads `users.lifetime_visits` (migration 0062) and visualises stamp-card
 * progress per client. Settings — stamp threshold + reward — live in
 * `plugin_installations.settings_json` via the generic
 * `plugins.updateSettings` mutation.
 *
 * Reward can be linked to an existing service (service name is used as the
 * display text) or be a freeform custom string. Settings shape:
 *   { stampsRequired, rewardServiceId: string|null, rewardText: string }
 * `rewardServiceId` null / absent → custom text branch.
 *
 * Redemption is manual for the MVP — the owner sees the 🎁 badge and
 * applies the discount at the next booking.
 */

import { useEffect, useMemo, useState } from "react";
import { Star, Save, Gift } from "lucide-react";
import { api } from "~/trpc/react";
import { PluginRuntimeShell } from "~/components/plugins/PluginRuntimeShell";
import { useRole } from "~/components/RoleContext";
import { resolveAvatarEmoji } from "~/lib/clientAvatar";
import type { PluginRuntimeProps } from "../runtimePanels";

const DEFAULT_STAMPS_REQUIRED = 7;
const DEFAULT_REWARD_TEXT = "Бесплатная процедура";
const CUSTOM_REWARD_SENTINEL = "__custom__";

interface LoyaltySettings {
  stampsRequired?: number;
  rewardServiceId?: string | null;
  rewardText?: string;
}

function parseSvcName(names: string | null | undefined, svcId: string): string {
  try {
    const j = JSON.parse(names ?? "{}") as Record<string, string>;
    return j.ru ?? j.en ?? svcId;
  } catch {
    return svcId;
  }
}

export default function LoyaltyStampsRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { tenantId } = useRole();

  const installedQ = api.plugins.getInstalled.useQuery();
  const updateSettings = api.plugins.updateSettings.useMutation();
  const utils = api.useUtils();

  const servicesQ = api.salon.getServices.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: !!tenantId },
  );
  const activeServices = (servicesQ.data ?? []).filter(
    (s: { active: number; hidden: number }) => s.active === 1 && !s.hidden,
  );

  const myInstall = installedQ.data?.find((x) => x.id === installationId);
  const persisted = useMemo<LoyaltySettings>(() => {
    if (!myInstall?.settingsJson) return {};
    try { return JSON.parse(myInstall.settingsJson) as LoyaltySettings; }
    catch { return {}; }
  }, [myInstall?.settingsJson]);

  const [stampsRequired, setStampsRequired] = useState<number>(
    persisted.stampsRequired ?? DEFAULT_STAMPS_REQUIRED,
  );
  // String svcId → that service is selected; CUSTOM_REWARD_SENTINEL → freeform text
  const [rewardServiceId, setRewardServiceId] = useState<string>(
    persisted.rewardServiceId ?? CUSTOM_REWARD_SENTINEL,
  );
  const [rewardText, setRewardText] = useState<string>(
    persisted.rewardText ?? DEFAULT_REWARD_TEXT,
  );
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Hydrate once settings arrive from the server
  useEffect(() => {
    if (persisted.stampsRequired !== undefined) setStampsRequired(persisted.stampsRequired);
    const sid = persisted.rewardServiceId;
    setRewardServiceId(sid != null ? sid : CUSTOM_REWARD_SENTINEL);
    if (persisted.rewardText !== undefined) setRewardText(persisted.rewardText);
  }, [persisted.stampsRequired, persisted.rewardServiceId, persisted.rewardText]);

  const isCustomReward = rewardServiceId === CUSTOM_REWARD_SENTINEL;

  const onSave = () => {
    const clamped = Math.max(3, Math.min(15, Math.floor(stampsRequired)));
    let finalText = rewardText.trim().slice(0, 200) || DEFAULT_REWARD_TEXT;
    let finalServiceId: string | null = null;

    if (!isCustomReward && rewardServiceId) {
      const svc = (activeServices as Array<{ svcId: string; names: string | null; emoji: string | null; price: number }>)
        .find((s) => s.svcId === rewardServiceId);
      if (svc) {
        finalServiceId = svc.svcId;
        finalText = parseSvcName(svc.names, svc.svcId);
      }
    }

    updateSettings.mutate(
      {
        installationId,
        settings: {
          stampsRequired: clamped,
          rewardServiceId: finalServiceId,
          rewardText: finalText,
        },
      },
      {
        onSuccess: () => {
          setFlash({ kind: "ok", text: "Настройки сохранены" });
          void utils.plugins.getInstalled.invalidate();
        },
        onError: (e) => setFlash({ kind: "err", text: e.message }),
      },
    );
  };

  const clientsQ = api.clients.list.useQuery(
    { tenantId: tenantId ?? "", sort: "visits", limit: 50 },
    { enabled: !!tenantId },
  );

  const rows = (clientsQ.data?.rows ?? []).map(
    (c: {
      chatId: number;
      name?: string | null;
      phone?: string | null;
      tgUsername?: string | null;
      lifetimeVisits?: number;
      avatarEmoji?: string | null;
      tags?: string | null;
      notes?: string | null;
    }) => {
      const visits = c.lifetimeVisits ?? 0;
      const cycles = Math.floor(visits / stampsRequired);
      const current = visits % stampsRequired;
      return { row: c, visits, cycles, current };
    },
  );

  return (
    <PluginRuntimeShell slug={slug} flash={flash}>
      <div className="space-y-4">
        {/* ── Settings ── */}
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

            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
              <span>Что получит клиент</span>
              <select
                value={rewardServiceId}
                onChange={(e) => setRewardServiceId(e.target.value)}
                data-testid="loyalty-reward-service-select"
                className="mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                {(activeServices as Array<{ svcId: string; names: string | null; emoji: string | null; price: number }>)
                  .map((svc) => (
                    <option key={svc.svcId} value={svc.svcId} data-testid="loyalty-service-option">
                      {svc.emoji ? `${svc.emoji} ` : ""}
                      {parseSvcName(svc.names, svc.svcId)} — {svc.price} zł
                    </option>
                  ))}
                <option value={CUSTOM_REWARD_SENTINEL}>✏️ Свой текст…</option>
              </select>
              {isCustomReward && (
                <input
                  type="text"
                  value={rewardText}
                  onChange={(e) => setRewardText(e.target.value)}
                  maxLength={200}
                  placeholder="Напр.: Бесплатное покрытие"
                  data-testid="loyalty-reward-input"
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              )}
            </div>
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

        {/* ── Client list ── */}
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
            {rows.map(({ row, visits, cycles, current }) => {
              const tags = row.tags
                ? row.tags.split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 3)
                : [];
              const noteSnippet = row.notes ? row.notes.slice(0, 60) : null;
              const displayName = row.name?.trim() || row.phone || row.tgUsername || "Без имени";

              return (
                <div
                  key={row.chatId}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                  data-testid="loyalty-client-row"
                >
                  {/* Avatar emoji */}
                  <span
                    className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-base shrink-0 select-none"
                    aria-hidden="true"
                    data-testid="loyalty-client-avatar"
                  >
                    {resolveAvatarEmoji(row.avatarEmoji)}
                  </span>

                  {/* Name + tags + notes */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{displayName}</p>
                    {(tags.length > 0 || noteSnippet) && (
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {tags.map((tag: string) => (
                          <span
                            key={tag}
                            data-testid="loyalty-client-tag"
                            className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 leading-none"
                          >
                            {tag}
                          </span>
                        ))}
                        {noteSnippet && (
                          <span
                            className="text-[10px] text-slate-400 truncate max-w-[120px]"
                            data-testid="loyalty-client-note"
                            title={row.notes ?? undefined}
                          >
                            {noteSnippet}{(row.notes?.length ?? 0) > 60 ? "…" : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress */}
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
                  <span
                    className="text-[10px] text-slate-400 shrink-0 tabular-nums w-12 text-right"
                    title={`Всего визитов: ${visits}`}
                  >
                    {visits} viz.
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </PluginRuntimeShell>
  );
}
