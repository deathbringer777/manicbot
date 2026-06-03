"use client";

import { useState, useEffect, type FormEvent } from "react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

interface Props {
  tenantId: string;
}

const DAY_SEC = 86_400;

function StampCardConfig({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const cfg = api.stampCard.getConfig.useQuery({ tenantId });
  const utils = api.useUtils();
  const save = api.stampCard.updateConfig.useMutation({
    onSuccess: () => utils.stampCard.getConfig.invalidate({ tenantId }),
  });

  const [enabled, setEnabled] = useState(false);
  const [visitsRequired, setVisitsRequired] = useState(5);
  const [rewardType, setRewardType] = useState<"free_service" | "percent_off" | "fixed_off">("free_service");
  const [rewardValue, setRewardValue] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cfg.data) {
      setEnabled(cfg.data.enabled === 1);
      setVisitsRequired(cfg.data.visitsRequired ?? 5);
      setRewardType((cfg.data.rewardType ?? "free_service") as "free_service" | "percent_off" | "fixed_off");
      setRewardValue(cfg.data.rewardValue != null ? String(cfg.data.rewardValue) : "");
      setDirty(false);
    }
  }, [cfg.data]);

  function onChange<T>(setter: (v: T) => void, v: T) {
    setter(v);
    setDirty(true);
  }

  function submit() {
    save.mutate({
      tenantId,
      enabled,
      visitsRequired,
      rewardType,
      rewardValue: rewardValue ? Number(rewardValue) : null,
    }, {
      onSuccess: () => setDirty(false),
    });
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("stamp.title", lang)}</h3>
          <p className="text-xs text-slate-500 dark:text-white/50">{t("stamp.subtitle", lang)}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(setEnabled, !enabled)}
          className={`relative h-6 w-11 rounded-full transition ${
            enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"
          }`}
          aria-label={enabled ? t("stamp.disable", lang) : t("stamp.enable", lang)}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              enabled ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-slate-200 dark:border-white/10 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("stamp.visitsRequired", lang)}</label>
              <input
                type="number"
                min={2}
                max={30}
                value={visitsRequired}
                onChange={(e) => onChange(setVisitsRequired, Math.max(2, Math.min(30, Number(e.target.value) || 5)))}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("stamp.rewardType", lang)}</label>
              <select
                value={rewardType}
                onChange={(e) => onChange(setRewardType, e.target.value as "free_service" | "percent_off" | "fixed_off")}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              >
                <option value="free_service">{t("stamp.freeService", lang)}</option>
                <option value="percent_off">{t("stamp.percentOff", lang)}</option>
                <option value="fixed_off">{t("stamp.fixedOff", lang)}</option>
              </select>
            </div>
          </div>
          {rewardType !== "free_service" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">
                {rewardType === "percent_off" ? t("stamp.discountPercent", lang) : t("stamp.discountAmount", lang)}
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={rewardValue}
                onChange={(e) => onChange(setRewardValue, e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              />
            </div>
          )}
        </div>
      )}

      {dirty && (
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }}
        >
          {save.isPending ? t("stamp.saving", lang) : t("common.save", lang)}
        </button>
      )}
    </div>
  );
}

export function PromoCodesTab({ tenantId }: Props) {
  const { lang } = useLang();
  const list = api.promoCodes.list.useQuery({ tenantId, activeOnly: false });
  const utils = api.useUtils();
  const create = api.promoCodes.create.useMutation({
    onSuccess: () => utils.promoCodes.list.invalidate({ tenantId, activeOnly: false }),
  });
  const del = api.promoCodes.delete.useMutation({
    onSuccess: () => utils.promoCodes.list.invalidate({ tenantId, activeOnly: false }),
  });

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed_pln">("percent");
  const [discountValue, setDiscountValue] = useState<string>("10");
  const [validDays, setValidDays] = useState<string>("30");
  const [maxUses, setMaxUses] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; code: string } | null>(null);

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setCode(s);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!code.trim() || Number(discountValue) < 1) {
      setErr(t("promo.requiredFields", lang));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const validFor = Math.max(1, Number(validDays) || 30);
    create.mutate({
      tenantId,
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: Math.max(1, Math.min(10_000, Number(discountValue))),
      validFrom: now,
      validUntil: now + validFor * DAY_SEC,
      maxUses: maxUses ? Math.max(1, Number(maxUses)) : undefined,
      maxUsesPerClient: 1,
      kind: "manual",
    }, {
      onError: (e) => setErr(e.message ?? t("promo.createError", lang)),
      onSuccess: () => {
        setCode("");
        setDiscountValue("10");
        setMaxUses("");
      },
    });
  }

  const localeForDate = lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : lang === "ua" ? "uk-UA" : "ru-RU";

  return (
    <div className="space-y-6">
      {/* Stamp card config */}
      <StampCardConfig tenantId={tenantId} />

      {/* Create form */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">{t("promo.newTitle", lang)}</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              type="text"
              placeholder="CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 font-mono text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-white/30 focus:border-violet-400"
            />
            <button
              type="button"
              onClick={randomCode}
              className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-xs text-slate-700 dark:text-white/70 transition hover:bg-slate-50 dark:hover:bg-white/[0.08]"
            >
              🎲 {t("promo.random", lang)}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("promo.discountType", lang)}</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed_pln")}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              >
                <option value="percent">{t("promo.percent", lang)}</option>
                <option value="fixed_pln">{t("promo.fixedPln", lang)}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("promo.value", lang)}</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("promo.validDays", lang)}</label>
              <input
                type="number"
                min={1}
                max={365}
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-white/70">{t("promo.maxUses", lang)}</label>
            <input
              type="number"
              min={1}
              max={10000}
              placeholder="∞"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-white/30 focus:border-violet-400"
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">{err}</p>
          )}

          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(209,70,56,0.45)] transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }}
          >
            {create.isPending ? t("promo.creating", lang) : t("promo.create", lang)}
          </button>
        </form>
      </div>

      {/* Existing codes list */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">{t("promo.activeTitle", lang)}</h3>
        {list.isLoading && <p className="text-xs text-slate-500 dark:text-white/50">{t("promo.loading", lang)}</p>}
        {!list.isLoading && (list.data?.length ?? 0) === 0 && (
          <p className="text-xs text-slate-500 dark:text-white/50">{t("promo.empty", lang)}</p>
        )}
        <div className="space-y-2">
          {(list.data ?? []).map((p) => {
            const now = Math.floor(Date.now() / 1000);
            const expired = p.validUntil && p.validUntil < now;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900 dark:text-white">{p.code}</span>
                    <span className="rounded-full bg-slate-100 dark:bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:text-white/60">
                      {p.kind}
                    </span>
                    {expired && (
                      <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
                        {t("promo.expired", lang)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-white/55">
                    −{p.discountValue}{p.discountType === "percent" ? "%" : " zł"}
                    {p.validUntil ? ` · ${t("promo.until", lang)} ${new Date(p.validUntil * 1000).toLocaleDateString(localeForDate)}` : ""}
                    {p.maxUses ? ` · ${p.maxUses} ${t("promo.uses", lang)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingDelete({ id: p.id, code: p.code })}
                  className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-1.5 text-xs text-slate-600 dark:text-white/60 transition hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title={`${t("promo.confirmDelete", lang)} ${pendingDelete?.code ?? ""}?`}
        description={t("common.deleteConfirmDesc", lang)}
        confirmLabel={t("common.delete", lang)}
        busy={del.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          del.mutate({ tenantId, id: pendingDelete.id }, {
            onSettled: () => setPendingDelete(null),
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
