import type { DriveStep } from "driver.js";
import type { Lang } from "~/lib/i18n";
import { firstVisibleTourElement, isTourElementVisible } from "~/lib/onboarding/tourVisibility";

type TourWebRole = "tenant_owner" | "master" | "support" | "technical_support";

type CopyBlock = {
  next: string;
  prev: string;
  done: string;
  header: { title: string; description: string };
  sidebar: { title: string; description: string };
  mobileNav: { title: string; description: string };
  settings: { title: string; description: string };
  salonTabs: { title: string; description: string };
  masterTabs: { title: string; description: string };
  supportFilters: { title: string; description: string };
  supportList: { title: string; description: string };
  content: { title: string; description: string };
};

const COPY: Record<Lang, CopyBlock> = {
  ru: {
    next: "Далее",
    prev: "Назад",
    done: "Готово",
    header: {
      title: "Верхняя панель",
      description: "Заголовок страницы, переключение темы и ваш аккаунт.",
    },
    sidebar: {
      title: "Боковое меню",
      description: "Основные разделы кабинета: дашборд, записи, услуги, клиенты и другие блоки.",
    },
    mobileNav: {
      title: "Навигация снизу",
      description: "На телефоне быстрый доступ к разделам — в нижней панели.",
    },
    settings: {
      title: "Настройки",
      description: "Язык, аккаунт и параметры кабинета. Откройте, когда нужно что-то изменить.",
    },
    salonTabs: {
      title: "Вкладки салона",
      description: "Переключайте обзор, записи, услуги, мастеров, каналы и настройки салона.",
    },
    masterTabs: {
      title: "Разделы мастера",
      description: "Сегодня, расписание, клиенты, доходы и профиль — всё в одном месте.",
    },
    supportFilters: {
      title: "Фильтры тикетов",
      description: "Сузьте список по статусу: открытые, в работе, эскалация и другие.",
    },
    supportList: {
      title: "Очередь обращений",
      description: "Нажмите на тикет, чтобы открыть переписку, взять в работу или ответить.",
    },
    content: {
      title: "Рабочая область",
      description: "Здесь карточки, таблицы и формы выбранного раздела — основная работа происходит здесь.",
    },
  },
  ua: {
    next: "Далі",
    prev: "Назад",
    done: "Готово",
    header: {
      title: "Верхня панель",
      description: "Заголовок сторінки, тема та ваш обліковий запис.",
    },
    sidebar: {
      title: "Бічне меню",
      description: "Основні розділи кабінету: дашборд, записи, послуги, клієнти тощо.",
    },
    mobileNav: {
      title: "Навігація знизу",
      description: "На телефоні швидкий доступ до розділів — у нижній панелі.",
    },
    settings: {
      title: "Налаштування",
      description: "Мова, обліковий запис і параметри кабінету.",
    },
    salonTabs: {
      title: "Вкладки салону",
      description: "Перемикайте огляд, записи, послуги, майстрів, канали та налаштування.",
    },
    masterTabs: {
      title: "Розділи майстра",
      description: "Сьогодні, розклад, клієнти, доходи та профіль.",
    },
    supportFilters: {
      title: "Фільтри тикетів",
      description: "Оберіть статус: відкриті, в роботі, ескалація тощо.",
    },
    supportList: {
      title: "Список звернень",
      description: "Натисніть тикет, щоб відкрити листування й відповісти.",
    },
    content: {
      title: "Робоча область",
      description: "Тут картки, списки та форми обраного розділу.",
    },
  },
  en: {
    next: "Next",
    prev: "Back",
    done: "Done",
    header: {
      title: "Top bar",
      description: "Page title, theme toggle, and your account pill.",
    },
    sidebar: {
      title: "Sidebar",
      description: "Jump between dashboard, appointments, services, clients, and more.",
    },
    mobileNav: {
      title: "Bottom navigation",
      description: "On your phone, primary sections live in the bottom bar.",
    },
    settings: {
      title: "Settings",
      description: "Language, account, and cabinet options when you need to adjust something.",
    },
    salonTabs: {
      title: "Salon tabs",
      description: "Switch overview, appointments, services, masters, channels, and salon settings.",
    },
    masterTabs: {
      title: "Master sections",
      description: "Today, schedule, clients, earnings, and profile — all in one flow.",
    },
    supportFilters: {
      title: "Ticket filters",
      description: "Narrow the queue by status: open, claimed, escalated, closed.",
    },
    supportList: {
      title: "Ticket queue",
      description: "Open a ticket to read the thread, claim it, and reply.",
    },
    content: {
      title: "Main workspace",
      description: "Cards, lists, and forms for the section you selected — this is where work happens.",
    },
  },
  pl: {
    next: "Dalej",
    prev: "Wstecz",
    done: "Gotowe",
    header: {
      title: "Górny pasek",
      description: "Tytuł strony, motyw i konto.",
    },
    sidebar: {
      title: "Menu boczne",
      description: "Przechodzenie między sekcjami: panel, wizyty, usługi, klienci itd.",
    },
    mobileNav: {
      title: "Nawigacja na dole",
      description: "Na telefonie główne sekcje są w dolnym pasku.",
    },
    settings: {
      title: "Ustawienia",
      description: "Język, konto i opcje panelu.",
    },
    salonTabs: {
      title: "Zakładki salonu",
      description: "Przełączaj podgląd, wizyty, usługi, stylistki, kanały i ustawienia.",
    },
    masterTabs: {
      title: "Sekcje stylistki",
      description: "Dziś, harmonogram, klienci, zarobki i profil.",
    },
    supportFilters: {
      title: "Filtry zgłoszeń",
      description: "Wybierz status: otwarte, przejęte, eskalacja, zamknięte.",
    },
    supportList: {
      title: "Kolejka zgłoszeń",
      description: "Kliknij zgłoszenie, aby otworzyć wątek i odpowiedzieć.",
    },
    content: {
      title: "Obszar roboczy",
      description: "Karty, listy i formularze wybranej sekcji.",
    },
  },
};

