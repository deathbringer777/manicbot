export default {
  // Admin panel
  adm_welcome: '🔧 <b>Панель администратора</b>\n\nПривет, {n}! Ты — админ.',
  adm_registered: '✅ <b>Ты зарегистрирован как админ!</b>\n\nТеперь у тебя есть доступ к панели управления.',
  adm_wrong_key: '❌ Неверный ключ.',
  adm_today: '📋 Записи на сегодня',
  adm_tomorrow: '📅 Записи на завтра',
  adm_masters: '👩‍🎨 Мастера',
  adm_add_master: '➕ Добавить мастера',
  adm_del_master: '❌ Удалить',
  adm_clients: '👥 Клиенты',
  adm_back: '◀️ Панель админа',
  adm_prev: '◀️ Назад',
  adm_next: 'Вперёд ▶️',
  adm_no_apts: 'Нет записей.',
  confirm_all_done: '✅ Подтверждено {n} заявок.',
  confirm_all_none: 'Нет ожидающих заявок.',
  adm_no_masters: 'Мастеров пока нет.\n\nДобавь первого!',
  adm_to_client: '💅 Режим клиента',

  // Appointments view
  adm_apt_unassigned: '❓ Не назначен',
  adm_assign_master_prompt: '👩‍🎨 Выбери мастера для записи:',
  adm_assign_btn: '👩‍🎨 Назначить мастера',
  adm_master_assigned_ok: '✅ Мастер <b>{name}</b> назначен на запись.',
  adm_all_apts: '📋 Все записи',
  adm_all_apts_title: '📋 <b>Все записи</b>',
  adm_filter_all: '👁 Все',
  adm_filter_master: '👤 {name}',

  // Master management
  adm_enter_master_id: '✏️ Введи ID, @username или телефон мастера\nили перешли его сообщение/контакт:',
  adm_master_added: '✅ Мастер <b>{n}</b> (ID: {id}) добавлен!',
  adm_master_removed: '❌ Мастер удалён.',
  adm_master_exists: 'ℹ️ Этот мастер уже добавлен.',
  adm_master_invalid: '❌ Не удалось найти мастера. Введи ID, @username, телефон или перешли сообщение/контакт.',
  adm_master_username_hint: '❌ По @username бот не видит пользователя (ограничение Telegram). Пусть этот человек сначала откроет этого бота и нажмёт /start — после этого повтори команду. Или укажи его ID: /grant_master 123456789',
  adm_master_must_use_bot_first: '❌ Этого пользователя нельзя назначить мастером: он ещё не заходил в этого бота. Пусть сначала откроет этого бота и нажмёт /start.',
  adm_vacation_btn: '🏖 В отпуск',
  adm_vacation_off_btn: '✅ Снять с отпуска',
  adm_vacation_on: '✅ Мастер в отпуске.',
  adm_vacation_off: '✅ Мастер снят с отпуска.',
  adm_vacation_status: 'в отпуске',
  adm_rename_master: '✏️ Переименовать',
  adm_rename_master_prompt: '✏️ Введи новое отображаемое имя мастера:',
  adm_rename_master_done: '✅ Имя мастера изменено на <b>{name}</b>.',
  adm_rename_master_err: '❌ Имя должно быть от 2 до 50 символов.',

  // Blocking
  adm_block_btn: '🚫 Блок',
  adm_unblock_btn: '✅ Разблок',
  adm_blocked: '🚫 Клиент заблокирован.',
  adm_unblocked: '✅ Клиент разблокирован.',

  // Cancel appointment (admin)
  adm_cancel_prompt: '💬 Причина отмены для клиента:',
  adm_cancel_skip: '⏭ Без причины',
  adm_apt_cancelled: '✅ Запись отменена. Клиент уведомлён.',
  adm_cancel_all_confirm: '⚠️ Отменить все {n} записей всех клиентов?',
  adm_cancel_all_yes: '🗑 Да, отменить все',
  adm_cancel_all_done: '✅ Отменено {n} записей. Клиенты уведомлены.',
  client_cancelled_admin: '😔 <b>Запись отменена</b>\n\n{svc}\n📅 {dt}\n\n💬 <i>{reason}</i>\n\nПриносим извинения!',

  // Salon settings
  adm_settings: '⚙️ Настройки',
  adm_settings_title: '⚙️ <b>Настройки салона</b>',
  adm_settings_name_btn: '✏️ Название',
  adm_settings_phone_btn: '📞 Телефон',
  adm_settings_addr_btn: '📍 Адрес',
  adm_settings_hours_btn: '🕐 Часы работы',
  adm_settings_enter_name: '✏️ Введите новое название салона:',
  adm_settings_enter_phone: '📞 Введите новый номер телефона:',
  adm_settings_enter_addr: '📍 Введите новый адрес:',
  adm_settings_enter_hours: '🕐 Введите часы работы в формате <b>9-19</b> (начало-конец):',
  adm_settings_saved: '✅ Настройки сохранены!',
  adm_settings_no_tenant: 'ℹ️ Управление настройками доступно в мультитенантном режиме.',

  // About section
  adm_about_photos: '📷 Фото «О нас»',
  adm_about_desc: '✏️ Описание «О нас»',
  adm_about_instagram: '📷 Ссылка Instagram',
  adm_enter_about_desc: '✏️ Введи описание для раздела «О нас»\n(или /skip чтобы сбросить на стандартное):',
  adm_enter_instagram: '📷 Введи ссылку на Instagram\n(например https://instagram.com/username):',
  adm_current: 'Текущее',

  // Tenant support agents (managed by tenant admin)
  adm_support_btn: '👥 Поддержка клиентов',
  adm_support_agents: 'Агенты поддержки клиентов',
  adm_support_no_agents: 'Агентов поддержки нет. Добавьте первого!',
  adm_support_add_btn: '➕ Добавить агента',
  adm_support_remove_btn: '❌ Удалить',
  adm_support_enter_user: 'Введите @username или числовой chat_id пользователя для добавления в поддержку клиентов:',
  adm_support_added: '✅ Агент поддержки добавлен.',
  adm_support_removed: '✅ Агент поддержки удалён.',
  adm_support_limit: '⚠️ Достигнут лимит в 50 агентов поддержки.',

  adm_meta_channels_btn: '📱 Instagram / WhatsApp',
  adm_meta_channels_title: '📱 <b>Instagram и WhatsApp</b>',
  adm_meta_channels_body:
    '<b>Как подключить</b>\n\n'
    + '1) Открой Mini App (кнопка ниже или меню «Салон»).\n'
    + '2) Вкладка <b>Channels</b> — скопируй Webhook URL и Verify Token.\n'
    + '3) В <b>Meta for Developers</b> подключи Instagram Messaging и/или WhatsApp Cloud API → Webhooks.\n'
    + '4) В Mini App сохрани Phone Number ID + токен (WhatsApp) или Page ID + Page Access Token (Instagram).\n\n'
    + 'Нужен тариф <b>Pro</b> или <b>Studio</b>.',
  adm_meta_open_miniapp: '📲 Открыть Mini App',
  adm_meta_open_browser: '🔗 Открыть в браузере',
  adm_meta_channels_plan: 'ℹ️ Каналы Instagram и WhatsApp доступны на тарифе Pro или Studio. Оформи подписку в разделе «Биллинг».',
};
