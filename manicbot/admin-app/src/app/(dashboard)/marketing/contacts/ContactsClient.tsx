"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { MarketingShell } from "../MarketingShell";
import { Loader2, Mail, Phone, Search, Ban } from "lucide-react";

function fmtDate(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function ContactsClient() {
  const [search, setSearch] = useState("");
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const listQ = (api as any).marketing.contactsList.useQuery({ search, subscribedOnly, limit: 100, offset: 0 });

  return (
    <MarketingShell title="Marketing • Contacts" subtitle="CRM база: лиды, клиенты салонов, web-users">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email, имени, телефону…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={subscribedOnly}
            onChange={(e) => setSubscribedOnly(e.target.checked)}
            className="accent-violet-500"
          />
          Только подписаны
        </label>
        <div className="text-xs text-slate-500 ml-auto">
          Всего: <b className="text-slate-200 tabular-nums">{listQ.data?.total ?? "—"}</b>
        </div>
      </div>

      {listQ.isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Имя</th>
                <th className="text-left px-3 py-2">Телефон</th>
                <th className="text-left px-3 py-2">Источник</th>
                <th className="text-left px-3 py-2">Lifecycle</th>
                <th className="text-left px-3 py-2">Последний контакт</th>
                <th className="text-left px-3 py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {listQ.data?.items.map((c: any) => (
                <tr key={c.id} className="border-t border-slate-800/60 hover:bg-slate-900/30">
                  <td className="px-3 py-2 text-slate-200 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3 text-slate-500" />
                      {c.email}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{c.name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono text-[11px]">
                    {c.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-slate-500" />{c.phone}</span> : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{c.source ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{c.lifecycleStage ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{fmtDate(c.lastSeenAt)}</td>
                  <td className="px-3 py-2">
                    {c.unsubscribed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-400">
                        <Ban className="h-3 w-3" /> unsubscribed
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-400">active</span>
                    )}
                  </td>
                </tr>
              ))}
              {!listQ.data?.items.length && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-500 text-xs">Контактов нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </MarketingShell>
  );
}
