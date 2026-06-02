"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  Ticket, Copy, Check, Loader2, Trash2, Sparkles, AlertTriangle,
} from "lucide-react";

type Plan = "start" | "pro" | "max";

const PLAN_BADGE: Record<string, string> = {
  start: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  pro: "bg-brand-500/10 text-brand-500 dark:text-brand-400",
  max: "bg-purple-500/10 text-purple-500 dark:text-purple-400",
};
const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  redeemed: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  revoked: "bg-red-500/10 text-red-600 dark:text-red-400",
};
const STATUS_LABEL: Record<string, string> = {
  active: "активен",
  redeemed: "использован",
  revoked: "отозван",
};

const inputCls =
  "w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400/40";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

export default function GrantCodesClient() {
  const utils = api.useUtils();
  const [plan, setPlan] = useState<Plan>("max");
  const [durationDays, setDurationDays] = useState(365);
  const [count, setCount] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [note, setNote] = useState("");
  const [issued, setIssued] = useState<Array<{ id: string; code: string }>>([]);

  const listQuery = api.subscriptionGrantCodes.list.useQuery({});
  const generateMut = api.subscriptionGrantCodes.generate.useMutation({
    onSuccess: (data) => {
      setIssued(data.codes.map((c) => ({ id: c.id, code: c.code })));
      void utils.subscriptionGrantCodes.list.invalidate();
    },
  });
  const revokeMut = api.subscriptionGrantCodes.revoke.useMutation({
    onSuccess: () => void utils.subscriptionGrantCodes.list.invalidate(),
  });

  const fmtDate = (ts: number | null | undefined) =>
    ts ? new Date(ts * 1000).toLocaleDateString("ru-RU") : "—";

  const rows = listQuery.data ?? [];

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-purple-500/10 p-2">
            <Ticket className="w-5 h-5 text-purple-500 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Промокоды подписки</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Одноразовые сервисные коды (префикс <span className="font-mono">SVC-</span>) дают
              салону бесплатный период подписки. Тестировщик вводит код при регистрации в поле
              «Промокод друга» (источник «Друзья / знакомые»). В базе хранится только хэш — код
              виден один раз, поэтому скопируйте его сразу.
            </p>
          </div>
        </div>

        {/* Generate */}
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-400" /> Сгенерировать
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="space-y-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Тариф</span>
              <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={inputCls}>
                <option value="start">start</option>
                <option value="pro">pro</option>
                <option value="max">max</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Срок, дней</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={durationDays}
                onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 0))}
                className={inputCls}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Количество</span>
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 0)))}
                className={inputCls}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Истекает через, дней (опц.)</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="без срока"
                className={inputCls}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Заметка (опц.)</span>
              <input
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="напр. тестировщик Аня"
                className={inputCls}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              generateMut.mutate({
                plan,
                durationDays,
                count,
                expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
                note: note.trim() || undefined,
              })
            }
            disabled={generateMut.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            {generateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            Сгенерировать
          </button>
          {generateMut.error ? (
            <p className="text-xs text-red-500 dark:text-red-400">{generateMut.error.message}</p>
          ) : null}

          {issued.length > 0 ? (
            <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 dark:border-amber-400/25 dark:bg-amber-500/10 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Скопируйте коды сейчас — повторно их не показать.
              </p>
              {issued.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-slate-900 dark:text-white select-all">{c.code}</span>
                  <CopyButton value={c.code} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* List */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Выданные коды</h2>
            <span className="ml-auto text-[10px] text-slate-500">{rows.length}</span>
          </div>
          {listQuery.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse bg-slate-200 dark:bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : !rows.length ? (
            <div className="p-6 text-xs text-slate-500 text-center">Пока нет кодов</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5 text-left text-slate-500">
                    <th className="px-4 py-2 font-medium">Код</th>
                    <th className="px-4 py-2 font-medium">Тариф</th>
                    <th className="px-4 py-2 font-medium">Срок</th>
                    <th className="px-4 py-2 font-medium">Статус</th>
                    <th className="px-4 py-2 font-medium">Заметка</th>
                    <th className="px-4 py-2 font-medium">Создан</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-200">{row.codePrefix}…</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${PLAN_BADGE[row.plan] ?? ""}`}>
                          {row.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{row.durationDays} дн.</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[row.status] ?? ""}`}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500 max-w-[12rem] truncate">{row.note ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono">{fmtDate(row.createdAt)}</td>
                      <td className="px-4 py-2 text-right">
                        {row.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => revokeMut.mutate({ id: row.id })}
                            disabled={revokeMut.isPending}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" /> Отозвать
                          </button>
                        ) : row.status === "redeemed" ? (
                          <span className="text-[10px] text-slate-400">{fmtDate(row.redeemedAt)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
