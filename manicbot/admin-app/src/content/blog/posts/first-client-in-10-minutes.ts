import type { BlogArticle } from "../types";

export const firstClientIn10Minutes: BlogArticle = {
  slug: "first-client-in-10-minutes",
  date: "2026-02-24",
  updated: "2026-05-16",
  categoryKey: "tips",
  coverImage: {
    url: "https://images.unsplash.com/photo-1571290274554-6a2eaa771e5f?w=1600&q=80&auto=format&fit=crop",
    alt: {
      ru: "Мастер делает маникюр клиенту — пошаговый запуск Telegram-бота для салона",
      ua: "Майстер робить манікюр клієнту — покроковий запуск Telegram-бота для салону",
      en: "Technician working on a client — step-by-step launch of a salon Telegram bot",
      pl: "Technik wykonujący manicure — uruchomienie bota Telegram krok po kroku",
    },
    credit: "Unsplash",
  },
  titles: {
    ru: "10 минут до первой записи в боте: пошагово, без разработчиков и интеграций",
    ua: "10 хвилин до першого запису в боті: покроково, без розробників та інтеграцій",
    en: "10 minutes to your first bot booking: step by step, no developers, no integrations",
    pl: "10 minut do pierwszej rezerwacji w bocie: krok po kroku, bez programistów i integracji",
  },
  excerpts: {
    ru: "Регистрация, услуги, расписание, первый клиент. Гайд для владельца салона, который никогда не настраивал ботов. С реальными скриншотами и цифрами.",
    ua: "Реєстрація, послуги, розклад, перший клієнт. Гайд для власника салону, який ніколи не налаштовував ботів. З реальними скриншотами і цифрами.",
    en: "Registration, services, schedule, first client. A guide for salon owners who've never set up a bot. With real screenshots and numbers.",
    pl: "Rejestracja, usługi, grafik, pierwszy klient. Przewodnik dla właściciela salonu, który nigdy nie konfigurował bota. Z prawdziwymi zrzutami i liczbami.",
  },
  keywords: {
    ru: ["как настроить Telegram бота для салона", "запуск ManicBot", "первый клиент через бота", "услуги для салона", "онлайн-запись с нуля"],
    ua: ["як налаштувати Telegram бота для салону", "запуск ManicBot", "перший клієнт через бота", "послуги для салону", "онлайн-запис з нуля"],
    en: ["how to set up Telegram bot for salon", "launch ManicBot", "first client via bot", "salon services setup", "online booking from scratch"],
    pl: ["jak skonfigurować bota Telegram dla salonu", "uruchomienie ManicBot", "pierwszy klient przez bota", "usługi w salonie", "rezerwacja online od zera"],
  },
  relatedSlugs: ["automate-salon-booking", "google-calendar-sync", "whatsapp-instagram-channels"],
  bodies: {
    ru: `Самый частый страх владельцев салонов: «у меня нет разработчиков, я не разберусь». Хорошая новость: настройка ManicBot занимает 10 минут на телефоне, без кода и без интеграций. Эта статья — пошаговый гайд от регистрации до первой записи реального клиента.

Если что-то пойдёт не так — в конце есть раздел про частые ошибки.

## Что нужно перед стартом

Минимум: телефон с Telegram, имя салона, 3–5 услуг с длительностью и ценой, рабочие часы. Всё. Сайт, домен, юрлицо — не нужны (можно подключить позже).

## Шаг 1. Регистрация (2 минуты)

1. Откройте **manicbot.com** на телефоне или ноутбуке.
2. Нажмите «Начать бесплатно» в правом верхнем углу.
3. Введите email и пароль (минимум 12 символов).
4. Подтвердите email — на почту приходит код из 6 цифр.
5. Введите код — вы внутри.

При регистрации мы спрашиваем язык интерфейса (RU/UA/EN/PL) и роль. Выбирайте **«Владелец салона»** — это активирует Salon Dashboard.

После регистрации вы автоматически попадаете на 14-дневный пробный период тарифа Pro. Карту привязывать не нужно — пробуйте, и только если понравится, выбирайте тариф.

## Шаг 2. Создание салона (1 минута)

В мастере онбординга введите:

- **Название салона** — то, что увидят клиенты в боте.
- **Город** — нужен для каталога публичного поиска.
- **Адрес** — попадёт в напоминания, чтобы клиент не блуждал.

Не переживайте про логотип и обложку — добавите позже в **Настройках**. Сейчас цель — первая запись, не дизайн.

## Шаг 3. Услуги (3 минуты)

Добавьте 3–5 базовых услуг. Каждая услуга — это:

- **Название** — «Маникюр с покрытием».
- **Длительность** — например, 90 минут. Это то время, на которое будет блокироваться слот.
- **Цена** — 150 zł. Можно «от 150», но конкретные цифры конвертят лучше.

Совет: начните с самых популярных услуг. Расширенный каталог — потом. Слишком длинный список на старте путает клиента.

## Шаг 4. Расписание (2 минуты)

Откройте **Настройки → Рабочие часы**. Укажите, в какие дни и часы вы работаете. По умолчанию — пн-пт 9:00–18:00, но это легко переключается.

Если вы — один мастер: достаточно. Если в салоне несколько мастеров — каждый добавляется в **Сотрудники** со своими часами. Каждому мастеру дайте \`master\` роль, и он получит свой Master Dashboard.

## Шаг 5. Первый клиент (2 минуты)

Готово. Теперь нужно протестировать. В разделе **Каналы → Telegram** вы видите ссылку на вашего бота — что-то вроде \`t.me/your_salon_bot\`.

1. Скопируйте ссылку.
2. Откройте сами в Telegram (или попросите знакомого).
3. Нажмите «Начать», бот поприветствует.
4. Выберите услугу → мастера → удобное время → подтвердите.
5. Запись появилась в админ-панели ManicBot (раздел **Записи**).

Поздравляем, ваш бот работает. Можно отправлять ссылку клиентам — в Instagram bio, в Direct, на визитке.

## Что делать дальше

После первой записи имеет смысл подключить ещё три вещи, по возрастанию сложности:

- **Google Calendar** — 2 минуты, убирает двойные брони. Гайд — в [отдельной статье](/blog/google-calendar-sync).
- **WhatsApp + Instagram каналы** — 15 минут, расширяет аудиторию. Гайд — в [статье про мультиканальность](/blog/whatsapp-instagram-channels).
- **Напоминания за 24/2 часа** — включаются галочкой в Настройках. По умолчанию уже включены.

## Частые ошибки на старте

- **Слишком много услуг сразу.** Начните с 5, расширяйте через неделю. Длинный список — низкая конверсия.
- **Неправильная длительность.** Если поставили 60 минут, а услуга занимает 90 — слоты будут пересекаться. Замерьте реально.
- **Не подключили мастеров.** Если вас несколько — каждый должен быть в **Сотрудниках** с email и ролью.
- **Пробный период истёк, а карты нет.** ManicBot напомнит за 3 дня. Тариф Start — 45 zł/мес, дешевле обеда.

## Что в итоге

10 минут на настройку, 14 дней бесплатно, 45 zł в месяц после. Это меньше, чем стоимость одного маникюра — и обычно за первую неделю вы получаете больше записей, чем платите.

Если что-то не получается — пишите в **Help → Чат с поддержкой**. Отвечаем в течение часа в рабочее время.`,
    ua: `Найчастіший страх власників салонів: «у мене немає розробників, я не розберуся». Хороша новина: налаштування ManicBot займає 10 хвилин на телефоні, без коду і без інтеграцій. Ця стаття — покроковий гайд від реєстрації до першого запису реального клієнта.

Якщо щось піде не так — наприкінці є розділ про часті помилки.

## Що потрібно перед стартом

Мінімум: телефон з Telegram, назва салону, 3–5 послуг з тривалістю і ціною, робочі години. Усе. Сайт, домен, юрособа — не потрібні (можна підключити пізніше).

## Крок 1. Реєстрація (2 хвилини)

1. Відкрийте **manicbot.com** на телефоні або ноутбуці.
2. Натисніть «Почати безкоштовно» у правому верхньому куті.
3. Введіть email і пароль (мінімум 12 символів).
4. Підтвердіть email — на пошту приходить код із 6 цифр.
5. Введіть код — ви всередині.

При реєстрації ми запитуємо мову інтерфейсу (RU/UA/EN/PL) і роль. Обирайте **«Власник салону»** — це активує Salon Dashboard.

Після реєстрації ви автоматично потрапляєте на 14-денний пробний період тарифу Pro. Карту прив'язувати не потрібно — пробуйте, і тільки якщо сподобається, обирайте тариф.

## Крок 2. Створення салону (1 хвилина)

У майстрі онбордингу введіть:

- **Назва салону** — те, що побачать клієнти в боті.
- **Місто** — потрібне для каталогу публічного пошуку.
- **Адреса** — потрапить у нагадування, щоб клієнт не блукав.

Не переживайте про логотип і обкладинку — додасте пізніше в **Налаштуваннях**. Зараз ціль — перший запис, не дизайн.

## Крок 3. Послуги (3 хвилини)

Додайте 3–5 базових послуг. Кожна послуга — це:

- **Назва** — «Манікюр з покриттям».
- **Тривалість** — наприклад, 90 хвилин. Це той час, на який блокуватиметься слот.
- **Ціна** — 150 zł. Можна «від 150», але конкретні цифри конвертять краще.

Порада: почніть із найпопулярніших послуг. Розширений каталог — потім. Занадто довгий список на старті плутає клієнта.

## Крок 4. Розклад (2 хвилини)

Відкрийте **Налаштування → Робочі години**. Вкажіть, у які дні та години ви працюєте. За замовчуванням — пн-пт 9:00–18:00, але це легко перемикається.

Якщо ви — один майстер: достатньо. Якщо в салоні кілька майстрів — кожен додається у **Співробітники** зі своїми годинами. Кожному майстру дайте \`master\` роль, і він отримає свій Master Dashboard.

## Крок 5. Перший клієнт (2 хвилини)

Готово. Тепер треба протестувати. У розділі **Канали → Telegram** ви бачите посилання на вашого бота — щось на кшталт \`t.me/your_salon_bot\`.

1. Скопіюйте посилання.
2. Відкрийте самі в Telegram (або попросіть знайомого).
3. Натисніть «Розпочати», бот привітає.
4. Оберіть послугу → майстра → зручний час → підтвердьте.
5. Запис з'явився в адмін-панелі ManicBot (розділ **Записи**).

Вітаємо, ваш бот працює. Можна надсилати посилання клієнтам — в Instagram bio, у Direct, на візитці.

## Що робити далі

Після першого запису має сенс підключити ще три речі, за зростанням складності:

- **Google Calendar** — 2 хвилини, прибирає подвійні броні. Гайд — в [окремій статті](/blog/google-calendar-sync).
- **WhatsApp + Instagram канали** — 15 хвилин, розширює аудиторію. Гайд — у [статті про мультиканальність](/blog/whatsapp-instagram-channels).
- **Нагадування за 24/2 години** — вмикаються галочкою в Налаштуваннях. За замовчуванням уже ввімкнені.

## Часті помилки на старті

- **Надто багато послуг одразу.** Почніть із 5, розширюйте через тиждень. Довгий список — низька конверсія.
- **Неправильна тривалість.** Якщо поставили 60 хвилин, а послуга займає 90 — слоти будуть перетинатися. Заміряйте реально.
- **Не підключили майстрів.** Якщо вас кілька — кожен має бути у **Співробітниках** з email і роллю.
- **Пробний період закінчився, а карти немає.** ManicBot нагадає за 3 дні. Тариф Start — 45 zł/міс, дешевше обіду.

## Що в підсумку

10 хвилин на налаштування, 14 днів безкоштовно, 45 zł на місяць після. Це менше, ніж вартість одного манікюру — і зазвичай за перший тиждень ви отримуєте більше записів, ніж платите.

Якщо щось не виходить — пишіть у **Help → Чат із підтримкою**. Відповідаємо протягом години в робочий час.`,
    en: `The most common fear among salon owners: "I don't have developers, I won't figure this out". Good news: setting up ManicBot takes 10 minutes on a phone, no code and no integrations. This article is a step-by-step guide from registration to the first real client booking.

If anything goes wrong — there's a "common mistakes" section at the end.

## What you need before you start

The minimum: a phone with Telegram, your salon name, 3–5 services with duration and price, working hours. That's it. Website, domain, legal entity — not required (you can connect them later).

## Step 1. Registration (2 minutes)

1. Open **manicbot.com** on your phone or laptop.
2. Click "Start for free" in the top right.
3. Enter email and password (12+ characters).
4. Confirm email — a 6-digit code arrives in your inbox.
5. Enter the code — you're in.

During registration we ask for the UI language (RU/UA/EN/PL) and a role. Pick **"Salon Owner"** — that activates the Salon Dashboard.

You're auto-enrolled into a 14-day trial of the Pro plan. No card needed — try it, and only pick a plan if you like it.

## Step 2. Create your salon (1 minute)

In the onboarding wizard, enter:

- **Salon name** — what clients will see in the bot.
- **City** — needed for the public catalogue.
- **Address** — included in reminders so clients don't get lost.

Don't worry about logo and cover photo — you'll add them later in **Settings**. Right now the goal is the first booking, not design.

## Step 3. Services (3 minutes)

Add 3–5 core services. Each service has:

- **Name** — "Manicure with coating".
- **Duration** — e.g. 90 minutes. The slot is blocked for that long.
- **Price** — 150 zł. You can use "from 150" but concrete numbers convert better.

Tip: start with the most popular services. Extended catalogue comes later. Too long a list on day one confuses the client.

## Step 4. Schedule (2 minutes)

Open **Settings → Working Hours**. Set the days and hours you work. Default is Mon-Fri 9:00–18:00, easily switched.

If you're a single technician — that's enough. If the salon has several — each is added in **Staff** with their own hours. Give each technician the \`master\` role and they'll get their own Master Dashboard.

## Step 5. First client (2 minutes)

Done. Now test. Under **Channels → Telegram** you'll see your bot link — something like \`t.me/your_salon_bot\`.

1. Copy the link.
2. Open it yourself in Telegram (or ask a friend).
3. Tap "Start" and the bot greets you.
4. Pick a service → technician → time → confirm.
5. The booking shows up in the ManicBot admin panel under **Appointments**.

Congrats, your bot is live. Send the link to clients — Instagram bio, Direct, business card.

## What to do next

After the first booking, plug in three more things, by ascending complexity:

- **Google Calendar** — 2 minutes, kills double-bookings. Guide in a [separate article](/blog/google-calendar-sync).
- **WhatsApp + Instagram channels** — 15 minutes, expands your audience. Guide in the [omnichannel article](/blog/whatsapp-instagram-channels).
- **24h / 2h reminders** — toggles in Settings. On by default.

## Common starting mistakes

- **Too many services at once.** Start with 5, expand in a week. Long list = low conversion.
- **Wrong duration.** If you set 60 minutes for a service that takes 90, slots will overlap. Measure for real.
- **Didn't add technicians.** If there are several of you — each must be in **Staff** with an email and role.
- **Trial expired, no card on file.** ManicBot reminds you 3 days ahead. Start plan is 45 zł/month, cheaper than lunch.

## The bottom line

10 minutes to set up, 14 days free, 45 zł/month after. Less than the price of one manicure — and you usually book more clients in the first week than you pay.

## A quick reality check on results

We get one question more than any other after onboarding: "I'm set up, but bookings don't roll in — what's wrong?". Nine times out of ten it's not the bot, it's distribution. The bot is a closer, not a marketer.

So once it works, make sure clients actually have a path to it:

- **Instagram bio link.** Replace whatever's there now with the bot link. Around 40% of first-week bookings come through that single change.
- **Direct auto-reply.** Inside Instagram Business settings, set the welcome message to point to the bot link. New DMs get the link automatically, even when you're asleep.
- **Stories with a "Book Now" sticker.** Once a week, post a work photo with that sticker. It converts surprisingly well.
- **Business card / receipt.** Print the bot link on whatever the client leaves with. They'll forget your name but they won't lose the card for two weeks.

If anything's off — message **Help → Support Chat**. We reply within an hour during business hours.`,
    pl: `Najczęstszy lęk właścicieli salonów: „nie mam programistów, nie poradzę sobie". Dobra wiadomość: konfiguracja ManicBot zajmuje 10 minut na telefonie, bez kodu i bez integracji. Ten artykuł to przewodnik krok po kroku — od rejestracji do pierwszej rezerwacji prawdziwego klienta.

Jeśli coś pójdzie nie tak — na końcu sekcja o częstych błędach.

## Co trzeba przed startem

Minimum: telefon z Telegramem, nazwa salonu, 3–5 usług z czasem i ceną, godziny pracy. Tyle. Strona, domena, firma — niepotrzebne (można podłączyć później).

## Krok 1. Rejestracja (2 minuty)

1. Otwórz **manicbot.com** na telefonie lub laptopie.
2. Kliknij „Zacznij za darmo" w prawym górnym rogu.
3. Wpisz e-mail i hasło (min. 12 znaków).
4. Potwierdź e-mail — na skrzynkę przychodzi 6-cyfrowy kod.
5. Wpisz kod — jesteś w środku.

Przy rejestracji pytamy o język interfejsu (RU/UA/EN/PL) i rolę. Wybierz **„Właściciel salonu"** — aktywuje to Salon Dashboard.

Automatycznie dostajesz 14-dniowy okres próbny planu Pro. Bez karty — testuj, i tylko jeśli się spodoba, wybierz plan.

## Krok 2. Utworzenie salonu (1 minuta)

W kreatorze onboardingu wpisz:

- **Nazwa salonu** — to, co zobaczą klienci w bocie.
- **Miasto** — potrzebne do publicznego katalogu.
- **Adres** — trafi do przypomnień, by klient nie błądził.

Nie martw się logo i okładką — dodasz w **Ustawieniach** później. Teraz cel to pierwsza rezerwacja, nie design.

## Krok 3. Usługi (3 minuty)

Dodaj 3–5 podstawowych usług. Każda ma:

- **Nazwę** — „Manicure z pokryciem".
- **Czas trwania** — np. 90 minut. Na tyle blokowany jest slot.
- **Cenę** — 150 zł. „Od 150" działa, ale konkretne liczby konwertują lepiej.

Wskazówka: zacznij od najpopularniejszych. Rozszerzony katalog — potem. Za długa lista na start gubi klienta.

## Krok 4. Harmonogram (2 minuty)

Otwórz **Ustawienia → Godziny pracy**. Wskaż dni i godziny pracy. Domyślnie pon-pt 9:00–18:00, łatwo zmienić.

Jeśli jesteś jednym technikiem — wystarczy. Jeśli w salonie jest kilku — każdy idzie w **Pracownicy** z własnymi godzinami. Każdemu nadaj rolę \`master\` — dostanie własny Master Dashboard.

## Krok 5. Pierwszy klient (2 minuty)

Gotowe. Teraz test. W sekcji **Kanały → Telegram** widzisz link do swojego bota — coś jak \`t.me/your_salon_bot\`.

1. Skopiuj link.
2. Otwórz w Telegramie samodzielnie (lub poproś znajomego).
3. Kliknij „Start", bot przywita.
4. Wybierz usługę → technika → termin → potwierdź.
5. Rezerwacja pojawia się w panelu ManicBot w sekcji **Rezerwacje**.

Gratulacje, Twój bot działa. Możesz wysyłać link klientom — w bio Instagrama, w Direct, na wizytówce.

## Co dalej

Po pierwszej rezerwacji warto podłączyć jeszcze trzy rzeczy, w kolejności trudności:

- **Google Calendar** — 2 minuty, kasuje podwójne rezerwacje. Przewodnik w [osobnym artykule](/blog/google-calendar-sync).
- **Kanały WhatsApp + Instagram** — 15 minut, rozszerza publikę. Przewodnik w [artykule o omnichannel](/blog/whatsapp-instagram-channels).
- **Przypomnienia 24h / 2h** — przełączniki w Ustawieniach. Domyślnie włączone.

## Częste błędy na starcie

- **Za dużo usług naraz.** Zacznij od 5, rozszerzaj po tygodniu. Długa lista = niska konwersja.
- **Zły czas trwania.** Jeśli ustawisz 60 minut na usługę, która trwa 90 — sloty się nałożą. Zmierz realnie.
- **Brak techników.** Jeśli jest was kilku — każdy musi być w **Pracownikach** z e-mailem i rolą.
- **Trial wygasł, karty brak.** ManicBot przypomni 3 dni wcześniej. Plan Start to 45 zł/mies — tańszy niż obiad.

## Podsumowanie

10 minut konfiguracji, 14 dni bezpłatnie, 45 zł/mies. Mniej niż cena jednego manicure — i zwykle w pierwszym tygodniu masz więcej rezerwacji niż płacisz.

## Szybki test rzeczywistości

Pytanie, które po onboardingu dostajemy częściej niż jakiekolwiek inne: „Jestem skonfigurowany, ale rezerwacji nie ma — co jest nie tak?". W dziewięciu przypadkach na dziesięć to nie bot, to dystrybucja. Bot zamyka, nie marketinguje.

Gdy więc działa, upewnij się, że klienci mają do niego ścieżkę:

- **Link w bio Instagrama.** Wstaw link bota zamiast tego, co tam jest teraz. Około 40% rezerwacji pierwszego tygodnia przychodzi z tej jednej zmiany.
- **Automatyczna odpowiedź w Direct.** W ustawieniach Instagram Business ustaw wiadomość powitalną z linkiem do bota. Nowe DM dostają link automatycznie, nawet gdy śpisz.
- **Stories z naklejką „Zarezerwuj".** Raz w tygodniu wrzuć zdjęcie pracy z tą naklejką. Konwertuje zaskakująco dobrze.
- **Wizytówka / paragon.** Wydrukuj link bota na tym, z czym klient wychodzi. Zapomną Twoje imię, ale nie zgubią wizytówki przez dwa tygodnie.

Jeśli coś nie działa — napisz w **Help → Czat ze wsparciem**. Odpowiadamy w ciągu godziny w godzinach pracy.`,
  },
};
