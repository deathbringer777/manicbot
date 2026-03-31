import type { Translations } from "./en";

export const pl: Translations = {
  flag: "🇵🇱",
  name: "PL",
  fullName: "Polski",

  nav: {
    features: "Możliwości",
    howItWorks: "Jak to działa",
    pricing: "Cennik",
    channels: "Kanały",
    login: "Zaloguj się",
    cta: "Wypróbuj ManicBot",
    findSalon: "Znajdź salon",
  },

  hero: {
    badge: "Telegram · Instagram · WhatsApp",
    headline: "Rezerwacje tam, gdzie Twoi klienci już rozmawiają",
    headlineAccent: "bez pobierania aplikacji",
    sub: "Klienci rezerwują bezpośrednio w komunikatorze, którego już używają. Ty dostajesz czyste potwierdzenia i pełny grafik — wszystko w jednym miejscu.",
    ctaPrimary: "Jak to działa",
    ctaSecondary: "Zobacz cennik",
    trustLine: "Dla salonów i niezależnych mistrzów w całej Europie",
    demoCaption: "Tak to wygląda w Telegramie",
    searchPlaceholder: "Znajdź salon według miasta lub usługi...",
    channelBadges: ["✈️ Telegram", "📷 Instagram", "💬 WhatsApp"],
  },

  stats: [
    { value: "3", label: "Kanały" },
    { value: "24/7", label: "Zawsze online" },
    { value: "0", label: "Zbędnych aplikacji" },
    { value: "4", label: "Języki" },
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
    title: "Wszystko czego potrzebujesz, nic zbędnego",
    sub: "Rezerwacje przez Telegram, Instagram i WhatsApp — z AI, przypomnieniami i synchronizacją kalendarza.",
    items: [
      {
        icon: "calendar",
        title: "Rezerwacje wielokanałowe",
        desc: "Klienci rezerwują przez Telegram, Instagram Direct lub WhatsApp. Bez aplikacji. Bez rejestracji. Tylko czat.",
      },
      {
        icon: "brain",
        title: "Asystent AI do rezerwacji",
        desc: "Rozumie naturalne wiadomości jak \"zapisz mnie jutro na klasyczny manicure\" i znajduje wolny termin.",
      },
      {
        icon: "layout-panel",
        title: "Panel administracyjny",
        desc: "Potwierdzaj, przenoś i anuluj wizyty. Przeglądaj grafik z dowolnego urządzenia.",
      },
      {
        icon: "globe",
        title: "4 języki",
        desc: "Angielski, rosyjski, ukraiński, polski — bot automatycznie przełącza się na język klienta.",
      },
      {
        icon: "calendar-sync",
        title: "Synchronizacja z Google Calendar",
        desc: "Wszystkie rezerwacje pojawiają się w Google Calendar natychmiast. Konflikty blokowane automatycznie.",
      },
      {
        icon: "bell",
        title: "Inteligentne przypomnienia",
        desc: "Automatyczne przypomnienia przed wizytą — przez ten sam kanał, przez który klient zarezerwował.",
      },
      {
        icon: "users",
        title: "Multi-mistrz",
        desc: "Wielu mistrzów, grafiki i usługi w jednym koncie. Każdy mistrz widzi tylko swój kalendarz.",
      },
      {
        icon: "shield",
        title: "Prywatność by design",
        desc: "Dane Twoich klientów nie trafiają na żaden marketplace. Bez profili, bez wyszukiwania, bez wycieków.",
      },
    ],
  },

  how: {
    title: "Uruchom w kilka minut",
    steps: [
      {
        num: "01",
        title: "Podłącz kanały",
        desc: "Połącz bota Telegram, stronę Instagram lub numer WhatsApp. Każde połączenie zajmuje do 3 minut.",
      },
      {
        num: "02",
        title: "Dodaj usługi i mistrzów",
        desc: "Skonfiguruj usługi, ceny i godziny pracy. Przeprowadzimy Cię przez każdy krok.",
      },
      {
        num: "03",
        title: "Udostępnij link",
        desc: "Wyślij link klientom. Rezerwują w komunikatorze, który wolą.",
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
          "Rezerwacje przez Telegram, Instagram i WhatsApp",
          "Synchronizacja z Google Calendar",
          "Przypomnienia dla klientów przed wizytą",
          "4 języki interfejsu",
          "Panel administracyjny na każdym urządzeniu",
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
          "Wszystkie kanały: Telegram, Instagram, WhatsApp",
          "Asystent AI do rezerwacji",
          "Rezerwacje w naturalnym języku",
          "Inteligentne przypomnienia i powiadomienia",
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
          "Nieograniczona liczba mistrzów",
          "Wszystkie funkcje Pro",
          "Własna nazwa i zdjęcie profilowe bota",
          "Zarządzanie wieloma lokalizacjami",
          "Onboarding i personalizowana konfiguracja",
          "Dedykowany menedżer wsparcia",
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
        a: "Nie. Potrzebują tylko Telegram, Instagram lub WhatsApp — który już mają. Jedno kliknięcie w link — gotowe.",
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

  channels: {
    title: "Jedna platforma — wszystkie kanały",
    subtitle: "Twoi klienci są na różnych platformach. ManicBot dociera do nich tam, gdzie już są.",
    live: "Działa",
    soon: "Wkrótce",
    items: [
      { icon: "✈️", name: "Telegram", desc: "Natywny bot z przyciskami, szybkimi odpowiedziami i synchronizacją z Kalendarzem Google.", live: true },
      { icon: "📷", name: "Instagram", desc: "Odpowiadaj bezpośrednio z Instagram Direct. Przyciski automatycznie dostosowują się do limitu Instagrama.", live: true },
      { icon: "💬", name: "WhatsApp", desc: "Pełny proces rezerwacji w najpopularniejszym komunikatorze na świecie.", live: false },
    ],
  },

  compare: {
    title: "ManicBot vs alternatywy",
    subtitle: "Porównaj nas z marketplace'ami rezerwacji.",
    note: "* Marketplace rezerwacji = platforma, gdzie klienci muszą pobrać ich aplikację i założyć konto, żeby zarezerwować.",
    col2: "Marketplace rezerwacji *",
    col3: "",
    rows: [
      { label: "Działa w komunikatorze klienta",          mb: true,  c2: false, c3: null },
      { label: "Bez pobierania aplikacji",                 mb: true,  c2: false, c3: null },
      { label: "Rezerwacje przez Instagram Direct",        mb: true,  c2: false, c3: null },
      { label: "Asystent AI do rezerwacji",                mb: true,  c2: false, c3: null },
      { label: "Synchronizacja Google Calendar",           mb: true,  c2: null,  c3: null },
      { label: "Brak prowizji marketplace",                mb: true,  c2: false, c3: null },
      { label: "Twoja marka — nie ich",                    mb: true,  c2: false, c3: null },
      { label: "4 języki interfejsu",                      mb: true,  c2: null,  c3: null },
    ],
  },

  theme: {
    toggleGroup: "Motyw strony",
    dark: "Ciemny",
    light: "Jasny",
  },

  search: {
    salonsLabel: "Salony",
    articlesLabel: "Artykuły",
    noResults: "Nic nie znaleziono dla",
    showAll: "Pokaż wszystkie wyniki",
    showAllFor: "Pokaż wszystkie wyniki dla",
  },

  footer: {
    tagline: "ManicBot — rezerwacje w Telegramie.",
    links: ["Prywatność", "Regulamin", "Wsparcie"],
    copy: "© 2026 ManicBot. Wszelkie prawa zastrzeżone.",
  },
};
