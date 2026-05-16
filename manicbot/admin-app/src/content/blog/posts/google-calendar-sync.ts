import type { BlogArticle } from "../types";

export const googleCalendarSync: BlogArticle = {
  slug: "google-calendar-sync",
  date: "2026-03-03",
  updated: "2026-05-16",
  categoryKey: "product",
  coverImage: {
    url: "https://images.unsplash.com/photo-1606327054629-64c8b0fd6e4f?w=1600&q=80&auto=format&fit=crop",
    alt: {
      ru: "Google Calendar на ноутбуке — синхронизация записей салона в реальном времени",
      ua: "Google Calendar на ноутбуці — синхронізація записів салону в реальному часі",
      en: "Google Calendar on a laptop — real-time salon booking sync",
      pl: "Google Calendar na laptopie — synchronizacja rezerwacji w czasie rzeczywistym",
    },
    credit: "Unsplash",
  },
  titles: {
    ru: "Двойные брони, которые крадут 2–3 часа в неделю — выключаются за 2 минуты через Google Calendar",
    ua: "Подвійні броні, що крадуть 2–3 години на тиждень — вимикаються за 2 хвилини через Google Calendar",
    en: "Double-bookings that steal 2–3 hours a week — switched off in 2 minutes with Google Calendar",
    pl: "Podwójne rezerwacje kradnące 2–3 godziny tygodniowo — wyłączane w 2 minuty przez Google Calendar",
  },
  excerpts: {
    ru: "Подключите Google Calendar — и забудьте о двойных записях. Двусторонняя синхронизация, личные дела блокируют слоты, оффлайн-устойчивость с экспоненциальным backoff.",
    ua: "Підключіть Google Calendar — і забудьте про подвійні записи. Двостороння синхронізація, особисті справи блокують слоти, офлайн-стійкість з експоненційним backoff.",
    en: "Connect Google Calendar and forget about double-bookings. Two-way sync, personal events block slots, offline-resilient with exponential backoff.",
    pl: "Podłącz Google Calendar i zapomnij o podwójnych rezerwacjach. Synchronizacja dwukierunkowa, prywatne wydarzenia blokują sloty, odporność offline z wykładniczym backoffem.",
  },
  keywords: {
    ru: ["Google Calendar для салона", "синхронизация записей", "двусторонняя синхронизация", "защита от двойных броней", "ManicBot и Google"],
    ua: ["Google Calendar для салону", "синхронізація записів", "двостороння синхронізація", "захист від подвійних бронювань", "ManicBot та Google"],
    en: ["Google Calendar for salon", "booking sync", "two-way calendar sync", "double-booking protection", "ManicBot Google integration"],
    pl: ["Google Calendar dla salonu", "synchronizacja rezerwacji", "dwukierunkowa synchronizacja", "ochrona przed podwójnymi rezerwacjami", "ManicBot Google"],
  },
  relatedSlugs: ["automate-salon-booking", "first-client-in-10-minutes", "whatsapp-instagram-channels"],
  bodies: {
    ru: `Двойная бронь — самый раздражающий косяк салона. Клиент пришёл, мастер занят с другим, обе стороны злятся, репутация в Google Maps падает. По нашим замерам, средний салон без синхронизации календарей теряет на двойных бронях и связанных с ними переносах **2–3 часа в неделю** — это половина рабочего дня в месяц.

Решение давно есть, но почему-то многие его не включают: двусторонняя синхронизация с Google Calendar. В ManicBot подключается за 2 минуты, работает 24/7, экспоненциальный backoff защищает от блокировок Google API.

В статье — что именно синхронизируется, как подключить и какие подводные камни нужно знать.

## Почему Google Calendar, а не отдельный CRM-календарь

Мастер живёт в своём личном Google Calendar. Туда попадают:

- встречи с друзьями и семейные дела;
- поездки за город, отпуска;
- учёба, тренинги, тренировки в зале;
- личные приёмы у врачей и других специалистов.

Если рабочий календарь отдельно — рано или поздно мастер запишет клиента на 14:00 в субботу, а в этом же 14:00 у него уже стоит «свадьба сестры». Никакой CRM этого не знает.

Решение единственное: **сделать Google Calendar единым источником истины** про занятость. ManicBot туда и пишет, и читает.

## Что синхронизируется (и в каком направлении)

### Из ManicBot → в Google Calendar

Каждая новая запись попадает в Google Calendar мастера автоматически:

- название события: «Анна — маникюр с покрытием»;
- время: с учётом длительности услуги;
- описание: контакт клиента, заметки, ссылка на профиль в боте;
- цвет: можно настроить для разных типов услуг (педикюр vs маникюр).

Если запись перенесли или отменили в боте — событие в Google обновляется или удаляется в течение секунд.

### Из Google Calendar → в ManicBot

Любое событие в Google Calendar, помеченное как «занят» (busy), автоматически блокирует слот в боте. Это значит:

- если мастер поставил «обед 13:00–14:00» — клиент не запишется на 13:30;
- если мастер уехал в отпуск и поставил событие на всю неделю — бот сам перестанет предлагать слоты;
- если у мастера планёрка в студии — слот недоступен.

Никакого ручного «не забудь заблокировать день в боте». Один календарь — один источник истины.

## Кэширование и оффлайн-устойчивость

Google API иногда отдаёт ошибки (rate limit, временные сбои). Если ManicBot слепо ретраил бы каждый раз — Google быстро заблокировал бы аккаунт. Поэтому мы используем **экспоненциальный backoff**: при первой ошибке — 1 минута, при второй — 2, потом 4, 8, 16. Параллельно ManicBot держит кэш занятых слотов на 24 часа вперёд, так что даже если синхронизация временно зависла — клиент всё равно видит реальные доступные слоты.

Колонки в базе для отслеживания: \`sync_retries\`, \`sync_retry_after\`, \`sync_last_error\`. Это видно в админ-панели в разделе «Google Calendar» — если что-то идёт не так, владелец сразу понимает причину.

## Как подключить

1. Откройте админ-панель ManicBot → **Настройки → Google Calendar**.
2. Нажмите «Подключить».
3. Авторизуйтесь через свой Google-аккаунт. Дайте разрешение на чтение и запись событий.
4. Выберите календарь (обычно «Основной», но можно завести отдельный «Работа» — мы поддерживаем оба варианта).
5. Готово. Первая полная синхронизация занимает 30–60 секунд.

Каждый мастер подключает свой Google-аккаунт отдельно. Это важно: ManicBot не «лезет» в общий календарь салона, а уважает приватность каждого мастера. Владелец видит только сводку «у такого-то 5 событий на эту неделю», без деталей.

## Что насчёт приватных событий

Если событие помечено в Google как **«Приватное»**, ManicBot видит только время «занято» — без названия, описания и участников. Никакого парсинга личных событий. Это политика по умолчанию, и её нельзя обойти.

## Двусторонние правки

Что если мастер отредактировал событие прямо в Google Calendar (например, передвинул запись клиента)? Webhook от Google уведомляет ManicBot, и через 5–10 секунд бот обновляет запись в своей базе. Клиент получает уведомление о переносе автоматически — Telegram/WhatsApp.

Что если запись в ManicBot отменили? Соответствующее событие в Google удаляется. Симметрия полная.

## Для кого

Синхронизация доступна на тарифах **Pro** и **Studio**. На Start работает только Telegram-бот без календарей — этого достаточно для салона с одним мастером, но как только появляется второй — Google Calendar становится обязательным.

Подключение бесплатное, лимитов на количество событий нет. Единственный лимит — со стороны Google API, но он настолько щедрый, что обычные салоны его никогда не достигают.

## Что в итоге

Двойные брони — техническая проблема, у которой есть техническое решение. ManicBot + Google Calendar убирают её за 2 минуты настройки. Все мастера в Google Calendar, все слоты в боте, ноль ручных копирований.

Если вы ещё не подключили синхронизацию — это самое простое улучшение, которое вы можете сделать сегодня. Откройте админку, нажмите «Подключить», и через минуту ваше расписание станет на порядок надёжнее.`,
    ua: `Подвійна броня — найдратівніший косяк салону. Клієнт прийшов, майстер зайнятий з іншим, обидві сторони злі, репутація в Google Maps падає. За нашими замірами, середній салон без синхронізації календарів втрачає на подвійних бронях і пов'язаних з ними перенесеннях **2–3 години на тиждень** — це половина робочого дня на місяць.

Рішення давно є, але чомусь багато хто його не вмикає: двостороння синхронізація з Google Calendar. У ManicBot підключається за 2 хвилини, працює 24/7, експоненційний backoff захищає від блокувань Google API.

У статті — що саме синхронізується, як підключити і які підводні камені треба знати.

## Чому Google Calendar, а не окремий CRM-календар

Майстер живе у своєму особистому Google Calendar. Туди потрапляють:

- зустрічі з друзями і сімейні справи;
- поїздки за місто, відпустки;
- навчання, тренінги, тренування в залі;
- особисті прийоми у лікарів та інших фахівців.

Якщо робочий календар окремо — рано чи пізно майстер запише клієнта на 14:00 у суботу, а в цьому ж 14:00 у нього вже стоїть «весілля сестри». Жоден CRM цього не знає.

Рішення єдине: **зробити Google Calendar єдиним джерелом істини** про зайнятість. ManicBot туди і пише, і читає.

## Що синхронізується (і в якому напрямку)

### З ManicBot → у Google Calendar

Кожен новий запис потрапляє в Google Calendar майстра автоматично:

- назва події: «Анна — манікюр з покриттям»;
- час: з урахуванням тривалості послуги;
- опис: контакт клієнта, нотатки, посилання на профіль у боті;
- колір: можна налаштувати для різних типів послуг (педикюр vs манікюр).

Якщо запис перенесли або скасували в боті — подія в Google оновлюється або видаляється протягом секунд.

### З Google Calendar → у ManicBot

Будь-яка подія в Google Calendar, позначена як «зайнятий» (busy), автоматично блокує слот у боті. Це означає:

- якщо майстер поставив «обід 13:00–14:00» — клієнт не запишеться на 13:30;
- якщо майстер поїхав у відпустку і поставив подію на весь тиждень — бот сам перестане пропонувати слоти;
- якщо у майстра планерка в студії — слот недоступний.

Жодного ручного «не забудь заблокувати день у боті». Один календар — одне джерело істини.

## Кешування і офлайн-стійкість

Google API іноді віддає помилки (rate limit, тимчасові збої). Якщо ManicBot сліпо ретраїв би щоразу — Google швидко заблокував би акаунт. Тому ми використовуємо **експоненційний backoff**: при першій помилці — 1 хвилина, при другій — 2, далі 4, 8, 16. Паралельно ManicBot тримає кеш зайнятих слотів на 24 години вперед, тож навіть якщо синхронізація тимчасово зависла — клієнт усе одно бачить реальні доступні слоти.

Колонки в базі для відстеження: \`sync_retries\`, \`sync_retry_after\`, \`sync_last_error\`. Це видно в адмін-панелі в розділі «Google Calendar» — якщо щось іде не так, власник одразу розуміє причину.

## Як підключити

1. Відкрийте адмін-панель ManicBot → **Налаштування → Google Calendar**.
2. Натисніть «Підключити».
3. Авторизуйтесь через свій Google-акаунт. Дайте дозвіл на читання та запис подій.
4. Виберіть календар (зазвичай «Основний», але можна завести окремий «Робота» — ми підтримуємо обидва варіанти).
5. Готово. Перша повна синхронізація займає 30–60 секунд.

Кожен майстер підключає свій Google-акаунт окремо. Це важливо: ManicBot не «лізе» в загальний календар салону, а поважає приватність кожного майстра. Власник бачить лише зведення «у такого-то 5 подій на цей тиждень», без деталей.

## Що щодо приватних подій

Якщо подія позначена в Google як **«Приватна»**, ManicBot бачить лише час «зайнято» — без назви, опису й учасників. Жодного парсингу особистих подій. Це політика за замовчуванням, і її не можна обійти.

## Двосторонні правки

Що якщо майстер відредагував подію прямо в Google Calendar (наприклад, пересунув запис клієнта)? Webhook від Google повідомляє ManicBot, і через 5–10 секунд бот оновлює запис у своїй базі. Клієнт отримує сповіщення про перенесення автоматично — Telegram/WhatsApp.

Що якщо запис у ManicBot скасували? Відповідна подія в Google видаляється. Симетрія повна.

## Для кого

Синхронізація доступна на тарифах **Pro** та **Studio**. На Start працює тільки Telegram-бот без календарів — цього достатньо для салону з одним майстром, але щойно з'являється другий — Google Calendar стає обов'язковим.

Підключення безкоштовне, лімітів на кількість подій немає. Єдиний ліміт — з боку Google API, але він настільки щедрий, що звичайні салони його ніколи не досягають.

## Що в підсумку

Подвійні броні — технічна проблема, у якої є технічне рішення. ManicBot + Google Calendar прибирають її за 2 хвилини налаштування. Усі майстри в Google Calendar, усі слоти в боті, нуль ручних копіювань.

Якщо ви ще не підключили синхронізацію — це найпростіше покращення, яке ви можете зробити сьогодні. Відкрийте адмінку, натисніть «Підключити», і через хвилину ваш розклад стане на порядок надійнішим.`,
    en: `Double-bookings are the most irritating salon screwup. Client shows up, technician is busy with another, both parties annoyed, Google Maps reputation slips. Our measurements show that the average salon without calendar sync loses **2–3 hours a week** to double-bookings and the rescheduling around them — that's half a workday a month.

The fix has been around forever, yet many salons don't turn it on: two-way Google Calendar sync. ManicBot connects in 2 minutes, runs 24/7, with exponential backoff protecting against Google API throttling.

This article covers what syncs, how to connect, and the gotchas you should know.

## Why Google Calendar, not a separate CRM calendar

A technician lives in their personal Google Calendar. That's where:

- meetings with friends and family stuff land;
- weekend trips and vacations live;
- training, courses, gym sessions;
- doctor's appointments and other personal bookings.

If the work calendar is separate, sooner or later a technician will book a client at 2 PM Saturday — and at that same 2 PM they already have "sister's wedding". No CRM knows this.

The only fix: **make Google Calendar the single source of truth** about availability. ManicBot writes to it and reads from it.

## What syncs (and in which direction)

### ManicBot → Google Calendar

Every new booking lands in the technician's Google Calendar automatically:

- event title: "Anna — manicure with coating";
- time: accounting for service duration;
- description: client contact, notes, link to the bot profile;
- colour: customisable per service type (pedicure vs manicure).

If the booking is moved or cancelled in the bot, the Google event updates or deletes within seconds.

### Google Calendar → ManicBot

Any Google Calendar event marked as "busy" automatically blocks a slot in the bot. That means:

- if the technician put "lunch 1:00–2:00 PM", clients can't book 1:30 PM;
- if the technician is on vacation with a week-long event, the bot stops offering slots;
- if there's a studio standup, the slot is unavailable.

No manual "don't forget to block the day in the bot". One calendar, one source of truth.

## Caching and offline resilience

Google API occasionally throws errors (rate limits, transient outages). If ManicBot blindly retried every time, Google would throttle the account fast. So we use **exponential backoff**: first error — 1 minute, second — 2, then 4, 8, 16. In parallel, ManicBot keeps a 24-hour-forward cache of busy slots, so even if sync briefly stalls, clients still see real availability.

DB columns for tracking: \`sync_retries\`, \`sync_retry_after\`, \`sync_last_error\`. Visible in the admin panel under "Google Calendar" — if anything goes wrong, the owner sees the cause immediately.

## How to connect

1. Open ManicBot admin → **Settings → Google Calendar**.
2. Click "Connect".
3. Authorize with your Google account. Grant read+write access to events.
4. Pick a calendar (usually "Primary", but a separate "Work" calendar works too — we support both).
5. Done. Initial full sync takes 30–60 seconds.

Each technician connects their own Google account separately. Important: ManicBot doesn't poke into a shared salon calendar — it respects each technician's privacy. The owner sees only an aggregate "5 events this week for X", no details.

## What about private events

If an event is marked **Private** in Google, ManicBot sees only "busy" — no title, description, or attendees. No parsing of personal events. This is the default policy and it cannot be overridden.

## Two-way edits

What if the technician edits an event directly in Google Calendar (say, moves a client's booking)? A Google webhook notifies ManicBot, and within 5–10 seconds the bot updates its DB. The client gets a reschedule notification automatically via Telegram/WhatsApp.

What if the booking is cancelled in ManicBot? The corresponding Google event is deleted. Full symmetry.

## Who it's for

Sync is available on **Pro** and **Studio** plans. The Start plan supports a Telegram bot only, no calendars — enough for a single-technician salon, but once you add a second person Google Calendar becomes mandatory.

Connection is free, no event limits. The only limit is on the Google API side, and it's so generous regular salons never hit it.

## The bottom line

Double-bookings are a technical problem with a technical fix. ManicBot + Google Calendar removes them with 2 minutes of setup. Every technician in Google Calendar, every slot in the bot, zero manual copying.

If you haven't connected sync yet — it's the single easiest improvement you can make today. Open admin, hit Connect, and a minute later your schedule is dramatically more reliable.`,
    pl: `Podwójne rezerwacje to najbardziej irytujący błąd salonu. Klient przyszedł, technik zajęty kimś innym, obie strony zdenerwowane, reputacja w Google Maps spada. Z naszych pomiarów przeciętny salon bez synchronizacji kalendarzy traci **2–3 godziny tygodniowo** na podwójne rezerwacje i przesuwanie wizyt — to pół dnia pracy w miesiącu.

Rozwiązanie istnieje od dawna, ale wielu go nie włącza: dwukierunkowa synchronizacja z Google Calendar. W ManicBot podłącza się w 2 minuty, działa 24/7, wykładniczy backoff chroni przed throttlingiem Google API.

W artykule — co dokładnie się synchronizuje, jak podłączyć i jakie pułapki znać.

## Dlaczego Google Calendar, a nie osobny kalendarz CRM

Technik żyje w swoim osobistym Google Calendar. Tam trafiają:

- spotkania ze znajomymi i sprawy rodzinne;
- wyjazdy weekendowe, urlopy;
- szkolenia, kursy, siłownia;
- wizyty u lekarzy i innych specjalistów.

Jeśli kalendarz pracy jest osobno, prędzej czy później technik zarezerwuje klienta na 14:00 w sobotę — a o 14:00 ma już „wesele siostry". Żaden CRM tego nie wie.

Jedyne rozwiązanie: **zrobić z Google Calendar jedyne źródło prawdy** o dostępności. ManicBot tam pisze i stamtąd czyta.

## Co się synchronizuje (i w którym kierunku)

### ManicBot → Google Calendar

Każda nowa rezerwacja trafia do Google Calendar technika automatycznie:

- tytuł wydarzenia: „Anna — manicure z pokryciem";
- czas: z uwzględnieniem czasu trwania usługi;
- opis: kontakt klienta, notatki, link do profilu w bocie;
- kolor: do konfiguracji po typie usługi (pedicure vs manicure).

Jeśli rezerwacja jest przeniesiona lub anulowana w bocie, wydarzenie w Google aktualizuje się lub kasuje w ciągu sekund.

### Google Calendar → ManicBot

Każde wydarzenie w Google Calendar oznaczone jako „zajęty" (busy) blokuje slot w bocie automatycznie. To znaczy:

- jeśli technik wstawił „lunch 13:00–14:00", klient nie zarezerwuje na 13:30;
- jeśli technik jest na urlopie z tygodniowym wydarzeniem, bot przestaje proponować sloty;
- jeśli jest standup w studio, slot jest niedostępny.

Żadnego ręcznego „pamiętaj zablokować dzień w bocie". Jeden kalendarz, jedno źródło prawdy.

## Cache i odporność offline

Google API czasem zwraca błędy (rate limit, chwilowe awarie). Gdyby ManicBot ślepo ponawiał, Google szybko by zablokował konto. Dlatego używamy **wykładniczego backoffu**: pierwszy błąd — 1 minuta, drugi — 2, potem 4, 8, 16. Równolegle ManicBot trzyma cache zajętych slotów na 24 godziny do przodu, więc nawet przy chwilowym zawieszeniu synchronizacji klient widzi realną dostępność.

Kolumny w bazie: \`sync_retries\`, \`sync_retry_after\`, \`sync_last_error\`. Widoczne w panelu admin w sekcji „Google Calendar" — gdy coś nie gra, właściciel od razu widzi przyczynę.

## Jak podłączyć

1. Otwórz panel ManicBot → **Ustawienia → Google Calendar**.
2. Kliknij „Podłącz".
3. Zaloguj się przez Google. Daj uprawnienie do odczytu i zapisu wydarzeń.
4. Wybierz kalendarz (zwykle „Główny", ale można założyć osobny „Praca" — wspieramy oba warianty).
5. Gotowe. Pierwsza pełna synchronizacja zajmuje 30–60 sekund.

Każdy technik podłącza swoje konto Google osobno. Ważne: ManicBot nie „grzebie" w wspólnym kalendarzu salonu — szanuje prywatność technika. Właściciel widzi tylko zbiorcze „X ma 5 wydarzeń w tym tygodniu", bez szczegółów.

## A wydarzenia prywatne

Jeśli wydarzenie jest oznaczone w Google jako **Prywatne**, ManicBot widzi tylko czas „zajęty" — bez tytułu, opisu i uczestników. Żadnego parsowania osobistych wydarzeń. To polityka domyślna, której nie da się obejść.

## Edycje dwukierunkowe

Co jeśli technik edytuje wydarzenie wprost w Google Calendar (np. przesuwa wizytę klienta)? Webhook od Google powiadamia ManicBot, a w ciągu 5–10 sekund bot aktualizuje rezerwację w bazie. Klient automatycznie dostaje powiadomienie o zmianie przez Telegram/WhatsApp.

Co jeśli rezerwacja jest anulowana w ManicBot? Odpowiednie wydarzenie w Google jest kasowane. Pełna symetria.

## Dla kogo

Synchronizacja dostępna w planach **Pro** i **Studio**. Plan Start to tylko bot Telegram bez kalendarzy — wystarczy dla jednoosobowego salonu, ale gdy pojawia się druga osoba, Google Calendar staje się obowiązkowy.

Podłączenie bezpłatne, bez limitów wydarzeń. Jedyny limit to Google API, ale tak hojny, że zwykłe salony nigdy go nie osiągają.

## Podsumowanie

Podwójne rezerwacje to problem techniczny z technicznym rozwiązaniem. ManicBot + Google Calendar usuwa je 2-minutową konfiguracją. Każdy technik w Google Calendar, każdy slot w bocie, zero ręcznego kopiowania.

Jeśli jeszcze nie podłączyłeś synchronizacji, to najprostsza poprawa, jaką możesz zrobić dziś. Otwórz panel, kliknij „Podłącz", a po minucie Twój grafik staje się o rząd wielkości bardziej niezawodny.`,
  },
};
