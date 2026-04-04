import { Header } from "@/components/Header";
import { useLanguage, type Locale } from "@/i18n";

interface LegalContent {
  title: string;
  lastUpdated: string;
  sections: { heading: string; body: string }[];
}

type PageKey = "privacy" | "terms" | "cookies" | "support" | "rules";

const CONTENT: Record<Locale, Record<PageKey, LegalContent>> = {
  ru: {
    privacy: {
      title: "Политика конфиденциальности",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Общие положения",
          body: `Настоящая политика конфиденциальности (далее — «Политика») определяет порядок сбора, хранения и использования персональных данных пользователей платформы ManicBot (далее — «Сервис»).\n\nОператор сервиса: __________________ (далее — «Оператор»).\n\nИспользуя Сервис, вы соглашаетесь с условиями настоящей Политики.`,
        },
        {
          heading: "2. Какие данные мы собираем",
          body: `Сервис может собирать следующие данные:\n\n• Имя и контактные данные (email, номер телефона) — при регистрации;\n• Telegram ID — для взаимодействия через мессенджер;\n• Информация об устройстве и браузере (технические данные);\n• Данные о действиях в Сервисе (история записей, сообщения боту);\n• Платёжные данные — обрабатываются платёжным провайдером, мы их не храним.`,
        },
        {
          heading: "3. Цели обработки данных",
          body: `Ваши данные используются исключительно для:\n\n• Предоставления услуг бронирования через Telegram-бота;\n• Уведомления о записях и изменениях расписания;\n• Улучшения качества Сервиса;\n• Выставления счетов и обработки платежей;\n• Выполнения требований законодательства.`,
        },
        {
          heading: "4. Хранение и защита данных",
          body: `Данные хранятся на защищённых серверах Cloudflare. Мы применяем шифрование, контроль доступа и регулярный аудит безопасности. Период хранения — в течение действия договора + 3 года после его окончания, если иное не предусмотрено законодательством.`,
        },
        {
          heading: "5. Передача данных третьим лицам",
          body: `Мы не продаём и не передаём ваши данные третьим лицам без вашего согласия, за исключением:\n\n• Платёжных систем (Stripe) — только для обработки оплаты;\n• Облачной инфраструктуры (Cloudflare) — для хранения и работы Сервиса;\n• Государственных органов — по требованию закона.`,
        },
        {
          heading: "6. Ваши права",
          body: `Вы имеете право:\n\n• Запросить доступ к своим данным;\n• Потребовать исправления или удаления данных;\n• Отозвать согласие на обработку;\n• Подать жалобу в надзорный орган.\n\nДля реализации прав обратитесь: support@manicbot.com`,
        },
        {
          heading: "7. Cookies",
          body: `Сервис использует файлы cookie для обеспечения работоспособности и аналитики. Подробнее — в Политике cookie.`,
        },
        {
          heading: "8. Изменения Политики",
          body: `Мы можем изменять настоящую Политику. При существенных изменениях мы уведомим пользователей через Сервис или email. Продолжение использования Сервиса после уведомления означает согласие с изменениями.`,
        },
      ],
    },

    terms: {
      title: "Условия использования",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Предмет соглашения",
          body: `Настоящие Условия использования (далее — «Условия») регулируют отношения между __________________ (далее — «Оператор») и пользователем платформы ManicBot (далее — «Пользователь»).\n\nИспользуя Сервис, Пользователь принимает Условия в полном объёме.`,
        },
        {
          heading: "2. Описание Сервиса",
          body: `ManicBot — платформа для автоматизации онлайн-записи в салоны красоты через Telegram, Instagram и WhatsApp. Сервис предоставляет инструменты для управления расписанием, клиентской базой и коммуникациями.`,
        },
        {
          heading: "3. Регистрация и аккаунт",
          body: `• Для использования Сервиса необходима регистрация;\n• Пользователь несёт ответственность за сохранность учётных данных;\n• Запрещается создавать несколько аккаунтов для обхода ограничений;\n• Оператор вправе заблокировать аккаунт при нарушении Условий.`,
        },
        {
          heading: "4. Тарифы и оплата",
          body: `• Сервис предоставляется по подписке согласно выбранному тарифу;\n• Оплата списывается ежемесячно;\n• При неоплате в течение 3 дней аккаунт переходит в режим ограниченного доступа;\n• Возврат средств возможен в течение 14 дней с первой оплаты при наличии технических причин.`,
        },
        {
          heading: "5. Запрещённые действия",
          body: `Запрещено:\n\n• Использовать Сервис в противозаконных целях;\n• Рассылать спам через инструменты Сервиса;\n• Передавать доступ третьим лицам без разрешения Оператора;\n• Проводить реверс-инжиниринг или взлом Сервиса;\n• Нарушать права третьих лиц.`,
        },
        {
          heading: "6. Ответственность",
          body: `Сервис предоставляется «как есть». Оператор не гарантирует бесперебойную работу и не несёт ответственности за косвенные убытки. Максимальная ответственность Оператора ограничена суммой, уплаченной Пользователем за последний месяц подписки.`,
        },
        {
          heading: "7. Интеллектуальная собственность",
          body: `Все права на Сервис, его компоненты и контент принадлежат Оператору. Пользователь получает ограниченную, неисключительную лицензию на использование Сервиса.`,
        },
        {
          heading: "8. Прекращение использования",
          body: `Пользователь вправе в любой момент отказаться от Сервиса. При отказе данные хранятся 90 дней, после чего удаляются. Оператор вправе прекратить предоставление Сервиса с уведомлением за 30 дней.`,
        },
        {
          heading: "9. Применимое право",
          body: `Условия регулируются законодательством __________________. Споры разрешаются в судебном порядке по месту нахождения Оператора.`,
        },
      ],
    },

    cookies: {
      title: "Политика Cookie",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Что такое cookie",
          body: `Cookie — небольшие текстовые файлы, сохраняемые браузером при посещении сайта. Они помогают сайту запоминать ваши предпочтения и работать корректно.`,
        },
        {
          heading: "Какие cookie мы используем",
          body: `Необходимые cookie:\n• Сессионный токен авторизации — для сохранения входа в систему;\n• Выбранный язык интерфейса;\n• Выбранная тема (светлая / тёмная).\n\nАналитические cookie:\n• Анонимизированная статистика посещаемости (при наличии).\n\nМы не используем рекламные или маркетинговые cookie.`,
        },
        {
          heading: "Как управлять cookie",
          body: `Вы можете отключить cookie в настройках браузера. Обратите внимание: отключение необходимых cookie может привести к неработоспособности некоторых функций Сервиса.`,
        },
        {
          heading: "Срок хранения",
          body: `• Сессионные cookie удаляются при закрытии браузера;\n• Постоянные cookie (тема, язык) хранятся до 12 месяцев или до удаления вручную.`,
        },
      ],
    },

    support: {
      title: "Поддержка",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Как с нами связаться",
          body: `Мы готовы помочь. Выберите удобный способ:\n\n• Email: support@manicbot.com\n• Telegram: @manicbot_support\n• Форма обратной связи: доступна в личном кабинете`,
        },
        {
          heading: "Время работы поддержки",
          body: `Поддержка доступна в рабочие часы:\n\nПн–Пт: 9:00 – 18:00 (UTC+3)\n\nВ выходные и праздничные дни отвечаем в порядке очереди в первый рабочий день.`,
        },
        {
          heading: "Технические вопросы",
          body: `При обращении по техническим вопросам, пожалуйста, укажите:\n\n• Ваш email или Telegram;\n• Описание проблемы;\n• Скриншот или запись экрана (если возможно);\n• Шаги, которые привели к ошибке.\n\nЭто поможет нам ответить быстрее.`,
        },
        {
          heading: "База знаний",
          body: `Ответы на частые вопросы:\n\n• Как подключить бота к моему Telegram-каналу?\n• Как настроить расписание мастеров?\n• Как подключить Google Calendar?\n• Как изменить тариф?\n\nОтветы доступны в личном кабинете → раздел «Помощь».`,
        },
        {
          heading: "Сообщить об ошибке",
          body: `Если вы нашли ошибку или уязвимость, напишите нам на security@manicbot.com. Мы ценим ответственное раскрытие информации.`,
        },
      ],
    },

    rules: {
      title: "Правила платформы",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Что можно делать",
          body: `• Создавать и управлять расписанием мастеров в рамках тарифного лимита;\n• Принимать записи клиентов через Telegram, Instagram и WhatsApp;\n• Использовать AI-помощника (тариф Pro и выше) для общения с клиентами;\n• Синхронизировать расписание с Google Calendar (тариф Pro и выше);\n• Подключать несколько мессенджеров к одному салону;\n• Передавать тикеты в службу поддержки платформы.`,
        },
        {
          heading: "Лимиты по тарифам",
          body: `Start: 1 мастер, базовая запись.\nPro: до 5 мастеров, AI-ассистент, Google Calendar, WhatsApp, Instagram.\nStudio: неограниченное число мастеров, все функции.\n\nПри превышении лимита мастеров платформа заблокирует добавление новых мастеров. Тариф необходимо повысить.`,
        },
        {
          heading: "Что запрещено",
          body: `• Создавать несколько аккаунтов для обхода тарифных ограничений;\n• Рассылать спам через бота — массовые сообщения без согласия получателей;\n• Передавать учётные данные или API-токены третьим лицам;\n• Использовать Сервис в незаконных целях или для продажи запрещённых товаров;\n• Проводить автоматизированные атаки или сканирование платформы;\n• Пытаться получить несанкционированный доступ к данным других арендаторов.`,
        },
        {
          heading: "Доступ и биллинг",
          body: `При просрочке оплаты аккаунт переходит в льготный период (7 дней): клиентам доступна только базовая запись, функции персонала (AI, панель управления, Google Calendar) отключаются.\n\nПо истечении льготного периода аккаунт переходит в статус expired: бот перестаёт принимать команды персонала. Данные не удаляются — восстановление доступа возможно после оплаты.`,
        },
        {
          heading: "Роли и права",
          body: `Клиент: запись через бота, просмотр каталога услуг. Доступ к панели управления закрыт.\nМастер: просмотр своего расписания, клиентов и заработка через мини-приложение.\nВладелец салона (tenant_owner): полное управление салоном — мастера, услуги, расписание, биллинг.\nПоддержка платформы: помощь с техническими вопросами и тикетами.\nСистемный администратор: полный доступ ко всем данным платформы.`,
        },
        {
          heading: "Ответственность за нарушения",
          body: `При нарушении правил Оператор вправе:\n\n• Временно ограничить или заблокировать аккаунт;\n• Удалить контент, нарушающий правила;\n• Расторгнуть договор без возврата оплаченного периода при грубых нарушениях.\n\nОб обнаруженных уязвимостях сообщайте на security@manicbot.com.`,
        },
      ],
    },
  },

  en: {
    privacy: {
      title: "Privacy Policy",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. General",
          body: `This Privacy Policy (hereinafter — «Policy») defines how ManicBot (hereinafter — «Service») collects, stores, and uses personal data of its users.\n\nService operator: __________________ (hereinafter — «Operator»).\n\nBy using the Service, you agree to this Policy.`,
        },
        {
          heading: "2. Data we collect",
          body: `The Service may collect:\n\n• Name and contact details (email, phone number) — at registration;\n• Telegram ID — for messenger interaction;\n• Device and browser information (technical data);\n• Activity data (booking history, messages to the bot);\n• Payment data — processed by the payment provider; we do not store it.`,
        },
        {
          heading: "3. Purpose of processing",
          body: `Your data is used exclusively to:\n\n• Provide booking services via Telegram bot;\n• Send notifications about appointments and schedule changes;\n• Improve the quality of the Service;\n• Issue invoices and process payments;\n• Comply with legal requirements.`,
        },
        {
          heading: "4. Storage and security",
          body: `Data is stored on Cloudflare's secure servers. We apply encryption, access controls, and regular security audits. Retention period: duration of the contract + 3 years after termination, unless otherwise required by law.`,
        },
        {
          heading: "5. Sharing with third parties",
          body: `We do not sell or share your data with third parties without consent, except:\n\n• Payment systems (Stripe) — for payment processing only;\n• Cloud infrastructure (Cloudflare) — for hosting the Service;\n• Government authorities — as required by law.`,
        },
        {
          heading: "6. Your rights",
          body: `You have the right to:\n\n• Request access to your data;\n• Request correction or deletion of your data;\n• Withdraw consent for processing;\n• File a complaint with a supervisory authority.\n\nTo exercise your rights, contact: support@manicbot.com`,
        },
        {
          heading: "7. Cookies",
          body: `The Service uses cookies to ensure functionality and analytics. See the Cookie Policy for details.`,
        },
        {
          heading: "8. Policy changes",
          body: `We may update this Policy. For significant changes, we will notify users via the Service or email. Continued use after notification constitutes acceptance of the changes.`,
        },
      ],
    },

    terms: {
      title: "Terms of Service",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Subject of agreement",
          body: `These Terms of Service (hereinafter — «Terms») govern the relationship between __________________ (hereinafter — «Operator») and the user of the ManicBot platform (hereinafter — «User»).\n\nBy using the Service, the User accepts the Terms in full.`,
        },
        {
          heading: "2. Service description",
          body: `ManicBot is a platform for automating online booking in beauty salons via Telegram, Instagram, and WhatsApp. The Service provides tools for managing schedules, client bases, and communications.`,
        },
        {
          heading: "3. Registration and account",
          body: `• Registration is required to use the Service;\n• The User is responsible for the security of their credentials;\n• Creating multiple accounts to bypass restrictions is prohibited;\n• The Operator may block an account for violation of the Terms.`,
        },
        {
          heading: "4. Pricing and payment",
          body: `• The Service is provided by subscription according to the selected plan;\n• Payment is charged monthly;\n• In case of non-payment within 3 days, the account enters restricted access mode;\n• Refunds are available within 14 days of the first payment for technical reasons.`,
        },
        {
          heading: "5. Prohibited actions",
          body: `Prohibited:\n\n• Using the Service for illegal purposes;\n• Sending spam through the Service's tools;\n• Sharing access with third parties without the Operator's permission;\n• Reverse engineering or hacking the Service;\n• Violating third-party rights.`,
        },
        {
          heading: "6. Liability",
          body: `The Service is provided «as is». The Operator does not guarantee uninterrupted operation and is not liable for indirect damages. Maximum liability is limited to the amount paid by the User for the last month of subscription.`,
        },
        {
          heading: "7. Intellectual property",
          body: `All rights to the Service, its components, and content belong to the Operator. The User receives a limited, non-exclusive license to use the Service.`,
        },
        {
          heading: "8. Termination",
          body: `The User may cancel the Service at any time. Upon cancellation, data is stored for 90 days and then deleted. The Operator may terminate the Service with 30 days' notice.`,
        },
        {
          heading: "9. Governing law",
          body: `The Terms are governed by the laws of __________________. Disputes are resolved in court at the location of the Operator.`,
        },
      ],
    },

    cookies: {
      title: "Cookie Policy",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "What are cookies",
          body: `Cookies are small text files stored by your browser when you visit a website. They help the site remember your preferences and work correctly.`,
        },
        {
          heading: "Cookies we use",
          body: `Necessary cookies:\n• Authentication session token — to keep you logged in;\n• Selected interface language;\n• Selected theme (light / dark).\n\nAnalytical cookies:\n• Anonymized visit statistics (if enabled).\n\nWe do not use advertising or marketing cookies.`,
        },
        {
          heading: "Managing cookies",
          body: `You can disable cookies in your browser settings. Note: disabling necessary cookies may cause some features of the Service to stop working.`,
        },
        {
          heading: "Retention",
          body: `• Session cookies are deleted when the browser is closed;\n• Persistent cookies (theme, language) are stored for up to 12 months or until manually deleted.`,
        },
      ],
    },

    support: {
      title: "Support",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "How to contact us",
          body: `We are ready to help. Choose a convenient method:\n\n• Email: support@manicbot.com\n• Telegram: @manicbot_support\n• Feedback form: available in your dashboard`,
        },
        {
          heading: "Support hours",
          body: `Support is available during business hours:\n\nMon–Fri: 9:00 – 18:00 (UTC+3)\n\nOn weekends and holidays, we respond in order on the next business day.`,
        },
        {
          heading: "Technical issues",
          body: `When contacting us for technical issues, please provide:\n\n• Your email or Telegram;\n• Description of the problem;\n• A screenshot or screen recording (if possible);\n• Steps that led to the error.\n\nThis will help us respond faster.`,
        },
        {
          heading: "Knowledge base",
          body: `Answers to common questions:\n\n• How to connect the bot to my Telegram channel?\n• How to set up the masters' schedule?\n• How to connect Google Calendar?\n• How to change my plan?\n\nAnswers are available in your dashboard → «Help» section.`,
        },
        {
          heading: "Report a bug",
          body: `If you find a bug or vulnerability, write to security@manicbot.com. We value responsible disclosure.`,
        },
      ],
    },

    rules: {
      title: "Platform Rules",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "What you can do",
          body: `• Create and manage master schedules within your plan's limits;\n• Accept client bookings via Telegram, Instagram, and WhatsApp;\n• Use the AI assistant (Pro plan and above) to communicate with clients;\n• Sync schedules with Google Calendar (Pro plan and above);\n• Connect multiple messengers to one salon;\n• Submit support tickets to the platform.`,
        },
        {
          heading: "Plan limits",
          body: `Start: 1 master, basic booking.\nPro: up to 5 masters, AI assistant, Google Calendar, WhatsApp, Instagram.\nStudio: unlimited masters, all features.\n\nIf the master limit is exceeded, the platform will block adding new masters. The plan must be upgraded.`,
        },
        {
          heading: "What is prohibited",
          body: `• Creating multiple accounts to bypass plan restrictions;\n• Sending spam through the bot — mass messages without recipient consent;\n• Sharing credentials or API tokens with third parties;\n• Using the Service for illegal purposes or selling prohibited goods;\n• Conducting automated attacks or scanning the platform;\n• Attempting unauthorized access to other tenants' data.`,
        },
        {
          heading: "Access and billing",
          body: `Upon overdue payment, the account enters a grace period (7 days): clients can only make basic bookings; staff features (AI, admin panel, Google Calendar) are disabled.\n\nAfter the grace period, the account enters expired status: the bot stops accepting staff commands. Data is not deleted — access can be restored after payment.`,
        },
        {
          heading: "Roles and permissions",
          body: `Client: booking via bot, viewing the service catalog. Admin panel is closed.\nMaster: viewing own schedule, clients, and earnings in the mini-app.\nSalon owner (tenant_owner): full salon management — masters, services, schedule, billing.\nPlatform support: help with technical issues and tickets.\nSystem administrator: full access to all platform data.`,
        },
        {
          heading: "Responsibility for violations",
          body: `Upon violation of the rules, the Operator may:\n\n• Temporarily restrict or block the account;\n• Remove content that violates the rules;\n• Terminate the contract without refund for serious violations.\n\nReport discovered vulnerabilities to security@manicbot.com.`,
        },
      ],
    },
  },

  ua: {
    privacy: {
      title: "Політика конфіденційності",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Загальні положення",
          body: `Ця політика конфіденційності (далі — «Політика») визначає порядок збору, зберігання та використання персональних даних користувачів платформи ManicBot (далі — «Сервіс»).\n\nОператор сервісу: __________________ (далі — «Оператор»).\n\nВикористовуючи Сервіс, ви погоджуєтесь з умовами цієї Політики.`,
        },
        {
          heading: "2. Які дані ми збираємо",
          body: `Сервіс може збирати такі дані:\n\n• Ім'я та контактні дані (email, номер телефону) — при реєстрації;\n• Telegram ID — для взаємодії через месенджер;\n• Інформація про пристрій і браузер (технічні дані);\n• Дані про дії в Сервісі (історія записів, повідомлення боту);\n• Платіжні дані — обробляються платіжним провайдером, ми їх не зберігаємо.`,
        },
        {
          heading: "3. Мета обробки даних",
          body: `Ваші дані використовуються виключно для:\n\n• Надання послуг бронювання через Telegram-бота;\n• Повідомлень про записи та зміни розкладу;\n• Покращення якості Сервісу;\n• Виставлення рахунків та обробки платежів;\n• Виконання вимог законодавства.`,
        },
        {
          heading: "4. Зберігання та захист даних",
          body: `Дані зберігаються на захищених серверах Cloudflare. Ми застосовуємо шифрування, контроль доступу та регулярний аудит безпеки. Термін зберігання — протягом дії договору + 3 роки після його закінчення.`,
        },
        {
          heading: "5. Передача даних третім особам",
          body: `Ми не продаємо і не передаємо ваші дані третім особам без вашої згоди, крім:\n\n• Платіжних систем (Stripe) — лише для обробки оплати;\n• Хмарної інфраструктури (Cloudflare) — для роботи Сервісу;\n• Державних органів — за вимогою закону.`,
        },
        {
          heading: "6. Ваші права",
          body: `Ви маєте право:\n\n• Запросити доступ до своїх даних;\n• Вимагати виправлення або видалення даних;\n• Відкликати згоду на обробку;\n• Подати скаргу до наглядового органу.\n\nДля реалізації прав звертайтесь: support@manicbot.com`,
        },
        {
          heading: "7. Cookies",
          body: `Сервіс використовує файли cookie для забезпечення роботи та аналітики. Детальніше — в Політиці cookie.`,
        },
        {
          heading: "8. Зміни Політики",
          body: `Ми можемо змінювати цю Політику. При суттєвих змінах повідомимо користувачів через Сервіс або email. Продовження використання Сервісу після повідомлення означає згоду зі змінами.`,
        },
      ],
    },

    terms: {
      title: "Умови використання",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Предмет угоди",
          body: `Ці Умови використання (далі — «Умови») регулюють відносини між __________________ (далі — «Оператор») та користувачем платформи ManicBot (далі — «Користувач»).\n\nВикористовуючи Сервіс, Користувач приймає Умови в повному обсязі.`,
        },
        {
          heading: "2. Опис Сервісу",
          body: `ManicBot — платформа для автоматизації онлайн-запису в салони краси через Telegram, Instagram та WhatsApp. Сервіс надає інструменти для управління розкладом, клієнтською базою та комунікаціями.`,
        },
        {
          heading: "3. Реєстрація та обліковий запис",
          body: `• Для використання Сервісу необхідна реєстрація;\n• Користувач несе відповідальність за збереження облікових даних;\n• Заборонено створювати кілька облікових записів для обходу обмежень;\n• Оператор вправі заблокувати обліковий запис при порушенні Умов.`,
        },
        {
          heading: "4. Тарифи та оплата",
          body: `• Сервіс надається за підпискою згідно з обраним тарифом;\n• Оплата списується щомісяця;\n• При несплаті протягом 3 днів обліковий запис переходить в режим обмеженого доступу;\n• Повернення коштів можливе протягом 14 днів з першої оплати при технічних причинах.`,
        },
        {
          heading: "5. Заборонені дії",
          body: `Заборонено:\n\n• Використовувати Сервіс у протизаконних цілях;\n• Розсилати спам через інструменти Сервісу;\n• Передавати доступ третім особам без дозволу Оператора;\n• Проводити реверс-інжиніринг або злом Сервісу;\n• Порушувати права третіх осіб.`,
        },
        {
          heading: "6. Відповідальність",
          body: `Сервіс надається «як є». Оператор не гарантує безперебійну роботу та не несе відповідальності за непрямі збитки. Максимальна відповідальність обмежена сумою, сплаченою за останній місяць підписки.`,
        },
        {
          heading: "7. Інтелектуальна власність",
          body: `Всі права на Сервіс, його компоненти та контент належать Оператору. Користувач отримує обмежену, невиключну ліцензію на використання Сервісу.`,
        },
        {
          heading: "8. Припинення використання",
          body: `Користувач вправі у будь-який момент відмовитися від Сервісу. При відмові дані зберігаються 90 днів, після чого видаляються. Оператор вправі припинити надання Сервісу з повідомленням за 30 днів.`,
        },
        {
          heading: "9. Застосовне право",
          body: `Умови регулюються законодавством __________________. Спори вирішуються в судовому порядку за місцем знаходження Оператора.`,
        },
      ],
    },

    cookies: {
      title: "Політика Cookie",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Що таке cookie",
          body: `Cookie — невеликі текстові файли, що зберігаються браузером при відвідуванні сайту. Вони допомагають сайту запам'ятовувати ваші вподобання та працювати коректно.`,
        },
        {
          heading: "Які cookie ми використовуємо",
          body: `Необхідні cookie:\n• Сесійний токен авторизації — для збереження входу;\n• Вибрана мова інтерфейсу;\n• Вибрана тема (світла / темна).\n\nАналітичні cookie:\n• Анонімізована статистика відвідуваності (за наявності).\n\nМи не використовуємо рекламні або маркетингові cookie.`,
        },
        {
          heading: "Як керувати cookie",
          body: `Ви можете вимкнути cookie в налаштуваннях браузера. Зверніть увагу: вимкнення необхідних cookie може призвести до неработоздатності деяких функцій Сервісу.`,
        },
        {
          heading: "Термін зберігання",
          body: `• Сесійні cookie видаляються при закритті браузера;\n• Постійні cookie (тема, мова) зберігаються до 12 місяців або до видалення вручну.`,
        },
      ],
    },

    support: {
      title: "Підтримка",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Як з нами зв'язатися",
          body: `Ми готові допомогти. Оберіть зручний спосіб:\n\n• Email: support@manicbot.com\n• Telegram: @manicbot_support\n• Форма зворотного зв'язку: доступна в особистому кабінеті`,
        },
        {
          heading: "Години роботи підтримки",
          body: `Підтримка доступна в робочі години:\n\nПн–Пт: 9:00 – 18:00 (UTC+3)\n\nУ вихідні та святкові дні відповідаємо в порядку черги в перший робочий день.`,
        },
        {
          heading: "Технічні питання",
          body: `При зверненні з технічних питань, будь ласка, вкажіть:\n\n• Ваш email або Telegram;\n• Опис проблеми;\n• Скріншот або запис екрана (якщо можливо);\n• Кроки, що призвели до помилки.\n\nЦе допоможе нам відповісти швидше.`,
        },
        {
          heading: "База знань",
          body: `Відповіді на часті запитання:\n\n• Як підключити бота до мого Telegram-каналу?\n• Як налаштувати розклад майстрів?\n• Як підключити Google Calendar?\n• Як змінити тариф?\n\nВідповіді доступні в особистому кабінеті → розділ «Допомога».`,
        },
        {
          heading: "Повідомити про помилку",
          body: `Якщо ви знайшли помилку або вразливість, напишіть нам на security@manicbot.com. Ми цінуємо відповідальне розкриття інформації.`,
        },
      ],
    },

    rules: {
      title: "Правила платформи",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Що можна робити",
          body: `• Створювати розклад майстрів у межах ліміту тарифу;\n• Приймати записи клієнтів через Telegram, Instagram та WhatsApp;\n• Використовувати AI-помічника (тариф Pro і вище) для спілкування з клієнтами;\n• Синхронізувати розклад з Google Calendar (тариф Pro і вище);\n• Підключати кілька месенджерів до одного салону;\n• Передавати тікети до служби підтримки платформи.`,
        },
        {
          heading: "Ліміти за тарифами",
          body: `Start: 1 майстер, базовий запис.\nPro: до 5 майстрів, AI-асистент, Google Calendar, WhatsApp, Instagram.\nStudio: необмежена кількість майстрів, усі функції.\n\nПри перевищенні ліміту майстрів платформа заблокує додавання нових. Тариф потрібно підвищити.`,
        },
        {
          heading: "Що заборонено",
          body: `• Створювати кілька облікових записів для обходу тарифних обмежень;\n• Розсилати спам через бота — масові повідомлення без згоди отримувачів;\n• Передавати облікові дані або API-токени третім особам;\n• Використовувати Сервіс у незаконних цілях або для продажу заборонених товарів;\n• Проводити автоматизовані атаки або сканування платформи;\n• Намагатися отримати несанкціонований доступ до даних інших орендарів.`,
        },
        {
          heading: "Доступ та білінг",
          body: `При простроченні оплати обліковий запис переходить у пільговий період (7 днів): клієнтам доступний лише базовий запис, функції персоналу (AI, панель управління, Google Calendar) вимкнено.\n\nПісля закінчення пільгового періоду статус змінюється на expired: бот перестає приймати команди персоналу. Дані не видаляються — відновлення доступу можливе після оплати.`,
        },
        {
          heading: "Ролі та права",
          body: `Клієнт: запис через бота, перегляд каталогу послуг. Доступ до панелі управління закрито.\nМайстер: перегляд свого розкладу, клієнтів та заробітку в міні-застосунку.\nВласник салону (tenant_owner): повне управління салоном — майстри, послуги, розклад, білінг.\nПідтримка платформи: допомога з технічними питаннями та тікетами.\nСистемний адміністратор: повний доступ до всіх даних платформи.`,
        },
        {
          heading: "Відповідальність за порушення",
          body: `При порушенні правил Оператор вправі:\n\n• Тимчасово обмежити або заблокувати обліковий запис;\n• Видалити контент, що порушує правила;\n• Розірвати договір без повернення оплаченого періоду при грубих порушеннях.\n\nПро виявлені вразливості повідомляйте на security@manicbot.com.`,
        },
      ],
    },
  },

  pl: {
    privacy: {
      title: "Polityka prywatności",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Postanowienia ogólne",
          body: `Niniejsza polityka prywatności (dalej — «Polityka») określa zasady zbierania, przechowywania i wykorzystywania danych osobowych użytkowników platformy ManicBot (dalej — «Serwis»).\n\nOperator serwisu: __________________ (dalej — «Operator»).\n\nKorzystając z Serwisu, zgadzasz się z warunkami niniejszej Polityki.`,
        },
        {
          heading: "2. Jakie dane zbieramy",
          body: `Serwis może zbierać następujące dane:\n\n• Imię i dane kontaktowe (e-mail, numer telefonu) — przy rejestracji;\n• Telegram ID — do interakcji przez komunikator;\n• Informacje o urządzeniu i przeglądarce (dane techniczne);\n• Dane o działaniach w Serwisie (historia rezerwacji, wiadomości do bota);\n• Dane płatnicze — przetwarzane przez dostawcę płatności; nie przechowujemy ich.`,
        },
        {
          heading: "3. Cel przetwarzania danych",
          body: `Twoje dane są wykorzystywane wyłącznie do:\n\n• Świadczenia usług rezerwacji przez bota Telegram;\n• Powiadamiania o wizytach i zmianach harmonogramu;\n• Poprawy jakości Serwisu;\n• Wystawiania faktur i przetwarzania płatności;\n• Wypełniania wymogów prawnych.`,
        },
        {
          heading: "4. Przechowywanie i ochrona danych",
          body: `Dane są przechowywane na bezpiecznych serwerach Cloudflare. Stosujemy szyfrowanie, kontrolę dostępu i regularne audyty bezpieczeństwa. Okres przechowywania: czas trwania umowy + 3 lata po jej zakończeniu.`,
        },
        {
          heading: "5. Przekazywanie danych osobom trzecim",
          body: `Nie sprzedajemy ani nie przekazujemy Twoich danych osobom trzecim bez zgody, z wyjątkiem:\n\n• Systemów płatności (Stripe) — wyłącznie do przetwarzania płatności;\n• Infrastruktury chmurowej (Cloudflare) — do hostowania Serwisu;\n• Organów państwowych — na żądanie prawa.`,
        },
        {
          heading: "6. Twoje prawa",
          body: `Masz prawo do:\n\n• Żądania dostępu do swoich danych;\n• Żądania poprawienia lub usunięcia danych;\n• Wycofania zgody na przetwarzanie;\n• Złożenia skargi do organu nadzorczego.\n\nAby skorzystać z praw, skontaktuj się: support@manicbot.com`,
        },
        {
          heading: "7. Pliki cookie",
          body: `Serwis używa plików cookie do zapewnienia funkcjonalności i analityki. Szczegóły — w Polityce cookie.`,
        },
        {
          heading: "8. Zmiany Polityki",
          body: `Możemy aktualizować niniejszą Politykę. W przypadku istotnych zmian powiadomimy użytkowników przez Serwis lub e-mail. Dalsze korzystanie z Serwisu po powiadomieniu oznacza akceptację zmian.`,
        },
      ],
    },

    terms: {
      title: "Regulamin",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "1. Przedmiot umowy",
          body: `Niniejszy Regulamin (dalej — «Regulamin») reguluje stosunki między __________________ (dalej — «Operator») a użytkownikiem platformy ManicBot (dalej — «Użytkownik»).\n\nKorzystając z Serwisu, Użytkownik akceptuje Regulamin w całości.`,
        },
        {
          heading: "2. Opis Serwisu",
          body: `ManicBot to platforma do automatyzacji rezerwacji online w salonach piękności przez Telegram, Instagram i WhatsApp. Serwis zapewnia narzędzia do zarządzania harmonogramem, bazą klientów i komunikacją.`,
        },
        {
          heading: "3. Rejestracja i konto",
          body: `• Do korzystania z Serwisu wymagana jest rejestracja;\n• Użytkownik odpowiada za bezpieczeństwo swoich danych logowania;\n• Tworzenie wielu kont w celu obejścia ograniczeń jest zabronione;\n• Operator może zablokować konto w przypadku naruszenia Regulaminu.`,
        },
        {
          heading: "4. Plany i płatności",
          body: `• Serwis jest świadczony w ramach subskrypcji zgodnie z wybranym planem;\n• Płatność jest pobierana miesięcznie;\n• W przypadku braku płatności przez 3 dni konto przechodzi w tryb ograniczonego dostępu;\n• Zwrot środków jest możliwy w ciągu 14 dni od pierwszej płatności z przyczyn technicznych.`,
        },
        {
          heading: "5. Działania zabronione",
          body: `Zabronione jest:\n\n• Używanie Serwisu do celów niezgodnych z prawem;\n• Wysyłanie spamu przez narzędzia Serwisu;\n• Udostępnianie dostępu osobom trzecim bez zgody Operatora;\n• Inżynieria wsteczna lub hakowanie Serwisu;\n• Naruszanie praw osób trzecich.`,
        },
        {
          heading: "6. Odpowiedzialność",
          body: `Serwis jest świadczony «tak jak jest». Operator nie gwarantuje nieprzerwanej pracy i nie ponosi odpowiedzialności za pośrednie straty. Maksymalna odpowiedzialność Operatora jest ograniczona do kwoty zapłaconej przez Użytkownika za ostatni miesiąc subskrypcji.`,
        },
        {
          heading: "7. Własność intelektualna",
          body: `Wszelkie prawa do Serwisu, jego komponentów i treści należą do Operatora. Użytkownik otrzymuje ograniczoną, niewyłączną licencję na korzystanie z Serwisu.`,
        },
        {
          heading: "8. Zakończenie korzystania",
          body: `Użytkownik może zrezygnować z Serwisu w dowolnym momencie. Po rezygnacji dane są przechowywane przez 90 dni, a następnie usuwane. Operator może zakończyć świadczenie Serwisu z 30-dniowym wyprzedzeniem.`,
        },
        {
          heading: "9. Prawo właściwe",
          body: `Regulamin podlega prawu __________________. Spory są rozstrzygane przed sądem właściwym dla siedziby Operatora.`,
        },
      ],
    },

    cookies: {
      title: "Polityka Cookie",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Czym są pliki cookie",
          body: `Pliki cookie to małe pliki tekstowe zapisywane przez przeglądarkę podczas odwiedzania strony. Pomagają stronie zapamiętywać Twoje preferencje i działać poprawnie.`,
        },
        {
          heading: "Jakich plików cookie używamy",
          body: `Niezbędne pliki cookie:\n• Token sesji autoryzacji — do utrzymania zalogowania;\n• Wybrany język interfejsu;\n• Wybrana motyw (jasny / ciemny).\n\nAnalityczne pliki cookie:\n• Anonimowe statystyki odwiedzin (jeśli włączone).\n\nNie używamy reklamowych ani marketingowych plików cookie.`,
        },
        {
          heading: "Zarządzanie plikami cookie",
          body: `Możesz wyłączyć pliki cookie w ustawieniach przeglądarki. Uwaga: wyłączenie niezbędnych plików cookie może spowodować, że niektóre funkcje Serwisu przestaną działać.`,
        },
        {
          heading: "Okres przechowywania",
          body: `• Sesyjne pliki cookie są usuwane po zamknięciu przeglądarki;\n• Trwałe pliki cookie (motyw, język) są przechowywane do 12 miesięcy lub do ręcznego usunięcia.`,
        },
      ],
    },

    support: {
      title: "Wsparcie",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Jak się z nami skontaktować",
          body: `Jesteśmy gotowi pomóc. Wybierz wygodny sposób:\n\n• E-mail: support@manicbot.com\n• Telegram: @manicbot_support\n• Formularz kontaktowy: dostępny w panelu klienta`,
        },
        {
          heading: "Godziny pracy wsparcia",
          body: `Wsparcie jest dostępne w godzinach roboczych:\n\nPn–Pt: 9:00 – 18:00 (UTC+3)\n\nW weekendy i święta odpowiadamy kolejno w pierwszy dzień roboczy.`,
        },
        {
          heading: "Problemy techniczne",
          body: `Kontaktując się w sprawie problemów technicznych, podaj:\n\n• Swój e-mail lub Telegram;\n• Opis problemu;\n• Zrzut ekranu lub nagranie ekranu (jeśli możliwe);\n• Kroki, które doprowadziły do błędu.\n\nPomożemy Ci szybciej.`,
        },
        {
          heading: "Baza wiedzy",
          body: `Odpowiedzi na najczęstsze pytania:\n\n• Jak połączyć bota z moim kanałem Telegram?\n• Jak ustawić harmonogram mistrzów?\n• Jak połączyć Google Calendar?\n• Jak zmienić plan?\n\nOdpowiedzi są dostępne w panelu klienta → sekcja «Pomoc».`,
        },
        {
          heading: "Zgłoś błąd",
          body: `Jeśli znalazłeś błąd lub podatność, napisz do nas na security@manicbot.com. Cenimy odpowiedzialne ujawnianie informacji.`,
        },
      ],
    },

    rules: {
      title: "Zasady platformy",
      lastUpdated: "04.04.2026",
      sections: [
        {
          heading: "Co możesz robić",
          body: `• Tworzyć harmonogramy mistrzów w ramach limitu planu;\n• Przyjmować rezerwacje klientów przez Telegram, Instagram i WhatsApp;\n• Korzystać z asystenta AI (plan Pro i wyższy) do komunikacji z klientami;\n• Synchronizować harmonogram z Google Calendar (plan Pro i wyższy);\n• Łączyć wiele komunikatorów z jednym salonem;\n• Przesyłać zgłoszenia do wsparcia platformy.`,
        },
        {
          heading: "Limity planów",
          body: `Start: 1 mistrz, podstawowe rezerwacje.\nPro: do 5 mistrzów, asystent AI, Google Calendar, WhatsApp, Instagram.\nStudio: nieograniczona liczba mistrzów, wszystkie funkcje.\n\nPo przekroczeniu limitu mistrzów platforma zablokuje dodawanie nowych. Plan musi zostać zmieniony na wyższy.`,
        },
        {
          heading: "Co jest zabronione",
          body: `• Tworzenie wielu kont w celu obejścia ograniczeń planu;\n• Wysyłanie spamu przez bota — masowe wiadomości bez zgody odbiorców;\n• Udostępnianie danych logowania lub tokenów API osobom trzecim;\n• Używanie Serwisu do celów niezgodnych z prawem lub sprzedaży zabronionych towarów;\n• Przeprowadzanie automatycznych ataków lub skanowania platformy;\n• Próby uzyskania nieautoryzowanego dostępu do danych innych najemców.`,
        },
        {
          heading: "Dostęp i rozliczenia",
          body: `W przypadku zaległości płatności konto przechodzi w okres karencji (7 dni): klienci mogą tylko dokonywać podstawowych rezerwacji; funkcje personelu (AI, panel administracyjny, Google Calendar) są wyłączone.\n\nPo upływie okresu karencji konto przechodzi w status expired: bot przestaje przyjmować polecenia personelu. Dane nie są usuwane — dostęp można przywrócić po zapłacie.`,
        },
        {
          heading: "Role i uprawnienia",
          body: `Klient: rezerwacje przez bota, przeglądanie katalogu usług. Panel administracyjny jest zamknięty.\nMistrz: przeglądanie własnego harmonogramu, klientów i zarobków w mini-aplikacji.\nWłaściciel salonu (tenant_owner): pełne zarządzanie salonem — mistrzowie, usługi, harmonogram, rozliczenia.\nWsparcie platformy: pomoc z problemami technicznymi i zgłoszeniami.\nAdministrator systemu: pełny dostęp do wszystkich danych platformy.`,
        },
        {
          heading: "Odpowiedzialność za naruszenia",
          body: `W przypadku naruszenia zasad Operator może:\n\n• Tymczasowo ograniczyć lub zablokować konto;\n• Usunąć treści naruszające zasady;\n• Rozwiązać umowę bez zwrotu opłaconego okresu w przypadku poważnych naruszeń.\n\nO odkrytych podatnościach informuj na security@manicbot.com.`,
        },
      ],
    },
  },
};

