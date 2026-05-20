"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";

/**
 * SEO audit 2026-05-20 — /about editor (system_admin only).
 *
 * The /about public page reads from `platform_config[about]`. This form
 * lets a system_admin edit every field without a code deploy. The
 * underlying schema validates lengths so a typo can't break the page
 * (each field has a max length per the Zod schema in platformConfig.ts).
 *
 * Layout intentionally simple — no design polish, no save-on-blur, no
 * autosave. The user explicitly wanted this as an editing surface, not
 * a content-management system. One Save button at the bottom; success
 * toast on completion.
 */
export default function AboutEditorClient() {
  const utils = api.useUtils();
  const current = api.platformConfig.getAbout.useQuery();
  const [form, setForm] = useState<Record<string, string>>({});
  const [year, setYear] = useState<number>(2025);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!current.data) return;
    const d = current.data;
    setForm({
      founderName: d.founderName,
      jurisdiction: d.jurisdiction,
      supportEmail: d.supportEmail,
      telegramHandle: d.telegramHandle,
      taglinePl: d.taglinePl,
      taglineRu: d.taglineRu,
      taglineUa: d.taglineUa,
      taglineEn: d.taglineEn,
      missionPl: d.missionPl,
      missionRu: d.missionRu,
      missionUa: d.missionUa,
      missionEn: d.missionEn,
    });
    setYear(d.foundedYear);
  }, [current.data]);

  const save = api.platformConfig.setAbout.useMutation({
    onSuccess: async () => {
      await utils.platformConfig.getAbout.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (current.isLoading) {
    return <div className="p-6 text-slate-500">Загрузка...</div>;
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      founderName: form.founderName ?? "",
      foundedYear: year,
      jurisdiction: form.jurisdiction ?? "",
      supportEmail: form.supportEmail ?? "",
      telegramHandle: form.telegramHandle ?? "",
      taglinePl: form.taglinePl ?? "",
      taglineRu: form.taglineRu ?? "",
      taglineUa: form.taglineUa ?? "",
      taglineEn: form.taglineEn ?? "",
      missionPl: form.missionPl ?? "",
      missionRu: form.missionRu ?? "",
      missionUa: form.missionUa ?? "",
      missionEn: form.missionEn ?? "",
    });
  }

  const Field = ({ id, label, value, rows = 1 }: { id: string; label: string; value: string; rows?: number }) => (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{label}</span>
      {rows === 1 ? (
        <input
          type="text"
          value={value}
          onChange={(e) => setField(id, e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      ) : (
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => setField(id, e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      )}
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="mb-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          /about — редактор
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Эти данные показываются на странице <a href="/about" className="text-violet-600 hover:underline">/about</a> и в Organization JSON-LD. Только система-админ может редактировать. Изменения вступают в силу сразу после сохранения.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Основное</h2>
        <Field id="founderName" label="Founder name" value={form.founderName ?? ""} />
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Founded year</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2000}
            max={2100}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
        <Field id="jurisdiction" label="Jurisdiction" value={form.jurisdiction ?? ""} />
        <Field id="supportEmail" label="Support email" value={form.supportEmail ?? ""} />
        <Field id="telegramHandle" label="Telegram handle (no @)" value={form.telegramHandle ?? ""} />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Tagline (главный абзац под H1)</h2>
        <Field id="taglinePl" label="Polski" value={form.taglinePl ?? ""} rows={3} />
        <Field id="taglineRu" label="Русский" value={form.taglineRu ?? ""} rows={3} />
        <Field id="taglineUa" label="Українська" value={form.taglineUa ?? ""} rows={3} />
        <Field id="taglineEn" label="English" value={form.taglineEn ?? ""} rows={3} />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Mission</h2>
        <Field id="missionPl" label="Polski" value={form.missionPl ?? ""} rows={3} />
        <Field id="missionRu" label="Русский" value={form.missionRu ?? ""} rows={3} />
        <Field id="missionUa" label="Українська" value={form.missionUa ?? ""} rows={3} />
        <Field id="missionEn" label="English" value={form.missionEn ?? ""} rows={3} />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="inline-flex h-11 items-center rounded-lg bg-violet-600 px-5 font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {save.isPending ? "Сохраняем..." : "Сохранить"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Сохранено</span>}
        {save.error && <span className="text-sm text-red-600">{save.error.message}</span>}
      </div>
    </form>
  );
}
