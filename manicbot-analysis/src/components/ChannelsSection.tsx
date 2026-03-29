import { useLanguage } from "@/i18n";

export function ChannelsSection() {
  const { t } = useLanguage();
  const ch = t.channels;

  return (
    <section id="channels" className="px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">
            {ch.title}
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-600 dark:text-white/45">
            {ch.subtitle}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {ch.items.map((item) => (
            <div
              key={item.name}
              className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-white/[0.07] dark:bg-white/[0.03]"
            >
              {/* Top accent stripe */}
              <div
                className="absolute inset-x-0 top-0 h-0.5"
                style={{
                  background: item.name === "Telegram"
                    ? "linear-gradient(90deg,#2AABEE,#229ED9)"
                    : item.name === "Instagram"
                    ? "linear-gradient(90deg,#833AB4,#E1306C,#FD1D1D)"
                    : "linear-gradient(90deg,#25D366,#128C7E)",
                  opacity: item.live ? 1 : 0.4,
                }}
              />

              <div className="mb-4 flex items-center justify-between">
                <span className="text-3xl">{item.icon}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    item.live
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : "border-slate-300/30 bg-slate-100/50 text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-white/30"
                  }`}
                >
                  {item.live ? ch.live : ch.soon}
                </span>
              </div>

              <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">
                {item.name}
              </h3>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-white/45">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
