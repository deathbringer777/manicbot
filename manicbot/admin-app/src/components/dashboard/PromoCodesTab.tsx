"use client";

import { useState, type FormEvent } from "react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
}

const DAY_SEC = 86_400;

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
