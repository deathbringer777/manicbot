import { useLanguage } from "@/i18n";

export function Footer() {
  const { t } = useLanguage();

  return (
    <footer
      className="px-4 py-10"
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          >
            M
          </div>
          <span className="text-xs text-white/35">{t.footer.tagline}</span>
        </div>

        <div className="flex items-center gap-5">
          {t.footer.links.map((link) => (
            <a
              key={link}
              href="#"
              className="text-xs text-white/30 hover:text-white/60 transition-colors duration-150"
            >
              {link}
            </a>
          ))}
        </div>

        <p className="text-xs text-white/20">{t.footer.copy}</p>
      </div>
    </footer>
  );
}