function pushIfVisible(
  out: DriveStep[],
  selector: string,
  popover: { title: string; description: string; side?: "top" | "right" | "bottom" | "left" },
) {
  if (!isTourElementVisible(selector)) return;
  out.push({
    element: () => firstVisibleTourElement(selector)!,
    popover: { ...popover, side: popover.side ?? "bottom", align: "start" },
  });
}

export function buildDashboardTourSteps(role: TourWebRole, lang: Lang): DriveStep[] {
  const c = COPY[lang] ?? COPY.en;
  const steps: DriveStep[] = [];

  pushIfVisible(steps, '[data-tour="web-header"]', {
    title: c.header.title,
    description: c.header.description,
    side: "bottom",
  });

  if (isTourElementVisible('[data-tour="web-sidebar"]')) {
    pushIfVisible(steps, '[data-tour="web-sidebar"]', {
      title: c.sidebar.title,
      description: c.sidebar.description,
      side: "right",
    });
  } else if (isTourElementVisible('[data-tour="web-mobile-nav"]')) {
    pushIfVisible(steps, '[data-tour="web-mobile-nav"]', {
      title: c.mobileNav.title,
      description: c.mobileNav.description,
      side: "top",
    });
  }

  pushIfVisible(steps, '[data-tour="web-settings"]', {
    title: c.settings.title,
    description: c.settings.description,
    side: "right",
  });

  if (role === "tenant_owner") {
    pushIfVisible(steps, '[data-tour="salon-tabs"]', {
      title: c.salonTabs.title,
      description: c.salonTabs.description,
      side: "bottom",
    });
  } else if (role === "master") {
    pushIfVisible(steps, '[data-tour="master-tabs"]', {
      title: c.masterTabs.title,
      description: c.masterTabs.description,
      side: "bottom",
    });
  } else if (role === "support" || role === "technical_support") {
    pushIfVisible(steps, '[data-tour="support-filters"]', {
      title: c.supportFilters.title,
      description: c.supportFilters.description,
      side: "bottom",
    });
    pushIfVisible(steps, '[data-tour="support-list"]', {
      title: c.supportList.title,
      description: c.supportList.description,
      side: "top",
    });
  }

  pushIfVisible(steps, '[data-tour="web-content"]', {
    title: c.content.title,
    description: c.content.description,
    side: "top",
  });

  return steps;
}

export function tourButtonLabels(lang: Lang): { next: string; prev: string; done: string } {
  const c = COPY[lang] ?? COPY.en;
  return { next: c.next, prev: c.prev, done: c.done };
}
