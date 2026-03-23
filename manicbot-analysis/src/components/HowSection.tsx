import { useLanguage } from "@/i18n";

export function HowSection() {
  const { t } = useLanguage();

  return (
    <section id="how" className="px-4 py-20">
      <div className="mx-auto max-w-4xl">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">{t.how.title}</h2>
        </div>

        <div className="relative">
          <div
            className="absolute bottom-10 left-[39px] top-10 hidden w-px sm:block dark:opacity-80"
            style={{ background: "linear-gradient(to bottom, rgba(124,58,237,0.25), rgba(6,182,212,0.25), transparent)" }}
          />

          <div className="space-y-6">
            {t.how.steps.map((step, i) => (
              <div key={step.num} className="group flex gap-6">
                <div className="relative flex-shrink-0">
                  <div
                    className={[
                      "flex h-20 w-20 items-center justify-center rounded-2xl font-mono text-2xl font-bold transition-all duration-300 group-hover:scale-105",
                      i === 0 && "text-violet-700 dark:text-violet-300",
                      i === 1 && "text-cyan-700 dark:text-cyan-300",
                      i === 2 && "text-emerald-700 dark:text-emerald-300",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      background:
                        i === 0
                          ? "linear-gradient(135deg,rgba(124,58,237,0.12),rgba(168,85,247,0.1))"
                          : i === 1
                            ? "linear-gradient(135deg,rgba(6,182,212,0.12),rgba(59,130,246,0.1))"
                            : "linear-gradient(135deg,rgba(16,185,129,0.12),rgba(6,182,212,0.1))",
                      border: `1px solid ${i === 0 ? "rgba(124,58,237,0.25)" : i === 1 ? "rgba(6,182,212,0.25)" : "rgba(16,185,129,0.25)"}`,
                    }}
                  >
                    {step.num}
                  </div>
                </div>

                <div className="flex-1 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md dark:border-white/[0.07] dark:bg-white/[0.03] dark:group-hover:shadow-black/20">
                  <h3 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-white/45">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
