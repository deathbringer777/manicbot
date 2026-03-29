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

**Маршрут Worker:** запросы на `POST /webhook/ig` и `POST /webhook/wa` обрабатываются **до** логики Telegram-`/webhook/{botId}`; сегменты `ig` и `wa` не считаются numeric bot id. Фоновая обработка сообщений привязана к `waitUntil` Cloudflare, чтобы ответ Meta «OK» не обрывал пайплайн.

## HTML admin panel (`/admin`)

Read-only канал-статус теперь виден и в HTML-панели Worker:

- **Telegram** — bot id + webhook URL
- **WhatsApp** — active/inactive + `phone_number_id` + `/webhook/wa`
- **Instagram** — active/inactive + `page_id` / `ig_account_id` + `/webhook/ig`

Редактирование и сохранение токенов остаётся только в **Mini App → Channels**.

## Шаг 3. Сохраните учётные данные в Mini App

### WhatsApp

В Meta возьмите **Phone Number ID** (и при необходимости **WABA ID**). Создайте **долгоживущий access token** с нужными правами для отправки сообщений.

В Mini App → **Channels** → WhatsApp введите ID и токен, нажмите **Save & Connect**.

### Instagram

Нужны **Page ID** Facebook Page (связанной с Instagram) и **Page Access Token** с правами на сообщения. Исходящие сообщения бот шлёт через **graph.facebook.com** (Messenger Platform / Instagram), а не через `graph.instagram.com`.

В Mini App → **Channels** → Instagram введите значения и сохраните.

#### `entry.id` в вебхуке и поле в Mini App

В payload Instagram webhook поле **`entry[0].id`** должно совпадать (после приведения к строке) с одним из сохранённых в конфиге идентификаторов:

- **`page_id`** — ID Facebook Page (то, что обычно показывает Meta в настройках страницы).
- При несовпадении с тем, что реально приходит в **Recent deliveries**, можно добавить в JSON конфига (через поддержку/миграцию) опциональные поля **`instagram_business_id`** или **`ig_account_id`** — Worker сопоставит webhook с любым из них.

Проверка: Meta → Webhooks → **Recent deliveries** для Instagram → развернуть тело и сравнить `entry[0].id` с тем, что сохранено в Channels.

## Важные ограничения Meta

- **Окно обмена сообщениями** (24 часа и правила шаблонов для WhatsApp) действует по правилам Meta — бот не может писать клиенту без ограничений вне этих рамок.
- Токены и **App Secret** храните в секрете. Если секрет или токен попали в чат, лог или скриншот — считайте их скомпрометированными: в Meta сгенерируйте новый **App Secret** и выполните на Worker `wrangler secret put META_APP_SECRET`; для **Page Access Token** перевыпустите токен в Business Suite и обновите в Mini App → Channels. После смены секретов задеплойте Worker (`wrangler deploy`).

## Переменные окружения (для владельца платформы)

Чтобы Mini App показывал те же **Verify Token**, что проверяет Worker:

