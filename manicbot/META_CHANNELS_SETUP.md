# Instagram и WhatsApp (Meta) — инструкция для салона

Каналы **Instagram Direct** и **WhatsApp** доступны на тарифах **Pro** и **Studio**. Настройка делается в **Telegram Mini App** (вкладка **Channels**) и в **Meta for Developers**.

## Что понадобится

- Бизнес-аккаунт **Meta Business** и доступ к **Facebook Page**, связанной с Instagram-профилем (для Instagram).
- Для WhatsApp — номер, подключённый к **WhatsApp Business Platform** (Cloud API) через Meta.
- Доступ к [developers.facebook.com](https://developers.facebook.com/apps) с правами на приложение.

## Шаг 1. Откройте Mini App салона

1. В **Telegram** откройте бота вашего салона.
2. Нажмите **/start** (если вы владелец/админ, появится панель управления).
3. Либо нажмите кнопку меню **«Салон»** (или кнопку **«Instagram / WhatsApp»** в панели админа).
4. В Mini App откройте вкладку **Channels**.

Здесь отображаются:

- **Webhook URL** для WhatsApp и для Instagram (разные пути).
- **Verify Token** — **должен совпадать** с тем, что задан на стороне платформы ManicBot (секреты Worker и переменные Pages). Если в интерфейсе показано предупреждение вместо токена — обратитесь к техподдержке платформы, чтобы выставили `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` и `WORKER_PUBLIC_URL` в Mini App.

## Шаг 2. Meta for Developers — приложение и вебхуки

1. Создайте или выберите **приложение** типа Business.
2. Добавьте продукты:
   - **WhatsApp** (Cloud API) — для WhatsApp;
   - **Instagram** — для сообщений Instagram (Messaging API), по документации Meta для вашего сценария.
3. В разделе **Webhooks**:
   - укажите **Callback URL** из Mini App (отдельно для WA и для IG, если Meta требует два подключения);
   - вставьте **Verify Token** **точно** как в Mini App;
   - подпишитесь на нужные поля (сообщения, статусы и т.д. — по требованиям Meta).

После успешной верификации Meta будет слать события на Worker ManicBot.

## Шаг 3. Сохраните учётные данные в Mini App

### WhatsApp

В Meta возьмите **Phone Number ID** (и при необходимости **WABA ID**). Создайте **долгоживущий access token** с нужными правами для отправки сообщений.

В Mini App → **Channels** → WhatsApp введите ID и токен, нажмите **Save & Connect**.

### Instagram

Нужны **Page ID** Instagram/Facebook Page и **Page Access Token** с правами на сообщения.

В Mini App → **Channels** → Instagram введите значения и сохраните.

## Важные ограничения Meta

- **Окно обмена сообщениями** (24 часа и правила шаблонов для WhatsApp) действует по правилам Meta — бот не может писать клиенту без ограничений вне этих рамок.
- Токены храните в секрете; при компрометации перевыпустите их в Meta и обновите в Mini App.

## Переменные окружения (для владельца платформы)

Чтобы Mini App показывал те же **Verify Token**, что проверяет Worker:

| Где | Переменная |
|-----|------------|
| Cloudflare Worker (secrets) | `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, при необходимости `META_APP_SECRET` |
| Cloudflare Pages (Mini App) | Те же `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, плюс `WORKER_PUBLIC_URL` (публичный URL Worker без `/` в конце) |

Значения verify token на Worker и на Pages должны **совпадать**.

## Дымовой чеклист (платформа + салон)

**Автоматически в репозитории:** тест `buildMetaChannelHints` в admin-app (`npm test` в `manicbot/admin-app`) проверяет формирование URL вебхуков и обрезку токенов.

**Вручную после выставления секретов:**

1. **Pages / Worker:** в Cloudflare заданы одинаковые `META_VERIFY_TOKEN_*` и на Worker (secrets), и в проекте Pages `admin-app` (см. [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)).
2. **Mini App:** войти как владелец салона → вкладка **Channels** → видны строки **Verify Token** (не жёлтое предупреждение) и корректный домен в **Webhook URL**.
3. **Meta:** в приложении разработчика нажать **Verify** для webhook — ответ должен быть успешным (Worker обрабатывает challenge).
4. **Telegram:** у владельца после `/start` есть меню **«Салон»** (или кнопка каналов в панели админа на Pro+) и ссылка открывает Mini App с `?tab=channels` при наличии каналов в тарифе.
