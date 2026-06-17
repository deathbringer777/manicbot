"use client";

import { FileText } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Section {
  title: string;
  intro?: string;
  items: string[];
}

interface RulesUi {
  kicker: string;
  title: string;
  updated: string;
  lead: string;
  sections: Section[];
}

const UI: Record<Lang, RulesUi> = {
  ru: {
    kicker: "Правила",
    title: "Правила пользования",
    updated: "Последнее обновление: июнь 2026",
    lead: "ManicBot — это программный сервис (платформа) для салонов красоты и частных мастеров. Эти правила объясняют, кто и как может пользоваться сервисом. Полное обязывающее соглашение — на странице /terms, обработка данных — на странице /privacy.",
    sections: [
      {
        title: "1. О сервисе, кто может пользоваться и типы аккаунтов",
        intro:
          "ManicBot предоставляет только программное обеспечение, которое помогает салонам и мастерам автоматизировать онлайн-запись, общение с клиентами и управление через Telegram, WhatsApp, Instagram и веб-виджет. Сами услуги салона ManicBot не оказывает.",
        items: [
          "Бизнес-аккаунт — для владельца салона или независимого (частного) мастера; регистрируется через панель администратора и после пробного периода требует активной подписки.",
          "Профиль клиента — создаётся автоматически, когда клиент записывается через бот; один аккаунт мессенджера (например, Telegram) соответствует одному профилю клиента.",
          "Для использования сервиса необходимо достичь совершеннолетия (или иметь согласие законного представителя) и указывать достоверные данные.",
        ],
      },
      {
        title: "2. Права пользователя",
        items: [
          "Пользоваться сервисом в пределах выбранного тарифа и настоящих правил.",
          "Получать доступ к своим персональным данным, выгружать их и запрашивать удаление — подробнее на странице /privacy.",
          "Обращаться в поддержку через встроенную систему поддержки и страницу /support.",
        ],
      },
      {
        title: "3. Обязанности и запрещённые действия",
        items: [
          "Указывать достоверные данные, беречь доступ к своему аккаунту и отвечать за действия, совершённые под ним.",
          "Не злоупотреблять системой поддержки и AI-ассистентом (спам, заведомое введение в заблуждение, попытки получить чужие данные).",
          "Не пытаться получить доступ к данным или аккаунтам других пользователей или салонов.",
          "Не извлекать данные автоматически (scraping), не декомпилировать, не перегружать и не вмешиваться в работу сервиса.",
          "Не использовать сервис для незаконного, мошеннического или вредоносного контента и для рассылки спама.",
          "Соблюдать правила платформ, через которые вы подключаетесь (Telegram, Meta / WhatsApp / Instagram и др.).",
        ],
      },
      {
        title: "4. Политику салона определяет сам салон",
        intro:
          "ManicBot — это только инструмент. Каждый салон или мастер самостоятельно настраивает свою работу в приложении и несёт за неё полную ответственность.",
        items: [
          "Перечень услуг, цены, график и расписание устанавливает салон, а не ManicBot.",
          "Политику отмен, неявок, предоплаты и переноса записей каждый салон определяет индивидуально с помощью инструментов приложения — ManicBot не устанавливает и не навязывает единое правило отмены.",
          "Договор об оказании услуги заключается между клиентом и салоном. ManicBot не является его стороной и не отвечает за оказанные услуги, их качество, оплату или споры между клиентом и салоном.",
        ],
      },
      {
        title: "5. Реферальная программа",
        items: [
          "Программа доступна владельцам салонов и независимым (частным) мастерам с активной подпиской.",
          "Приглашённый получает 20% скидки на первый месяц или 10% на годовую подписку при первой оплате по реферальной ссылке.",
          "Пригласивший получает 1 бесплатный месяц за каждого подтверждённого друга — друг считается подтверждённым только после успешной оплаты первого счёта (не пробного периода).",
          "Лимит — 6 бесплатных месяцев в течение скользящего года. Если приглашённый запросит возврат или отменит подписку в первый месяц, награда отменяется.",
          "Самоприглашение, фейковые регистрации и спам в публичных каналах запрещены и ведут к аннулированию награды и блокировке кода.",
        ],
      },
      {
        title: "6. Данные и обязывающее соглашение",
        items: [
          "Персональные данные обрабатываются так, как описано в Политике конфиденциальности (/privacy).",
          "Полное соглашение, регулирующее использование ManicBot, — это Условия использования (/terms). При любом противоречии преимущество имеют Условия использования.",
        ],
      },
      {
        title: "7. Изменения правил",
        items: [
          "Мы можем обновлять эти правила; дата обновления указывается вверху страницы.",
          "Продолжение пользования сервисом после обновления означает согласие с действующей версией правил.",
        ],
      },
    ],
  },
  ua: {
    kicker: "Правила",
    title: "Правила користування",
    updated: "Останнє оновлення: червень 2026",
    lead: "ManicBot — це програмний сервіс (платформа) для салонів краси та приватних майстрів. Ці правила пояснюють, хто і як може користуватися сервісом. Повна обовʼязкова угода — на сторінці /terms, обробка даних — на сторінці /privacy.",
    sections: [
      {
        title: "1. Про сервіс, хто може користуватися та типи акаунтів",
        intro:
          "ManicBot надає лише програмне забезпечення, яке допомагає салонам і майстрам автоматизувати онлайн-запис, спілкування з клієнтами та управління через Telegram, WhatsApp, Instagram і вебвіджет. Самі послуги салону ManicBot не надає.",
        items: [
          "Бізнес-акаунт — для власника салону або незалежного (приватного) майстра; реєструється через панель адміністратора і після пробного періоду потребує активної підписки.",
          "Профіль клієнта — створюється автоматично, коли клієнт записується через бот; один акаунт месенджера (наприклад, Telegram) відповідає одному профілю клієнта.",
          "Для користування сервісом необхідно досягти повноліття (або мати згоду законного представника) і вказувати достовірні дані.",
        ],
      },
      {
        title: "2. Права користувача",
        items: [
          "Користуватися сервісом у межах обраного тарифу та цих правил.",
          "Отримувати доступ до своїх персональних даних, вивантажувати їх і запитувати видалення — детальніше на сторінці /privacy.",
          "Звертатися в підтримку через вбудовану систему підтримки та сторінку /support.",
        ],
      },
      {
        title: "3. Обовʼязки та заборонені дії",
        items: [
          "Вказувати достовірні дані, берегти доступ до свого акаунта та відповідати за дії, вчинені під ним.",
          "Не зловживати системою підтримки та AI-асистентом (спам, свідоме введення в оману, спроби отримати чужі дані).",
          "Не намагатися отримати доступ до даних або акаунтів інших користувачів чи салонів.",
          "Не вилучати дані автоматично (scraping), не декомпілювати, не перевантажувати і не втручатися в роботу сервісу.",
          "Не використовувати сервіс для незаконного, шахрайського чи шкідливого контенту та для розсилання спаму.",
          "Дотримуватися правил платформ, через які ви підключаєтеся (Telegram, Meta / WhatsApp / Instagram тощо).",
        ],
      },
      {
        title: "4. Політику салону визначає сам салон",
        intro:
          "ManicBot — це лише інструмент. Кожен салон або майстер самостійно налаштовує свою роботу в застосунку і несе за неї повну відповідальність.",
        items: [
          "Перелік послуг, ціни, графік і розклад встановлює салон, а не ManicBot.",
          "Політику скасувань, неявок, передоплати та перенесення записів кожен салон визначає індивідуально за допомогою інструментів застосунку — ManicBot не встановлює і не нав'язує єдине правило скасування.",
          "Договір про надання послуги укладається між клієнтом і салоном. ManicBot не є його стороною і не відповідає за надані послуги, їхню якість, оплату чи спори між клієнтом і салоном.",
        ],
      },
      {
        title: "5. Реферальна програма",
        items: [
          "Програма доступна власникам салонів та незалежним (приватним) майстрам з активною підпискою.",
          "Запрошений отримує 20% знижки на перший місяць або 10% на річну підписку при першій оплаті за реферальним посиланням.",
          "Запрошувач отримує 1 безкоштовний місяць за кожного підтвердженого друга — друг вважається підтвердженим лише після успішної оплати першого рахунку (не пробного періоду).",
          "Ліміт — 6 безкоштовних місяців протягом ковзного року. Якщо запрошений запросить повернення коштів або скасує підписку в перший місяць, винагорода скасовується.",
          "Самозапрошення, фіктивні реєстрації та спам у публічних каналах заборонені та ведуть до скасування винагороди й блокування коду.",
        ],
      },
      {
        title: "6. Дані та обовʼязкова угода",
        items: [
          "Персональні дані обробляються так, як описано в Політиці конфіденційності (/privacy).",
          "Повна угода, що регулює використання ManicBot, — це Умови використання (/terms). За будь-якого протиріччя перевагу мають Умови використання.",
        ],
      },
      {
        title: "7. Зміни правил",
        items: [
          "Ми можемо оновлювати ці правила; дата оновлення зазначається вгорі сторінки.",
          "Продовження користування сервісом після оновлення означає згоду з чинною версією правил.",
        ],
      },
    ],
  },
  en: {
    kicker: "Rules",
    title: "Rules of Use",
    updated: "Last updated: June 2026",
    lead: "ManicBot is a software service (platform) for beauty salons and independent masters. These rules explain who may use the service and how. The full binding agreement is on the /terms page, and data handling is described on the /privacy page.",
    sections: [
      {
        title: "1. About the service, who can use it, and account types",
        intro:
          "ManicBot provides software only — tools that help salons and masters automate online booking, client communication and management through Telegram, WhatsApp, Instagram and the web widget. ManicBot does not provide the salon services themselves.",
        items: [
          "Business account — for a salon owner or an independent (personal) master; registered through the admin panel and, after the trial period, requires an active subscription.",
          "Client profile — created automatically when a client books through the bot; one messenger account (e.g. Telegram) corresponds to one client profile.",
          "To use the service you must be of the age of majority (or have a legal guardian's consent) and provide accurate information.",
        ],
      },
      {
        title: "2. Your rights",
        items: [
          "Use the service within the limits of your chosen plan and these rules.",
          "Access, export and request deletion of your personal data — see the /privacy page.",
          "Contact support through the built-in support system and the /support page.",
        ],
      },
      {
        title: "3. Your obligations and prohibited actions",
        items: [
          "Provide accurate information, keep your account access secure, and remain responsible for activity under your account.",
          "Do not abuse the support system or the AI assistant (spam, deliberate deception, attempts to obtain other people's data).",
          "Do not attempt to access the data or accounts of other users or salons.",
          "Do not scrape, decompile, overload, or otherwise interfere with the service.",
          "Do not use the service for unlawful, fraudulent or harmful content, or to send spam.",
          "Comply with the rules of the platforms you connect through (Telegram, Meta / WhatsApp / Instagram, etc.).",
        ],
      },
      {
        title: "4. Each salon sets its own policies",
        intro:
          "ManicBot is only a tool. Each salon or master independently configures how they run their business in the app and is fully responsible for it.",
        items: [
          "Services, prices, working hours and schedule are set by the salon, not by ManicBot.",
          "Cancellation, no-show, prepayment and rescheduling policies are decided by each salon individually using the app's tools — ManicBot does not set or enforce any single cancellation rule.",
          "The agreement to provide a service is between the client and the salon. ManicBot is not a party to it and is not responsible for the services rendered, their quality, payment, or any dispute between a client and a salon.",
        ],
      },
      {
        title: "5. Referral program",
        items: [
          "The program is available to salon owners and independent (personal) masters with an active subscription.",
          "The invited friend gets 20% off the first month or 10% off the yearly plan on their first paid invoice through the referral link.",
          "The inviter gets 1 free month per confirmed friend — a friend counts as confirmed only after a successful first paid invoice (not the trial).",
          "The cap is 6 free months per rolling year. If the invited friend issues a refund or cancels within the first month, the reward is reversed.",
          "Self-referrals, fake registrations and spam on public channels are prohibited and result in reward cancellation and code suspension.",
        ],
      },
      {
        title: "6. Data and the binding agreement",
        items: [
          "Personal data is processed as described in the Privacy Policy (/privacy).",
          "The full agreement governing the use of ManicBot is the Terms of Service (/terms). In case of any conflict, the Terms of Service prevail.",
        ],
      },
      {
        title: "7. Changes to these rules",
        items: [
          "We may update these rules; the update date is shown at the top of the page.",
          "Continued use of the service after an update means you accept the current version.",
        ],
      },
    ],
  },
  pl: {
    kicker: "Zasady",
    title: "Zasady korzystania",
    updated: "Ostatnia aktualizacja: czerwiec 2026",
    lead: "ManicBot to usługa programistyczna (platforma) dla salonów kosmetycznych i niezależnych mistrzów. Niniejsze zasady wyjaśniają, kto i jak może korzystać z serwisu. Pełna wiążąca umowa znajduje się na stronie /terms, a przetwarzanie danych opisano na stronie /privacy.",
    sections: [
      {
        title: "1. O serwisie, kto może korzystać i rodzaje kont",
        intro:
          "ManicBot udostępnia wyłącznie oprogramowanie — narzędzia, które pomagają salonom i mistrzom automatyzować rezerwacje online, komunikację z klientami oraz zarządzanie przez Telegram, WhatsApp, Instagram i widżet internetowy. ManicBot nie świadczy samych usług salonu.",
        items: [
          "Konto biznesowe — dla właściciela salonu lub niezależnego (osobistego) mistrza; rejestrowane przez panel administracyjny i po okresie próbnym wymaga aktywnej subskrypcji.",
          "Profil klienta — tworzony automatycznie, gdy klient rezerwuje przez bota; jedno konto komunikatora (np. Telegram) odpowiada jednemu profilowi klienta.",
          "Aby korzystać z serwisu, należy być osobą pełnoletnią (lub mieć zgodę opiekuna prawnego) oraz podawać prawdziwe dane.",
        ],
      },
      {
        title: "2. Prawa użytkownika",
        items: [
          "Korzystanie z serwisu w granicach wybranego planu i niniejszych zasad.",
          "Dostęp do swoich danych osobowych, ich eksport i żądanie usunięcia — szczegóły na stronie /privacy.",
          "Kontakt z pomocą przez wbudowany system wsparcia oraz stronę /support.",
        ],
      },
      {
        title: "3. Obowiązki i działania zabronione",
        items: [
          "Podawanie prawdziwych danych, dbanie o dostęp do swojego konta i odpowiedzialność za działania wykonane na koncie.",
          "Zakaz nadużywania systemu wsparcia i asystenta AI (spam, celowe wprowadzanie w błąd, próby uzyskania cudzych danych).",
          "Zakaz prób uzyskania dostępu do danych lub kont innych użytkowników albo salonów.",
          "Zakaz automatycznego pobierania danych (scraping), dekompilacji, przeciążania i ingerencji w działanie serwisu.",
          "Zakaz wykorzystywania serwisu do treści niezgodnych z prawem, oszukańczych lub szkodliwych oraz do rozsyłania spamu.",
          "Przestrzeganie zasad platform, przez które się łączysz (Telegram, Meta / WhatsApp / Instagram itp.).",
        ],
      },
      {
        title: "4. Politykę salonu ustala sam salon",
        intro:
          "ManicBot to wyłącznie narzędzie. Każdy salon lub mistrz samodzielnie konfiguruje sposób prowadzenia swojej działalności w aplikacji i ponosi za to pełną odpowiedzialność.",
        items: [
          "Zakres usług, ceny, godziny pracy i grafik ustala salon, a nie ManicBot.",
          "Politykę anulowania, nieobecności, przedpłat i przekładania wizyt każdy salon ustala indywidualnie za pomocą narzędzi aplikacji — ManicBot nie ustala ani nie narzuca jednej reguły anulowania.",
          "Umowa o wykonanie usługi jest zawierana między klientem a salonem. ManicBot nie jest jej stroną i nie odpowiada za wykonane usługi, ich jakość, płatność ani spory między klientem a salonem.",
        ],
      },
      {
        title: "5. Program poleceń",
        items: [
          "Program jest dostępny dla właścicieli salonów i niezależnych (osobistych) mistrzów z aktywną subskrypcją.",
          "Zaproszony otrzymuje 20% zniżki na pierwszy miesiąc lub 10% na subskrypcję roczną przy pierwszej płatności przez link polecający.",
          "Polecający otrzymuje 1 darmowy miesiąc za każdego potwierdzonego znajomego — znajomy jest potwierdzony dopiero po pomyślnej płatności za pierwszą fakturę (nie po okresie próbnym).",
          "Limit to 6 darmowych miesięcy w roku kroczącym. Jeśli zaproszony zażąda zwrotu lub anuluje subskrypcję w pierwszym miesiącu, nagroda zostaje cofnięta.",
          "Samopolecenia, fikcyjne rejestracje i spam w kanałach publicznych są zabronione i skutkują anulowaniem nagrody oraz blokadą kodu.",
        ],
      },
      {
        title: "6. Dane i wiążąca umowa",
        items: [
          "Dane osobowe są przetwarzane zgodnie z Polityką prywatności (/privacy).",
          "Pełną umową regulującą korzystanie z ManicBot jest Regulamin (/terms). W razie jakiejkolwiek sprzeczności pierwszeństwo ma Regulamin.",
        ],
      },
      {
        title: "7. Zmiany zasad",
        items: [
          "Możemy aktualizować niniejsze zasady; data aktualizacji jest podana u góry strony.",
          "Dalsze korzystanie z serwisu po aktualizacji oznacza akceptację aktualnej wersji zasad.",
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
