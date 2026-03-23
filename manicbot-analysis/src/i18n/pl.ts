import type { Translations } from "./en";

export const pl: Translations = {
  flag: "🇵🇱",
  name: "PL",
  fullName: "Polski",

  nav: {
    features: "Możliwości",
    howItWorks: "Jak to działa",
    pricing: "Cennik",
    cta: "Wypróbuj ManicBot",
  },

  hero: {
    badge: "Twój salon w Telegramie",
    headline: "Rezerwacje bez zbędnego stresu",
    headlineAccent: "dla Ciebie i gości",
    sub: "Gość nie musi instalować nic nowego — pisze jak na czacie, a Ty dostajesz jasne potwierdzenie, godzinę i cenę w jednej wiadomości.",
    ctaPrimary: "Jak to działa",
    ctaSecondary: "Zobacz cennik",
    trustLine: "Dla salonów i prywatnych mistrzów",
    demoCaption: "Tak to wygląda w Telegramie",
  },

  stats: [
    { value: "4", label: "Języki" },
    { value: "24/7", label: "Zawsze online" },
    { value: "0", label: "Zbędnych aplikacji" },
    { value: "1", label: "Link dla gości" },
  ],

  phoneDemo: {
    time: "22:41",
    botLabel: "bot",
    welcomeLead: "💅 Witaj w Preview Salon!",
    welcomeHi: "Cześć, Anno! 👋",
    welcomeBody: "Pomogę Ci zapisać się na manicure szybko i wygodnie.",
    featuresIntro: "🌸 Co potrafię:",
    features: [
      "Rezerwacja online o każdej porze",
      "Katalog prac ze zdjęciami",
      "Przypomnienia przed wizytą",
      "Plik do Google / Apple Calendar",
    ],
    choosePrompt: "Wybierz, co Cię interesuje:",
    menuBook: "📝 Zapisz się",
    menuCatalog: "📸 Katalog prac",
    menuPrice: "💰 Cennik",
    menuMy: "📋 Moje rezerwacje",
    userMessage: "zapisz mnie jutro na klasyczny manicure o 15",
    confirmTitle: "📋 Potwierdzenie rezerwacji",
    confirmService: "💅 Manicure klasyczny",
    confirmWhen: "📅 24 mar (wt) 15:00",
    confirmDuration: "⏱️ 60 min",
    confirmPrice: "💵 80 zł",
    confirmClient: "👤 Anna",
    btnOk: "✅ Potwierdź",
    btnNo: "❌ Anuluj",
    inputPlaceholder: "Wiadomość…",
  },

  features: {
    title: "Wygodnie na co dzień",
    sub: "Czytelne przyciski, spokojne przypomnienia — ten sam format, który wszyscy znają z czatu.",
    items: [
      {
        icon: "calendar",
        title: "Inteligentne rezerwacje",
        desc: "Klienci wybierają usługę, mistrza i godzinę bezpośrednio w Telegram. Bez pobierania aplikacji.",
      },
      {
        icon: "brain",
        title: "Pomocnik w tle",
        desc: "Odpowiada na typowe pytania i delikatnie prowadzi do dogodnej godziny — Ty decydujesz.",
      },
      {
        icon: "layout-panel",
        title: "Panel pod właściciela",
        desc: "Usługi, ceny i grafik w jednym miejscu — mniej chaosu w czatach i arkuszach.",
      },
      {
        icon: "globe",
        title: "4 języki",
        desc: "Angielski, rosyjski, ukraiński, polski — bot automatycznie mówi językiem klienta.",
      },
      {
        icon: "calendar-sync",
        title: "Synchronizacja z Google Calendar",
        desc: "Wszystkie rezerwacje synchronizują się z Google Calendar w czasie rzeczywistym.",
      },
      {
        icon: "bell",
        title: "Przypomnienia i powiadomienia",
        desc: "Automatyczne przypomnienia przed wizytą. Klienci potwierdzają lub anulują jednym kliknięciem.",
      },
      {
        icon: "users",
        title: "Multi-mistrz",
        desc: "Zarządzaj kilkoma mistrzami lub oddziałami w jednym bocie. Osobne grafiki dla każdego.",
      },
      {
        icon: "shield",
        title: "Prywatność",
        desc: "Dane salonów są oddzielone. Jest ochrona przed spamem i nadużyciami.",
      },
    ],
  },

  how: {
    title: "Trzy spokojne kroki",
    steps: [
      {
        num: "01",
        title: "Podłącz bota",
        desc: "Połącz token swojego bota Telegram z ManicBot. Zajmuje 2 minuty.",
      },
      {
        num: "02",
        title: "Dodaj usługi i mistrzów",
        desc: "Skonfiguruj usługi, ceny i godziny pracy. Resztą zajmiemy się my.",
      },
      {
        num: "03",
        title: "Udostępnij link",
        desc: "Wyślij link Telegram klientom. Rezerwacje zaczną napływać od razu.",
      },
    ],
  },

  pricing: {
    title: "Cennik",
    sub: "Proste i przejrzyste plany dla każdej skali",
    popularBadge: "Popularny",
    plans: [
      {
        name: "Start",
        price: "45 zł",
        period: "/mies",
        desc: "Dla manikiurzystki solo",
        features: [
          "1 mistrz",
          "Rezerwacja i harmonogram",
          "Przypomnienia dla klientów",
          "4 języki interfejsu",
        ],
        cta: "Zaczynamy",
        highlighted: false,
      },
      {
        name: "Pro",
        price: "60 zł",
        period: "/mies",
        desc: "Dla salonu z zespołem",
        features: [
          "Do 5 mistrzów",
          "Asystent AI",
          "Agenci wsparcia",
          "Priorytetowe wsparcie",
        ],
        cta: "Zaczynamy",
        highlighted: true,
      },
      {
        name: "MAX",
        price: "90 zł",
        period: "/mies",
        desc: "Dla sieci salonów lub dużego zespołu",
        features: [
          "Nieograniczeni mistrzowie",
          "Wygląd bota pod Twój salon",
          "Personalizacja",
          "Dedykowane wsparcie",
        ],
        cta: "Zaczynamy",
        highlighted: false,
      },
    ],
  },

  testimonials: {
    title: "Od osób, które już próbują",
    items: [
      {
        text: "Przeszliśmy z 20 telefonów dziennie do zera. Klienci rezerwują sami o północy, my po prostu przychodzimy do pracy.",
        author: "Anna K.",
        role: "Właścicielka studia paznokci, Warszawa",
      },
      {
        text: "AI obsługuje wszystkie pytania 'a ile to kosztuje'. W końcu mogę skupić się na pracy.",
        author: "Maria S.",
        role: "Mistrzyni urody, Wrocław",
      },
      {
        text: "Skonfigurowałam w jeden wieczór. Następnego ranka miałam 8 nowych rezerwacji od klientów, którzy nigdy wcześniej do nas nie dzwonili.",
        author: "Daria L.",
        role: "Menedżer salonu, Poznań",
      },
    ],
  },

  faq: {
    title: "Częste pytania",
    items: [
      {
        q: "Czy klienci muszą coś instalować?",
        a: "Nie. Potrzebują tylko Telegram, który już mają. Jedno kliknięcie w link — gotowe.",
      },
      {
        q: "Mam już system rezerwacji. Co zrobić?",
        a: "ManicBot działa równolegle z Twoimi narzędziami. Synchronizacja z Google Calendar łączy wszystko w jednym miejscu.",
      },
      {
        q: "Czy mogę dostosować osobowość bota?",
        a: "Tak. W planie MAX możesz ustawić nazwę, styl komunikacji, a nawet zdjęcie profilowe dla AI.",
      },
      {
        q: "Czy przetwarzanie płatności jest bezpieczne?",
        a: "Absolutnie. Używamy Stripe z pełną weryfikacją HMAC i ochroną idempotentności.",
      },
    ],
  },

  cta: {
    title: "Chcesz sam przejść ten scenariusz?",
    sub: "Zacznij za darmo, zaproś kilku gości i zobacz, czy Ci pasuje.",
    button: "Zacznij za darmo — bez karty",
  },

  seo: {
    title: "ManicBot — rezerwacje w Telegramie dla salonów i stylistek | AI, 4 języki, UE",
    description:
      "ManicBot: rezerwacja manicure w Telegramie — asystent 24/7, synchronizacja z Google Calendar, języki EN/RU/UA/PL. Dla salonów i niezależnych stylistek w Polsce i Europie.",
    keywords:
      "bot Telegram, rezerwacja salonu, manicure, Polska, Europa, asystent AI, Google Calendar, automatyzacja beauty",
    ogSiteName: "ManicBot",
  },

  theme: {
    toggleGroup: "Motyw strony",
    dark: "Ciemny",
    light: "Jasny",
  },

  footer: {
    tagline: "ManicBot — rezerwacje w Telegramie.",
    links: ["Prywatność", "Regulamin", "Wsparcie"],
    copy: "© 2026 ManicBot. Wszelkie prawa zastrzeżone.",
  },
};
