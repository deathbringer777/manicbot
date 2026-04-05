import type { Lang } from "~/lib/i18n";

export const authCopy: Record<
  Lang,
  {
    shared: {
      back: string;
      loginButton: string;
      brandTitle: string;
      brandSubtitle: string;
      themeLight: string;
      themeDark: string;
      featureOneTitle: string;
      featureOneText: string;
      featureTwoTitle: string;
      featureTwoText: string;
      featureThreeTitle: string;
      featureThreeText: string;
      or: string;
    };
    login: {
      kicker: string;
      title: string;
      description: string;
      panelTitle: string;
      panelDescription: string;
      email: string;
      password: string;
      invalidCredentials: string;
      googleStartError: string;
      submit: string;
      submitting: string;
      google: string;
      googleLoading: string;
      noAccount: string;
      register: string;
      showPassword: string;
      hidePassword: string;
    };
    register: {
      kicker: string;
      title: string;
      description: string;
      panelTitle: string;
      panelDescription: string;
      role: string;
      roleOwner: string;
      roleMaster: string;
      salonName: string;
      yourName: string;
      password: string;
      passwordHint: string;
      confirmPassword: string;
      referral: string;
      referralPlaceholder: string;
      referralGoogle: string;
      referralInstagram: string;
      referralTelegram: string;
      referralFriends: string;
      referralOther: string;
      passwordsMismatch: string;
      passwordTooShort: string;
      googleStartError: string;
      submit: string;
      submitting: string;
      google: string;
      googleLoading: string;
      hasAccount: string;
      login: string;
      registrationError: string;
      conflict: string;
      verifyNotice: string;
      verifyReady: string;
      showPassword: string;
      hidePassword: string;
      tosLabel: string;
      tosLinkText: string;
      tosRequired: string;
      googlePrefillHint: string;
      googlePrefillExpired: string;
    };
  }
