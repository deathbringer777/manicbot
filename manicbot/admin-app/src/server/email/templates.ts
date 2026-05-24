/**
 * Branded HTML email templates for ManicBot.
 * All templates use inline styles for maximum email client compatibility.
 */

import type { Lang } from "~/lib/i18n";

// ─── i18n copy for emails ───────────────────────────────────────────────────

const emailCopy: Record<Lang, {
  verification: { subject: string; heading: string; body: string; cta: string; ignore: string };
  verificationCode: { subject: string; heading: string; body: string; expires: string; ignore: string; copy: string; copied: string };
  passwordReset: { subject: string; heading: string; body: string; cta: string; ignore: string; expires: string };
  passwordResetCode: { subject: string; heading: string; body: string; expires: string; ignore: string; copy: string };
  welcome: { subject: string; heading: string; body: string; cta: string };
  /**
   * Newsletter "Stay in the loop" subscription confirmation. Sent once per
   * NEW row in `newsletter_subscribers` (migration 0086). NOT the same as
   * `welcome` above — that one fires after registration + email verification.
   */
  subscriptionWelcome: {
    subject: string;
    heading: string;
    body: string;
    bullet1: string;
    bullet2: string;
    bullet3: string;
    footerNote: string;
    unsubscribeHint: string;
  };
  emailChange: { subject: string; heading: string; body: string; cta: string; ignore: string; expires: string };
  emailChangeCode: { subject: string; heading: string; body: string; expires: string; ignore: string; copy: string };
  loginAlert: { subject: string; heading: string; body: string; ip: string; time: string; warning: string };
  roleRequestAdmin: { subject: string; heading: string; body: string; from: string; to: string; reason: string; cta: string };
  roleRequestDecision: {
    approvedSubject: string; deniedSubject: string;
    approvedHeading: string; deniedHeading: string;
    approvedBody: string; deniedBody: string;
    note: string; cta: string;
  };
  /** #P1-5 — Stripe `invoice.payment_failed` notice. */
  paymentFailed: {
    subject: string;
    heading: string;
    body: string;
    amount: string;
    plan: string;
    nextStep: string;
    cta: string;
    grace: string;
  };
  /** #P1-5 — `customer.subscription.updated` with plan tier going UP. */
  planUpgrade: {
    subject: string;
    heading: string;
    body: string;
    from: string;
    to: string;
    cta: string;
    welcome: string;
  };
  /** #P1-5 — tenant_owner adding a master row to tenant_roles. */
  masterInvite: {
    subject: string;
    heading: string;
    body: string;
    salon: string;
    role: string;
    cta: string;
    note: string;
  };
  /** #P1-5 — support agent reply on a platform/local ticket. */
  supportReply: {
    subject: string;
    heading: string;
    body: string;
    ticket: string;
    preview: string;
    cta: string;
    footerNote: string;
  };
  footer: string;
}> = {
  ru: {
    verification: {
      subject: "Подтвердите ваш email — ManicBot",
      heading: "Подтвердите email",
      body: "Спасибо за регистрацию! Нажмите кнопку ниже, чтобы подтвердить ваш email и начать работу.",
      cta: "Подтвердить email",
      ignore: "Если вы не регистрировались, просто проигнорируйте это письмо.",
    },
    verificationCode: {
      subject: "Ваш код подтверждения — ManicBot",
      heading: "Код подтверждения",
      body: "Введите этот код в ManicBot, чтобы подтвердить ваш email:",
      expires: "Код действителен 15 минут.",
      ignore: "Если вы не регистрировались, просто проигнорируйте это письмо.",
      copy: "Нажмите на код, чтобы выделить",
      copied: "Скопировано ✓",
    },
    passwordReset: {
      subject: "Сброс пароля — ManicBot",
      heading: "Сброс пароля",
      body: "Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы установить новый пароль.",
      cta: "Установить новый пароль",
      ignore: "Если вы не запрашивали сброс, проигнорируйте это письмо.",
      expires: "Ссылка действует 1 час.",
    },
    passwordResetCode: {
      subject: "Код для сброса пароля — ManicBot",
      heading: "Сброс пароля",
      body: "Введите этот код в ManicBot, чтобы установить новый пароль:",
      expires: "Код действителен 1 час.",
      ignore: "Если вы не запрашивали сброс, проигнорируйте это письмо.",
      copy: "Нажмите на код, чтобы выделить",
    },
    welcome: {
      subject: "Добро пожаловать в ManicBot!",
      heading: "Добро пожаловать!",
      body: "Ваш email подтверждён. Теперь вы можете войти и начать настройку вашего салона.",
      cta: "Войти в кабинет",
    },
    subscriptionWelcome: {
      subject: "Вы подписались на новости ManicBot",
      heading: "Вы в списке!",
      body: "Спасибо за подписку на новости ManicBot. Раз в месяц мы будем присылать письма с тем, что действительно стоит вашего внимания:",
      bullet1: "Обновления продукта и новые возможности для салонов и мастеров.",
      bullet2: "Практические советы по росту: запись, удержание клиентов, маркетинг.",
      bullet3: "Истории команд, которые уже работают на ManicBot.",
      footerNote: "Никакого спама. Если разонравится — отписаться можно одной кнопкой ниже.",
      unsubscribeHint: "Отписаться",
    },
    emailChange: {
      subject: "Подтвердите новый email — ManicBot",
      heading: "Смена email",
      body: "Вы запросили смену email. Нажмите кнопку ниже, чтобы подтвердить новый адрес.",
      cta: "Подтвердить новый email",
      ignore: "Если вы не запрашивали смену, проигнорируйте это письмо.",
      expires: "Ссылка действует 1 час.",
    },
    emailChangeCode: {
      subject: "Код подтверждения нового email — ManicBot",
      heading: "Смена email",
      body: "Введите этот код в ManicBot, чтобы подтвердить новый email:",
      expires: "Код действителен 1 час.",
      ignore: "Если вы не запрашивали смену, проигнорируйте это письмо.",
      copy: "Нажмите на код, чтобы выделить",
    },
    loginAlert: {
      subject: "Вход с нового устройства — ManicBot",
      heading: "Новый вход в аккаунт",
      body: "Зафиксирован вход в ваш аккаунт с нового IP-адреса.",
      ip: "IP-адрес",
      time: "Время",
      warning: "Если это были не вы, смените пароль немедленно.",
    },
    roleRequestAdmin: {
      subject: "Запрос на смену роли — ManicBot",
      heading: "Запрос на смену роли",
      body: "Пользователь отправил запрос на смену роли.",
      from: "Текущая роль",
      to: "Запрошенная роль",
      reason: "Причина",
      cta: "Посмотреть запросы",
    },
    roleRequestDecision: {
      approvedSubject: "Ваша роль изменена — ManicBot",
      deniedSubject: "Запрос на смену роли рассмотрен — ManicBot",
      approvedHeading: "Роль изменена",
      deniedHeading: "Запрос отклонён",
      approvedBody: "Ваш запрос на смену роли одобрен. Новая роль вступила в силу.",
      deniedBody: "К сожалению, ваш запрос на смену роли был отклонён.",
      note: "Администратор оставил комментарий — посмотрите его в кабинете.",
      cta: "Перейти в кабинет",
    },
    paymentFailed: {
      subject: "Оплата не прошла — ManicBot",
      heading: "Не удалось списать оплату",
      body: "Мы не смогли списать оплату вашей подписки ManicBot. Возможно, истёк срок действия карты или недостаточно средств.",
      amount: "Сумма",
      plan: "Тариф",
      nextStep: "Чтобы избежать отключения, обновите способ оплаты в кабинете.",
      cta: "Обновить способ оплаты",
      grace: "У вас есть 7 дней до отключения функций.",
    },
    planUpgrade: {
      subject: "Ваш тариф обновлён — ManicBot",
      heading: "Тариф обновлён",
      body: "Спасибо за апгрейд! Расширенные возможности уже доступны.",
      from: "Старый тариф",
      to: "Новый тариф",
      cta: "Перейти в кабинет",
      welcome: "Откройте для себя все новые функции, которые включены в ваш план.",
    },
    masterInvite: {
      subject: "Вас добавили в салон — ManicBot",
      heading: "Вас пригласили в команду",
      body: "Владелец салона добавил вас как мастера в ManicBot.",
      salon: "Салон",
      role: "Ваша роль",
      cta: "Войти в кабинет",
      note: "После входа вы увидите свой график, клиентов и доход.",
    },
    supportReply: {
      subject: "Ответ службы поддержки — ManicBot",
      heading: "Новый ответ от поддержки",
      body: "Служба поддержки ответила на ваше обращение.",
      ticket: "Обращение",
      preview: "Ответ",
      cta: "Открыть обращение",
      footerNote: "Чтобы продолжить, ответьте через кабинет — не отвечайте на это письмо.",
    },
    footer: "ManicBot.com — платформа для салонов красоты",
  },
  ua: {
    verification: {
      subject: "Підтвердіть ваш email — ManicBot",
      heading: "Підтвердіть email",
      body: "Дякуємо за реєстрацію! Натисніть кнопку нижче, щоб підтвердити ваш email та почати роботу.",
      cta: "Підтвердити email",
      ignore: "Якщо ви не реєструвалися, просто проігноруйте цей лист.",
    },
    verificationCode: {
      subject: "Ваш код підтвердження — ManicBot",
      heading: "Код підтвердження",
      body: "Введіть цей код у ManicBot, щоб підтвердити ваш email:",
      expires: "Код дійсний 15 хвилин.",
      ignore: "Якщо ви не реєструвалися, просто проігноруйте цей лист.",
      copy: "Натисніть на код, щоб виділити",
      copied: "Скопійовано ✓",
    },
    passwordReset: {
      subject: "Скидання пароля — ManicBot",
      heading: "Скидання пароля",
      body: "Ви запросили скидання пароля. Натисніть кнопку нижче, щоб встановити новий пароль.",
      cta: "Встановити новий пароль",
      ignore: "Якщо ви не запитували скидання, проігноруйте цей лист.",
      expires: "Посилання дійсне 1 годину.",
    },
    passwordResetCode: {
      subject: "Код для скидання пароля — ManicBot",
      heading: "Скидання пароля",
      body: "Введіть цей код у ManicBot, щоб встановити новий пароль:",
      expires: "Код дійсний 1 годину.",
      ignore: "Якщо ви не запитували скидання, проігноруйте цей лист.",
      copy: "Натисніть на код, щоб виділити",
    },
    welcome: {
      subject: "Ласкаво просимо до ManicBot!",
      heading: "Ласкаво просимо!",
      body: "Ваш email підтверджено. Тепер ви можете увійти та почати налаштування вашого салону.",
      cta: "Увійти до кабінету",
    },
    subscriptionWelcome: {
      subject: "Ви підписалися на новини ManicBot",
      heading: "Ви у списку!",
      body: "Дякуємо за підписку на новини ManicBot. Раз на місяць ми будемо надсилати листи з тим, що справді варте вашої уваги:",
      bullet1: "Оновлення продукту та нові можливості для салонів і майстрів.",
      bullet2: "Практичні поради зі зростання: запис, утримання клієнтів, маркетинг.",
      bullet3: "Історії команд, які вже працюють на ManicBot.",
      footerNote: "Жодного спаму. Якщо набридне — відписатися можна однією кнопкою нижче.",
      unsubscribeHint: "Відписатися",
    },
    emailChange: {
      subject: "Підтвердіть новий email — ManicBot",
      heading: "Зміна email",
      body: "Ви запросили зміну email. Натисніть кнопку нижче, щоб підтвердити нову адресу.",
      cta: "Підтвердити новий email",
      ignore: "Якщо ви не запитували зміну, проігноруйте цей лист.",
      expires: "Посилання дійсне 1 годину.",
    },
    emailChangeCode: {
      subject: "Код підтвердження нового email — ManicBot",
      heading: "Зміна email",
      body: "Введіть цей код у ManicBot, щоб підтвердити новий email:",
      expires: "Код дійсний 1 годину.",
      ignore: "Якщо ви не запитували зміну, проігноруйте цей лист.",
      copy: "Натисніть на код, щоб виділити",
    },
    loginAlert: {
      subject: "Вхід з нового пристрою — ManicBot",
      heading: "Новий вхід до акаунту",
      body: "Зафіксовано вхід до вашого акаунту з нової IP-адреси.",
      ip: "IP-адреса",
      time: "Час",
      warning: "Якщо це були не ви, змініть пароль негайно.",
    },
    roleRequestAdmin: {
      subject: "Запит на зміну ролі — ManicBot",
      heading: "Запит на зміну ролі",
      body: "Користувач надіслав запит на зміну ролі.",
      from: "Поточна роль",
      to: "Запитувана роль",
      reason: "Причина",
      cta: "Переглянути запити",
    },
    roleRequestDecision: {
      approvedSubject: "Вашу роль змінено — ManicBot",
      deniedSubject: "Запит на зміну ролі розглянуто — ManicBot",
      approvedHeading: "Роль змінено",
      deniedHeading: "Запит відхилено",
      approvedBody: "Ваш запит на зміну ролі схвалено. Нова роль набула чинності.",
      deniedBody: "На жаль, ваш запит на зміну ролі було відхилено.",
      note: "Адміністратор залишив коментар — перегляньте його в кабінеті.",
      cta: "Перейти до кабінету",
    },
    paymentFailed: {
      subject: "Оплата не пройшла — ManicBot",
      heading: "Не вдалося списати оплату",
      body: "Ми не змогли списати оплату вашої підписки ManicBot. Можливо, термін дії картки закінчився або недостатньо коштів.",
      amount: "Сума",
      plan: "Тариф",
      nextStep: "Щоб уникнути відключення, оновіть спосіб оплати в кабінеті.",
      cta: "Оновити спосіб оплати",
      grace: "У вас є 7 днів до відключення функцій.",
    },
    planUpgrade: {
      subject: "Ваш тариф оновлено — ManicBot",
      heading: "Тариф оновлено",
      body: "Дякуємо за апгрейд! Розширені можливості вже доступні.",
      from: "Старий тариф",
      to: "Новий тариф",
      cta: "Перейти до кабінету",
      welcome: "Відкрийте для себе всі нові функції, які входять до вашого плану.",
    },
    masterInvite: {
      subject: "Вас додали до салону — ManicBot",
      heading: "Вас запросили до команди",
      body: "Власник салону додав вас як майстра в ManicBot.",
      salon: "Салон",
      role: "Ваша роль",
      cta: "Увійти до кабінету",
      note: "Після входу ви побачите свій графік, клієнтів та дохід.",
    },
    supportReply: {
      subject: "Відповідь служби підтримки — ManicBot",
      heading: "Нова відповідь від підтримки",
      body: "Служба підтримки відповіла на ваше звернення.",
      ticket: "Звернення",
      preview: "Відповідь",
      cta: "Відкрити звернення",
      footerNote: "Щоб продовжити, відповідайте через кабінет — не відповідайте на цей лист.",
    },
    footer: "ManicBot.com — платформа для салонів краси",
  },
  en: {
    verification: {
      subject: "Confirm your email — ManicBot",
      heading: "Confirm your email",
      body: "Thanks for signing up! Click the button below to verify your email and get started.",
      cta: "Confirm email",
      ignore: "If you didn't sign up, just ignore this email.",
    },
    verificationCode: {
      subject: "Your verification code — ManicBot",
      heading: "Verification code",
      body: "Enter this code in ManicBot to verify your email:",
      expires: "This code expires in 15 minutes.",
      ignore: "If you didn't sign up, just ignore this email.",
      copy: "Click the code to select it",
      copied: "Copied ✓",
    },
    passwordReset: {
      subject: "Reset your password — ManicBot",
      heading: "Reset your password",
      body: "You requested a password reset. Click the button below to set a new password.",
      cta: "Set new password",
      ignore: "If you didn't request this, ignore this email.",
      expires: "This link expires in 1 hour.",
    },
    passwordResetCode: {
      subject: "Password reset code — ManicBot",
      heading: "Reset your password",
      body: "Enter this code in ManicBot to set a new password:",
      expires: "This code expires in 1 hour.",
      ignore: "If you didn't request this, ignore this email.",
      copy: "Click the code to select it",
    },
    welcome: {
      subject: "Welcome to ManicBot!",
      heading: "Welcome!",
      body: "Your email is verified. You can now sign in and start setting up your salon.",
      cta: "Go to dashboard",
    },
    subscriptionWelcome: {
      subject: "You're subscribed to ManicBot updates",
      heading: "You're on the list!",
      body: "Thanks for subscribing to ManicBot updates. Once a month we'll send you what's actually worth your attention:",
      bullet1: "Product updates and new features for salons and individual masters.",
      bullet2: "Practical growth tips: booking, client retention, marketing.",
      bullet3: "Stories from teams already running on ManicBot.",
      footerNote: "Zero spam. Don't like it? One-click unsubscribe below.",
      unsubscribeHint: "Unsubscribe",
    },
    emailChange: {
      subject: "Confirm your new email — ManicBot",
      heading: "Email change",
      body: "You requested an email change. Click the button below to confirm your new address.",
      cta: "Confirm new email",
      ignore: "If you didn't request this, ignore this email.",
      expires: "This link expires in 1 hour.",
    },
    emailChangeCode: {
      subject: "Email change code — ManicBot",
      heading: "Email change",
      body: "Enter this code in ManicBot to confirm your new email:",
      expires: "This code expires in 1 hour.",
      ignore: "If you didn't request this, ignore this email.",
      copy: "Click the code to select it",
    },
    loginAlert: {
      subject: "New login detected — ManicBot",
      heading: "New login to your account",
      body: "A login to your account was detected from a new IP address.",
      ip: "IP address",
      time: "Time",
      warning: "If this wasn't you, change your password immediately.",
    },
    roleRequestAdmin: {
      subject: "Role change request — ManicBot",
      heading: "Role Change Request",
      body: "A user has submitted a role change request.",
      from: "Current role",
      to: "Requested role",
      reason: "Reason",
      cta: "Review requests",
    },
    roleRequestDecision: {
      approvedSubject: "Your role has been changed — ManicBot",
      deniedSubject: "Role change request reviewed — ManicBot",
      approvedHeading: "Role Changed",
      deniedHeading: "Request Denied",
      approvedBody: "Your role change request has been approved. Your new role is now active.",
      deniedBody: "Unfortunately, your role change request has been denied.",
      note: "An admin left a note — view it in your dashboard.",
      cta: "Go to dashboard",
    },
    paymentFailed: {
      subject: "Payment failed — ManicBot",
      heading: "We couldn't charge your card",
      body: "We were unable to charge your ManicBot subscription. The card may be expired or have insufficient funds.",
      amount: "Amount",
      plan: "Plan",
      nextStep: "To avoid service interruption, update your payment method in the dashboard.",
      cta: "Update payment method",
      grace: "You have 7 days before features are paused.",
    },
    planUpgrade: {
      subject: "Your plan was upgraded — ManicBot",
      heading: "Plan upgraded",
      body: "Thanks for upgrading! The expanded features are now available on your account.",
      from: "Previous plan",
      to: "New plan",
      cta: "Go to dashboard",
      welcome: "Explore the new features that come with your plan.",
    },
    masterInvite: {
      subject: "You've been added to a salon — ManicBot",
      heading: "You're on the team",
      body: "The salon owner added you as a master in ManicBot.",
      salon: "Salon",
      role: "Your role",
      cta: "Open dashboard",
      note: "After signing in you'll see your schedule, clients and earnings.",
    },
    supportReply: {
      subject: "New reply from support — ManicBot",
      heading: "New reply from support",
      body: "The support team has replied to your ticket.",
      ticket: "Ticket",
      preview: "Reply",
      cta: "Open ticket",
      footerNote: "Reply through the dashboard — please don't reply to this email.",
    },
    footer: "ManicBot.com — beauty salon platform",
  },
  pl: {
    verification: {
      subject: "Potwierdź swój email — ManicBot",
      heading: "Potwierdź email",
      body: "Dziękujemy za rejestrację! Kliknij przycisk poniżej, aby potwierdzić email i zacząć.",
      cta: "Potwierdź email",
      ignore: "Jeśli nie rejestrowałeś się, zignoruj tę wiadomość.",
    },
    verificationCode: {
      subject: "Twój kod weryfikacyjny — ManicBot",
      heading: "Kod weryfikacyjny",
      body: "Wpisz ten kod w ManicBot, aby potwierdzić swój email:",
      expires: "Kod ważny 15 minut.",
      ignore: "Jeśli nie rejestrowałeś się, zignoruj tę wiadomość.",
      copy: "Kliknij kod, aby go zaznaczyć",
      copied: "Skopiowano ✓",
    },
    passwordReset: {
      subject: "Resetowanie hasła — ManicBot",
      heading: "Resetowanie hasła",
      body: "Poprosiłeś o reset hasła. Kliknij przycisk poniżej, aby ustawić nowe hasło.",
      cta: "Ustaw nowe hasło",
      ignore: "Jeśli nie prosiłeś o reset, zignoruj tę wiadomość.",
      expires: "Link ważny 1 godzinę.",
    },
    passwordResetCode: {
      subject: "Kod resetowania hasła — ManicBot",
      heading: "Resetowanie hasła",
      body: "Wpisz ten kod w ManicBot, aby ustawić nowe hasło:",
      expires: "Kod ważny 1 godzinę.",
      ignore: "Jeśli nie prosiłeś o reset, zignoruj tę wiadomość.",
      copy: "Kliknij kod, aby go zaznaczyć",
    },
    welcome: {
      subject: "Witamy w ManicBot!",
      heading: "Witamy!",
      body: "Twój email został zweryfikowany. Możesz się zalogować i zacząć konfigurację salonu.",
      cta: "Przejdź do panelu",
    },
    subscriptionWelcome: {
      subject: "Zapisałeś się na nowości ManicBot",
      heading: "Jesteś na liście!",
      body: "Dziękujemy za subskrypcję ManicBot. Raz w miesiącu prześlemy Ci to, co naprawdę warte Twojej uwagi:",
      bullet1: "Aktualizacje produktu i nowe funkcje dla salonów oraz mistrzów.",
      bullet2: "Praktyczne porady dotyczące rozwoju: rezerwacje, utrzymanie klientów, marketing.",
      bullet3: "Historie zespołów, które już działają na ManicBot.",
      footerNote: "Zero spamu. Nie podoba Ci się? Wypisz się jednym kliknięciem poniżej.",
      unsubscribeHint: "Wypisz się",
    },
    emailChange: {
      subject: "Potwierdź nowy email — ManicBot",
      heading: "Zmiana emaila",
      body: "Poprosiłeś o zmianę emaila. Kliknij przycisk poniżej, aby potwierdzić nowy adres.",
      cta: "Potwierdź nowy email",
      ignore: "Jeśli nie prosiłeś o zmianę, zignoruj tę wiadomość.",
      expires: "Link ważny 1 godzinę.",
    },
    emailChangeCode: {
      subject: "Kod potwierdzenia nowego emaila — ManicBot",
      heading: "Zmiana emaila",
      body: "Wpisz ten kod w ManicBot, aby potwierdzić nowy email:",
      expires: "Kod ważny 1 godzinę.",
      ignore: "Jeśli nie prosiłeś o zmianę, zignoruj tę wiadomość.",
      copy: "Kliknij kod, aby go zaznaczyć",
    },
    loginAlert: {
      subject: "Nowe logowanie — ManicBot",
      heading: "Nowe logowanie na konto",
      body: "Wykryto logowanie na Twoje konto z nowego adresu IP.",
      ip: "Adres IP",
      time: "Czas",
      warning: "Jeśli to nie Ty, zmień hasło natychmiast.",
    },
    roleRequestAdmin: {
      subject: "Prośba o zmianę roli — ManicBot",
      heading: "Prośba o zmianę roli",
      body: "Użytkownik przesłał prośbę o zmianę roli.",
      from: "Obecna rola",
      to: "Żądana rola",
      reason: "Powód",
      cta: "Sprawdź prośby",
    },
    roleRequestDecision: {
      approvedSubject: "Twoja rola została zmieniona — ManicBot",
      deniedSubject: "Prośba o zmianę roli rozpatrzona — ManicBot",
      approvedHeading: "Rola zmieniona",
      deniedHeading: "Prośba odrzucona",
      approvedBody: "Twoja prośba o zmianę roli została zatwierdzona. Nowa rola jest aktywna.",
      deniedBody: "Niestety, Twoja prośba o zmianę roli została odrzucona.",
      note: "Administrator zostawił komentarz — sprawdź go w panelu.",
      cta: "Przejdź do panelu",
    },
    paymentFailed: {
      subject: "Płatność nie powiodła się — ManicBot",
      heading: "Nie udało się obciążyć karty",
      body: "Nie udało nam się pobrać opłaty za Twoją subskrypcję ManicBot. Możliwe, że karta wygasła lub brakuje środków.",
      amount: "Kwota",
      plan: "Plan",
      nextStep: "Aby uniknąć przerwy w działaniu, zaktualizuj sposób płatności w panelu.",
      cta: "Zaktualizuj sposób płatności",
      grace: "Masz 7 dni zanim funkcje zostaną wstrzymane.",
    },
    planUpgrade: {
      subject: "Twój plan został zaktualizowany — ManicBot",
      heading: "Plan zaktualizowany",
      body: "Dziękujemy za upgrade! Rozszerzone funkcje są już dostępne na Twoim koncie.",
      from: "Poprzedni plan",
      to: "Nowy plan",
      cta: "Przejdź do panelu",
      welcome: "Odkryj nowe funkcje, które zawiera Twój plan.",
    },
    masterInvite: {
      subject: "Zostałeś dodany do salonu — ManicBot",
      heading: "Jesteś w zespole",
      body: "Właściciel salonu dodał Cię jako mistrza w ManicBot.",
      salon: "Salon",
      role: "Twoja rola",
      cta: "Otwórz panel",
      note: "Po zalogowaniu zobaczysz swój harmonogram, klientów i przychody.",
    },
    supportReply: {
      subject: "Nowa odpowiedź od wsparcia — ManicBot",
      heading: "Nowa odpowiedź od wsparcia",
      body: "Zespół wsparcia odpowiedział na Twoje zgłoszenie.",
      ticket: "Zgłoszenie",
      preview: "Odpowiedź",
      cta: "Otwórz zgłoszenie",
      footerNote: "Odpowiedz przez panel — prosimy nie odpowiadać na ten e-mail.",
    },
    footer: "ManicBot.com — platforma dla salonów kosmetycznych",
  },
};

