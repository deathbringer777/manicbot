"use client";

import type { Lang } from "~/lib/i18n";
import type { HelpUiFigure } from "~/content/help/helpArticleFigures";

function Caption({ text, exampleLabel }: { text: string; exampleLabel: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
      <span className="text-violet-600 dark:text-violet-400">{exampleLabel}</span>
      <span className="mx-1.5 opacity-40">·</span>
      {text}
    </p>
  );
}

function TelegramMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "telegram_chat" }>; lang: Lang; exampleLabel: string }) {
  return (
    <div>
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <div className="rounded-xl overflow-hidden border border-slate-200/90 dark:border-white/10 shadow-md bg-[#0e1621]">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#17212b] border-b border-white/5">
        <span className="text-lg leading-none opacity-80">‹</span>
        <span className="text-[13px] font-medium text-white/95 truncate flex-1">{fig.chatTitle[lang]}</span>
        <span className="text-white/40 text-xs">⋮</span>
      </div>
      <div className="px-3 py-3 space-y-2 min-h-[100px]">
        {fig.messages.map((m, i) => (
          <div key={i} className={`flex ${m.side === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${
                m.side === "user"
                  ? "bg-[#2b5278] text-white rounded-br-md"
                  : "bg-[#182533] text-white/95 rounded-bl-md border border-white/5"
              }`}
            >
              {m.text[lang]}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function MiniAppMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "mini_app" }>; lang: Lang; exampleLabel: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-950/80 p-2 shadow-inner">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <div className="mx-auto max-w-[280px] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 overflow-hidden shadow-lg">
        <div className="h-7 bg-slate-100 dark:bg-slate-800 flex items-center justify-center gap-1">
          <span className="h-1.5 w-8 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>
        <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5">
          <p className="text-center text-sm font-semibold text-slate-900 dark:text-white">{fig.title[lang]}</p>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {fig.rows.map((row, i) => (
            <li key={i} className="px-3 py-2.5 flex items-center justify-between gap-2 text-[13px] text-slate-800 dark:text-slate-200">
              <span>{row.label[lang]}</span>
              {row.hint ? <span className="text-xs text-slate-400 shrink-0">{row.hint[lang]}</span> : <span className="text-slate-300">›</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DashboardNavMock({
  fig,
  lang,
  exampleLabel,
}: {
  fig: Extract<HelpUiFigure, { kind: "dashboard_nav" }>;
  lang: Lang;
  exampleLabel: string;
}) {
  const items = fig.items[lang];
  const active = fig.activeIndex ?? 0;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 p-3">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <div className="flex flex-wrap gap-1.5">
        {items.map((label, i) => (
          <span
            key={i}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              i === active
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DataCardMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "data_card" }>; lang: Lang; exampleLabel: string }) {
  const fields = fig.fields[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 p-4 shadow-sm">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">{fig.cardTitle[lang]}</p>
      <dl className="space-y-2 text-[13px]">
        {fields.map((f, i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400 shrink-0">{f.label}</dt>
            <dd className="text-slate-900 dark:text-slate-100 text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
      {fig.actionLabel ? (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
          <span className="inline-flex rounded-lg bg-violet-600/10 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-xs font-semibold px-3 py-1.5">
            {fig.actionLabel[lang]}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function InboxListMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "inbox_list" }>; lang: Lang; exampleLabel: string }) {
  const rows = fig.rows[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 overflow-hidden">
      {fig.caption ? (
        <div className="px-3 pt-3">
          <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} />
        </div>
      ) : null}
      <ul className="divide-y divide-slate-100 dark:divide-white/5">
        {rows.map((r, i) => (
          <li key={i} className="px-3 py-2.5 flex items-center gap-3 text-[13px]">
            <span className="rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold px-1.5 py-0.5 text-slate-600 dark:text-slate-300">
              {r.channel}
            </span>
            <span className="flex-1 truncate text-slate-800 dark:text-slate-100">{r.title}</span>
            {r.time ? <span className="text-xs text-slate-400 shrink-0">{r.time}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChannelBarsMock({
  fig,
  lang,
  exampleLabel,
}: {
  fig: Extract<HelpUiFigure, { kind: "channel_bars" }>;
  lang: Lang;
  exampleLabel: string;
}) {
  const ch = fig.channels[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-2">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      {ch.map((c, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-white/5 px-3 py-2 text-[13px]"
        >
          <span className={`h-2 w-2 rounded-full shrink-0 ${c.active ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} />
          <span className="text-slate-800 dark:text-slate-100">{c.name}</span>
        </div>
      ))}
    </div>
  );
}

function FormMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "form_mock" }>; lang: Lang; exampleLabel: string }) {
  const fields = fig.fields[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 p-4 shadow-sm max-w-sm">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <div className="space-y-3">
        {fields.map((f, i) => (
          <div key={i}>
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{f.label}</label>
            <div className="mt-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-[13px] text-slate-500 dark:text-slate-400">
              {f.placeholder}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-4 w-full rounded-lg bg-slate-900 dark:bg-violet-600 text-white text-sm font-semibold py-2.5"
        disabled
      >
        {fig.button[lang]}
      </button>
      {fig.oauthHint ? <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{fig.oauthHint[lang]}</p> : null}
    </div>
  );
}

function TicketStripMock({
  fig,
  lang,
  exampleLabel,
}: {
  fig: Extract<HelpUiFigure, { kind: "ticket_strip" }>;
  lang: Lang;
  exampleLabel: string;
}) {
  const actions = fig.actions[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/70 overflow-hidden shadow-sm">
      {fig.caption ? (
        <div className="px-3 pt-3">
          <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} />
        </div>
      ) : null}
      <div className="p-4">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{fig.subject[lang]}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{fig.status[lang]}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <span
              key={i}
              className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-xs font-medium px-2.5 py-1 text-slate-700 dark:text-slate-200"
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChecklistMock({ fig, lang, exampleLabel }: { fig: Extract<HelpUiFigure, { kind: "checklist" }>; lang: Lang; exampleLabel: string }) {
  const items = fig.items[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 p-4">
      {fig.caption ? <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} /> : null}
      <ol className="space-y-2 text-[13px] text-slate-700 dark:text-slate-200 list-none">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
              {i + 1}
            </span>
            <span className="pt-0.5 leading-snug">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SplitScreenMock({
  fig,
  lang,
  exampleLabel,
}: {
  fig: Extract<HelpUiFigure, { kind: "split_screen" }>;
  lang: Lang;
  exampleLabel: string;
}) {
  const L = fig.leftItems[lang];
  const R = fig.rightItems[lang];
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
      {fig.caption ? (
        <div className="px-3 pt-3 bg-slate-50 dark:bg-slate-900/40">
          <Caption exampleLabel={exampleLabel} text={fig.caption[lang]} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-white/10">
        <div className="p-4 bg-white dark:bg-slate-900/40">
          <p className="text-xs font-bold text-slate-900 dark:text-white mb-2">{fig.leftTitle[lang]}</p>
          <ul className="text-[13px] text-slate-600 dark:text-slate-300 space-y-1">
            {L.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-violet-500">→</span> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-slate-50/80 dark:bg-slate-950/40">
          <p className="text-xs font-bold text-slate-900 dark:text-white mb-2">{fig.rightTitle[lang]}</p>
          <ul className="text-[13px] text-slate-600 dark:text-slate-300 space-y-1">
            {R.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-violet-500">→</span> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function HelpArticleFigures({
  figures,
  lang,
  exampleLabel,
}: {
  figures: HelpUiFigure[];
  lang: Lang;
  exampleLabel: string;
}) {
  if (figures.length === 0) return null;
  return (
    <div className="mt-5 space-y-5 border-t border-slate-100 dark:border-white/10 pt-5">
      {figures.map((fig, i) => {
        const key = `${fig.kind}-${i}`;
        switch (fig.kind) {
          case "telegram_chat":
            return <TelegramMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "mini_app":
            return <MiniAppMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "dashboard_nav":
            return <DashboardNavMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "data_card":
            return <DataCardMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "inbox_list":
            return <InboxListMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "channel_bars":
            return <ChannelBarsMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "form_mock":
            return <FormMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "ticket_strip":
            return <TicketStripMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "checklist":
            return <ChecklistMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          case "split_screen":
            return <SplitScreenMock key={key} fig={fig} lang={lang} exampleLabel={exampleLabel} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