> = {
  ru: {
    shared: {
      back: "Назад",
      loginButton: "Войти",
      brandTitle: "ManicBot",
      brandSubtitle: "Платформа записи для салонов и мастеров",
      themeLight: "Светлая",
      themeDark: "Тёмная",
      featureOneTitle: "Все каналы в одном окне",
      featureOneText: "Telegram, Instagram и WhatsApp сходятся в единый поток общения с клиентом.",
      featureTwoTitle: "Календарь без хаоса",
      featureTwoText: "Записи, напоминания и рабочие смены синхронизируются в одной панели.",
      featureThreeTitle: "Команда и роли",
      featureThreeText: "Владелец, мастер и поддержка работают в одном кабинете без лишних переключений.",
      or: "или",
    },
    login: {
      kicker: "Кабинет ManicBot",
      title: "Войти в панель и сразу вернуться к работе с клиентами",
      description: "Записи, каналы и команда собраны в одном интерфейсе. Экран входа теперь ощущается частью ManicBot и нормально работает и в светлой, и в тёмной теме.",
      panelTitle: "Вход в кабинет",
      panelDescription: "Для владельцев салонов, мастеров и команды поддержки.",
      email: "Email",
      password: "Пароль",
      invalidCredentials: "Неверный email или пароль",
      googleStartError: "Не удалось начать вход через Google",
      submit: "Войти",
      submitting: "Вход...",
      google: "Войти через Google",
      googleLoading: "Перенаправление...",
      noAccount: "Нет аккаунта?",
      register: "Зарегистрироваться",
      showPassword: "Показать пароль",
      hidePassword: "Скрыть пароль",
    },
    register: {
      kicker: "Новый кабинет",
      title: "Создать кабинет и перейти к настройке салона без лишних шагов",
      description: "Регистрация занимает пару минут. После входа можно подключить каналы, календарь и публичную страницу салона.",
      panelTitle: "Создать кабинет",
      panelDescription: "Выберите роль и заполните базовые данные.",
      role: "Роль",
      roleOwner: "Владелец салона",
      roleMaster: "Мастер",
      salonName: "Название салона",
      yourName: "Ваше имя",
      password: "Пароль",
      passwordHint: "минимум 12 символов",
      confirmPassword: "Подтверждение пароля",
      referral: "Где вы о нас узнали?",
      referralPlaceholder: "Выберите источник",
      referralGoogle: "Google",
      referralInstagram: "Instagram",
      referralTelegram: "Telegram",
      referralFriends: "Друзья / знакомые",
      referralOther: "Другое",
      passwordsMismatch: "Пароли не совпадают",
      passwordTooShort: "Пароль должен содержать минимум 12 символов",
      googleStartError: "Не удалось начать вход через Google",
      submit: "Зарегистрироваться",
      submitting: "Регистрация...",
      google: "Войти через Google",
      googleLoading: "Перенаправление...",
      hasAccount: "Уже есть аккаунт?",
      login: "Войти",
      registrationError: "Ошибка регистрации",
      conflict: "Регистрация не удалась. Попробуйте другой email или войдите в существующий кабинет.",
      verifyNotice: "Аккаунт создан. Подтвердите email и затем войдите.",
      verifyReady: "Аккаунт создан. Можно сразу входить в панель.",
      showPassword: "Показать пароль",
      hidePassword: "Скрыть пароль",
      tosLabel: "Регистрируясь, вы принимаете",
      tosLinkText: "ПРАВИЛА ПОЛЬЗОВАНИЯ",
      tosRequired: "Необходимо принять правила пользования",
      googlePrefillHint:
        "Аккаунт Google подтверждён. Укажите пароль и роль — после регистрации вы сразу войдёте в кабинет.",
      googlePrefillExpired:
        "Ссылка из Google устарела или недействительна. Зарегистрируйтесь вручную или снова нажмите «Войти через Google».",
    },
  },
  ua: {
    shared: {
      back: "Назад",
      loginButton: "Увійти",
      brandTitle: "ManicBot",
      brandSubtitle: "Платформа запису для салонів і майстрів",
      themeLight: "Світла",
      themeDark: "Темна",
      featureOneTitle: "Усі канали в одному вікні",
      featureOneText: "Telegram, Instagram і WhatsApp збираються в єдиний потік спілкування з клієнтом.",
      featureTwoTitle: "Календар без хаосу",
      featureTwoText: "Записи, нагадування та робочі зміни синхронізуються в одній панелі.",
      featureThreeTitle: "Команда та ролі",
      featureThreeText: "Власник, майстер і підтримка працюють в одному кабінеті без зайвих перемикань.",
      or: "або",
    },
    login: {
      kicker: "Кабінет ManicBot",
      title: "Увійти в панель і одразу повернутися до роботи з клієнтами",
      description: "Записи, канали й команда зібрані в одному інтерфейсі. Екран входу тепер відчувається частиною ManicBot і нормально працює і у світлій, і в темній темі.",
      panelTitle: "Вхід до кабінету",
      panelDescription: "Для власників салонів, майстрів і команди підтримки.",
      email: "Email",
      password: "Пароль",
      invalidCredentials: "Невірний email або пароль",
      googleStartError: "Не вдалося почати вхід через Google",
      submit: "Увійти",
      submitting: "Вхід...",
      google: "Увійти через Google",
      googleLoading: "Переадресація...",
      noAccount: "Немає акаунта?",
      register: "Зареєструватися",
      showPassword: "Показати пароль",
      hidePassword: "Сховати пароль",
    },
    register: {
      kicker: "Новий кабінет",
      title: "Створити кабінет і перейти до налаштування салону без зайвих кроків",
      description: "Реєстрація займає кілька хвилин. Після входу можна підключити канали, календар і публічну сторінку салону.",
      panelTitle: "Створити кабінет",
      panelDescription: "Оберіть роль і заповніть базові дані.",
      role: "Роль",
      roleOwner: "Власник салону",
      roleMaster: "Майстер",
      salonName: "Назва салону",
      yourName: "Ваше ім'я",
      password: "Пароль",
      passwordHint: "мінімум 12 символів",
      confirmPassword: "Підтвердження пароля",
      referral: "Звідки ви про нас дізналися?",
      referralPlaceholder: "Оберіть джерело",
      referralGoogle: "Google",
      referralInstagram: "Instagram",
      referralTelegram: "Telegram",
      referralFriends: "Друзі / знайомі",
      referralOther: "Інше",
      passwordsMismatch: "Паролі не збігаються",
      passwordTooShort: "Пароль має містити щонайменше 12 символів",
      googleStartError: "Не вдалося почати вхід через Google",
      submit: "Зареєструватися",
      submitting: "Реєстрація...",
      google: "Увійти через Google",
      googleLoading: "Переадресація...",
      hasAccount: "Вже є акаунт?",
      login: "Увійти",
      registrationError: "Помилка реєстрації",
      conflict: "Реєстрація не вдалася. Спробуйте інший email або увійдіть в існуючий кабінет.",
      verifyNotice: "Акаунт створено. Підтвердьте email, а потім увійдіть.",
      verifyReady: "Акаунт створено. Можна одразу входити в панель.",
      showPassword: "Показати пароль",
      hidePassword: "Сховати пароль",
      tosLabel: "Реєструючись, ви приймаєте",
      tosLinkText: "ПРАВИЛА КОРИСТУВАННЯ",
      tosRequired: "Необхідно прийняти правила користування",
      googlePrefillHint:
        "Обліковий запис Google підтверджено. Задайте пароль і роль — після реєстрації ви одразу увійдете в кабінет.",
      googlePrefillExpired:
        "Посилання з Google застаріло або недійсне. Зареєструйтесь вручну або знову натисніть «Увійти через Google».",
    },
  },
  en: {
    shared: {
      back: "Back",
      loginButton: "Log in",
      brandTitle: "ManicBot",
      brandSubtitle: "Booking platform for salons and beauty masters",
      themeLight: "Light",
      themeDark: "Dark",
      featureOneTitle: "All channels in one view",
      featureOneText: "Telegram, Instagram, and WhatsApp flow into one client conversation stream.",
      featureTwoTitle: "Calendar without chaos",
      featureTwoText: "Appointments, reminders, and team schedules stay in sync inside one panel.",
      featureThreeTitle: "Team roles that make sense",
      featureThreeText: "Owner, master, and support work inside one cabinet without bouncing between tools.",
      or: "or",
    },
    login: {
      kicker: "ManicBot cabinet",
      title: "Sign in and get straight back to client work",
      description: "Appointments, channels, and your team live in one interface. The sign-in screen now feels like part of ManicBot and works properly in both light and dark themes.",
      panelTitle: "Sign in",
      panelDescription: "For salon owners, masters, and support staff.",
      email: "Email",
      password: "Password",
      invalidCredentials: "Wrong email or password",
      googleStartError: "Could not start Google sign-in",
      submit: "Sign in",
      submitting: "Signing in...",
      google: "Continue with Google",
      googleLoading: "Redirecting...",
      noAccount: "No account yet?",
      register: "Create one",
      showPassword: "Show password",
      hidePassword: "Hide password",
    },
    register: {
      kicker: "New cabinet",
      title: "Create your cabinet and move straight into salon setup",
      description: "Registration takes a couple of minutes. After sign-in you can connect channels, calendar sync, and your public salon page.",
      panelTitle: "Create account",
      panelDescription: "Choose your role and fill in the basics.",
      role: "Role",
      roleOwner: "Salon owner",
      roleMaster: "Master",
      salonName: "Salon name",
      yourName: "Your name",
      password: "Password",
      passwordHint: "at least 12 characters",
      confirmPassword: "Confirm password",
      referral: "How did you hear about us?",
      referralPlaceholder: "Choose a source",
      referralGoogle: "Google",
      referralInstagram: "Instagram",
      referralTelegram: "Telegram",
      referralFriends: "Friends / colleagues",
      referralOther: "Other",
      passwordsMismatch: "Passwords do not match",
      passwordTooShort: "Password must be at least 12 characters long",
      googleStartError: "Could not start Google sign-in",
      submit: "Create account",
      submitting: "Creating account...",
      google: "Continue with Google",
      googleLoading: "Redirecting...",
      hasAccount: "Already have an account?",
      login: "Sign in",
      registrationError: "Registration error",
      conflict: "Registration failed. Try another email or sign in to your existing cabinet.",
      verifyNotice: "Account created. Verify your email and then sign in.",
      verifyReady: "Account created. You can sign in right away.",
      showPassword: "Show password",
      hidePassword: "Hide password",
      tosLabel: "By registering, you agree to the",
      tosLinkText: "TERMS OF USE",
      tosRequired: "You must accept the Terms of Use",
      googlePrefillHint:
        "Your Google account is verified. Set a password and role — after registration you will sign in right away.",
      googlePrefillExpired:
        "The Google link expired or is invalid. Register manually or try “Continue with Google” again.",
    },
  },
  pl: {
    shared: {
      back: "Wróć",
      loginButton: "Zaloguj",
      brandTitle: "ManicBot",
      brandSubtitle: "Platforma rezerwacji dla salonów i stylistek",
      themeLight: "Jasna",
      themeDark: "Ciemna",
      featureOneTitle: "Wszystkie kanały w jednym miejscu",
      featureOneText: "Telegram, Instagram i WhatsApp wpadają do jednego strumienia rozmów z klientką.",
      featureTwoTitle: "Kalendarz bez chaosu",
      featureTwoText: "Wizyty, przypomnienia i grafiki zespołu synchronizują się w jednym panelu.",
      featureThreeTitle: "Role bez zamieszania",
      featureThreeText: "Właścicielka, stylistka i support pracują w jednym panelu bez skakania między narzędziami.",
      or: "lub",
    },
    login: {
      kicker: "Panel ManicBot",
      title: "Zaloguj się i od razu wróć do pracy z klientkami",
      description: "Wizyty, kanały i zespół są w jednym interfejsie. Ekran logowania wreszcie wygląda jak część ManicBot i działa dobrze zarówno w jasnym, jak i ciemnym motywie.",
      panelTitle: "Logowanie",
      panelDescription: "Dla właścicielek salonów, stylistek i zespołu wsparcia.",
      email: "Email",
      password: "Hasło",
      invalidCredentials: "Nieprawidłowy email lub hasło",
      googleStartError: "Nie udało się rozpocząć logowania przez Google",
      submit: "Zaloguj się",
      submitting: "Logowanie...",
      google: "Zaloguj się przez Google",
      googleLoading: "Przekierowanie...",
      noAccount: "Nie masz konta?",
      register: "Załóż konto",
      showPassword: "Pokaż hasło",
      hidePassword: "Ukryj hasło",
    },
    register: {
      kicker: "Nowy panel",
      title: "Załóż konto i przejdź od razu do konfiguracji salonu",
      description: "Rejestracja zajmuje kilka minut. Po zalogowaniu możesz podłączyć kanały, kalendarz i publiczną stronę salonu.",
      panelTitle: "Załóż konto",
      panelDescription: "Wybierz rolę i uzupełnij podstawowe dane.",
      role: "Rola",
      roleOwner: "Właścicielka salonu",
      roleMaster: "Stylistka",
      salonName: "Nazwa salonu",
      yourName: "Twoje imię",
      password: "Hasło",
      passwordHint: "minimum 12 znaków",
      confirmPassword: "Potwierdź hasło",
      referral: "Skąd o nas wiesz?",
      referralPlaceholder: "Wybierz źródło",
      referralGoogle: "Google",
      referralInstagram: "Instagram",
      referralTelegram: "Telegram",
      referralFriends: "Znajomi / polecenie",
      referralOther: "Inne",
      passwordsMismatch: "Hasła nie są takie same",
      passwordTooShort: "Hasło musi mieć co najmniej 12 znaków",
      googleStartError: "Nie udało się rozpocząć logowania przez Google",
      submit: "Zarejestruj się",
      submitting: "Rejestracja...",
      google: "Zaloguj się przez Google",
      googleLoading: "Przekierowanie...",
      hasAccount: "Masz już konto?",
      login: "Zaloguj się",
      registrationError: "Błąd rejestracji",
      conflict: "Rejestracja nie powiodła się. Spróbuj innego emaila albo zaloguj się do istniejącego panelu.",
      verifyNotice: "Konto zostało utworzone. Potwierdź email, a potem się zaloguj.",
      verifyReady: "Konto zostało utworzone. Możesz od razu się zalogować.",
      showPassword: "Pokaż hasło",
      hidePassword: "Ukryj hasło",
      tosLabel: "Rejestrując się, akceptujesz",
      tosLinkText: "REGULAMIN",
      tosRequired: "Musisz zaakceptować regulamin",
      googlePrefillHint:
        "Konto Google jest potwierdzone. Ustaw hasło i rolę — po rejestracji od razu zalogujesz się do panelu.",
      googlePrefillExpired:
        "Link z Google wygasł lub jest nieprawidłowy. Zarejestruj się ręcznie lub ponownie użyj „Zaloguj się przez Google”.",
    },
  },
};
