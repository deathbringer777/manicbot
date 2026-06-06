export default {
  // Registration
  reg_confirm_name: '📝 Для записи нужна регистрация.\n\nТвоё имя в Telegram: <b>{n}</b>\n\nПродолжая, ты принимаешь <a href="https://manicbot.com/rules">Правила пользования</a>.\n\nВсё верно?',
  reg_yes: '✅ Принимаю и продолжаю',
  reg_change: '✏️ Изменить имя',
  reg_enter_name: '✏️ Введи своё имя:',
  reg_name_err: '❌ Введи корректное имя (2-50 символов):',
  reg_phone: 'Отлично, <b>{n}</b>! 😊\n\n📱 Введи номер телефона или нажми кнопку:\n\n<i>Пожалуйста, проверьте правильность набора номера</i>',
  // Channels without a Telegram reply-keyboard (web/Instagram/WhatsApp): no button to press.
  reg_phone_web: 'Отлично, <b>{n}</b>! 😊\n\n📱 Напиши номер телефона в ответном сообщении (например, +48123456789):\n\n<i>Пожалуйста, проверьте правильность набора номера</i>',
  reg_phone_btn: '📱 Отправить номер',
  reg_phone_err: '❌ Введи корректный номер телефона:',
  reg_done: '✅ <b>Регистрация завершена!</b>\n\n👤 Имя: <b>{n}</b>\n📱 Телефон: <b>{p}</b>',
  now_choose: '💅 Теперь выбери услугу:',

  // Booking flow
  choose_svc: '💅 <b>Выбери услугу:</b>',
  choose_date: '📅 Выбери дату:',
  no_slots: '😔 На <b>{d}</b> нет свободных мест.\n\n📅 Выбери другую дату:',
  choose_time: '🕐 Выбери время:',
  other_svc: '◀️ Другая услуга',
  other_date: '◀️ Другая дата',
  chosen: '✅ Выбрано: <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}',
  chosen_correction: '✅ Выбрано: <b>{svc}</b>\n\nВыбери дату:',
  confirm_correction: '📋 <b>Подтверждение записи</b>\n\n{svc}\n📅 {dt}\n\n👤 {name}\n📱 {phone}',
  free_label: 'Бесплатно',

  // Master selection
  book_choose_master: '👩‍🎨 <b>Выбери мастера</b>\n\nМожешь выбрать конкретного мастера или записаться к любому свободному.',
  book_any_master: '🎲 Любой свободный мастер',
  book_master_label: '👤 {name}',
  book_master_assigned: '👩‍🎨 Мастер: <b>{name}</b>',
  book_any_master_label: '🎲 Любой мастер',

  // Confirmation
  confirm_title: '📋 <b>Подтверждение записи</b>',
  confirm_yes: '✅ Подтвердить',
  confirm_no: '❌ Отменить',
  book_confirm_declined: '❌ <b>Подтверждение снято.</b>\n\n📅 Слот сохранён: <b>{dt}</b>\n\nНапишите услугу (например «педикюр») или выберите из списка.',
  book_repick_service: '💅 Выбрать услугу из списка',
  book_choose_svc_adjust: '💅 Выберите услугу — дата и время останутся прежними.',
  booked: [
    '🎉 <b>Запись подтверждена!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '⏱ {dur} {min}', '💵 {p} {c}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Напомню тебе:', '• За 24 часа', '• За 2 часа',
    '', '📅 Добавить в календарь (Google Calendar/Mac) ⬇️'
  ],
  booked_correction: [
    '🎉 <b>Запись подтверждена!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Напомню тебе:', '• За 24 часа', '• За 2 часа',
    '', '📅 Добавить в календарь (Google Calendar/Mac) ⬇️'
  ],
  book_cancelled: '❌ Запись отменена.\n\nВыбери, что тебя интересует:',
  book_err: '❌ Ошибка. Начни запись сначала.',
  book_limit: '⚠️ Достигнут лимит записей ({n}). Отмени одну из текущих, чтобы создать новую.',
  slot_taken: '😔 Это время только что заняли. Выбери другое:',

  // My appointments
  my_title: '📋 <b>Мои записи</b>',
  my_empty: 'У тебя нет предстоящих записей.\n\n💅 Хочешь записаться?',
  my_cancel: '❌ Отменить: {d} {t}',
  my_cancel_all: '🗑 Отменить все записи',
  cancel_confirm: '⚠️ Точно отменить?\n\n{svc}\n📅 {dt}',
  cancel_all_confirm: '⚠️ Отменить все {n} записей?',
  cancel_yes: '❌ Да, отменить',
  cancel_all_yes: '🗑 Да, отменить все',
  cancel_no: '◀️ Нет, назад',
  cancel_all_ok: '✅ Все записи отменены.',
  cancel_comment_prompt: '💬 Добавь комментарий к отмене для мастера/админа\nили нажми «Пропустить»:',
  cancel_comment_skip: '⏭ Пропустить',
  cancel_ok: '✅ <b>Запись отменена:</b>\n\n{svc}\n📅 {dt}\n\nХочешь перезаписаться на другую дату?',
  cancel_err: '❌ Запись не найдена или уже отменена.',
  rebook: '📝 Записаться заново',

  // Reminders
  rem_24: ['⏰ <b>Напоминание!</b>','','Завтра у тебя запись:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','До встречи! 💅'],
  rem_2:  ['⏰ <b>Напоминание!</b>','','Через 2 часа:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Уже скоро! 💖'],
  staff_apt_cancelled_client: '❌ <b>Запись отменена клиентом</b>',

  // Reviews
  review_request: '💬 <b>Спасибо за визит!</b>\n\nКак вам обслуживание? Поставьте оценку:',
  review_thanks: '✅ Спасибо за оценку! ({rating}⭐)\n\nХотите оставить комментарий?',
  review_add_comment: '✏️ Да, написать',
  review_skip_comment: '⏭ Пропустить',
  review_enter_text: '✏️ Напишите ваш отзыв:',
  review_text_saved: '✅ Отзыв сохранён!\n\nХотите добавить фото? (до 3 шт.)',
  review_add_photo: '📸 Добавить фото',
  review_done: '⏭ Готово',
  review_send_photo: '📸 Отправьте фото (до {n} ещё):',
  review_photo_saved: '✅ Фото добавлено! ({count}/3)',
  review_complete: '🎉 <b>Спасибо за отзыв!</b>\n\n{rating}⭐\n{text}',
  review_complete_no_text: '🎉 <b>Спасибо за отзыв!</b>\n\n{rating}⭐',
  review_already: 'Вы уже оставляли отзыв для этой записи.',
};
