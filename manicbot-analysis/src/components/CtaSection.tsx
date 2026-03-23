import { useLanguage } from "@/i18n";
import { MANICBOT_TELEGRAM_URL } from "@/constants";

export function CtaSection() {
  const { t } = useLanguage();

  return (
    <section className="px-4 py-20">
      <div className="relative mx-auto max-w-3xl text-center">
        <div
          className="relative overflow-hidden rounded-3xl border border-violet-200/80 bg-gradient-to-br from-violet-50/90 to-cyan-50/50 p-10 shadow-[0_20px_60px_-24px_rgba(124,58,237,0.2)] sm:p-16 dark:border-violet-500/25 dark:from-violet-500/[0.12] dark:to-cyan-500/[0.08] dark:shadow-[0_24px_64px_-24px_rgba(124,58,237,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 dark:opacity-90"
            style={{
              background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124,58,237,0.12) 0%, transparent 70%)",
            }}
          />

          <h2 className="relative mb-4 text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">
            {t.cta.title}
          </h2>
          <p className="relative mx-auto mb-8 max-w-md text-sm leading-relaxed text-slate-600 dark:text-white/50">
            {t.cta.sub}
          </p>
          <a
            href={MANICBOT_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="relative inline-flex items-center justify-center rounded-2xl px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-violet-500/35 transition-all duration-200 hover:scale-[1.02] hover:opacity-95 dark:shadow-[0_12px_40px_-8px_rgba(124,58,237,0.45)]"
            style={{
              background: "linear-gradient(135deg,#7c3aed,#06b6d4)",
            }}
          >
            {t.cta.button}
          </a>
        </div>
      </div>
    </section>
  );
}