| Где | Переменная |
|-----|------------|
| Cloudflare Worker (secrets) | `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, `META_APP_SECRET` (для подписи `X-Hub-Signature-256` на POST) |
| Cloudflare Pages (Mini App) | Те же `META_VERIFY_TOKEN_WA`, `META_VERIFY_TOKEN_IG`, плюс `WORKER_PUBLIC_URL` (публичный URL Worker без `/` в конце) |

Значения verify token на Worker и на Pages должны **совпадать**.

### Служебный аккаунт (например @manicbot_com)

В вебхуке Instagram приходит только **числовой IGSID** отправителя, не @username.

- Сообщения **исходящие от страницы** (echo) Worker уже **не обрабатывает** (`is_echo` в payload).
- Чтобы не гонять в **LLM** личные/служебные диалоги с фиксированного аккаунта, задайте секрет Worker:
  - `wrangler secret put INSTAGRAM_IGNORE_SENDER_IDS`
  - значение: один или несколько IGSID через запятую или пробел, например `1784360123456789`.

**Как узнать IGSID для @manicbot_com:** отправьте тестовое DM боту и посмотрите поле `sender.id` в теле webhook в логах Meta (**Webhook fields** → **Test** / **Recent deliveries**) или запросите профиль через Instagram Graph API для связанного Business-аккаунта (нужны соответствующие права токена).

### Опционально: триггерные слова для ответа ИИ в Instagram

По умолчанию свободный текст из Direct уходит в тот же ИИ, что в Telegram. Чтобы **не** вызывать LLM на каждое сообщение, задайте секрет Worker:

- `wrangler secret put INSTAGRAM_AI_TRIGGER`
- значение: подстроки через **запятую**; пробелы по краям каждого элемента обрезаются, пустые сегменты отбрасываются. Пример: `запись, вопрос, manic`

Сообщение попадёт в ИИ только если текст (без учёта регистра) **содержит** хотя бы одну из подстрок. Иначе пользователь получит короткую подсказку (ключ `ig_ai_trigger_hint` в переводах). Сценарии записи и шаг `REG_CONFIRM` не затрагиваются.

Если секрет **пустой** или не задан — ограничения нет (как раньше).

## Дымовой чеклист (платформа + салон)

**Автоматически в репозитории:** тест `buildMetaChannelHints` в admin-app (`npm test` в `manicbot/admin-app`) проверяет формирование URL вебхуков и обрезку токенов.

**Вручную после выставления секретов:**

1. **Pages / Worker:** в Cloudflare заданы одинаковые `META_VERIFY_TOKEN_*` и на Worker (secrets), и в проекте Pages `admin-app` (см. [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)).
2. **Mini App:** войти как владелец салона → вкладка **Channels** → видны строки **Verify Token** (не жёлтое предупреждение) и корректный домен в **Webhook URL**.
3. **Meta:** в приложении разработчика нажать **Verify** для webhook — ответ должен быть успешным (Worker обрабатывает challenge).
4. **Instagram:** в **Recent deliveries** для POST на URL вида `…/webhook/ig` статус **200** (не 403). Если 403 — проверить `META_APP_SECRET` и тело ответа Worker.
5. **Telegram:** у владельца после `/start` есть меню **«Салон»** (или кнопка каналов в панели админа на Pro+) и ссылка открывает Mini App с `?tab=channels` при наличии каналов в тарифе.

## Troubleshooting

- **Meta verification проходит, но бот молчит:** проверьте, что на Worker заданы `META_APP_SECRET`, нужный `META_VERIFY_TOKEN_*`, и что задеплоен актуальный код. Для Telegram/D1 fallback теперь смотрите логи Worker по сообщениям `[worker] context resolution failed`.
- **Mini App не показывает verify token:** это обычно Pages env. Выставьте `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` и `WORKER_PUBLIC_URL` в проекте `admin-app`.
- **`/admin` не показывает IG/WA канал:** проверьте, что у тенанта есть строки в `channel_configs` и вы открываете `/admin` внутри tenant-aware контекста Worker, а не только platform billing page.
- **Instagram webhook отдаёт 403:** сравните `META_APP_SECRET` с секретом приложения Meta и проверьте тело ответа Worker в Recent deliveries.

## Тестовый тенант для E2E (Instagram как чат с ботом)

**Кто платит:** подписка и trial привязаны к **тенанту (салону)**. Пользователи, которые пишут в Instagram Direct, **ничего не оплачивают** — им выдаётся роль клиента, биллинг проверяется по салону ([`src/billing/features.js`](src/billing/features.js)).

### 1) Создать тенант + бот + владелец в D1

Из каталога `manicbot/` (нужен `wrangler` и доступ к D1):

```bash
# Посмотреть SQL без выполнения:
npm run ig-e2e:tenant -- --owner=ВАШ_TELEGRAM_USER_ID --bot-id=ID_БОТА_ИЗ_ТОКЕНА --dry-run

# Записать в удалённую D1 (по умолчанию):
npm run ig-e2e:tenant -- --owner=ВАШ_TELEGRAM_USER_ID --bot-id=ID_БОТА_ИЗ_ТОКЕНА

# Локальная D1 wrangler dev:
npm run ig-e2e:tenant -- --owner=ВАШ_TELEGRAM_USER_ID --bot-id=ID_БОТА_ИЗ_ТОКЕНА --local
```

По умолчанию выполняется `wrangler d1 execute … --remote`; для локальной базы добавьте **`--local`**. Скрипт: [`scripts/create-ig-e2e-tenant.mjs`](scripts/create-ig-e2e-tenant.mjs).

- Создаётся тенант с **`plan = pro`**, **`billing_status = trialing`**, trial ~30 суток.
- Строка **`bots`**: если бот уже есть — обновляется только **`tenant_id`** (секрет вебхука не затирается); если бота не было — вставляется новая строка (тогда токен нужно зарегистрировать обычным способом).
- **`tenant_roles`**: ваш Telegram `chat_id` получает **`tenant_owner`** для доступа к Mini App → **Channels**.

Альтернатива без скрипта: God Mode в Mini App → создание тенанта + привязка бота ([`admin-app/src/server/api/routers/provisioning.ts`](admin-app/src/server/api/routers/provisioning.ts)).

### 2) Подключить Instagram в Mini App

Войти в Mini App **тем же Telegram-аккаунтом**, что указан в `--owner` → **Channels** → Instagram: **Page ID** и **Page Access Token**. Сверить **`entry[0].id`** из Meta → Webhooks → **Recent deliveries** с полем в конфиге (см. раздел выше про `page_id` / `instagram_business_id` / `ig_account_id`).

### 3) Секреты Worker перед тестом

- **`META_APP_SECRET`** — совпадает с приложением Meta (иначе POST **403**).
- **`INSTAGRAM_AI_TRIGGER`** — **не задавать** (пусто), чтобы отвечал на любой текст, в т.ч. «привет».
- **`INSTAGRAM_IGNORE_SENDER_IDS`** — **не** включать IGSID тестового клиента, с которого пишете в Direct.

### 4) Ручной сценарий в Instagram

1. С личного аккаунта клиента написать в Direct странице, привязанной к этому тенанту.
2. Убедиться в **Recent deliveries**: **200** на `POST …/webhook/ig`.
3. Ожидать текстовый ответ; «кнопки» в IG — это **quick replies** (ограничения Meta), не полная копия Telegram UI.

При сбое смотреть логи Worker: `[ig] unresolved page_id`, `[ig] missing token`, `[ig] POST … failed`.
