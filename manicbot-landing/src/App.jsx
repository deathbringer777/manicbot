import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChatMockup from './ChatMockup';
import Carousel from './Carousel';
import './App.css';

function useReveal(alwaysVisible = false) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(alwaysVisible);

  useEffect(() => {
    if (alwaysVisible) return;
    const el = ref.current;
    if (!el) return;
    // Threshold 0.01 + no negative margin — fixes iOS Safari not firing for first element
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.01 }
    );
    obs.observe(el);
    // Fallback: if already in viewport (iOS bug), fire immediately
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) setVisible(true);
    return () => obs.disconnect();
  }, [alwaysVisible]);

  return [ref, visible];
}

const LANGS = ['ru', 'en', 'pl', 'uk'];
const LANGUAGE_LABELS = { ru: 'Русский', en: 'English', pl: 'Polski', uk: 'Українська' };

function LangSwitcher() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const resolved = i18n.resolvedLanguage || i18n.language;
  const currentLang = LANGS.includes(resolved) ? resolved : (resolved === 'ua' ? 'uk' : 'en');

  const changeLanguage = (lng) => { i18n.changeLanguage(lng); setOpen(false); };

  return (
    <div className="lang-wrap">
      <button type="button" className="lang-btn" onClick={() => setOpen((p) => !p)} aria-label="Select language" aria-expanded={open}>
        {LANGUAGE_LABELS[currentLang]}
        <span className="lang-chevron">▼</span>
      </button>
      {open && (
        <div className="lang-dropdown" role="menu">
          {LANGS.map((lng) => (
            <button key={lng} type="button" className={lng === currentLang ? 'active' : ''} onClick={() => changeLanguage(lng)}>
              {LANGUAGE_LABELS[lng]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Nav({ onNavClick, mobileOpen, setMobileOpen }) {
  const { t } = useTranslation();

  const links = [
    { id: 'about', label: t('nav.about') },
    { id: 'features', label: t('nav.features') },
    { id: 'how-it-works', label: t('nav.howItWorks') },
    { id: 'ai', label: t('nav.ai') },
    { id: 'pricing', label: t('nav.pricing') },
    { id: 'contacts', label: t('nav.contacts') },
  ];

  const handleClick = (e, id) => { e.preventDefault(); onNavClick(id); setMobileOpen(false); };

  return (
    <nav className={`nav ${mobileOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
      <button
        type="button"
        className="nav-toggle"
        onClick={() => setMobileOpen((p) => !p)}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? (
          <span className="nav-toggle-x">✕</span>
        ) : (
          <>
            <span />
            <span />
            <span />
          </>
        )}
      </button>

      <ul className="nav-list">
        {links.map(({ id, label }) => (
          <li key={id}>
            <a href={`#${id}`} onClick={(e) => handleClick(e, id)}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PlanCard({ planKey, featured }) {
  const { t } = useTranslation();
  const badge = t(`pricing.plans.${planKey}.badge`);

  return (
    <div className={`plan-card ${featured ? 'plan-featured' : ''}`}>
      {badge && <span className="plan-badge">{badge}</span>}
      <h3 className="plan-name">{t(`pricing.plans.${planKey}.name`)}</h3>
      <p className="plan-desc">{t(`pricing.plans.${planKey}.desc`)}</p>
      <div className="plan-price">
        <span className="plan-price-amount">{t(`pricing.plans.${planKey}.price`)}</span>
        <span className="plan-price-period">{t('pricing.period')}</span>
      </div>
      <ul className="plan-features">
        {['f1', 'f2', 'f3', 'f4'].map((f) => (
          <li key={f}>
            <span className="plan-check">✓</span>
            {t(`pricing.plans.${planKey}.${f}`)}
          </li>
        ))}
      </ul>
      <a href="https://t.me/manic_preview_bot" target="_blank" rel="noopener noreferrer" className={`plan-cta ${featured ? 'plan-cta-featured' : ''}`}>
        {t('pricing.cta')}
      </a>
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const lng = i18n.resolvedLanguage || i18n.language;
    if (lng && typeof document !== 'undefined') {
      document.documentElement.lang = lng === 'ua' ? 'uk' : lng;
    }
  }, [i18n.resolvedLanguage, i18n.language]);

  const [heroRef, heroVisible] = useReveal(true); // always show hero immediately
  const [statsRef, statsVisible] = useReveal();
  const [aboutRef, aboutVisible] = useReveal();
  const [featRef, featVisible] = useReveal();
  const [howRef, howVisible] = useReveal();
  const [carouselRef, carouselVisible] = useReveal();
  const [aiRef, aiVisible] = useReveal();
  const [pricingRef, pricingVisible] = useReveal();
  const [contactsRef, contactsVisible] = useReveal();
  const [ctaRef, ctaVisible] = useReveal();

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const chatMessages = [
    { from: 'bot', text: t('chat.hello') },
    { from: 'user', text: t('chat.userService') },
    { from: 'bot', text: t('chat.botDay') },
    { from: 'user', text: t('chat.userDay') },
    { from: 'bot', text: t('chat.slots') },
    { from: 'user', text: t('chat.userTime') },
    { from: 'bot', text: t('chat.success') },
  ];

  const carouselItems = [
    { icon: '📅', text: t('carousel.booking') },
    { icon: '🔔', text: t('carousel.reminders') },
    { icon: '💬', text: t('carousel.answers') },
    { icon: '🤖', text: t('carousel.aiTone') },
    { icon: '🏪', text: t('carousel.soloAndSalon') },
  ];

  const howSteps = [
    { icon: '💬', key: 's1' },
    { icon: '📅', key: 's2' },
    { icon: '✅', key: 's3' },
  ];

  return (
    <div className="app">
      <div className="bg-mesh" aria-hidden="true" />

      <header className="header">
        <div className="header-inner">
          <a href="#" className="logo" onClick={(e) => { e.preventDefault(); scrollTo('hero'); }}>
            <span className="logo-icon">💅</span>
            <span className="logo-text">ManicBot</span>
          </a>
          <Nav onNavClick={scrollTo} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
          <LangSwitcher />
        </div>
      </header>

      {mobileOpen && (
        <div className="nav-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <main>
        {/* Hero */}
        <section className="hero hero-compact" id="hero" ref={heroRef}>
          <div className="hero-grid">
            <div className="hero-content">
              <p className={`hero-tag reveal delay-1 ${heroVisible ? 'visible' : ''}`}>{t('hero.tagline')}</p>
              <h1 className={`hero-title reveal delay-2 ${heroVisible ? 'visible' : ''}`}>{t('hero.title')}</h1>
              <p className={`hero-sub reveal delay-3 ${heroVisible ? 'visible' : ''}`}>{t('hero.subtitle')}</p>
              <a href="https://t.me/manic_preview_bot" target="_blank" rel="noopener noreferrer" className={`hero-cta reveal delay-4 ${heroVisible ? 'visible' : ''}`}>
                {t('hero.cta')}
              </a>
            </div>
            <div className={`hero-mockup reveal delay-2 ${heroVisible ? 'visible' : ''}`}>
              <ChatMockup messages={chatMessages} />
            </div>
          </div>
          <div className="hero-glow" />
        </section>

        {/* Stats bar */}
        <section className="stats-bar" ref={statsRef}>
          <div className="stats-inner">
            {['s1', 's2', 's3'].map((k, i) => (
              <div key={k} className={`stat-item reveal delay-${i + 1} ${statsVisible ? 'visible' : ''}`}>
                <span className="stat-value">{t(`stats.${k}.value`)}</span>
                <span className="stat-label">{t(`stats.${k}.label`)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* About */}
        <section className="about" id="about" ref={aboutRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${aboutVisible ? 'visible' : ''}`}>{t('about.title')}</h2>
            <div className={`about-grid reveal delay-1 ${aboutVisible ? 'visible' : ''}`}>
              <p>{t('about.p1')}</p>
              <p>{t('about.p2')}</p>
              <p>{t('about.p3')}</p>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features" id="features" ref={featRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${featVisible ? 'visible' : ''}`}>{t('features.title')}</h2>
            <div className={`feat-grid reveal delay-1 ${featVisible ? 'visible' : ''}`}>
              {['booking', 'reminders', 'answers', 'flexible', 'multilang', 'team'].map((key, i) => (
                <div key={key} className="feat-card">
                  <span className="feat-icon">{['📅', '🔔', '💬', '🏪', '🌐', '👥'][i]}</span>
                  <h3>{t(`features.items.${key}.title`)}</h3>
                  <p>{t(`features.items.${key}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="how-section" id="how-it-works" ref={howRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${howVisible ? 'visible' : ''}`}>{t('howItWorks.title')}</h2>
            <p className={`section-sub reveal delay-1 ${howVisible ? 'visible' : ''}`}>{t('howItWorks.subtitle')}</p>
            <div className="how-steps">
              {howSteps.map(({ icon, key }, i) => (
                <div key={key} className={`how-step reveal delay-${i + 2} ${howVisible ? 'visible' : ''}`}>
                  <div className="how-step-icon">{icon}</div>
                  <div className="how-step-num">{t(`howItWorks.steps.${key}.num`)}</div>
                  <h3 className="how-step-title">{t(`howItWorks.steps.${key}.title`)}</h3>
                  <p className="how-step-desc">{t(`howItWorks.steps.${key}.desc`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Carousel */}
        <section className="carousel-section" id="carousel" ref={carouselRef}>
          <div className="section-inner">
            <div className={`reveal ${carouselVisible ? 'visible' : ''}`}>
              <Carousel items={carouselItems} />
            </div>
          </div>
        </section>

        {/* AI */}
        <section className="ai-section" id="ai" ref={aiRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${aiVisible ? 'visible' : ''}`}>{t('ai.title')}</h2>
            <p className={`section-sub reveal delay-1 ${aiVisible ? 'visible' : ''}`}>{t('ai.subtitle')}</p>
            <div className={`ai-grid reveal delay-2 ${aiVisible ? 'visible' : ''}`}>
              <p>{t('ai.points.understands')}</p>
              <p>{t('ai.points.guides')}</p>
              <p>{t('ai.points.savesTime')}</p>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="pricing-section" id="pricing" ref={pricingRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${pricingVisible ? 'visible' : ''}`}>{t('pricing.title')}</h2>
            <p className={`section-sub reveal delay-1 ${pricingVisible ? 'visible' : ''}`}>{t('pricing.subtitle')}</p>
            <div className={`pricing-cards reveal delay-2 ${pricingVisible ? 'visible' : ''}`}>
              <PlanCard planKey="start" featured={false} />
              <PlanCard planKey="pro" featured={true} />
              <PlanCard planKey="studio" featured={false} />
            </div>
          </div>
        </section>

        {/* Contacts */}
        <section className="contacts-section" id="contacts" ref={contactsRef}>
          <div className="section-inner">
            <h2 className={`section-title reveal ${contactsVisible ? 'visible' : ''}`}>{t('contacts.title')}</h2>
            <p className={`section-sub reveal delay-1 ${contactsVisible ? 'visible' : ''}`}>{t('contacts.subtitle')}</p>
            <div className={`contacts-grid reveal delay-2 ${contactsVisible ? 'visible' : ''}`}>
              <a href="https://t.me/manic_preview_bot" target="_blank" rel="noopener noreferrer" className="contact-card">
                <span className="contact-icon">✈️</span>
                <span>{t('contacts.telegram')}</span>
              </a>
              <a href="mailto:hello@manicbot.com" className="contact-card">
                <span className="contact-icon">✉️</span>
                <span>{t('contacts.email')}</span>
              </a>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta" ref={ctaRef}>
          <div className="cta-inner">
            <h2 className={`cta-title reveal ${ctaVisible ? 'visible' : ''}`}>{t('cta.title')}</h2>
            <p className={`cta-sub reveal delay-1 ${ctaVisible ? 'visible' : ''}`}>{t('cta.subtitle')}</p>
            <a href="https://t.me/manic_preview_bot" target="_blank" rel="noopener noreferrer" className={`cta-btn reveal delay-2 ${ctaVisible ? 'visible' : ''}`}>
              {t('cta.button')}
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p className="footer-copy">{t('footer.copy')} · {t('footer.tagline')}</p>
          <div className="footer-links">
            <a href="https://t.me/manic_preview_bot" target="_blank" rel="noopener noreferrer">{t('footer.links.telegram')}</a>
            <a href="mailto:hello@manicbot.com">{t('footer.links.email')}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
