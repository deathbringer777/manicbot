# Проверка настройки Cloudflare для ManicBot

Если AI не отвечает в боте (всегда «Не понимаю») или не приходят уведомления о консультанте — проверь по шагам.

## 0. Workers AI по API-токену (рекомендуется)

Если binding не срабатывает, подключи вызов через REST API по токену:

1. В дашборде: **Build → AI → Workers AI** — скопируй **Account ID** и нажми **Create a Workers AI API Token** (права Read + Edit).
2. В проекте задай секреты воркеру:
   ```bash
   cd manicbot
   wrangler secret put WORKERS_AI_API_TOKEN
   # вставь токен когда попросит
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   # вставь Account ID (например 07dbabce20f0e9f375a020b5314d5427)
   ```
3. Задеплой: `npm run deploy`.

Код сначала пробует REST по токену; если токен и Account ID заданы — binding не используется для AI.

## 1. Workers AI включён

- Зайди в **Cloudflare Dashboard** → **Build** → **AI** → **Workers AI**.
- Страница должна открываться без ошибок. Если продукт не включён — включи его для аккаунта.
- На бесплатном плане даётся лимит Neurons в день; при превышении запросы могут падать.

## 2. Binding AI у воркера

- **Workers & Pages** → выбери воркер **manicbot** → **Settings** → **Variables**.
- В блоке **Bindings** должна быть привязка **AI** (тип Workers AI). Она добавляется из `wrangler.toml` при `wrangler deploy`.
- Если binding нет — выполни ещё раз `npm run deploy` из папки `manicbot`.

## 3. Модель

В коде используются:

- основная: `@cf/openai/gpt-oss-120b`;
- запасная: `@cf/meta/llama-3.1-8b-instruct`.

Если основная модель недоступна в твоём аккаунте/регионе, ответы пойдут через запасную.

## 4. Уведомления «Подключить консультанта»

Чтобы при нажатии кнопки «Подключить консультанта» кто-то получал уведомление:

- В боте должен быть **зарегистрирован админ** (команда `/admin YOUR_ADMIN_KEY`) и/или добавлены **мастера** в админ-панели.
- Опционально: в настройках воркера задай переменную **ADMIN_CHAT_ID** (числовой Telegram chat_id), тогда уведомления будут приходить и туда.

## 5. Логи при ошибках AI

- **Workers & Pages** → **manicbot** → **Logs** (Real-time logs или Analytics).
- В логах ищи строки `Workers AI error:` или `Workers AI run ... error:` — по ним можно понять, падает ли вызов модели и с какой ошибкой.

## 6. Краткий чеклист

| Проверка | Где смотреть |
|----------|----------------|
| Workers AI включён | Build → AI → Workers AI |
| У воркера есть binding AI | Workers → manicbot → Settings → Variables → Bindings |
| Деплой после изменений | `npm run deploy` в папке manicbot |
| Админ/мастера для уведомлений | Бот: /admin, панель мастера |
| Ошибки AI | Workers → manicbot → Logs |