export function LegalPage({ page }: { page: string }) {
  const { locale } = useLanguage();
  const localeContent = CONTENT[locale] ?? CONTENT.ru;
  const content = localeContent[page as PageKey];

  if (!content) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Page not found</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 antialiased dark:bg-[#050812] dark:text-white">
      <Header />

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-24 sm:px-6 sm:pt-28 lg:px-8">
        {/* Back link */}
        <a
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/80 px-3.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur-md transition-all hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70 dark:hover:text-white"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>
            {locale === "ru" ? "На главную" : locale === "ua" ? "На головну" : locale === "pl" ? "Na stronę główną" : "Back"}
          </span>
        </a>

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
            {content.title}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/40">
            {locale === "ru" ? "Последнее обновление" : locale === "ua" ? "Останнє оновлення" : locale === "pl" ? "Ostatnia aktualizacja" : "Last updated"}: {content.lastUpdated}
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
                {section.heading}
              </h2>
              <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-5 dark:border-white/[0.07] dark:bg-white/[0.03]">
                {section.body.split("\n").map((line, i) =>
                  line === "" ? (
                    <br key={i} />
                  ) : (
                    <p key={i} className="text-sm leading-relaxed text-slate-600 dark:text-slate-300/80">
                      {line}
                    </p>
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
