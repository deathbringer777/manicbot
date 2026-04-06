import type { Lang } from "~/lib/i18n";

export interface BlogArticle {
  slug: string;
  date: string; // YYYY-MM-DD
  categoryKey: BlogCategory;
  titles: Record<Lang, string>;
  excerpts: Record<Lang, string>;
  bodies: Record<Lang, string>;
}

export type BlogCategory = "tips" | "product" | "business" | "trends";

export const BLOG_CATEGORY_LABELS: Record<BlogCategory, Record<Lang, string>> = {
  tips: { ru: "Советы", ua: "Поради", en: "Tips", pl: "Porady" },
  product: { ru: "Продукт", ua: "Продукт", en: "Product", pl: "Produkt" },
  business: { ru: "Бизнес", ua: "Бізнес", en: "Business", pl: "Biznes" },
  trends: { ru: "Тренды", ua: "Тренди", en: "Trends", pl: "Trendy" },
};

export const BLOG_CATEGORY_ORDER: BlogCategory[] = ["tips", "product", "business", "trends"];

export const BLOG_ARTICLES: BlogArticle[] = [
  {
    slug: "automate-salon-booking",
    date: "2026-04-01",
    categoryKey: "tips",
    titles: {
      ru: "5 способов автоматизировать запись в салон",
      ua: "5 способів автоматизувати запис у салон",
      en: "5 ways to automate salon booking",
      pl: "5 sposobów na automatyzację rezerwacji w salonie",
    },
    excerpts: {
      ru: "Telegram-бот, онлайн-виджет, напоминания — разбираем, что действительно экономит время мастера.",
      ua: "Telegram-бот, онлайн-віджет, нагадування — розбираємо, що справді економить час майстра.",
      en: "Telegram bot, online widget, reminders — we break down what truly saves a technician's time.",
      pl: "Bot Telegram, widget online, przypomnienia — analizujemy, co naprawdę oszczędza czas technika.",
    },
    bodies: {
      ru: `Автоматизация записи — это не роскошь, а необходимость для салона, который хочет расти.

1. Telegram-бот для записи
Клиент выбирает мастера, услугу и время прямо в мессенджере. Без звонков и ожидания. ManicBot позволяет настроить это за 15 минут.

2. Автоматические напоминания
За 24 и 2 часа до визита клиент получает сообщение. Это снижает no-show на 40-60%.

3. Онлайн-расписание
Мастер видит свои записи в реальном времени. Клиент видит только свободные слоты — никаких конфликтов.

4. Повторная запись
После визита бот предлагает записаться снова через 2-3 недели. Удержание клиентов растёт.

5. Синхронизация с Google Calendar
Все записи автоматически попадают в личный календарь мастера. Двойные бронирования исключены.`,
      ua: `Автоматизація запису — це не розкіш, а необхідність для салону, який хоче рости.

1. Telegram-бот для запису
Клієнт обирає майстра, послугу та час прямо в месенджері. Без дзвінків та очікування. ManicBot дозволяє налаштувати це за 15 хвилин.

2. Автоматичні нагадування
За 24 та 2 години до візиту клієнт отримує повідомлення. Це знижує no-show на 40-60%.

3. Онлайн-розклад
Майстер бачить свої записи в реальному часі. Клієнт бачить лише вільні слоти — жодних конфліктів.

4. Повторний запис
Після візиту бот пропонує записатися знову через 2-3 тижні. Утримання клієнтів зростає.

5. Синхронізація з Google Calendar
Усі записи автоматично потрапляють до особистого календаря майстра. Подвійні бронювання виключені.`,
      en: `Automating appointments isn't a luxury — it's a necessity for any salon that wants to grow.

1. Telegram bot for booking
Clients choose a technician, service, and time right in the messenger. No calls or waiting. ManicBot lets you set this up in 15 minutes.

2. Automatic reminders
24 and 2 hours before the visit, the client gets a message. This reduces no-shows by 40-60%.

3. Online schedule
The technician sees their bookings in real time. Clients only see available slots — no conflicts.

4. Re-booking
After a visit, the bot suggests booking again in 2-3 weeks. Client retention grows.

5. Google Calendar sync
All appointments automatically land in the technician's personal calendar. Double bookings eliminated.`,
      pl: `Automatyzacja rezerwacji to nie luksus — to konieczność dla salonu, który chce rosnąć.

1. Bot Telegram do rezerwacji
Klient wybiera technika, usługę i czas bezpośrednio w komunikatorze. Bez dzwonienia i czekania. ManicBot pozwala skonfigurować to w 15 minut.

2. Automatyczne przypomnienia
24 i 2 godziny przed wizytą klient otrzymuje wiadomość. Zmniejsza to nieobecności o 40-60%.

3. Harmonogram online
Technik widzi swoje rezerwacje w czasie rzeczywistym. Klient widzi tylko wolne terminy — żadnych konfliktów.

4. Ponowna rezerwacja
Po wizycie bot proponuje ponowną rezerwację za 2-3 tygodnie. Retencja klientów rośnie.

5. Synchronizacja z Google Calendar
Wszystkie wizyty automatycznie trafiają do osobistego kalendarza technika. Podwójne rezerwacje wykluczone.`,
    },
  },
  {
    slug: "reduce-no-shows",
    date: "2026-03-25",
    categoryKey: "business",
    titles: {
      ru: "Как сократить no-show в салоне красоты",
      ua: "Як скоротити no-show у салоні краси",
      en: "How to reduce no-shows in a beauty salon",
      pl: "Jak zmniejszyć nieobecności w salonie kosmetycznym",
    },
    excerpts: {
      ru: "No-show — это потерянное время и деньги. Рассказываем, какие инструменты помогают решить эту проблему.",
      ua: "No-show — це втрачений час і гроші. Розповідаємо, які інструменти допомагають вирішити цю проблему.",
      en: "No-shows mean lost time and money. We explain which tools help solve this problem.",
      pl: "Nieobecności oznaczają utracony czas i pieniądze. Wyjaśniamy, jakie narzędzia pomagają rozwiązać ten problem.",
    },
    bodies: {
      ru: `No-show — когда клиент записался, но не пришёл — одна из главных проблем бьюти-индустрии. В среднем это 15-30% всех записей.

Что помогает:

Напоминания в мессенджере
Обычные SMS открывают 20% людей. Telegram-сообщения — 85%+. ManicBot отправляет напоминания автоматически за день и за 2 часа.

Простая отмена
Если клиенту неудобно — пусть легко отменит. Это лучше, чем пустое окно в расписании. В ManicBot отмена — одна кнопка.

Учёт no-show
ManicBot отмечает клиентов, которые не приходят. Мастер видит статистику и может принять решение: предоплата, подтверждение за день, или отказ в записи.

Повторные записи
Если клиент активно записывается через бота — он реже пропускает. Привычка пользоваться сервисом = ответственность.`,
      ua: `No-show — коли клієнт записався, але не прийшов — одна з головних проблем б'юті-індустрії. В середньому це 15-30% усіх записів.

Що допомагає:

Нагадування в месенджері
Звичайні SMS відкривають 20% людей. Telegram-повідомлення — 85%+. ManicBot надсилає нагадування автоматично за день і за 2 години.

Просте скасування
Якщо клієнту незручно — нехай легко скасує. Це краще, ніж порожнє вікно в розкладі. В ManicBot скасування — одна кнопка.

Облік no-show
ManicBot позначає клієнтів, які не приходять. Майстер бачить статистику і може прийняти рішення: передоплата, підтвердження за день, або відмова у записі.

Повторні записи
Якщо клієнт активно записується через бота — він рідше пропускає. Звичка користуватися сервісом = відповідальність.`,
      en: `No-shows — when a client books but doesn't come — are one of the biggest problems in the beauty industry. On average, that's 15-30% of all appointments.

What helps:

Messenger reminders
Only 20% of people open regular SMS. Telegram messages — 85%+. ManicBot sends reminders automatically one day and 2 hours before.

Easy cancellation
If it's inconvenient for the client — let them cancel easily. It's better than an empty slot. In ManicBot, cancellation is one button.

No-show tracking
ManicBot flags clients who don't show up. The technician sees the stats and can decide: prepayment, day-before confirmation, or booking refusal.

Re-booking
When clients actively book through the bot, they miss less. Habit of using the service = responsibility.`,
      pl: `Nieobecności — gdy klient rezerwuje, ale nie przychodzi — to jeden z największych problemów branży beauty. Średnio to 15-30% wszystkich wizyt.

Co pomaga:

Przypomnienia w komunikatorze
Tylko 20% osób otwiera zwykłe SMS. Wiadomości Telegram — 85%+. ManicBot wysyła przypomnienia automatycznie dzień i 2 godziny przed wizytą.

Łatwe anulowanie
Jeśli klientowi nie pasuje — niech łatwo anuluje. To lepsze niż puste okno w grafiku. W ManicBot anulowanie to jeden przycisk.

Śledzenie nieobecności
ManicBot oznacza klientów, którzy się nie pojawiają. Technik widzi statystyki i może zdecydować: przedpłata, potwierdzenie dzień wcześniej lub odmowa rezerwacji.

Ponowne rezerwacje
Gdy klienci aktywnie rezerwują przez bota, rzadziej opuszczają wizyty. Nawyk korzystania z serwisu = odpowiedzialność.`,
    },
  },
  {
    slug: "nail-trends-2026",
    date: "2026-03-18",
    categoryKey: "trends",
    titles: {
      ru: "Тренды nail-индустрии 2026: что изменилось",
      ua: "Тренди nail-індустрії 2026: що змінилось",
      en: "Nail industry trends 2026: what's changed",
      pl: "Trendy branży nail 2026: co się zmieniło",
    },
    excerpts: {
      ru: "Минимализм, AI-помощники, онлайн-запись — как технологии меняют привычный маникюрный бизнес.",
      ua: "Мінімалізм, AI-помічники, онлайн-запис — як технології змінюють звичний манікюрний бізнес.",
      en: "Minimalism, AI assistants, online booking — how technology is changing the nail business.",
      pl: "Minimalizm, asystenci AI, rezerwacja online — jak technologia zmienia branżę paznokci.",
    },
    bodies: {
      ru: `Nail-индустрия в 2026 году продолжает трансформироваться. Вот ключевые тренды:

Автоматизация коммуникации
Клиенты ожидают мгновенного ответа. AI-ассистенты в Telegram и Instagram отвечают на вопросы о ценах, свободных слотах и услугах 24/7.

Мультиканальность
Один салон — несколько каналов: Telegram, WhatsApp, Instagram. ManicBot объединяет все обращения в единый inbox.

Персонализация
Бот запоминает предпочтения клиента: любимого мастера, тип покрытия, частоту визитов. Следующая запись — в два клика.

Прозрачное ценообразование
Клиент видит каталог услуг с ценами прямо в боте. Никаких сюрпризов при оплате.

Удержание через данные
Аналитика показывает, какие клиенты уходят, а какие приносят больше всего выручки. Владелец принимает решения на основе цифр, а не интуиции.`,
      ua: `Nail-індустрія у 2026 році продовжує трансформуватися. Ось ключові тренди:

Автоматизація комунікації
Клієнти очікують миттєвої відповіді. AI-асистенти в Telegram та Instagram відповідають на запитання про ціни, вільні слоти та послуги 24/7.

Мультиканальність
Один салон — кілька каналів: Telegram, WhatsApp, Instagram. ManicBot об'єднує всі звернення в єдиний inbox.

Персоналізація
Бот запам'ятовує вподобання клієнта: улюбленого майстра, тип покриття, частоту візитів. Наступний запис — у два кліки.

Прозоре ціноутворення
Клієнт бачить каталог послуг з цінами прямо в боті. Жодних сюрпризів при оплаті.

Утримання через дані
Аналітика показує, які клієнти йдуть, а які приносять найбільше виручки. Власник приймає рішення на основі цифр, а не інтуїції.`,
      en: `The nail industry in 2026 continues to transform. Here are the key trends:

Communication automation
Clients expect instant responses. AI assistants in Telegram and Instagram answer questions about prices, available slots, and services 24/7.

Multichannel approach
One salon — multiple channels: Telegram, WhatsApp, Instagram. ManicBot unifies all inquiries into a single inbox.

Personalization
The bot remembers client preferences: favorite technician, coating type, visit frequency. Next booking — two clicks.

Transparent pricing
The client sees the service catalog with prices right in the bot. No surprises at payment.

Data-driven retention
Analytics shows which clients are leaving and which bring the most revenue. Owners make decisions based on numbers, not intuition.`,
      pl: `Branża nail w 2026 roku nadal się transformuje. Oto kluczowe trendy:

Automatyzacja komunikacji
Klienci oczekują natychmiastowej odpowiedzi. Asystenci AI w Telegramie i Instagramie odpowiadają na pytania o ceny, wolne terminy i usługi 24/7.

Podejście wielokanałowe
Jeden salon — wiele kanałów: Telegram, WhatsApp, Instagram. ManicBot łączy wszystkie zapytania w jedną skrzynkę.

Personalizacja
Bot zapamiętuje preferencje klienta: ulubionego technika, typ pokrycia, częstotliwość wizyt. Następna rezerwacja — dwa kliknięcia.

Przejrzyste ceny
Klient widzi katalog usług z cenami bezpośrednio w bocie. Żadnych niespodzianek przy płatności.

Retencja oparta na danych
Analityka pokazuje, którzy klienci odchodzą, a którzy przynoszą najwięcej przychodu. Właściciele podejmują decyzje na podstawie liczb, nie intuicji.`,
    },
  },
  {
    slug: "whatsapp-instagram-channels",
    date: "2026-03-10",
    categoryKey: "product",
    titles: {
      ru: "ManicBot теперь в WhatsApp и Instagram",
      ua: "ManicBot тепер у WhatsApp та Instagram",
      en: "ManicBot is now on WhatsApp and Instagram",
      pl: "ManicBot teraz na WhatsApp i Instagram",
    },
    excerpts: {
      ru: "Подключайте WhatsApp и Instagram — клиенты пишут туда, где им удобно, а вы управляете всем из одного места.",
      ua: "Підключайте WhatsApp та Instagram — клієнти пишуть туди, де їм зручно, а ви керуєте всім з одного місця.",
      en: "Connect WhatsApp and Instagram — clients write where it's convenient, you manage everything from one place.",
      pl: "Podłącz WhatsApp i Instagram — klienci piszą tam, gdzie im wygodnie, a Ty zarządzasz wszystkim z jednego miejsca.",
    },
    bodies: {
      ru: `Мы добавили поддержку WhatsApp и Instagram как полноценных каналов для записи.

Что это значит для вашего салона:

Единый inbox
Все сообщения из Telegram, WhatsApp и Instagram приходят в одно место. Вы не пропустите ни одного клиента.

Запись через любой канал
Клиент может начать запись в Instagram, а продолжить в Telegram — бот запомнит контекст.

AI-ассистент везде
Умный помощник работает одинаково во всех каналах: отвечает на вопросы, предлагает слоты, отправляет напоминания.

Простое подключение
Владелец салона подключает каналы в панели управления. Никакого кода — всё через интерфейс.

Мы верим, что салон должен быть там, где клиент. А клиент — в мессенджерах.`,
      ua: `Ми додали підтримку WhatsApp та Instagram як повноцінних каналів для запису.

Що це означає для вашого салону:

Єдиний inbox
Усі повідомлення з Telegram, WhatsApp та Instagram приходять в одне місце. Ви не пропустите жодного клієнта.

Запис через будь-який канал
Клієнт може почати запис в Instagram, а продовжити в Telegram — бот запам'ятає контекст.

AI-асистент скрізь
Розумний помічник працює однаково в усіх каналах: відповідає на запитання, пропонує слоти, надсилає нагадування.

Просте підключення
Власник салону підключає канали в панелі керування. Жодного коду — все через інтерфейс.

Ми віримо, що салон має бути там, де клієнт. А клієнт — у месенджерах.`,
      en: `We've added WhatsApp and Instagram support as full-fledged booking channels.

What this means for your salon:

Unified inbox
All messages from Telegram, WhatsApp, and Instagram come to one place. You won't miss a single client.

Booking through any channel
A client can start booking on Instagram and continue on Telegram — the bot remembers the context.

AI assistant everywhere
The smart assistant works the same across all channels: answers questions, suggests slots, sends reminders.

Easy setup
The salon owner connects channels in the dashboard. No code — everything through the interface.

We believe a salon should be where the client is. And clients are in messengers.`,
      pl: `Dodaliśmy wsparcie WhatsApp i Instagram jako pełnoprawnych kanałów rezerwacji.

Co to oznacza dla Twojego salonu:

Zunifikowana skrzynka
Wszystkie wiadomości z Telegram, WhatsApp i Instagram trafiają w jedno miejsce. Nie przegapisz żadnego klienta.

Rezerwacja przez dowolny kanał
Klient może rozpocząć rezerwację na Instagramie i kontynuować na Telegramie — bot zapamięta kontekst.

Asystent AI wszędzie
Inteligentny asystent działa tak samo we wszystkich kanałach: odpowiada na pytania, proponuje terminy, wysyła przypomnienia.

Łatwa konfiguracja
Właściciel salonu podłącza kanały w panelu zarządzania. Żadnego kodu — wszystko przez interfejs.

Wierzymy, że salon powinien być tam, gdzie klient. A klient jest w komunikatorach.`,
    },
  },
  {
    slug: "google-calendar-sync",
    date: "2026-03-03",
    categoryKey: "product",
    titles: {
      ru: "Синхронизация с Google Calendar: как это работает",
      ua: "Синхронізація з Google Calendar: як це працює",
      en: "Google Calendar sync: how it works",
      pl: "Synchronizacja z Google Calendar: jak to działa",
    },
    excerpts: {
      ru: "Подключите Google Calendar — и забудьте о двойных записях. Рассказываем, как настроить за 2 минуты.",
      ua: "Підключіть Google Calendar — і забудьте про подвійні записи. Розповідаємо, як налаштувати за 2 хвилини.",
      en: "Connect Google Calendar and forget about double bookings. Here's how to set it up in 2 minutes.",
      pl: "Podłącz Google Calendar i zapomnij o podwójnych rezerwacjach. Oto jak skonfigurować w 2 minuty.",
    },
    bodies: {
      ru: `Google Calendar — самый популярный календарь среди мастеров. ManicBot умеет с ним работать в обе стороны.

Как подключить:
Откройте панель управления салоном → Настройки → Google Calendar → «Подключить». Авторизуйтесь через Google — готово.

Что синхронизируется:
— Новые записи из ManicBot автоматически появляются в Google Calendar
— Занятые слоты из Google Calendar блокируются в ManicBot (никто не запишется, когда у вас личные дела)
— Отмены синхронизируются в обе стороны

Для кого:
Синхронизация доступна на тарифах Pro и Studio. Каждый мастер подключает свой Google-аккаунт отдельно.

Что если интернет пропал:
ManicBot хранит очередь и досинхронизирует данные, когда связь восстановится. Экспоненциальный backoff гарантирует, что Google API не заблокирует ваш аккаунт.`,
      ua: `Google Calendar — найпопулярніший календар серед майстрів. ManicBot вміє з ним працювати в обидва боки.

Як підключити:
Відкрийте панель керування салоном → Налаштування → Google Calendar → «Підключити». Авторизуйтесь через Google — готово.

Що синхронізується:
— Нові записи з ManicBot автоматично з'являються в Google Calendar
— Зайняті слоти з Google Calendar блокуються в ManicBot (ніхто не запишеться, коли у вас особисті справи)
— Скасування синхронізуються в обидва боки

Для кого:
Синхронізація доступна на тарифах Pro та Studio. Кожен майстер підключає свій Google-акаунт окремо.

Що якщо інтернет зник:
ManicBot зберігає чергу і досинхронізує дані, коли зв'язок відновиться. Експоненційний backoff гарантує, що Google API не заблокує ваш акаунт.`,
      en: `Google Calendar is the most popular calendar among technicians. ManicBot works with it in both directions.

How to connect:
Open salon dashboard → Settings → Google Calendar → "Connect". Authorize through Google — done.

What syncs:
— New ManicBot bookings automatically appear in Google Calendar
— Busy slots from Google Calendar are blocked in ManicBot (no one books when you have personal matters)
— Cancellations sync both ways

Who it's for:
Sync is available on Pro and Studio plans. Each technician connects their own Google account separately.

What if internet drops:
ManicBot queues the data and syncs when connection is restored. Exponential backoff ensures Google API won't block your account.`,
      pl: `Google Calendar to najpopularniejszy kalendarz wśród techników. ManicBot współpracuje z nim w obu kierunkach.

Jak podłączyć:
Otwórz panel zarządzania salonem → Ustawienia → Google Calendar → „Podłącz". Autoryzuj się przez Google — gotowe.

Co się synchronizuje:
— Nowe rezerwacje ManicBot automatycznie pojawiają się w Google Calendar
— Zajęte terminy z Google Calendar są blokowane w ManicBot (nikt nie zarezerwuje, gdy masz prywatne sprawy)
— Anulowania synchronizują się w obu kierunkach

Dla kogo:
Synchronizacja dostępna w planach Pro i Studio. Każdy technik podłącza swoje konto Google osobno.

Co jeśli internet zniknie:
ManicBot kolejkuje dane i synchronizuje po przywróceniu połączenia. Wykładniczy backoff gwarantuje, że Google API nie zablokuje Twojego konta.`,
    },
  },
  {
    slug: "first-client-in-10-minutes",
    date: "2026-02-24",
    categoryKey: "tips",
    titles: {
      ru: "Первый клиент через бота за 10 минут",
      ua: "Перший клієнт через бота за 10 хвилин",
      en: "Your first bot client in 10 minutes",
      pl: "Pierwszy klient przez bota w 10 minut",
    },
    excerpts: {
      ru: "Пошаговая инструкция: регистрация, настройка услуг, первая запись. Без технических знаний.",
      ua: "Покрокова інструкція: реєстрація, налаштування послуг, перший запис. Без технічних знань.",
      en: "Step-by-step guide: registration, service setup, first booking. No technical knowledge needed.",
      pl: "Instrukcja krok po kroku: rejestracja, konfiguracja usług, pierwsza rezerwacja. Bez wiedzy technicznej.",
    },
    bodies: {
      ru: `Запустить бота для салона можно за 10 минут. Вот как:

Шаг 1: Регистрация (2 мин)
Перейдите на manicbot.com и нажмите «Начать бесплатно». Укажите название салона и свой Telegram.

Шаг 2: Настройка услуг (3 мин)
Добавьте услуги: название, длительность, цена. Например: «Маникюр с покрытием — 90 мин — 150 zł».

Шаг 3: Расписание (2 мин)
Укажите рабочие часы. По умолчанию — пн-пт 9:00-18:00, но можно настроить под себя.

Шаг 4: Пригласите первого клиента (3 мин)
Отправьте ссылку на бота знакомому. Пусть попробует записаться — вы увидите запись в панели.

Готово! Теперь у вас работающий бот для онлайн-записи.`,
      ua: `Запустити бота для салону можна за 10 хвилин. Ось як:

Крок 1: Реєстрація (2 хв)
Перейдіть на manicbot.com та натисніть «Почати безкоштовно». Вкажіть назву салону та свій Telegram.

Крок 2: Налаштування послуг (3 хв)
Додайте послуги: назва, тривалість, ціна. Наприклад: «Манікюр з покриттям — 90 хв — 150 zł».

Крок 3: Розклад (2 хв)
Вкажіть робочі години. За замовчуванням — пн-пт 9:00-18:00, але можна налаштувати під себе.

Крок 4: Запросіть першого клієнта (3 хв)
Надішліть посилання на бота знайомому. Нехай спробує записатися — ви побачите запис у панелі.

Готово! Тепер у вас працюючий бот для онлайн-запису.`,
      en: `You can launch a salon bot in 10 minutes. Here's how:

Step 1: Registration (2 min)
Go to manicbot.com and click "Start for free". Enter your salon name and Telegram.

Step 2: Service setup (3 min)
Add services: name, duration, price. Example: "Manicure with coating — 90 min — 150 zł".

Step 3: Schedule (2 min)
Set working hours. Default is Mon-Fri 9:00-18:00, but you can customize.

Step 4: Invite your first client (3 min)
Send the bot link to a friend. Let them try booking — you'll see the appointment in the dashboard.

Done! You now have a working online booking bot.`,
      pl: `Bota dla salonu można uruchomić w 10 minut. Oto jak:

Krok 1: Rejestracja (2 min)
Przejdź na manicbot.com i kliknij „Zacznij za darmo". Wpisz nazwę salonu i swój Telegram.

Krok 2: Konfiguracja usług (3 min)
Dodaj usługi: nazwa, czas trwania, cena. Przykład: „Manicure z pokryciem — 90 min — 150 zł".

Krok 3: Harmonogram (2 min)
Ustaw godziny pracy. Domyślnie pon-pt 9:00-18:00, ale możesz dostosować.

Krok 4: Zaproś pierwszego klienta (3 min)
Wyślij link do bota znajomemu. Niech spróbuje zarezerwować — zobaczysz wizytę w panelu.

Gotowe! Masz teraz działającego bota do rezerwacji online.`,
    },
  },
];
