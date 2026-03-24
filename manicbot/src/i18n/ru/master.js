export default {
  // Master panel
  mst_welcome: '💅 <b>Панель мастера</b>\n\nПривет, {n}!',
  mst_today: '📋 Мои записи сегодня',
  mst_tomorrow: '📅 Все записи',
  mst_to_client: '💅 Режим клиента',
  mst_back: '◀️ Панель мастера',

  // Appointment status notifications (to client)
  apt_pending: '⏳ <b>Заявка принята!</b>\n\nМы получили вашу заявку:\n\n{svc}\n📅 {dt}\n\nМастер подтвердит запись в ближайшее время. Мы сообщим! 📲',
  apt_rejected: '❌ <b>Запись не подтверждена</b>\n\n{svc}\n📅 {dt}',
  apt_reject_cmt: '\n\n💬 <i>{comment}</i>',
  apt_rebook: '\n\nЖелаете выбрать другое время?',
  apt_counter: '💬 <b>Мастер предлагает другое время:</b>\n\n{svc}\n📅 {d}\n🕐 <b>{newtime}</b>',
  apt_counter_cmt: '\n\n💬 <i>{comment}</i>',
  apt_accept: '✅ Принять',
  apt_decline: '❌ Отклонить',
  apt_reply_btn: '💬 Ответить',
  apt_enter_reply: '💬 Напиши сообщение мастеру:',
  apt_reply_sent: '✅ Сообщение отправлено.',

  // New appointment notification (to master)
  mst_new_apt_header: 'Новая заявка!',
  mst_confirm_btn: '✅ Подтвердить',
  mst_reject_btn: '❌ Отклонить',
  mst_counter_btn: '💬 Другое время',
  mst_reject_prompt: '💬 Комментарий для клиента\n(или нажми «Пропустить»):',
  mst_skip: '⏭ Пропустить',
  mst_counter_time: '🕐 Введи новое время (ЧЧ:ММ):',
  mst_counter_cmt_prompt: '💬 Комментарий для клиента\n(или «Пропустить»):',
  mst_apt_confirmed: '✅ Подтверждено!\n👤 {client} · 📅 {dt}',
  mst_apt_rejected: '❌ Отклонено.\n👤 {client} · 📅 {dt}',
  mst_counter_sent: '💬 Предложение отправлено.',
  mst_client_accepted: '✅ Клиент принял {newtime}!\n👤 {client}',
  mst_client_declined: '❌ Клиент отклонил.\n👤 {client}',
  mst_client_msg: '💬 От {client}:\n<i>{msg}</i>',
  mst_already_done: 'ℹ️ Уже обработано.',

  // Google Calendar (master)
  mst_calendar: '📅 Google Календарь',
  mst_calendar_status_on: '✅ Подключён',
  mst_calendar_status_off: '❌ Не подключён',
  mst_calendar_enter_id: '📅 Отправьте email сервис-аккаунта уже расшарен вашему Google Календарю.\n\nОтправьте <b>ID вашего календаря</b> (например: <code>name@gmail.com</code> или ID из настроек):',
  mst_calendar_connected: '✅ Google Календарь подключён: <code>{id}</code>',
  mst_calendar_cleared: '✅ Google Календарь отключён.',
  mst_calendar_setup_btn: '⚙️ Настроить',
  mst_calendar_clear_btn: '❌ Отключить',
};
