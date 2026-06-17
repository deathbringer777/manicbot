"use client";

import { ScrollText } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

interface Section {
  title: string;
  intro?: string;
  items: string[];
}

interface TermsUi {
  kicker: string;
  title: string;
  updated: string;
  lead: string;
  sections: Section[];
}

const UI: Record<Lang, TermsUi> = {
  ru: {
    kicker: "Условия",
    title: "Условия использования",
    updated: "Последнее обновление: июнь 2026",
    lead: "Настоящие Условия регулируют использование платформы ManicBot между Оператором и Пользователем. Начиная пользоваться сервисом, вы принимаете эти Условия. Реквизиты Оператора: [данные оператора будут указаны].",
    sections: [
      {
        title: "1. Определения",
        items: [
          "Оператор (мы) — поставщик платформы ManicBot: [данные оператора].",
          "Сервис / Платформа — программное обеспечение ManicBot: боты, панель администратора, виджеты и связанные функции.",
          "Пользователь (вы) — любое лицо, использующее сервис: бизнес-клиент или конечный клиент.",
          "Бизнес-аккаунт / Владелец — салон или независимый (частный) мастер, который оформляет подписку и ведёт запись через платформу (также — арендатор/tenant).",
          "Мастер — специалист, работающий в рамках бизнес-аккаунта.",
          "Конечный клиент — лицо, которое записывается на услугу через бот салона.",
          "Подписка — платный тариф, дающий доступ к функциям платформы.",
        ],
      },
      {
        title: "2. Сервис и роль Оператора",
        intro:
          "ManicBot предоставляет только программное обеспечение. Мы даём салонам инструменты для онлайн-записи и общения с клиентами; мы не оказываем услуги красоты и не ведём бизнес салона.",
        items: [
          "Мы не являемся стороной отношений между салоном и его клиентами и не выступаем маркетплейсом, агентом или посредником в оказании услуг.",
          "Мы не устанавливаем цены, расписание и политику отмен/неявок/предоплаты — это определяет и за это отвечает каждый салон.",
          "Мы не отвечаем за качество, законность, исполнение или оплату услуг, которые салоны оказывают своим клиентам, а также за споры между ними.",
          "Сервис может зависеть от сторонних платформ (Telegram, Meta / WhatsApp / Instagram, Stripe, Cloudflare, почтовые провайдеры); мы не отвечаем за их доступность, изменения и политику.",
        ],
      },
      {
        title: "3. Заключение соглашения и акцепт",
        items: [
          "Соглашение считается заключённым с момента начала использования сервиса (создания аккаунта или записи через бот).",
          "Используя сервис от имени бизнеса, вы подтверждаете, что уполномочены действовать от его имени.",
          "Если вы не принимаете эти Условия, не пользуйтесь сервисом.",
        ],
      },
      {
        title: "4. Подписка, пробный период, оплата и возвраты",
        items: [
          "Бизнес-аккаунты могут получить пробный период; после него дальнейшее использование требует платной подписки.",
          "Платежи обрабатывает наш платёжный провайдер (Stripe). Подписка продлевается автоматически до её отмены.",
          "Повысить или понизить тариф, поставить подписку на паузу или отменить её можно в приложении; изменения вступают в силу так, как указано в момент изменения.",
          "Уже оплаченные суммы за текущий период по общему правилу не возвращаются, кроме случаев, предусмотренных законом. Мы можем менять цены с предварительным уведомлением; новые цены применяются со следующего расчётного периода.",
        ],
      },
      {
        title: "5. Интеллектуальная собственность",
        items: [
          "Платформа, программное обеспечение, дизайн, товарные знаки и созданный Оператором контент принадлежат Оператору и охраняются законом.",
          "Вы сохраняете права на загружаемый вами контент (например, фото работ, логотипы, тексты) и предоставляете Оператору неисключительную лицензию на его хранение, обработку и отображение в объёме, необходимом для работы сервиса.",
          "Вы подтверждаете, что обладаете правами на любой загружаемый вами контент.",
        ],
      },
      {
        title: "6. Отказ от гарантий и ограничение ответственности",
        intro:
          "Сервис предоставляется «как есть» и «как доступно». В пределах, допустимых применимым правом, ответственность Оператора ограничена так, как указано ниже. Ничто в этих Условиях не ограничивает права, которые принадлежат вам как потребителю по императивным нормам закона.",
        items: [
          "Мы не гарантируем бесперебойную и безошибочную работу сервиса или его пригодность для конкретной цели.",
          "В пределах, допустимых законом, мы не несём ответственности за: упущенные записи, доход, прибыль или данные; сбои и изменения сторонних платформ; неточности AI-ассистента; а также за косвенные, случайные или последующие убытки.",
          "Если ответственность не может быть исключена, она ограничена суммой платежей, внесённых вами за сервис за период, предшествующий событию, повлёкшему претензию.",
          "Вы отвечаете за соблюдение законов, применимых к вашему бизнесу, включая защиту прав потребителей и защиту данных (RODO/GDPR) в отношении ваших собственных клиентов.",
        ],
      },
      {
        title: "7. Приостановка и прекращение",
        items: [
          "Мы можем приостановить или прекратить доступ при нарушении этих Условий, неоплате, злоупотреблении или незаконном использовании — по возможности с предварительным уведомлением.",
          "Вы можете прекратить пользование сервисом и отменить подписку в любой момент в приложении.",
          "После прекращения доступ к платным функциям заканчивается; обращение с данными регулируется Политикой конфиденциальности (/privacy).",
        ],
      },
      {
        title: "8. Изменения Условий",
        items: [
          "Мы можем обновлять эти Условия; дата обновления указывается вверху страницы, а о существенных изменениях мы сообщаем разумным способом.",
          "Продолжение пользования сервисом после обновления означает согласие с действующей версией.",
        ],
      },
      {
        title: "9. Контакты",
        items: [
          "Вопросы по этим Условиям: [контакт оператора] или страница /support.",
        ],
      },
    ],
  },
  ua: {
    kicker: "Умови",
    title: "Умови використання",
    updated: "Останнє оновлення: червень 2026",
    lead: "Ці Умови регулюють використання платформи ManicBot між Оператором і Користувачем. Починаючи користуватися сервісом, ви приймаєте ці Умови. Реквізити Оператора: [дані оператора буде вказано].",
    sections: [
      {
        title: "1. Визначення",
        items: [
          "Оператор (ми) — постачальник платформи ManicBot: [дані оператора].",
          "Сервіс / Платформа — програмне забезпечення ManicBot: боти, панель адміністратора, віджети та повʼязані функції.",
          "Користувач (ви) — будь-яка особа, що використовує сервіс: бізнес-клієнт або кінцевий клієнт.",
          "Бізнес-акаунт / Власник — салон або незалежний (приватний) майстер, який оформлює підписку і веде запис через платформу (також — орендар/tenant).",
          "Майстер — спеціаліст, що працює в межах бізнес-акаунта.",
          "Кінцевий клієнт — особа, яка записується на послугу через бот салону.",
          "Підписка — платний тариф, що дає доступ до функцій платформи.",
        ],
      },
      {
        title: "2. Сервіс і роль Оператора",
        intro:
          "ManicBot надає лише програмне забезпечення. Ми даємо салонам інструменти для онлайн-запису та спілкування з клієнтами; ми не надаємо послуги краси і не ведемо бізнес салону.",
        items: [
          "Ми не є стороною відносин між салоном і його клієнтами і не виступаємо маркетплейсом, агентом чи посередником у наданні послуг.",
          "Ми не встановлюємо ціни, розклад і політику скасувань/неявок/передоплати — це визначає і за це відповідає кожен салон.",
          "Ми не відповідаємо за якість, законність, виконання чи оплату послуг, які салони надають своїм клієнтам, а також за спори між ними.",
          "Сервіс може залежати від сторонніх платформ (Telegram, Meta / WhatsApp / Instagram, Stripe, Cloudflare, поштові провайдери); ми не відповідаємо за їхню доступність, зміни та політику.",
        ],
      },
      {
        title: "3. Укладення угоди та акцепт",
        items: [
          "Угода вважається укладеною з моменту початку використання сервісу (створення акаунта або запису через бот).",
          "Використовуючи сервіс від імені бізнесу, ви підтверджуєте, що уповноважені діяти від його імені.",
          "Якщо ви не приймаєте ці Умови, не користуйтеся сервісом.",
        ],
      },
      {
        title: "4. Підписка, пробний період, оплата та повернення",
        items: [
          "Бізнес-акаунти можуть отримати пробний період; після нього подальше використання потребує платної підписки.",
          "Платежі обробляє наш платіжний провайдер (Stripe). Підписка продовжується автоматично до її скасування.",
          "Підвищити або знизити тариф, поставити підписку на паузу чи скасувати її можна в застосунку; зміни набувають чинності так, як зазначено в момент зміни.",
          "Уже сплачені суми за поточний період за загальним правилом не повертаються, окрім випадків, передбачених законом. Ми можемо змінювати ціни з попереднім повідомленням; нові ціни застосовуються з наступного розрахункового періоду.",
        ],
      },
      {
        title: "5. Інтелектуальна власність",
        items: [
          "Платформа, програмне забезпечення, дизайн, торговельні марки та створений Оператором контент належать Оператору і охороняються законом.",
          "Ви зберігаєте права на завантажуваний вами контент (наприклад, фото робіт, логотипи, тексти) і надаєте Оператору невиключну ліцензію на його зберігання, обробку та відображення в обсязі, необхідному для роботи сервісу.",
          "Ви підтверджуєте, що володієте правами на будь-який завантажуваний вами контент.",
        ],
      },
      {
        title: "6. Відмова від гарантій та обмеження відповідальності",
        intro:
          "Сервіс надається «як є» і «як доступно». У межах, дозволених застосовним правом, відповідальність Оператора обмежена так, як зазначено нижче. Ніщо в цих Умовах не обмежує прав, які належать вам як споживачу за імперативними нормами закону.",
        items: [
          "Ми не гарантуємо безперебійну та безпомилкову роботу сервісу або його придатність для конкретної мети.",
          "У межах, дозволених законом, ми не несемо відповідальності за: втрачені записи, дохід, прибуток або дані; збої та зміни сторонніх платформ; неточності AI-асистента; а також за непрямі, випадкові чи подальші збитки.",
          "Якщо відповідальність не може бути виключена, вона обмежена сумою платежів, внесених вами за сервіс за період, що передував події, яка спричинила претензію.",
          "Ви відповідаєте за дотримання законів, застосовних до вашого бізнесу, включно із захистом прав споживачів і захистом даних (RODO/GDPR) щодо ваших власних клієнтів.",
        ],
      },
      {
        title: "7. Призупинення та припинення",
        items: [
          "Ми можемо призупинити або припинити доступ у разі порушення цих Умов, несплати, зловживання чи незаконного використання — за можливості з попереднім повідомленням.",
          "Ви можете припинити користування сервісом і скасувати підписку будь-коли в застосунку.",
          "Після припинення доступ до платних функцій завершується; поводження з даними регулюється Політикою конфіденційності (/privacy).",
        ],
      },
      {
        title: "8. Зміни Умов",
        items: [
          "Ми можемо оновлювати ці Умови; дата оновлення зазначається вгорі сторінки, а про істотні зміни ми повідомляємо розумним способом.",
          "Продовження користування сервісом після оновлення означає згоду з чинною версією.",
        ],
      },
      {
        title: "9. Контакти",
        items: [
          "Питання щодо цих Умов: [контакт оператора] або сторінка /support.",
        ],
      },
    ],
  },
  en: {
    kicker: "Terms",
    title: "Terms of Service",
    updated: "Last updated: June 2026",
    lead: "These Terms of Service govern the use of the ManicBot platform between the Operator and the User. By using the service you accept these Terms. Operator details: [operator details to be specified].",
    sections: [
      {
        title: "1. Definitions",
        items: [
          "Operator (we) — the provider of the ManicBot platform: [operator details].",
          "Service / Platform — the ManicBot software: bots, admin panel, widgets and related features.",
          "User (you) — any person using the service: a business customer or an end client.",
          "Business account / Owner — a salon or independent (personal) master who subscribes and runs booking through the platform (also referred to as a tenant).",
          "Master — a specialist working within a business account.",
          "End client — a person who books a service through a salon's bot.",
          "Subscription — a paid plan giving access to the platform's features.",
        ],
      },
      {
        title: "2. The service and the Operator's role",
        intro:
          "ManicBot provides software only. We give salons tools for online booking and client communication; we do not provide beauty services and do not run any salon's business.",
        items: [
          "We are not a party to the relationship between a salon and its clients and are not a marketplace, agent or intermediary for the provision of services.",
          "We do not set prices, schedules, or cancellation/no-show/prepayment policies — each salon sets and is responsible for these.",
          "We are not responsible for the quality, legality, performance or payment of services that salons provide to their clients, nor for disputes between them.",
          "The service may rely on third-party platforms (Telegram, Meta / WhatsApp / Instagram, Stripe, Cloudflare, email providers); we are not responsible for their availability, changes or policies.",
        ],
      },
      {
        title: "3. Conclusion of the agreement and acceptance",
        items: [
          "The agreement is concluded when you start using the service (creating an account or booking through a bot).",
          "If you use the service on behalf of a business, you confirm that you are authorised to bind that business.",
          "If you do not accept these Terms, do not use the service.",
        ],
      },
      {
        title: "4. Subscription, trial, payment and refunds",
        items: [
          "Business accounts may receive a trial period; after it, continued use requires a paid subscription.",
          "Payments are processed by our payment provider (Stripe). Subscriptions renew automatically until cancelled.",
          "You can upgrade, downgrade, pause or cancel your subscription in the app; changes take effect as described at the time of the change.",
          "Fees already paid for the current period are generally non-refundable except where required by law. We may change prices with prior notice; new prices apply from the next billing period.",
        ],
      },
      {
        title: "5. Intellectual property",
        items: [
          "The platform, software, design, trademarks and content created by the Operator are owned by the Operator and protected by law.",
          "You keep ownership of content you upload (e.g. work photos, logos, texts) and grant the Operator a non-exclusive licence to host, process and display it as needed to run the service.",
          "You confirm that you have the rights to any content you upload.",
        ],
      },
      {
        title: "6. Disclaimer of warranties and limitation of liability",
        intro:
          "The service is provided \"as is\" and \"as available\". To the extent permitted by applicable law, the Operator's liability is limited as set out below. Nothing in these Terms limits the rights you have as a consumer under mandatory law.",
        items: [
          "We do not guarantee that the service will be uninterrupted, error-free, or fit for any particular purpose.",
          "To the extent permitted by law, we are not liable for: lost bookings, revenue, profit or data; outages or changes of third-party platforms; inaccuracies of the AI assistant; or indirect, incidental or consequential damages.",
          "Where liability cannot be excluded, it is limited to the total fees you paid for the service in the period preceding the event giving rise to the claim.",
          "You are responsible for complying with the laws applicable to your business, including consumer-protection and data-protection (RODO/GDPR) obligations toward your own clients.",
        ],
      },
      {
        title: "7. Suspension and termination",
        items: [
          "We may suspend or terminate access for breach of these Terms, non-payment, abuse, or unlawful use — where possible with prior notice.",
          "You may stop using the service and cancel your subscription at any time in the app.",
          "On termination, access to paid features ends; the handling of data is governed by the Privacy Policy (/privacy).",
        ],
      },
      {
        title: "8. Changes to the Terms",
        items: [
          "We may update these Terms; the update date is shown at the top of the page, and material changes are communicated in a reasonable manner.",
          "Continued use of the service after an update means you accept the current version.",
        ],
      },
      {
        title: "9. Contact",
        items: [
          "Questions about these Terms: [operator contact] or the /support page.",
        ],
      },
    ],
  },
  pl: {
    kicker: "Regulamin",
    title: "Regulamin",
    updated: "Ostatnia aktualizacja: czerwiec 2026",
    lead: "Niniejszy Regulamin reguluje korzystanie z platformy ManicBot pomiędzy Operatorem a Użytkownikiem. Korzystając z serwisu, akceptujesz Regulamin. Dane Operatora: [dane operatora zostaną wskazane].",
    sections: [
      {
        title: "1. Definicje",
        items: [
          "Operator (my) — dostawca platformy ManicBot: [dane operatora].",
          "Serwis / Platforma — oprogramowanie ManicBot: boty, panel administracyjny, widżety i powiązane funkcje.",
          "Użytkownik (Ty) — każda osoba korzystająca z serwisu: klient biznesowy lub klient końcowy.",
          "Konto biznesowe / Właściciel — salon lub niezależny (osobisty) mistrz, który wykupuje subskrypcję i prowadzi rezerwacje przez platformę (zwany też najemcą/tenant).",
          "Mistrz — specjalista pracujący w ramach konta biznesowego.",
          "Klient końcowy — osoba, która rezerwuje usługę przez bota salonu.",
          "Subskrypcja — płatny plan dający dostęp do funkcji platformy.",
        ],
      },
      {
        title: "2. Serwis i rola Operatora",
        intro:
          "ManicBot udostępnia wyłącznie oprogramowanie. Dajemy salonom narzędzia do rezerwacji online i komunikacji z klientami; nie świadczymy usług kosmetycznych i nie prowadzimy działalności żadnego salonu.",
        items: [
          "Nie jesteśmy stroną relacji między salonem a jego klientami i nie działamy jako marketplace, agent ani pośrednik w świadczeniu usług.",
          "Nie ustalamy cen, grafiku ani polityki anulowania/nieobecności/przedpłat — ustala je i odpowiada za nie każdy salon.",
          "Nie odpowiadamy za jakość, legalność, wykonanie ani płatność usług, które salony świadczą swoim klientom, ani za spory między nimi.",
          "Serwis może korzystać z platform zewnętrznych (Telegram, Meta / WhatsApp / Instagram, Stripe, Cloudflare, dostawcy poczty); nie odpowiadamy za ich dostępność, zmiany ani polityki.",
        ],
      },
      {
        title: "3. Zawarcie umowy i akceptacja",
        items: [
          "Umowa zostaje zawarta z chwilą rozpoczęcia korzystania z serwisu (utworzenia konta lub rezerwacji przez bota).",
          "Korzystając z serwisu w imieniu firmy, potwierdzasz, że jesteś upoważniony do działania w jej imieniu.",
          "Jeśli nie akceptujesz Regulaminu, nie korzystaj z serwisu.",
        ],
      },
      {
        title: "4. Subskrypcja, okres próbny, płatności i zwroty",
        items: [
          "Konta biznesowe mogą otrzymać okres próbny; po nim dalsze korzystanie wymaga płatnej subskrypcji.",
          "Płatności obsługuje nasz dostawca płatności (Stripe). Subskrypcja odnawia się automatycznie do czasu jej anulowania.",
          "Plan można podwyższyć, obniżyć, wstrzymać lub anulować w aplikacji; zmiany wchodzą w życie zgodnie z informacją podaną w chwili zmiany.",
          "Opłaty już wniesione za bieżący okres co do zasady nie podlegają zwrotowi, z wyjątkiem przypadków wymaganych przez prawo. Możemy zmieniać ceny z wcześniejszym powiadomieniem; nowe ceny obowiązują od kolejnego okresu rozliczeniowego.",
        ],
      },
      {
        title: "5. Własność intelektualna",
        items: [
          "Platforma, oprogramowanie, projekt, znaki towarowe i treści stworzone przez Operatora należą do Operatora i są chronione prawem.",
          "Zachowujesz prawa do przesyłanych przez siebie treści (np. zdjęć prac, logotypów, tekstów) i udzielasz Operatorowi niewyłącznej licencji na ich przechowywanie, przetwarzanie i wyświetlanie w zakresie niezbędnym do działania serwisu.",
          "Potwierdzasz, że posiadasz prawa do wszelkich przesyłanych przez siebie treści.",
        ],
      },
      {
        title: "6. Wyłączenie gwarancji i ograniczenie odpowiedzialności",
        intro:
          "Serwis jest udostępniany „tak jak jest” i „w miarę dostępności”. W zakresie dozwolonym przez obowiązujące prawo odpowiedzialność Operatora jest ograniczona w sposób opisany poniżej. Żadne z postanowień Regulaminu nie ogranicza praw przysługujących Ci jako konsumentowi na mocy bezwzględnie obowiązujących przepisów.",
        items: [
          "Nie gwarantujemy nieprzerwanego i bezbłędnego działania serwisu ani jego przydatności do określonego celu.",
          "W zakresie dozwolonym przez prawo nie odpowiadamy za: utracone rezerwacje, przychód, zysk lub dane; awarie i zmiany platform zewnętrznych; nieścisłości asystenta AI; ani za szkody pośrednie, przypadkowe lub następcze.",
          "Tam, gdzie odpowiedzialności nie można wyłączyć, jest ona ograniczona do sumy opłat wniesionych przez Ciebie za serwis w okresie poprzedzającym zdarzenie będące podstawą roszczenia.",
          "Odpowiadasz za przestrzeganie przepisów dotyczących Twojej działalności, w tym ochrony konsumentów i ochrony danych (RODO/GDPR) wobec własnych klientów.",
        ],
      },
      {
        title: "7. Zawieszenie i zakończenie",
        items: [
          "Możemy zawiesić lub zakończyć dostęp w razie naruszenia Regulaminu, braku płatności, nadużyć lub niezgodnego z prawem korzystania — w miarę możliwości z wcześniejszym powiadomieniem.",
          "Możesz w dowolnym momencie zaprzestać korzystania z serwisu i anulować subskrypcję w aplikacji.",
          "Po zakończeniu dostęp do funkcji płatnych wygasa; postępowanie z danymi reguluje Polityka prywatności (/privacy).",
        ],
      },
      {
        title: "8. Zmiany Regulaminu",
        items: [
          "Możemy aktualizować Regulamin; data aktualizacji jest podana u góry strony, a o istotnych zmianach informujemy w rozsądny sposób.",
          "Dalsze korzystanie z serwisu po aktualizacji oznacza akceptację aktualnej wersji.",
        ],
      },
      {
        title: "9. Kontakt",
        items: [
          "Pytania dotyczące Regulaminu: [kontakt operatora] lub strona /support.",
        ],
      },
    ],
  },
};

export function TermsClient() {
  const { lang } = useLang();
  const ui = UI[lang];

  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <ScrollText className="h-3.5 w-3.5" />
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
