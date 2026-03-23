import { useState } from "react";
import { useLanguage } from "@/i18n";

export function FaqSection() {
  const { t } = useLanguage();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-2xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">{t.faq.title}</h2>
        </div>

        <div className="space-y-2">
          {t.faq.items.map((item, i) => (
            <div
              key={i}
              className={[
                "overflow-hidden rounded-2xl border transition-all duration-200",
                open === i
                  ? "border-violet-300/90 bg-violet-50/90 dark:border-violet-500/35 dark:bg-violet-500/[0.12]"
                  : "border-slate-200/90 bg-white dark:border-white/[0.07] dark:bg-white/[0.03]",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-sm font-medium text-slate-900 dark:text-white">{item.q}</span>
                <span
                  className="flex-shrink-0 text-lg leading-none text-slate-400 transition-transform duration-200 dark:text-white/30"
                  style={{ transform: open === i ? "rotate(45deg)" : "rotate(0)" }}
                >
                  +
                </span>
              </button>
              {open === i && (
                <div className="px-5 pb-4">
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-white/50">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
