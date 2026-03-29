export type Lang = "ru" | "ua" | "en" | "pl";

export const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "ru", flag: "🇷🇺", label: "RU" },
  { code: "ua", flag: "🇺🇦", label: "UA" },
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "pl", flag: "🇵🇱", label: "PL" },
];

const translations = {
  // ── Common ──────────────────────────────────────────────────────────────────
  "common.loading":         { ru: "Загрузка...", ua: "Завантаження...", en: "Loading...", pl: "Ładowanie..." },
  "common.save":            { ru: "Сохранить",   ua: "Зберегти",       en: "Save",       pl: "Zapisz" },
  "common.back":            { ru: "Назад",        ua: "Назад",          en: "Back",       pl: "Wróć" },
  "common.close":           { ru: "Закрыть",      ua: "Закрити",        en: "Close",      pl: "Zamknij" },
  "common.settings":        { ru: "Настройки",    ua: "Налаштування",   en: "Settings",   pl: "Ustawienia" },
  "common.language":        { ru: "Язык",         ua: "Мова",           en: "Language",   pl: "Język" },
  "common.noData":          { ru: "Нет данных",   ua: "Немає даних",    en: "No data",    pl: "Brak danych" },
  "common.send":            { ru: "Отправить",    ua: "Надіслати",      en: "Send",       pl: "Wyślij" },
  "common.today":           { ru: "Сегодня",      ua: "Сьогодні",       en: "Today",      pl: "Dziś" },

  // ── Status labels ──────────────────────────────────────────────────────────
  "status.confirmed":       { ru: "Подтверждено", ua: "Підтверджено",   en: "Confirmed",  pl: "Potwierdzone" },
  "status.pending":         { ru: "Ожидает",      ua: "Очікує",         en: "Pending",    pl: "Oczekuje" },
  "status.cancelled":       { ru: "Отменено",     ua: "Скасовано",      en: "Cancelled",  pl: "Anulowane" },
  "status.rejected":        { ru: "Отклонено",    ua: "Відхилено",      en: "Rejected",   pl: "Odrzucone" },
  "status.open":            { ru: "Открыт",       ua: "Відкрито",       en: "Open",       pl: "Otwarte" },
  "status.claimed":         { ru: "В работе",     ua: "В роботі",       en: "In progress",pl: "W toku" },
  "status.escalated":       { ru: "Эскалирован",  ua: "Ескальовано",    en: "Escalated",  pl: "Eskalowane" },
  "status.closed":          { ru: "Закрыт",       ua: "Закрито",        en: "Closed",     pl: "Zamknięte" },

  // ── Billing ────────────────────────────────────────────────────────────────
  "billing.plan":           { ru: "Тариф",        ua: "Тариф",          en: "Plan",       pl: "Plan" },
  "billing.status":         { ru: "Статус",       ua: "Статус",         en: "Status",     pl: "Status" },
  "billing.nextPayment":    { ru: "Следующий платёж", ua: "Наступний платіж", en: "Next payment", pl: "Kolejna płatność" },
  "billing.trialUntil":     { ru: "Пробный до",   ua: "Пробний до",     en: "Trial until", pl: "Próba do" },
  "billing.active":         { ru: "Активна",      ua: "Активна",        en: "Active",     pl: "Aktywny" },
  "billing.trialing":       { ru: "Пробный",      ua: "Пробний",        en: "Trial",      pl: "Próbny" },
  "billing.grace":          { ru: "Льготный",     ua: "Пільговий",      en: "Grace",      pl: "Łaski" },
  "billing.expired":        { ru: "Истёк",        ua: "Завершився",     en: "Expired",    pl: "Wygasłe" },

  // ── Salon dashboard ────────────────────────────────────────────────────────
  "salon.title":            { ru: "Мой салон",    ua: "Мій салон",      en: "My Salon",   pl: "Mój salon" },
  "salon.overview":         { ru: "Обзор",        ua: "Огляд",          en: "Overview",   pl: "Przegląd" },
  "salon.appointments":     { ru: "Записи",       ua: "Записи",         en: "Appointments",pl: "Wizyty" },
  "salon.masters":          { ru: "Мастера",      ua: "Майстри",        en: "Masters",    pl: "Mistrzowie" },
  "salon.services":         { ru: "Услуги",       ua: "Послуги",        en: "Services",   pl: "Usługi" },
  "salon.clients":          { ru: "Клиенты",      ua: "Клієнти",        en: "Clients",    pl: "Klienci" },
  "salon.billing":          { ru: "Тариф",        ua: "Тариф",          en: "Billing",    pl: "Płatności" },
  "salon.todayApts":        { ru: "Записей сегодня", ua: "Записів сьогодні", en: "Today's appointments", pl: "Wizyty dziś" },
  "salon.activeMasters":    { ru: "Мастеров",     ua: "Майстрів",       en: "Masters",    pl: "Mistrzów" },
  "salon.openTickets":      { ru: "Открытых тикетов", ua: "Відкритих тікетів", en: "Open tickets", pl: "Otwarte zgłoszenia" },
  "salon.noApts":           { ru: "Записей нет",  ua: "Записів немає",  en: "No appointments", pl: "Brak wizyt" },
  "salon.noMasters":        { ru: "Мастеров нет", ua: "Майстрів немає", en: "No masters", pl: "Brak mistrzów" },
  "salon.noServices":       { ru: "Услуг нет",    ua: "Послуг немає",   en: "No services", pl: "Brak usług" },
  "salon.noClients":        { ru: "Клиентов нет", ua: "Клієнтів немає", en: "No clients", pl: "Brak klientów" },
  "salon.salonProfile":     { ru: "Настройки салона", ua: "Налаштування салону", en: "Salon settings", pl: "Ustawienia salonu" },
  "salon.botHint":          { ru: "Для изменения используйте бота: /settings", ua: "Для змін використайте бота: /settings", en: "To edit, use the bot: /settings", pl: "Aby edytować, użyj bota: /settings" },
  "salon.address":          { ru: "Адрес",        ua: "Адреса",         en: "Address",    pl: "Adres" },
  "salon.phone":            { ru: "Телефон",      ua: "Телефон",        en: "Phone",      pl: "Telefon" },
  "salon.hours":            { ru: "Часы работы",  ua: "Години роботи",  en: "Working hours", pl: "Godziny pracy" },
  "salon.name":             { ru: "Название",     ua: "Назва",          en: "Name",       pl: "Nazwa" },
  "salon.billingTitle":     { ru: "Тариф и оплата", ua: "Тариф і оплата", en: "Plan & billing", pl: "Plan i płatności" },

  // ── Master dashboard ───────────────────────────────────────────────────────
  "master.title":           { ru: "Кабинет мастера", ua: "Кабінет майстра", en: "Master Cabinet", pl: "Gabinet mistrza" },
  "master.today":           { ru: "Сегодня",      ua: "Сьогодні",       en: "Today",      pl: "Dziś" },
  "master.schedule":        { ru: "Расписание",   ua: "Розклад",        en: "Schedule",   pl: "Harmonogram" },
  "master.clients":         { ru: "Клиенты",      ua: "Клієнти",        en: "Clients",    pl: "Klienci" },
  "master.earnings":        { ru: "Доходы",       ua: "Доходи",         en: "Earnings",   pl: "Zarobki" },
  "master.profile":         { ru: "Профиль",      ua: "Профіль",        en: "Profile",    pl: "Profil" },
  "master.noSchedule":      { ru: "На сегодня записей нет", ua: "На сьогодні записів немає", en: "No appointments today", pl: "Brak wizyt dziś" },
  "master.noClients":       { ru: "Клиентов нет", ua: "Клієнтів немає", en: "No clients", pl: "Brak klientów" },
  "master.noApts":          { ru: "Записей нет",  ua: "Записів немає",  en: "No appointments", pl: "Brak wizyt" },
  "master.noProfile":       { ru: "Профиль не найден", ua: "Профіль не знайдено", en: "Profile not found", pl: "Profil nie znaleziony" },
  "master.earningsTitle":   { ru: "Доходы",       ua: "Доходи",         en: "Earnings",   pl: "Zarobki" },
  "master.allApts":         { ru: "Все записи",   ua: "Всі записи",     en: "All appointments", pl: "Wszystkie wizyty" },
  "master.myClients":       { ru: "Мои клиенты",  ua: "Мої клієнти",    en: "My clients", pl: "Moi klienci" },
  "master.lastApt":         { ru: "Последняя запись:", ua: "Остання запис:", en: "Last appointment:", pl: "Ostatnia wizyta:" },
  "master.profileHint":     { ru: "Для изменения профиля используйте бота: /profile", ua: "Для зміни профілю використайте бота: /profile", en: "To edit profile, use the bot: /profile", pl: "Aby edytować profil, użyj bota: /profile" },
  "master.weekEarnings":    { ru: "Выручка за неделю", ua: "Виручка за тиждень", en: "Weekly earnings", pl: "Tygodniowe zarobki" },
  "master.monthEarnings":   { ru: "Выручка за месяц", ua: "Виручка за місяць", en: "Monthly earnings", pl: "Miesięczne zarobki" },
  "master.yearEarnings":    { ru: "Выручка за год", ua: "Виручка за рік", en: "Yearly earnings", pl: "Roczne zarobki" },
  "master.confirmedApts":   { ru: "подтверждённых записей", ua: "підтверджених записів", en: "confirmed appointments", pl: "potwierdzone wizyty" },
  "master.week":            { ru: "Неделя",       ua: "Тиждень",        en: "Week",       pl: "Tydzień" },
  "master.month":           { ru: "Месяц",        ua: "Місяць",         en: "Month",      pl: "Miesiąc" },
  "master.year":            { ru: "Год",          ua: "Рік",            en: "Year",       pl: "Rok" },

  // ── Support dashboard ──────────────────────────────────────────────────────
  "support.title":          { ru: "Поддержка",    ua: "Підтримка",      en: "Support",    pl: "Wsparcie" },
  "support.tickets":        { ru: "Тикеты",       ua: "Тікети",         en: "Tickets",    pl: "Zgłoszenia" },
  "support.all":            { ru: "Все",          ua: "Всі",            en: "All",        pl: "Wszystkie" },
  "support.noTickets":      { ru: "Тикетов нет",  ua: "Тікетів немає",  en: "No tickets", pl: "Brak zgłoszeń" },
  "support.claim":          { ru: "Взять в работу", ua: "Взяти в роботу", en: "Claim",    pl: "Przejmij" },
  "support.escalate":       { ru: "Эскалировать", ua: "Ескалювати",     en: "Escalate",   pl: "Eskaluj" },
  "support.noMessages":     { ru: "Сообщений пока нет", ua: "Повідомлень поки немає", en: "No messages yet", pl: "Brak wiadomości" },
  "support.replyPlaceholder": { ru: "Напишите ответ...", ua: "Напишіть відповідь...", en: "Write a reply...", pl: "Napisz odpowiedź..." },
  "support.platform":       { ru: "Платформа",   ua: "Платформа",       en: "Platform",   pl: "Platforma" },

  // ── God Mode Shell nav ─────────────────────────────────────────────────────
  "nav.dashboard":          { ru: "Dashboard",    ua: "Dashboard",      en: "Dashboard",  pl: "Dashboard" },
  "nav.users":              { ru: "Users",        ua: "Users",          en: "Users",      pl: "Users" },
  "nav.tenants":            { ru: "Tenants",      ua: "Tenants",        en: "Tenants",    pl: "Tenants" },
  "nav.appointments":       { ru: "Appts",        ua: "Appts",          en: "Appts",      pl: "Appts" },
  "nav.agents":             { ru: "Agents",       ua: "Agents",         en: "Agents",     pl: "Agents" },
  "nav.billing":            { ru: "Billing",      ua: "Billing",        en: "Billing",    pl: "Billing" },
  "nav.system":             { ru: "System",       ua: "System",         en: "System",     pl: "System" },
  "nav.settings":           { ru: "Settings",     ua: "Settings",       en: "Settings",   pl: "Settings" },

  // ── Role switcher ──────────────────────────────────────────────────────────
  "roleSwitch.title":       { ru: "Режим просмотра", ua: "Режим перегляду", en: "Preview mode", pl: "Tryb podglądu" },
  "roleSwitch.godMode":     { ru: "God Mode",     ua: "God Mode",       en: "God Mode",   pl: "God Mode" },
  "roleSwitch.salon":       { ru: "Как салон",    ua: "Як салон",       en: "As Salon",   pl: "Jako salon" },
  "roleSwitch.master":      { ru: "Как мастер",   ua: "Як майстер",     en: "As Master",  pl: "Jako mistrz" },
  "roleSwitch.support":     { ru: "Как саппорт",  ua: "Як підтримка",   en: "As Support", pl: "Jako wsparcie" },
  "roleSwitch.pickTenant":  { ru: "Выберите салон", ua: "Оберіть салон", en: "Pick a salon", pl: "Wybierz salon" },
  "roleSwitch.preview":     { ru: "Превью:",      ua: "Перегляд:",      en: "Preview:",   pl: "Podgląd:" },
  "roleSwitch.exit":        { ru: "Выйти из превью", ua: "Вийти з перегляду", en: "Exit preview", pl: "Wyjdź z podglądu" },

  // ── Settings modal ─────────────────────────────────────────────────────────
  "settings.title":         { ru: "Настройки",    ua: "Налаштування",   en: "Settings",   pl: "Ustawienia" },
  "settings.language":      { ru: "Язык интерфейса", ua: "Мова інтерфейсу", en: "Interface language", pl: "Język interfejsu" },

  // ── Init / errors ──────────────────────────────────────────────────────────
  "gate.tgOnly":            { ru: "Только через Telegram", ua: "Тільки через Telegram", en: "Telegram only", pl: "Tylko przez Telegram" },
  "gate.tgOnlyDesc":        { ru: "Панель управления открывается только как Telegram Mini App.", ua: "Панель керування відкривається тільки як Telegram Mini App.", en: "This panel opens only as a Telegram Mini App.", pl: "Panel otwiera się tylko jako Telegram Mini App." },
  "gate.forbidden":         { ru: "Доступ запрещён", ua: "Доступ заборонено", en: "Access denied", pl: "Dostęp zabroniony" },
  "gate.forbiddenDesc":     { ru: "У вас нет доступа к панели управления.", ua: "У вас немає доступу до панелі керування.", en: "You don't have access to this panel.", pl: "Nie masz dostępu do tego panelu." },
  "gate.init":              { ru: "Инициализация...", ua: "Ініціалізація...", en: "Initializing...", pl: "Inicjalizacja..." },
  "gate.webLogin":          { ru: "Войти через сайт", ua: "Увійти через сайт", en: "Log in via web", pl: "Zaloguj się przez web" },

  // ── CRUD actions ────────────────────────────────────────────────────────────
  "action.add":             { ru: "Добавить",       ua: "Додати",          en: "Add",        pl: "Dodaj" },
  "action.edit":            { ru: "Редактировать",  ua: "Редагувати",      en: "Edit",       pl: "Edytuj" },
  "action.delete":          { ru: "Удалить",        ua: "Видалити",        en: "Delete",     pl: "Usuń" },
  "action.cancel":          { ru: "Отмена",         ua: "Скасувати",       en: "Cancel",     pl: "Anuluj" },
  "action.confirm":         { ru: "Подтвердить",    ua: "Підтвердити",     en: "Confirm",    pl: "Potwierdź" },
  "action.reject":          { ru: "Отклонить",      ua: "Відхилити",       en: "Reject",     pl: "Odrzuć" },
  "action.create":          { ru: "Создать",        ua: "Створити",        en: "Create",     pl: "Utwórz" },
  "action.search":          { ru: "Поиск",          ua: "Пошук",           en: "Search",     pl: "Szukaj" },

  // ── Service fields ────────────────────────────────────────────────────────
  "service.name":           { ru: "Название услуги", ua: "Назва послуги",  en: "Service name", pl: "Nazwa usługi" },
  "service.price":          { ru: "Цена",           ua: "Ціна",            en: "Price",      pl: "Cena" },
  "service.duration":       { ru: "Длительность (мин)", ua: "Тривалість (хв)", en: "Duration (min)", pl: "Czas (min)" },
  "service.emoji":          { ru: "Иконка",         ua: "Іконка",          en: "Icon",       pl: "Ikona" },
  "service.active":         { ru: "Активна",        ua: "Активна",         en: "Active",     pl: "Aktywna" },
  "service.hidden":         { ru: "Скрыта",         ua: "Приховано",       en: "Hidden",     pl: "Ukryta" },

  // ── Master fields ─────────────────────────────────────────────────────────
  "master.chatId":          { ru: "Telegram ID мастера", ua: "Telegram ID майстра", en: "Master's Telegram ID", pl: "Telegram ID mistrza" },
  "master.name":            { ru: "Имя мастера",    ua: "Ім'я майстра",    en: "Master's name", pl: "Imię mistrza" },
  "master.addMaster":       { ru: "Добавить мастера", ua: "Додати майстра", en: "Add master", pl: "Dodaj mistrza" },
  "master.removeMaster":    { ru: "Удалить мастера", ua: "Видалити майстра", en: "Remove master", pl: "Usuń mistrza" },

  // ── Salon settings ────────────────────────────────────────────────────────
  "salon.editProfile":      { ru: "Редактировать профиль", ua: "Редагувати профіль", en: "Edit profile", pl: "Edytuj profil" },
  "salon.workHoursFrom":    { ru: "Начало работы",  ua: "Початок роботи",  en: "Start time", pl: "Godzina otwarcia" },
  "salon.workHoursTo":      { ru: "Конец работы",   ua: "Кінець роботи",   en: "End time",   pl: "Godzina zamknięcia" },

  // ── Confirmations ─────────────────────────────────────────────────────────
  "confirm.deleteService":  { ru: "Удалить услугу?", ua: "Видалити послугу?", en: "Delete service?", pl: "Usunąć usługę?" },
  "confirm.removeMaster":   { ru: "Удалить мастера?", ua: "Видалити майстра?", en: "Remove master?", pl: "Usunąć mistrza?" },
  "confirm.cancelApt":      { ru: "Отменить запись?", ua: "Скасувати запис?", en: "Cancel appointment?", pl: "Anulować wizytę?" },

  // ── Toast/success messages ────────────────────────────────────────────────
  "toast.saved":            { ru: "Сохранено",      ua: "Збережено",       en: "Saved",      pl: "Zapisano" },
  "toast.created":          { ru: "Создано",        ua: "Створено",        en: "Created",    pl: "Utworzono" },
  "toast.deleted":          { ru: "Удалено",        ua: "Видалено",        en: "Deleted",    pl: "Usunięto" },
} as const;

type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, lang: Lang): string {
  return translations[key]?.[lang] ?? translations[key]?.["ru"] ?? key;
}