export function getEmailCopy(lang: Lang) {
  return emailCopy[lang] ?? emailCopy.en;
}

// ─── Base layout ────────────────────────────────────────────────────────────

function baseLayout(heading: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e1a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;background-color:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
  <!-- Header -->
  <tr><td style="padding:32px 32px 0;text-align:center;">
    <div style="display:inline-block;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#06b6d4);text-align:center;line-height:48px;font-size:20px;font-weight:800;color:#fff;">M</div>
    <h1 style="margin:16px 0 0;font-size:22px;font-weight:700;color:#ffffff;">${heading}</h1>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:24px 32px 32px;">
    ${body}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">${footer}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(url: string, text: string): string {
  return `<div style="text-align:center;margin:24px 0;">
<a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:12px;">${text}</a>
</div>`;
}

function paragraph(text: string, color = "#d1d5db"): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${color};">${text}</p>`;
}

function muted(text: string): string {
  return paragraph(text, "#64748b");
}

// ─── Template functions ─────────────────────────────────────────────────────

export function verificationCodeEmailHtml(code: string, lang: Lang): string {
  const c = getEmailCopy(lang).verificationCode;
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function verificationEmailHtml(verifyUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).verification;
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(verifyUrl, c.cta) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function passwordResetEmailHtml(resetUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).passwordReset;
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(resetUrl, c.cta) + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

/**
 * #N1 — code-based password reset email. Replaces the URL-based variant so
 * tokens never appear in Referer headers, MTA logs, or browser history.
 */
export function passwordResetCodeEmailHtml(code: string, lang: Lang): string {
  const c = getEmailCopy(lang).passwordResetCode;
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function welcomeEmailHtml(name: string | null, dashboardUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).welcome;
  const greeting = name ? c.heading.replace("!", `, ${name}!`) : c.heading;
  return baseLayout(
    greeting,
    paragraph(c.body) + ctaButton(dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

/**
 * Newsletter "Stay in the loop" confirmation. Sent once per NEW row in
 * `newsletter_subscribers` (migration 0086). Not to be confused with
 * `welcomeEmailHtml` above — that one fires post-registration after the
 * verification code is consumed.
 *
 * `unsubscribeUrl` is a placeholder until the real one-click unsubscribe
 * flow ships (deliberate follow-up PR). Today's value points to the
 * forms-level marketing unsubscribe so we don't ship a dead link.
 */
export function subscriptionWelcomeEmailHtml(unsubscribeUrl: string, lang: Lang): string {
  const c = getEmailCopy(lang).subscriptionWelcome;
  const bullets = `<ul style="margin:18px 0 6px;padding-left:20px;color:#d1d5db;font-size:14px;line-height:1.7;">
      <li style="margin:0 0 6px;">${c.bullet1}</li>
      <li style="margin:0 0 6px;">${c.bullet2}</li>
      <li style="margin:0;">${c.bullet3}</li>
    </ul>`;
  const unsubscribe = `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748b;text-align:center;">${c.footerNote}<br>
    <a href="${unsubscribeUrl}" style="color:#a78bfa;text-decoration:underline;">${c.unsubscribeHint}</a></p>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + bullets + unsubscribe,
    getEmailCopy(lang).footer,
  );
}

export function emailChangeEmailHtml(confirmUrl: string, newEmail: string, lang: Lang): string {
  const c = getEmailCopy(lang).emailChange;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    paragraph(`<strong>${newEmail}</strong>`, "#e2e8f0") +
    ctaButton(confirmUrl, c.cta) +
    muted(c.expires) +
    muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

/**
 * #N1 — code-based email-change confirmation. Replaces the URL variant so the
 * confirmation token never appears in Referer headers, MTA logs, or browser
 * history.
 */
export function emailChangeCodeEmailHtml(code: string, newEmail: string, lang: Lang): string {
  const c = getEmailCopy(lang).emailChangeCode;
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    paragraph(`<strong>${newEmail}</strong>`, "#e2e8f0") +
    codeBlock +
    muted(c.expires) +
    muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

/**
 * #N3 — login alert email no longer embeds the raw client IP. Original
 * design leaked rough geolocation + travel patterns to anyone with email
 * inbox access (especially shared / forwarded mailboxes). The full IP and
 * timestamp are still recorded server-side in `web_users.last_login_ip`
 * and `last_login_at`; users can review their own login history in the
 * settings panel.
 */
export function loginAlertEmailHtml(_ip: string, time: string, lang: Lang): string {
  const c = getEmailCopy(lang).loginAlert;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.time}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${time}</td></tr>
    </table>` +
    paragraph(`<strong style="color:#f87171;">${c.warning}</strong>`),
    getEmailCopy(lang).footer,
  );
}

// ─── Role change request emails ─────────────────────────────────────────────

export function roleRequestAdminEmailHtml(
  userName: string,
  userEmail: string,
  currentRole: string,
  requestedRole: string,
  reason: string | null,
  reviewUrl: string,
  lang: Lang,
): string {
  const c = getEmailCopy(lang).roleRequestAdmin;
  const reasonRow = reason
    ? `<tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.reason}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${reason}</td></tr>`
    : "";
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    paragraph(`<strong>${userName}</strong> (${userEmail})`, "#e2e8f0") +
    `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.from}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${currentRole}</td></tr>
      <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;${reason ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${c.to}</td><td style="padding:8px 12px;font-size:13px;color:#a78bfa;font-weight:600;${reason ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${requestedRole}</td></tr>
      ${reasonRow}
    </table>` +
    ctaButton(reviewUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

/**
 * #N4 — role-decision email no longer embeds `adminNote` in plaintext. Admin
 * notes are intended as internal commentary and may include security
 * concerns or personal observations that should not be forwarded to the
 * user (or to whoever they CC). When a note exists, we surface a generic
 * "additional details available in your dashboard" hint and link the user
 * to the dashboard, where the authenticated `roleChangeRequests.getMyRequest`
 * query exposes the note only to the requester.
 *
 * The legacy `adminNote` parameter is still accepted for backwards-compat
 * with callsites; the value is consumed only as a boolean signal.
 */
export function roleRequestDecisionEmailHtml(
  decision: "approved" | "denied",
  oldRole: string,
  newRole: string,
  adminNote: string | null,
  dashboardUrl: string,
  lang: Lang,
): string {
  const c = getEmailCopy(lang).roleRequestDecision;
  const heading = decision === "approved" ? c.approvedHeading : c.deniedHeading;
  const body = decision === "approved" ? c.approvedBody : c.deniedBody;
  const roleInfo = decision === "approved"
    ? paragraph(`${oldRole} → <strong style="color:#a78bfa;">${newRole}</strong>`, "#e2e8f0")
    : "";
  const noteHint = adminNote
    ? `<div style="margin:16px 0;padding:12px 16px;background-color:#1e293b;border-radius:10px;border-left:3px solid #7c3aed;">
        <p style="margin:0;font-size:13px;color:#94a3b8;">${c.note}</p>
      </div>`
    : "";
  return baseLayout(
    heading,
    paragraph(body) + roleInfo + noteHint + ctaButton(dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

// ─── Phase 2: permission elevation (English-only for launch) ────────────────

const permissionElevationCopy: Record<Lang, {
  subject: string;
  heading: string;
  body: (targetEmail: string, perms: string) => string;
  copy: string;
  expires: string;
  ignore: string;
}> = {
  en: {
    subject: "ManicBot — confirm staff permission elevation",
    heading: "Confirm permission elevation",
    body: (target, perms) => `You're granting sensitive permissions (<b>${perms}</b>) to <b>${target}</b>. Enter this code in the ManicBot dashboard to confirm.`,
    copy: "Tap to copy",
    expires: "The code expires in 15 minutes.",
    ignore: "If you didn't request this change, ignore this email and revoke the staff invitation.",
  },
  ru: {
    subject: "ManicBot — подтвердите расширение прав сотрудника",
    heading: "Подтверждение расширения прав",
    body: (target, perms) => `Вы предоставляете чувствительные права (<b>${perms}</b>) пользователю <b>${target}</b>. Введите этот код в панели ManicBot для подтверждения.`,
    copy: "Нажмите, чтобы скопировать",
    expires: "Код действует 15 минут.",
    ignore: "Если вы не запрашивали это изменение — проигнорируйте письмо и отзовите приглашение сотрудника.",
  },
  ua: {
    subject: "ManicBot — підтвердіть розширення прав співробітника",
    heading: "Підтвердження розширення прав",
    body: (target, perms) => `Ви надаєте чутливі права (<b>${perms}</b>) користувачу <b>${target}</b>. Введіть цей код у панелі ManicBot для підтвердження.`,
    copy: "Натисніть, щоб скопіювати",
    expires: "Код діє 15 хвилин.",
    ignore: "Якщо ви не запитували цю зміну — ігноруйте лист та відкличте запрошення.",
  },
  pl: {
    subject: "ManicBot — potwierdź rozszerzenie uprawnień personelu",
    heading: "Potwierdzenie rozszerzenia uprawnień",
    body: (target, perms) => `Przyznajesz uprawnienia wrażliwe (<b>${perms}</b>) użytkownikowi <b>${target}</b>. Wpisz ten kod w panelu ManicBot, aby potwierdzić.`,
    copy: "Kliknij, aby skopiować",
    expires: "Kod wygasa po 15 minutach.",
    ignore: "Jeśli nie prosiłeś o tę zmianę — zignoruj ten e-mail i cofnij zaproszenie.",
  },
};

export function getPermissionElevationCopy(lang: Lang) {
  return permissionElevationCopy[lang] ?? permissionElevationCopy.en;
}

export function permissionElevationCodeEmailHtml(
  code: string,
  targetEmail: string,
  permissions: string[],
  lang: Lang,
): string {
  const c = getPermissionElevationCopy(lang);
  const permsLabel = permissions.join(", ");
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body(targetEmail, permsLabel)) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

// ─── #P1-5 — Plain-text fallbacks ─────────────────────────────────────────
//
// Email clients that prefer text/plain (corporate scanners, screen readers,
// terminal mail) get a clean text alternative. We keep the same i18n copy
// so language fidelity is preserved across both representations.

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * #P1-5 — Stripe `invoice.payment_failed` notification.
 * Triggered from `src/billing/webhooks.js` after the grace_period flip.
 *
 * We avoid embedding raw card last4 or the full Stripe invoice id — those
 * are best read from the dashboard, not the inbox.
 */
export function paymentFailedEmailHtml(
  options: { amountFormatted: string; planLabel: string; updatePaymentUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).paymentFailed;
  const details = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.amount}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${options.amountFormatted}</td></tr>
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.plan}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;">${options.planLabel}</td></tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    details +
    paragraph(c.nextStep) +
    ctaButton(options.updatePaymentUrl, c.cta) +
    muted(c.grace),
    getEmailCopy(lang).footer,
  );
}

export function paymentFailedEmailText(
  options: { amountFormatted: string; planLabel: string; updatePaymentUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).paymentFailed;
  return [
    c.heading,
    "",
    c.body,
    `${c.amount}: ${options.amountFormatted}`,
    `${c.plan}: ${options.planLabel}`,
    "",
    c.nextStep,
    options.updatePaymentUrl,
    "",
    c.grace,
    "",
    stripTags(getEmailCopy(lang).footer),
  ].join("\n");
}

/**
 * #P1-5 — `customer.subscription.updated` plan-upgrade notification.
 * Fired only when the new plan tier is strictly HIGHER than the previous
 * one (per PLAN_ORDER in webhooks.js). Downgrades and lateral moves are
 * intentionally NOT emailed here — those would deserve a different tone.
 */
export function planUpgradeEmailHtml(
  options: { oldPlanLabel: string; newPlanLabel: string; dashboardUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).planUpgrade;
  const planRow = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.from}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${options.oldPlanLabel}</td></tr>
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.to}</td><td style="padding:8px 12px;font-size:13px;color:#a78bfa;font-weight:600;">${options.newPlanLabel}</td></tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + planRow + paragraph(c.welcome) + ctaButton(options.dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

export function planUpgradeEmailText(
  options: { oldPlanLabel: string; newPlanLabel: string; dashboardUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).planUpgrade;
  return [
    c.heading,
    "",
    c.body,
    `${c.from}: ${options.oldPlanLabel}`,
    `${c.to}: ${options.newPlanLabel}`,
    "",
    c.welcome,
    options.dashboardUrl,
    "",
    stripTags(getEmailCopy(lang).footer),
  ].join("\n");
}

/**
 * #P1-5 — master-invite email. Fired when a tenant_owner adds a master
 * row to `tenant_roles` via `salon.addMaster` or `salon.createMasterAccount`.
 *
 * We do NOT include the auto-generated password in the email body — the
 * dashboard call that triggers this email returns the password to the
 * inviting owner so they can share it through a trusted channel of their
 * choice. Sending a password by email is a textbook credential-leakage
 * antipattern and is forbidden by our `SECURITY_FINDINGS.md` posture.
 */
export function masterInviteEmailHtml(
  options: { salonName: string; roleLabel: string; dashboardUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).masterInvite;
  const details = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.salon}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${options.salonName}</td></tr>
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;">${c.role}</td><td style="padding:8px 12px;font-size:13px;color:#a78bfa;font-weight:600;">${options.roleLabel}</td></tr>
  </table>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + details + paragraph(c.note) + ctaButton(options.dashboardUrl, c.cta),
    getEmailCopy(lang).footer,
  );
}

export function masterInviteEmailText(
  options: { salonName: string; roleLabel: string; dashboardUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).masterInvite;
  return [
    c.heading,
    "",
    c.body,
    `${c.salon}: ${options.salonName}`,
    `${c.role}: ${options.roleLabel}`,
    "",
    c.note,
    options.dashboardUrl,
    "",
    stripTags(getEmailCopy(lang).footer),
  ].join("\n");
}

/**
 * #P1-5 — support-reply notification. Fired from `support.replyToTicket`
 * (web) when a support / technical_support / system_admin agent replies on
 * a platform ticket. We do NOT include the reply body in plaintext to
 * avoid leaking sensitive support content to whoever forwards the email;
 * a short preview (≤ 240 chars, no HTML) is fine.
 */
export function supportReplyEmailHtml(
  options: { ticketId: string; previewText: string; ticketUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).supportReply;
  const safePreview = stripTags(options.previewText).slice(0, 240);
  const details = `<table style="margin:16px 0;width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px 12px;font-size:13px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">${c.ticket}</td><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.06);">${options.ticketId}</td></tr>
  </table>`;
  const previewBlock = safePreview
    ? `<div style="margin:16px 0;padding:12px 16px;background-color:#1e293b;border-radius:10px;border-left:3px solid #7c3aed;">
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${c.preview}</p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#e2e8f0;">${safePreview}</p>
      </div>`
    : "";
  return baseLayout(
    c.heading,
    paragraph(c.body) +
    details +
    previewBlock +
    ctaButton(options.ticketUrl, c.cta) +
    muted(c.footerNote),
    getEmailCopy(lang).footer,
  );
}

export function supportReplyEmailText(
  options: { ticketId: string; previewText: string; ticketUrl: string },
  lang: Lang,
): string {
  const c = getEmailCopy(lang).supportReply;
  const safePreview = stripTags(options.previewText).slice(0, 240);
  return [
    c.heading,
    "",
    c.body,
    `${c.ticket}: ${options.ticketId}`,
    "",
    safePreview ? `${c.preview}: ${safePreview}` : "",
    "",
    options.ticketUrl,
    "",
    c.footerNote,
    "",
    stripTags(getEmailCopy(lang).footer),
  ].filter(Boolean).join("\n");
}

// ─── Ownership transfer ─────────────────────────────────────────────────────

const ownershipCopy: Record<Lang, {
  request: { subject: string; heading: string; body1: string; body2: string; cta: string; expires: string; ignore: string };
  oldOwner: { subject: string; heading: string; body: string; loginNote: string };
  newOwner: { subject: string; heading: string; body: string; loginNote: string };
}> = {
  ru: {
    request: {
      subject: "Подтвердите передачу прав владения",
      heading: "Подтверждение передачи прав",
      body1: "Вы инициировали передачу прав владения салоном",
      body2: "После подтверждения вы станете мастером, а получатель — владельцем салона. Если запрос инициировали не вы — просто проигнорируйте это письмо.",
      cta: "Подтвердить передачу",
      expires: "Ссылка действительна 24 часа.",
      ignore: "Если вы не запрашивали передачу прав — игнорируйте это письмо. Никаких изменений не произойдёт.",
    },
    oldOwner: {
      subject: "Права владения переданы",
      heading: "Права владения переданы",
      body: "Вы передали права владения салоном.",
      loginNote: "Ваша роль теперь — мастер. Для входа используйте обычные данные.",
    },
    newOwner: {
      subject: "Вы — владелец салона",
      heading: "Вы — новый владелец салона",
      body: "Бывший владелец передал вам права. Теперь вы управляете салоном.",
      loginNote: "Откройте кабинет, чтобы начать работу.",
    },
  },
  ua: {
    request: {
      subject: "Підтвердьте передачу прав власника",
      heading: "Підтвердження передачі прав",
      body1: "Ви ініціювали передачу прав власника салоном",
      body2: "Після підтвердження ви станете майстром, а отримувач — власником салону. Якщо запит ініціювали не ви — просто проігноруйте цей лист.",
      cta: "Підтвердити передачу",
      expires: "Посилання дійсне 24 години.",
      ignore: "Якщо ви не запитували передачу прав — проігноруйте цей лист. Жодних змін не відбудеться.",
    },
    oldOwner: {
      subject: "Права власника передано",
      heading: "Права власника передано",
      body: "Ви передали права власника салоном.",
      loginNote: "Ваша роль тепер — майстер. Для входу використовуйте звичайні дані.",
    },
    newOwner: {
      subject: "Ви — власник салону",
      heading: "Ви — новий власник салону",
      body: "Колишній власник передав вам права. Тепер ви керуєте салоном.",
      loginNote: "Відкрийте кабінет, щоб почати роботу.",
    },
  },
  en: {
    request: {
      subject: "Confirm ownership transfer",
      heading: "Confirm ownership transfer",
      body1: "You initiated a transfer of salon ownership",
      body2: "After confirmation, you become a master and the recipient becomes the salon owner. If you did not initiate this request, simply ignore this email.",
      cta: "Confirm transfer",
      expires: "This link is valid for 24 hours.",
      ignore: "If you did not request ownership transfer — ignore this email. Nothing will change.",
    },
    oldOwner: {
      subject: "Ownership transferred",
      heading: "Ownership transferred",
      body: "You transferred salon ownership.",
      loginNote: "Your role is now master. Log in with your usual credentials.",
    },
    newOwner: {
      subject: "You are now the salon owner",
      heading: "You are now the salon owner",
      body: "The previous owner transferred ownership to you. You now manage the salon.",
      loginNote: "Open the dashboard to get started.",
    },
  },
  pl: {
    request: {
      subject: "Potwierdź przekazanie własności",
      heading: "Potwierdzenie przekazania własności",
      body1: "Zainicjowano przekazanie własności salonu",
      body2: "Po potwierdzeniu zostaniesz mistrzem, a odbiorca — właścicielem salonu. Jeśli to nie Ty zainicjowałeś prośbę — po prostu zignoruj tę wiadomość.",
      cta: "Potwierdź przekazanie",
      expires: "Link jest ważny 24 godziny.",
      ignore: "Jeśli nie prosiłeś o przekazanie własności — zignoruj tę wiadomość. Nic się nie zmieni.",
    },
    oldOwner: {
      subject: "Własność przekazana",
      heading: "Własność przekazana",
      body: "Przekazałeś własność salonu.",
      loginNote: "Twoja rola to teraz mistrz. Zaloguj się jak zwykle.",
    },
    newOwner: {
      subject: "Jesteś nowym właścicielem salonu",
      heading: "Jesteś nowym właścicielem salonu",
      body: "Poprzedni właściciel przekazał własność Tobie. Teraz zarządzasz salonem.",
      loginNote: "Otwórz panel, aby rozpocząć.",
    },
  },
};

export function getOwnershipCopy(lang: Lang) {
  return ownershipCopy[lang] ?? ownershipCopy.en;
}

export function ownershipTransferRequestEmailHtml(opts: {
  fromName: string;
  toName: string;
  toEmail: string;
  tenantName: string;
  confirmUrl: string;
  lang: Lang;
}): string {
  const c = getOwnershipCopy(opts.lang).request;
  return baseLayout(
    c.heading,
    paragraph(`${c.body1}: <strong>${opts.tenantName}</strong>`, "#e2e8f0") +
    paragraph(`${opts.toName} (<strong>${opts.toEmail}</strong>)`, "#d1d5db") +
    paragraph(c.body2) +
    ctaButton(opts.confirmUrl, c.cta) +
    muted(c.expires) +
    muted(c.ignore),
    getEmailCopy(opts.lang).footer,
  );
}

export function ownershipTransferCompletedOldOwnerEmailHtml(opts: {
  newOwnerName: string;
  tenantName: string;
  lang: Lang;
}): string {
  const c = getOwnershipCopy(opts.lang).oldOwner;
  return baseLayout(
    c.heading,
    paragraph(`${c.body} <strong>${opts.tenantName}</strong>`, "#e2e8f0") +
    paragraph(`→ ${opts.newOwnerName}`, "#d1d5db") +
    muted(c.loginNote),
    getEmailCopy(opts.lang).footer,
  );
}

export function ownershipTransferCompletedNewOwnerEmailHtml(opts: {
  oldOwnerName: string;
  tenantName: string;
  lang: Lang;
}): string {
  const c = getOwnershipCopy(opts.lang).newOwner;
  return baseLayout(
    c.heading,
    paragraph(`${c.body}`) +
    paragraph(`<strong>${opts.tenantName}</strong> ← ${opts.oldOwnerName}`, "#e2e8f0") +
    muted(c.loginNote),
    getEmailCopy(opts.lang).footer,
  );
}

// ─── Masters-tab overhaul: 4 new templates (commit cb2383f migrations) ──────
//
// These templates are kept inline (function-local i18n) rather than extending
// the `emailCopy` type so the schema-foundation PR doesn't grow it for every
// micro-string. Keys: salonInviteExisting, salonInviteNew, passwordResetByOwner,
// actionOtp. Each function ships ru/ua/en/pl copy; English is the fallback.

type InviteCopy = {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  note: string;
};

function inviteExistingUserCopy(lang: Lang, salonName: string): InviteCopy {
  const sn = salonName || "ManicBot";
  switch (lang) {
    case "ru":
      return {
        subject: `${sn} приглашает вас стать мастером — ManicBot`,
        heading: "Приглашение в салон",
        body: `${sn} приглашает вас присоединиться как мастер. Откройте панель, чтобы принять приглашение.`,
        cta: "Открыть приглашение",
        note: "Приглашение действительно 7 дней.",
      };
    case "ua":
      return {
        subject: `${sn} запрошує вас стати майстром — ManicBot`,
        heading: "Запрошення в салон",
        body: `${sn} запрошує вас приєднатися як майстер. Відкрийте панель, щоб прийняти запрошення.`,
        cta: "Відкрити запрошення",
        note: "Запрошення дійсне 7 днів.",
      };
    case "pl":
      return {
        subject: `${sn} zaprasza Cię jako mistrza — ManicBot`,
        heading: "Zaproszenie do salonu",
        body: `${sn} zaprasza Cię do dołączenia jako mistrz. Otwórz panel, aby zaakceptować zaproszenie.`,
        cta: "Otwórz zaproszenie",
        note: "Zaproszenie jest ważne przez 7 dni.",
      };
    default:
      return {
        subject: `${sn} invited you to join as a master — ManicBot`,
        heading: "Salon invitation",
        body: `${sn} invited you to join their team as a master. Open the dashboard to accept.`,
        cta: "Open invitation",
        note: "This invitation expires in 7 days.",
      };
  }
}

function inviteNewUserCopy(lang: Lang, salonName: string): InviteCopy {
  const sn = salonName || "ManicBot";
  switch (lang) {
    case "ru":
      return {
        subject: `${sn} приглашает вас в ManicBot`,
        heading: "Регистрация мастера",
        body: `${sn} приглашает вас стать мастером в ManicBot. Создайте аккаунт по ссылке ниже — ваш email уже заполнен.`,
        cta: "Зарегистрироваться",
        note: "Ссылка одноразовая и действует 7 дней.",
      };
    case "ua":
      return {
        subject: `${sn} запрошує вас у ManicBot`,
        heading: "Реєстрація майстра",
        body: `${sn} запрошує вас стати майстром у ManicBot. Створіть акаунт за посиланням нижче — ваш email вже вписаний.`,
        cta: "Зареєструватися",
        note: "Посилання одноразове і дійсне 7 днів.",
      };
    case "pl":
      return {
        subject: `${sn} zaprasza Cię do ManicBot`,
        heading: "Rejestracja mistrza",
        body: `${sn} zaprasza Cię, abyś dołączył jako mistrz w ManicBot. Utwórz konto za pomocą poniższego linku — Twój email jest już wpisany.`,
        cta: "Zarejestruj się",
        note: "Link jest jednorazowy i ważny przez 7 dni.",
      };
    default:
      return {
        subject: `${sn} invited you to ManicBot`,
        heading: "Master registration",
        body: `${sn} invited you to join ManicBot as a master. Create your account via the link below — your email is pre-filled.`,
        cta: "Register",
        note: "This link is single-use and expires in 7 days.",
      };
  }
}

/** Scenario A — recipient already has a web_users account. */
export function masterInviteExistingUserHtml(
  options: { salonName: string; acceptUrl: string },
  lang: Lang,
): string {
  const c = inviteExistingUserCopy(lang, options.salonName);
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(options.acceptUrl, c.cta) + muted(c.note),
    getEmailCopy(lang).footer,
  );
}

export function masterInviteExistingUserText(
  options: { salonName: string; acceptUrl: string },
  lang: Lang,
): string {
  const c = inviteExistingUserCopy(lang, options.salonName);
  return [c.heading, "", c.body, "", options.acceptUrl, "", c.note, "", stripTags(getEmailCopy(lang).footer)].join("\n");
}

/** Scenario B — no web_users row; recipient registers via magic link. */
export function masterInviteNewUserHtml(
  options: { salonName: string; registerUrl: string },
  lang: Lang,
): string {
  const c = inviteNewUserCopy(lang, options.salonName);
  return baseLayout(
    c.heading,
    paragraph(c.body) + ctaButton(options.registerUrl, c.cta) + muted(c.note),
    getEmailCopy(lang).footer,
  );
}

export function masterInviteNewUserText(
  options: { salonName: string; registerUrl: string },
  lang: Lang,
): string {
  const c = inviteNewUserCopy(lang, options.salonName);
  return [c.heading, "", c.body, "", options.registerUrl, "", c.note, "", stripTags(getEmailCopy(lang).footer)].join("\n");
}

type PasswordResetByOwnerCopy = {
  subject: string;
  heading: string;
  body: string;
  yourPassword: string;
  cta: string;
  warning: string;
};

function passwordResetByOwnerCopy(lang: Lang, salonName: string): PasswordResetByOwnerCopy {
  const sn = salonName || "ManicBot";
  switch (lang) {
    case "ru":
      return {
        subject: `Ваш пароль был обновлён — ${sn}`,
        heading: "Новый пароль",
        body: `Владелец салона «${sn}» сбросил ваш пароль. Используйте новый пароль ниже для входа.`,
        yourPassword: "Ваш новый пароль:",
        cta: "Войти в кабинет",
        warning: "Если это не вы или вы не знаете этот салон — свяжитесь с поддержкой.",
      };
    case "ua":
      return {
        subject: `Ваш пароль було оновлено — ${sn}`,
        heading: "Новий пароль",
        body: `Власник салону «${sn}» скинув ваш пароль. Використайте новий пароль нижче для входу.`,
        yourPassword: "Ваш новий пароль:",
        cta: "Увійти в кабінет",
        warning: "Якщо це не ви або ви не знаєте цей салон — звʼяжіться з підтримкою.",
      };
    case "pl":
      return {
        subject: `Twoje hasło zostało zmienione — ${sn}`,
        heading: "Nowe hasło",
        body: `Właściciel salonu „${sn}" zresetował Twoje hasło. Użyj nowego hasła poniżej, aby się zalogować.`,
        yourPassword: "Twoje nowe hasło:",
        cta: "Zaloguj się",
        warning: "Jeśli to nie Ty lub nie znasz tego salonu — skontaktuj się z pomocą.",
      };
    default:
      return {
        subject: `Your password was reset — ${sn}`,
        heading: "New password",
        body: `The owner of "${sn}" has reset your password. Use the new password below to log in.`,
        yourPassword: "Your new password:",
        cta: "Sign in",
        warning: "If this wasn't you, or you don't recognize this salon, contact support.",
      };
  }
}

/** Salon owner triggered a password reset; the new plaintext is emailed
 *  directly to the master. The salon never sees the new password. */
export function masterPasswordResetByOwnerHtml(
  options: { salonName: string; newPassword: string; loginUrl: string },
  lang: Lang,
): string {
  const c = passwordResetByOwnerCopy(lang, options.salonName);
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:14px 24px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1.5px;user-select:all;-webkit-user-select:all;cursor:text;">${options.newPassword}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.yourPassword}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + codeBlock + ctaButton(options.loginUrl, c.cta) + muted(c.warning),
    getEmailCopy(lang).footer,
  );
}

export function masterPasswordResetByOwnerText(
  options: { salonName: string; newPassword: string; loginUrl: string },
  lang: Lang,
): string {
  const c = passwordResetByOwnerCopy(lang, options.salonName);
  return [
    c.heading,
    "",
    c.body,
    "",
    `${c.yourPassword} ${options.newPassword}`,
    "",
    options.loginUrl,
    "",
    c.warning,
    "",
    stripTags(getEmailCopy(lang).footer),
  ].join("\n");
}

type ActionOtpCopy = {
  subject: string;
  heading: string;
  body: string;
  expires: string;
  ignore: string;
  copy: string;
};

function actionOtpCopy(lang: Lang, actionLabel: string): ActionOtpCopy {
  switch (lang) {
    case "ru":
      return {
        subject: "Код подтверждения — ManicBot",
        heading: "Код подтверждения",
        body: `Введите этот код для подтверждения действия: «${actionLabel}».`,
        expires: "Код действителен 15 минут.",
        ignore: "Если вы не запрашивали действие — проигнорируйте письмо и смените пароль.",
        copy: "Нажмите, чтобы скопировать код",
      };
    case "ua":
      return {
        subject: "Код підтвердження — ManicBot",
        heading: "Код підтвердження",
        body: `Введіть цей код для підтвердження дії: «${actionLabel}».`,
        expires: "Код дійсний 15 хвилин.",
        ignore: "Якщо ви не запитували дію — проігноруйте лист і змініть пароль.",
        copy: "Натисніть, щоб скопіювати код",
      };
    case "pl":
      return {
        subject: "Kod potwierdzający — ManicBot",
        heading: "Kod potwierdzający",
        body: `Wprowadź ten kod, aby potwierdzić działanie: „${actionLabel}".`,
        expires: "Kod jest ważny przez 15 minut.",
        ignore: "Jeśli nie żądałeś tej akcji — zignoruj wiadomość i zmień hasło.",
        copy: "Kliknij, aby skopiować kod",
      };
    default:
      return {
        subject: "Confirmation code — ManicBot",
        heading: "Confirmation code",
        body: `Enter this code to confirm: "${actionLabel}".`,
        expires: "This code expires in 15 minutes.",
        ignore: "If you did not request this action, ignore this email and change your password.",
        copy: "Click to copy the code",
      };
  }
}

/** Generic OTP code sent for any destructive/role-escalation mutation.
 *  Caller passes a localized action label ("Archive master Olga") and the
 *  6-digit code from requestActionOtp(). */
export function actionOtpEmailHtml(
  options: { code: string; actionLabel: string },
  lang: Lang,
): string {
  const c = actionOtpCopy(lang, options.actionLabel);
  const codeBlock = `<div style="margin:24px auto;text-align:center;">
    <div style="display:inline-block;padding:16px 32px;background-color:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:10px;user-select:all;-webkit-user-select:all;cursor:text;">${options.code}</div>
    <div style="margin-top:10px;font-size:12px;color:#64748b;">${c.copy}</div>
  </div>`;
  return baseLayout(
    c.heading,
    paragraph(c.body) + codeBlock + muted(c.expires) + muted(c.ignore),
    getEmailCopy(lang).footer,
  );
}

export function actionOtpEmailText(
  options: { code: string; actionLabel: string },
  lang: Lang,
): string {
  const c = actionOtpCopy(lang, options.actionLabel);
  return [c.heading, "", c.body, "", options.code, "", c.expires, c.ignore, "", stripTags(getEmailCopy(lang).footer)].join("\n");
}

// Subject helpers for sender wrappers — exported so emailService.ts can pull
// without re-importing the lang switch.
export function getInviteExistingUserSubject(lang: Lang, salonName: string): string {
  return inviteExistingUserCopy(lang, salonName).subject;
}
export function getInviteNewUserSubject(lang: Lang, salonName: string): string {
  return inviteNewUserCopy(lang, salonName).subject;
}
export function getPasswordResetByOwnerSubject(lang: Lang, salonName: string): string {
  return passwordResetByOwnerCopy(lang, salonName).subject;
}
export function getActionOtpSubject(lang: Lang): string {
  return actionOtpCopy(lang, "").subject;
}
