import { useLanguage } from "@/i18n";

function sym(v: boolean | null | undefined): string {
  if (v === true) return "✓";
  if (v === false) return "✗";
  return "±";
}

function cellCls(v: boolean | null | undefined): string {
  if (v === true) return "text-emerald-500";
  if (v === false) return "text-slate-300/40 dark:text-white/15";
  return "text-amber-500";
}

export function CompareSection() {
  const { t } = useLanguage();
  const cp = t.compare;

  return (
    <section className="px-4 pb-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">
            {cp.title}
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-600 dark:text-white/45">
            {cp.subtitle}
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200/90 dark:border-white/[0.07]">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200/90 bg-slate-50/80 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <th className="w-[44%] px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/30" />
                <th className="px-4 py-3.5 text-center text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  ManicBot
                </th>
                <th className="px-4 py-3.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/30">
                  {cp.col2}
                </th>
                <th className="px-4 py-3.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/30">
                  {cp.col3}
                </th>
              </tr>
            </thead>
            <tbody>
              {cp.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-200/60 transition-colors last:border-b-0 hover:bg-slate-50/50 dark:border-white/[0.04] dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-3 text-sm text-slate-600 dark:text-white/50">
                    {row.label}
                  </td>
                  <td className={`px-4 py-3 text-center text-base font-bold ${cellCls(row.mb)} bg-violet-500/[0.03] dark:bg-violet-500/[0.04]`}>
                    {sym(row.mb)}
                  </td>
                  <td className={`px-4 py-3 text-center text-base font-bold ${cellCls(row.c2)}`}>
                    {sym(row.c2)}
                  </td>
                  <td className={`px-4 py-3 text-center text-base font-bold ${cellCls(row.c3)}`}>
                    {sym(row.c3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
