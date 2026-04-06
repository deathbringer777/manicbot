"use client";

import { FileText } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Section {
  title: string;
  items: string[];
}

const UI: Record<Lang, { kicker: string; title: string; updated: string; sections: Section[] }> = {
  ru: {
    kicker: "Правила",
    title: "Правила пользования",
    updated: "Последнее обновление: апрель 2026",
    sections: [
      {
        title: "1. Регистрация и аккаунт",
        items: [
          "Для записи через бот необходимо подтвердить своё имя в Telegram.",
          "Один аккаунт Telegram соответствует одному профилю клиента.",
          "Владельцы салонов регистрируют бизнес-аккаунт через панель администратора.",
        ],
      },
      {
        title: "2. Запись и отмена",
        items: [
          "Запись доступна на свободные слоты в расписании мастера.",
          "Отмена возможна не позднее чем за 2 часа до начала сеанса.",
          "Систематические неявки могут привести к временной блокировке записи.",
        ],
      },
      {
        title: "3. Ответственность пользователей",
        items: [
          "Запрещено указывать заведомо ложные данные при регистрации.",
          "Запрещено злоупотреблять системой поддержки или AI-ассистентом.",
          "Запрещено пытаться получить доступ к чужим данным или аккаунтам.",
        ],
      },
      {
        title: "4. Данные и конфиденциальность",
        items: [
          "Персональные данные обрабатываются в соответствии с политикой конфиденциальности.",
          "Данные записей хранятся для обеспечения истории визитов.",
          "Подробнее — на странице /privacy.",
        ],
      },
      {
        title: "5. Изменения правил",
        items: [
          "Платформа оставляет за собой право обновлять правила.",
          "Продолжение пользования сервисом означает согласие с текущей версией правил.",
        ],
      },
    ],
  },
  ua: {
    kicker: "Правила",
    title: "Правила користування",
    updated: "Останнє оновлення: квітень 2026",
    sections: [
      {
        title: "1. Реєстрація та акаунт",
        items: [
          "Для запису через бот необхідно підтвердити своє ім'я в Telegram.",
          "Один акаунт Telegram відповідає одному профілю клієнта.",
          "Власники салонів реєструють бізнес-акаунт через панель адміністратора.",
        ],
      },
      {
        title: "2. Запис та скасування",
        items: [
          "Запис доступний на вільні слоти в розкладі майстра.",
          "Скасування можливе не пізніше ніж за 2 години до початку сеансу.",
          "Систематичні неявки можуть призвести до тимчасового блокування запису.",
        ],
      },
      {
        title: "3. Відповідальність користувачів",
        items: [
          "Заборонено вказувати завідомо неправдиві дані при реєстрації.",
          "Заборонено зловживати системою підтримки або AI-асистентом.",
          "Заборонено намагатися отримати доступ до чужих даних або акаунтів.",
        ],
      },
      {
        title: "4. Дані та конфіденційність",
        items: [
          "Персональні дані обробляються відповідно до політики конфіденційності.",
          "Дані записів зберігаються для забезпечення історії відвідувань.",
          "Детальніше — на сторінці /privacy.",
        ],
      },
      {
        title: "5. Зміни правил",
        items: [
          "Платформа залишає за собою право оновлювати правила.",
          "Продовження користування сервісом означає згоду з поточною версією правил.",
        ],
      },
    ],
  },
  en: {
    kicker: "Rules",
    title: "Terms of Use",
    updated: "Last updated: April 2026",
    sections: [
      {
        title: "1. Registration & Account",
        items: [
          "To book through the bot you must confirm your Telegram name.",
          "One Telegram account corresponds to one client profile.",
          "Salon owners register a business account through the admin panel.",
        ],
      },
      {
        title: "2. Booking & Cancellation",
        items: [
          "Booking is available for open slots in the master's schedule.",
          "Cancellation is allowed no later than 2 hours before the session.",
          "Repeated no-shows may result in a temporary booking suspension.",
        ],
      },
      {
        title: "3. User Responsibilities",
        items: [
          "Providing deliberately false information during registration is prohibited.",
          "Abusing the support system or AI assistant is prohibited.",
          "Attempting to access other users' data or accounts is prohibited.",
        ],
      },
      {
        title: "4. Data & Privacy",
        items: [
          "Personal data is processed in accordance with the privacy policy.",
          "Booking data is stored to maintain visit history.",
          "See /privacy for details.",
        ],
      },
      {
        title: "5. Changes to Rules",
        items: [
          "The platform reserves the right to update these rules.",
          "Continued use of the service means you accept the current version of the rules.",
        ],
      },
    ],
  },
  pl: {
    kicker: "Zasady",
    title: "Zasady korzystania",
    updated: "Ostatnia aktualizacja: kwiecien 2026",
    sections: [
      {
        title: "1. Rejestracja i konto",
        items: [
          "Aby zapisac sie przez bota, nalezy potwierdzic swoje imie w Telegram.",
          "Jedno konto Telegram odpowiada jednemu profilowi klienta.",
          "Wlasciciele salonow rejestruja konto biznesowe przez panel administracyjny.",
        ],
      },
      {
        title: "2. Rezerwacja i anulowanie",
        items: [
          "Rezerwacja jest dostepna na wolne sloty w grafiku mistrza.",
          "Anulowanie jest mozliwe nie pozniej niz 2 godziny przed sesja.",
          "Systematyczne nieobecnosci moga skutkowac tymczasowa blokada rezerwacji.",
        ],
      },
      {
        title: "3. Odpowiedzialnosc uzytkownikow",
        items: [
          "Podawanie celowo falszywych danych podczas rejestracji jest zabronione.",
          "Naduzywanie systemu wsparcia lub asystenta AI jest zabronione.",
          "Proba uzyskania dostepu do danych lub kont innych uzytkownikow jest zabroniona.",
        ],
      },
      {
        title: "4. Dane i prywatnosc",
        items: [
          "Dane osobowe sa przetwarzane zgodnie z polityka prywatnosci.",
          "Dane rezerwacji sa przechowywane w celu prowadzenia historii wizyt.",
          "Szczegoly na stronie /privacy.",
        ],
      },
      {
        title: "5. Zmiany zasad",
        items: [
          "Platforma zastrzega sobie prawo do aktualizacji zasad.",
          "Dalsze korzystanie z serwisu oznacza akceptacje aktualnej wersji zasad.",
        ],
      },
    ],
  },
};

export function RulesClient() {
  const { lang } = useLang();
  const ui = UI[lang];

  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <FileText className="h-3.5 w-3.5" />
          {ui.kicker}
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{ui.title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{ui.updated}</p>
      </div>

      <div className="space-y-8">
        {ui.sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-lg font-bold mb-3">{section.title}</h2>
            <ul className="space-y-2 text-slate-700 dark:text-slate-300">
              {section.items.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
