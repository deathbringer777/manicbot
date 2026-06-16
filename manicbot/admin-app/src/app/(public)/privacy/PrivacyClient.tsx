"use client";

import { ShieldCheck } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Section {
  title: string;
  intro?: string;
  items: string[];
}

interface PrivacyUi {
  kicker: string;
  title: string;
  updated: string;
  lead: string;
  sections: Section[];
}

const UI: Record<Lang, PrivacyUi> = {
  ru: {
    kicker: "Конфиденциальность",
    title: "Политика конфиденциальности",
    updated: "Последнее обновление: июнь 2026",
    lead: "Эта Политика объясняет, какие персональные данные обрабатывает ManicBot и как. Поставщик платформы (Оператор): [данные оператора будут указаны].",
    sections: [
      {
        title: "1. Какие данные и зачем мы обрабатываем",
        intro: "Мы обрабатываем минимально необходимый объём данных для работы сервиса.",
        items: [
          "Данные аккаунта: имя и контактные данные (например, имя пользователя/ID Telegram, телефон, email) — для создания и работы вашего аккаунта.",
          "Данные записей: визиты, услуги, расписание и история — чтобы обеспечивать запись и вести её историю.",
          "Данные общения: сообщения в подключённых каналах и переписка с AI-ассистентом — для поддержки и ведения диалога.",
          "Технические данные: данные об устройстве, использовании и логи — для безопасности, диагностики и улучшения сервиса.",
          "Правовые основания: исполнение договора, ваше согласие (где применимо) и наши законные интересы (безопасность, улучшение сервиса).",
        ],
      },
      {
        title: "2. Роли: кто управляет данными",
        intro:
          "В отношении данных конечных клиентов салон является контролёром (администратором) данных, а ManicBot выступает обработчиком, действующим по поручению салона.",
        items: [
          "Салон (бизнес-аккаунт) решает, какие данные клиентов и для чего он собирает, — он является контролёром этих данных.",
          "ManicBot обрабатывает эти данные только для предоставления сервиса салону и по его указаниям.",
          "В отношении данных самого владельца бизнес-аккаунта контролёром является ManicBot.",
        ],
      },
      {
        title: "3. Передача данных и субобработчики",
        items: [
          "Для работы сервиса мы используем надёжных поставщиков, например: Telegram, Meta (WhatsApp/Instagram), Stripe (платежи), Cloudflare (хостинг/инфраструктура) и почтовый провайдер (например, Resend).",
          "Мы передаём им данные только в объёме, необходимом для работы сервиса, и они обрабатывают их по собственным условиям.",
          "Мы не продаём персональные данные.",
        ],
      },
      {
        title: "4. Срок хранения",
        items: [
          "Мы храним персональные данные, пока аккаунт активен и пока это необходимо для предоставления сервиса и ведения истории визитов.",
          "Мы удаляем или обезличиваем данные, когда они больше не нужны или по обоснованному запросу об удалении, с учётом обязательных сроков хранения по закону.",
        ],
      },
      {
        title: "5. Ваши права",
        items: [
          "Вы можете запросить доступ к данным, их исправление, удаление, ограничение обработки и переносимость, а также возразить против отдельных видов обработки.",
          "Если обработка основана на согласии, вы можете отозвать его в любой момент.",
          "Запросы по данным конечных клиентов обрабатываются совместно с салоном, который ими управляет.",
        ],
      },
      {
        title: "6. Файлы cookie и локальное хранилище",
        items: [
          "Мы используем необходимые cookie/локальное хранилище для работы сервиса (например, сессию и ваш выбор языка, который хранится как manicbot_lang).",
          "Мы не применяем излишнее отслеживание без согласия там, где согласие требуется.",
        ],
      },
      {
        title: "7. Контакты",
        items: [
          "Вопросы о конфиденциальности и запросы по данным: [контакт оператора / ответственного за защиту данных] или страница /support.",
        ],
      },
    ],
  },
  ua: {
    kicker: "Конфіденційність",
    title: "Політика конфіденційності",
    updated: "Останнє оновлення: червень 2026",
    lead: "Ця Політика пояснює, які персональні дані обробляє ManicBot і як. Постачальник платформи (Оператор): [дані оператора буде вказано].",
    sections: [
      {
        title: "1. Які дані і навіщо ми обробляємо",
        intro: "Ми обробляємо мінімально необхідний обсяг даних для роботи сервісу.",
        items: [
          "Дані акаунта: імʼя та контактні дані (наприклад, імʼя користувача/ID Telegram, телефон, email) — для створення і роботи вашого акаунта.",
          "Дані записів: візити, послуги, розклад та історія — щоб забезпечувати запис і вести її історію.",
          "Дані спілкування: повідомлення в підключених каналах і листування з AI-асистентом — для підтримки та ведення діалогу.",
          "Технічні дані: дані про пристрій, використання та логи — для безпеки, діагностики та покращення сервісу.",
          "Правові підстави: виконання договору, ваша згода (де застосовно) та наші законні інтереси (безпека, покращення сервісу).",
        ],
      },
      {
        title: "2. Ролі: хто керує даними",
        intro:
          "Щодо даних кінцевих клієнтів салон є контролером (розпорядником) даних, а ManicBot виступає обробником, що діє за дорученням салону.",
        items: [
          "Салон (бізнес-акаунт) вирішує, які дані клієнтів і для чого він збирає, — він є контролером цих даних.",
          "ManicBot обробляє ці дані лише для надання сервісу салону і за його вказівками.",
          "Щодо даних самого власника бізнес-акаунта контролером є ManicBot.",
        ],
      },
      {
        title: "3. Передача даних і субобробники",
        items: [
          "Для роботи сервісу ми використовуємо надійних постачальників, наприклад: Telegram, Meta (WhatsApp/Instagram), Stripe (платежі), Cloudflare (хостинг/інфраструктура) та поштовий провайдер (наприклад, Resend).",
          "Ми передаємо їм дані лише в обсязі, необхідному для роботи сервісу, і вони обробляють їх за власними умовами.",
          "Ми не продаємо персональні дані.",
        ],
      },
      {
        title: "4. Строк зберігання",
        items: [
          "Ми зберігаємо персональні дані, поки акаунт активний і поки це необхідно для надання сервісу та ведення історії візитів.",
          "Ми видаляємо або знеособлюємо дані, коли вони більше не потрібні або за обґрунтованим запитом про видалення, з урахуванням обовʼязкових строків зберігання за законом.",
        ],
      },
      {
        title: "5. Ваші права",
        items: [
          "Ви можете запитати доступ до даних, їх виправлення, видалення, обмеження обробки та перенесення, а також заперечити проти окремих видів обробки.",
          "Якщо обробка ґрунтується на згоді, ви можете відкликати її будь-коли.",
          "Запити щодо даних кінцевих клієнтів обробляються спільно із салоном, який ними керує.",
        ],
      },
      {
        title: "6. Файли cookie та локальне сховище",
        items: [
          "Ми використовуємо необхідні cookie/локальне сховище для роботи сервісу (наприклад, сесію та ваш вибір мови, що зберігається як manicbot_lang).",
          "Ми не застосовуємо надмірне відстеження без згоди там, де згода потрібна.",
        ],
      },
      {
        title: "7. Контакти",
        items: [
          "Питання щодо конфіденційності та запити щодо даних: [контакт оператора / відповідального за захист даних] або сторінка /support.",
        ],
      },
    ],
  },
  en: {
    kicker: "Privacy",
    title: "Privacy Policy",
    updated: "Last updated: June 2026",
    lead: "This Privacy Policy explains what personal data ManicBot processes and how. The provider of the platform (Operator) is: [operator details to be specified].",
    sections: [
      {
        title: "1. What data we process and why",
        intro: "We process the minimum data needed to run the service.",
        items: [
          "Account data: name and contact details (e.g. Telegram username/ID, phone, email) — to create and operate your account.",
          "Booking data: visits, services, schedule and history — to provide bookings and keep their history.",
          "Communication data: messages exchanged through connected channels and with the AI assistant — to provide support and run the conversation.",
          "Technical data: device, usage data and logs — for security, diagnostics and improving the service.",
          "Legal bases: performance of a contract, your consent (where applicable), and our legitimate interests (security, service improvement).",
        ],
      },
      {
        title: "2. Roles: who controls the data",
        intro:
          "For end-client data, the salon is the data controller and ManicBot acts as a processor on the salon's behalf.",
        items: [
          "A salon (business account) decides what client data it collects and why — it is the controller of that data.",
          "ManicBot processes that data only to provide the service to the salon and under its instructions.",
          "For the data of the business-account holder itself, ManicBot is the controller.",
        ],
      },
      {
        title: "3. Sharing and sub-processors",
        items: [
          "To run the service we use trusted providers, for example: Telegram, Meta (WhatsApp/Instagram), Stripe (payments), Cloudflare (hosting/infrastructure) and an email provider (e.g. Resend).",
          "We share data with them only as needed to run the service, and they process it under their own terms.",
          "We do not sell personal data.",
        ],
      },
      {
        title: "4. Retention",
        items: [
          "We keep personal data for as long as the account is active and as long as needed to provide the service and maintain visit history.",
          "We delete or anonymise data when it is no longer needed or upon a valid deletion request, subject to mandatory legal retention periods.",
        ],
      },
      {
        title: "5. Your rights",
        items: [
          "You may request access, rectification, erasure, restriction and portability of your data, and object to certain processing.",
          "Where processing is based on consent, you may withdraw it at any time.",
          "Requests concerning end-client data are handled together with the salon that controls it.",
        ],
      },
      {
        title: "6. Cookies and local storage",
        items: [
          "We use necessary cookies/local storage to run the service (e.g. the session and your language preference, stored as manicbot_lang).",
          "We do not use unnecessary tracking without consent where consent is required.",
        ],
      },
      {
        title: "7. Contact",
        items: [
          "Privacy questions and data requests: [operator / data-protection contact] or the /support page.",
        ],
      },
    ],
  },
  pl: {
    kicker: "Prywatność",
    title: "Polityka prywatności",
    updated: "Ostatnia aktualizacja: czerwiec 2026",
    lead: "Niniejsza Polityka wyjaśnia, jakie dane osobowe przetwarza ManicBot i w jaki sposób. Dostawcą platformy (Operatorem) jest: [dane operatora zostaną wskazane].",
    sections: [
      {
        title: "1. Jakie dane i w jakim celu przetwarzamy",
        intro: "Przetwarzamy minimalny zakres danych niezbędny do działania serwisu.",
        items: [
          "Dane konta: imię i dane kontaktowe (np. nazwa użytkownika/ID Telegram, telefon, e-mail) — w celu utworzenia i obsługi Twojego konta.",
          "Dane rezerwacji: wizyty, usługi, grafik i historia — aby zapewniać rezerwacje i prowadzić ich historię.",
          "Dane komunikacji: wiadomości wymieniane w podłączonych kanałach i z asystentem AI — w celu wsparcia i prowadzenia rozmowy.",
          "Dane techniczne: dane o urządzeniu, korzystaniu oraz logi — w celu bezpieczeństwa, diagnostyki i ulepszania serwisu.",
          "Podstawy prawne: wykonanie umowy, Twoja zgoda (jeśli dotyczy) oraz nasze uzasadnione interesy (bezpieczeństwo, ulepszanie serwisu).",
        ],
      },
      {
        title: "2. Role: kto zarządza danymi",
        intro:
          "W odniesieniu do danych klientów końcowych salon jest administratorem danych, a ManicBot działa jako podmiot przetwarzający w imieniu salonu.",
        items: [
          "Salon (konto biznesowe) decyduje, jakie dane klientów i w jakim celu zbiera — jest administratorem tych danych.",
          "ManicBot przetwarza te dane wyłącznie w celu świadczenia usługi salonowi i zgodnie z jego poleceniami.",
          "W odniesieniu do danych samego posiadacza konta biznesowego administratorem jest ManicBot.",
        ],
      },
      {
        title: "3. Udostępnianie i podmioty przetwarzające",
        items: [
          "Do działania serwisu korzystamy z zaufanych dostawców, na przykład: Telegram, Meta (WhatsApp/Instagram), Stripe (płatności), Cloudflare (hosting/infrastruktura) oraz dostawcy poczty (np. Resend).",
          "Udostępniamy im dane wyłącznie w zakresie niezbędnym do działania serwisu, a oni przetwarzają je na własnych warunkach.",
          "Nie sprzedajemy danych osobowych.",
        ],
      },
      {
        title: "4. Okres przechowywania",
        items: [
          "Przechowujemy dane osobowe tak długo, jak konto jest aktywne i jak długo jest to potrzebne do świadczenia usługi oraz prowadzenia historii wizyt.",
          "Usuwamy lub anonimizujemy dane, gdy nie są już potrzebne lub na uzasadnione żądanie usunięcia, z uwzględnieniem obowiązkowych okresów przechowywania wynikających z prawa.",
        ],
      },
      {
        title: "5. Twoje prawa",
        items: [
          "Możesz zażądać dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia oraz wnieść sprzeciw wobec niektórych form przetwarzania.",
          "Jeśli przetwarzanie opiera się na zgodzie, możesz ją wycofać w dowolnym momencie.",
          "Żądania dotyczące danych klientów końcowych są obsługiwane wspólnie z salonem, który nimi zarządza.",
        ],
      },
      {
        title: "6. Pliki cookie i pamięć lokalna",
        items: [
          "Używamy niezbędnych plików cookie/pamięci lokalnej do działania serwisu (np. sesji i Twojego wyboru języka, zapisywanego jako manicbot_lang).",
          "Nie stosujemy zbędnego śledzenia bez zgody tam, gdzie zgoda jest wymagana.",
        ],
      },
      {
        title: "7. Kontakt",
        items: [
          "Pytania dotyczące prywatności i żądania w sprawie danych: [kontakt operatora / inspektora ochrony danych] lub strona /support.",
        ],
      },
    ],
  },
};

export function PrivacyClient() {
  const { lang } = useLang();
  const ui = UI[lang];

  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <ShieldCheck className="h-3.5 w-3.5" />
          {ui.kicker}
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{ui.title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{ui.updated}</p>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {ui.lead}
        </p>
      </div>

      <div className="space-y-8">
        {ui.sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-lg font-bold mb-3">{section.title}</h2>
            {section.intro && (
              <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {section.intro}
              </p>
            )}
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
