import { useLanguage } from "@/i18n";
import { TelegramPhoneDemo } from "./TelegramPhoneDemo";
import { SearchAutocomplete } from "./SearchAutocomplete";

export function HeroSection() {
  const { t } = useLanguage();

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative overflow-visible px-4 pb-16 pt-28 sm:pb-24">
      <div
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(124,58,237,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(124,58,237,0.06)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_90%_70%_at_50%_40%,black_28%,transparent_100%)] dark:[background-image:linear-gradient(rgba(124,58,237,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(124,58,237,0.05)_1px,transparent_1px)] dark:[background-size:60px_60px]"
        style={{
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 28%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 28%, transparent 100%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-4xl lg:mb-12">
          <SearchAutocomplete className="mx-auto max-w-4xl" />
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(260px,320px)] lg:gap-16">
          <div className="order-2 text-center lg:order-1 lg:text-left">
            <div className="mb-5 inline-flex lg:flex">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200/90 bg-violet-50 px-3.5 py-1.5 text-xs font-medium text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
                {t.hero.badge}
              </span>
            </div>

            <h1 className="mb-4 text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem] dark:text-white">
              {t.hero.headline}{" "}
              <span
                className="mt-1 block sm:mt-0 sm:inline lg:block"
                style={{
                  background: "linear-gradient(135deg,#a78bfa 0%,#67e8f9 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t.hero.headlineAccent}
              </span>
            </h1>

            <p className="mx-auto mb-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg lg:mx-0 dark:text-white/50">
              {t.hero.sub}
            </p>

            <div className="mb-5 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <button
                type="button"
                onClick={() => scrollTo("how")}
                className="w-full rounded-2xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all duration-200 hover:scale-[1.02] hover:opacity-95 sm:w-auto dark:shadow-[0_12px_40px_rgba(109,40,217,0.35)]"
                style={{
                  background: "linear-gradient(135deg,#6d28d9,#0891b2)",
                }}
              >
                {t.hero.ctaPrimary}
              </button>
              <button
                type="button"
                onClick={() => scrollTo("pricing")}
                className="w-full rounded-2xl border border-slate-200/90 bg-white px-7 py-3.5 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 sm:w-auto dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75 dark:hover:bg-white/[0.07]"
              >
                {t.hero.ctaSecondary}
              </button>
            </div>

            <div className="mb-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {t.hero.channelBadges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/55"
                >
                  {badge}
                </span>
              ))}
            </div>

            <p className="mb-6 max-w-md text-center text-xs leading-relaxed text-slate-500 dark:text-white/40 lg:mb-6 lg:max-w-none lg:text-left">
              {t.hero.trustLine}
            </p>

            <div className="mx-auto grid w-full max-w-[20rem] grid-cols-2 gap-2 sm:max-w-none sm:grid-cols-4 lg:mx-0">
              {t.stats.map((s, i) => (
                <div
                  key={i}
                  className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03]"
                >
                  <span
                    className="font-mono text-lg font-bold leading-tight"
                    style={{
                      background: "linear-gradient(135deg,#a78bfa,#5eead4)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {s.value}
                  </span>
                  <span className="mt-1 block text-[10px] font-medium leading-snug text-slate-500 dark:text-white/40">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            id="demo"
            className="order-1 flex justify-center pt-2 lg:order-2 lg:justify-end"
          >
            <div className="relative w-full max-w-[300px]">
              <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400 lg:text-right dark:text-white/35">
                {t.hero.demoCaption}
              </p>
              <TelegramPhoneDemo />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
