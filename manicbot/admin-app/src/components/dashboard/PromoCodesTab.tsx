"use client";

import { useState, useEffect, type FormEvent } from "react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
}

const DAY_SEC = 86_400;

function StampCardConfig({ tenantId }: { tenantId: string }) {
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
    <div className="glass-card rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Stamp card (карта лояльности)</h3>
          <p className="text-xs text-white/50">Каждый N-й визит клиента — в подарок или со скидкой.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(setEnabled, !enabled)}
          className={`relative h-6 w-11 rounded-full transition ${
            enabled ? "bg-emerald-500" : "bg-white/20"
          }`}
          aria-label={enabled ? "Отключить" : "Включить"}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              enabled ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Визитов для награды</label>
              <input
                type="number"
                min={2}
                max={30}
                value={visitsRequired}
                onChange={(e) => onChange(setVisitsRequired, Math.max(2, Math.min(30, Number(e.target.value) || 5)))}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Тип награды</label>
              <select
                value={rewardType}
                onChange={(e) => onChange(setRewardType, e.target.value as "free_service" | "percent_off" | "fixed_off")}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              >
                <option value="free_service">Бесплатная услуга</option>
                <option value="percent_off">% скидки</option>
                <option value="fixed_off">Фикс. скидка (zł)</option>
              </select>
            </div>
          </div>
          {rewardType !== "free_service" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">
                {rewardType === "percent_off" ? "Процент скидки" : "Сумма скидки (zł)"}
              </label>
              <input
                type="number"
                min={0}
                max={10000}
                value={rewardValue}
                onChange={(e) => onChange(setRewardValue, e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
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
          style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      )}
    </div>
  );
}

export function PromoCodesTab({ tenantId }: Props) {
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
      setErr("Код и значение скидки обязательны.");
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
      onError: (e) => setErr(e.message ?? "Не удалось создать промокод"),
      onSuccess: () => {
        setCode("");
        setDiscountValue("10");
        setMaxUses("");
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Stamp card config */}
      <StampCardConfig tenantId={tenantId} />

      {/* Create form */}
      <div className="glass-card rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Новый промокод</h3>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              type="text"
              placeholder="CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-400"
            />
            <button
              type="button"
              onClick={randomCode}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 transition hover:bg-white/[0.08]"
            >
              🎲 Случайный
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Тип скидки</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed_pln")}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              >
                <option value="percent">Процент</option>
                <option value="fixed_pln">Фикс (zł)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Значение</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Срок (дней)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Лимит использований (необяз.)</label>
            <input
              type="number"
              min={1}
              max={10000}
              placeholder="∞"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-violet-400"
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300">{err}</p>
          )}

          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            {create.isPending ? "Создаём…" : "Создать промокод"}
          </button>
        </form>
      </div>

      {/* Existing codes list */}
      <div className="glass-card rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Активные промокоды</h3>
        {list.isLoading && <p className="text-xs text-white/50">Загрузка…</p>}
        {!list.isLoading && (list.data?.length ?? 0) === 0 && (
          <p className="text-xs text-white/50">Пока ничего нет. Создайте первый промокод выше.</p>
        )}
        <div className="space-y-2">
          {(list.data ?? []).map((p) => {
            const now = Math.floor(Date.now() / 1000);
            const expired = p.validUntil && p.validUntil < now;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-white">{p.code}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                      {p.kind}
                    </span>
                    {expired && (
                      <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                        истёк
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-white/55">
                    −{p.discountValue}{p.discountType === "percent" ? "%" : " zł"}
                    {p.validUntil ? ` · до ${new Date(p.validUntil * 1000).toLocaleDateString("ru")}` : ""}
                    {p.maxUses ? ` · ${p.maxUses} шт` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Удалить ${p.code}?`)) {
                      del.mutate({ tenantId, id: p.id });
                    }
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/60 transition hover:bg-rose-500/10 hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
