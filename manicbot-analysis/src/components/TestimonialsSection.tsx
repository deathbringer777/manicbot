import { useLanguage } from "@/i18n";

export function TestimonialsSection() {
  const { t } = useLanguage();

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">{t.testimonials.title}</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {t.testimonials.items.map((item, i) => (
            <div
              key={i}
              className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-white/[0.07] dark:bg-white/[0.03] dark:hover:shadow-black/30"
            >
              <p className="mb-6 text-sm italic leading-relaxed text-slate-600 dark:text-white/55">
                &ldquo;{item.text}&rdquo;
              </p>

              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-md"
                  style={{
                    background: [
                      "linear-gradient(135deg,#7c3aed,#a855f7)",
                      "linear-gradient(135deg,#06b6d4,#3b82f6)",
                      "linear-gradient(135deg,#10b981,#06b6d4)",
                    ][i % 3],
                  }}
                >
                  {item.author[0]}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">{item.author}</p>
                  <p className="text-[11px] text-slate-500 dark:text-white/35">{item.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
