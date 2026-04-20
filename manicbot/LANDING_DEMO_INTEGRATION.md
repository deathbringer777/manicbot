# Landing iPhone Demo → Worker Integration

На лендинге `manicbot.com` уже есть готовый iPhone-макет в hero-секции с приветствием «Добро пожаловать в Preview Salon!» и четырьмя inline-кнопками (Записаться / Каталог работ / Прайс-лист / Мои записи). Этот документ описывает, как превратить статичную разметку в живой чат, завязанный на выделенный preview-тенант.

Лендинг живёт в отдельном репо `manicbot-analysis` (Vite SPA). Бэкенд (этот репо) уже всё предоставляет — ниже контракт и минимальный JS-слой, который лендинг-дев вставляет внутрь своего `<IPhoneMock>`.

## Preview-тенант

- **Tenant ID:** `t_preview_landing`
- **Slug:** `preview-landing`
- Провижинится автоматически при старте воркера через `ensurePreviewTenantProvisioned()` (см. `src/tenant/previewTenant.js`). Нового ничего деплоить отдельно не нужно — первый запрос к `/chat/*` поднимет тенант.
- Флаги безопасности: `tenant_config.preview_mode = '1'`, `tenants.is_test = 1`.
- **Никогда** не пишет в `appointments` / не мутирует другие таблицы (см. `saveApt`/`cancelApt` — preview short-circuit).
- AI отвечает под дополнительным system-prompt guardrail: только тема салона, off-topic вежливо возвращается к записи.

Состав:
- Услуги: Классический маникюр (45 PLN, 60 мин), Гель-лак (80 PLN, 90 мин), Педикюр (120 PLN, 75 мин), Авторский дизайн (30 PLN, 30 мин).
- Мастера: Алина, Виктория.
- Часы: 10:00–20:00, `Europe/Warsaw`, валюта PLN.

## HTTP API (CORS: `*`)

Все эндпоинты — на origin воркера (`https://manicbot.com`). Preflight `OPTIONS` поддерживается.

### `POST /chat/init`

Инициирует сессию (sessionId живёт в `localStorage` лендинга, переживает релоад).

```http
POST /chat/init
Content-Type: application/json

{ "slug": "preview-landing" }
```

Ответ:

```json
{
  "ok": true,
  "sessionId": "a1b2c3…",        // hex, 32–128 chars
  "chatId": 3921,                 // int, derived from sessionId
  "salon": {
    "slug": "preview-landing",
    "name": "Preview Salon",
    "legalName": "Preview Salon",
    "logo": "https://…",
    "coverPhoto": "https://…",
    "brandPalette": null,
    "description": "…",
    "city": "Warszawa"
  }
}
```

### `POST /chat/send`

Отправка текста или клик inline-кнопки. Возвращает массив bubble-ов, которые надо дорендерить в чат.

```http
POST /chat/send
Content-Type: application/json

{
  "slug": "preview-landing",
  "sessionId": "a1b2c3…",
  "text": "/start",                 // либо
  "callbackData": "CB:BOOK",        // ровно одно из двух обязательно
  "messageId": "bubble-42",         // опционально: id родительского bubble,
                                    //   чтобы editMessageId мог его заменить
  "userName": "Anna",               // опционально
  "userLang": "ru"                  // опционально: ru | ua | en | pl
}
```

Ответ:

```json
{ "ok": true, "messages": [ /* Bubble[] */ ] }
```

### `GET /chat/poll?slug=&sessionId=&since=`

Подтягивает out-of-band пуши (напоминания, подтверждения). Рекомендуется опрашивать раз в 3 секунды пока вкладка видна.

```json
{ "ok": true, "messages": [ /* Bubble[] */ ] }
```

## Shape bubble-а

```ts
type Bubble = {
  id: string;               // уникальный id; используется для editMessageId
  ts: number;               // unix seconds
  text: string;             // уже с HTML-разметкой (<b>, <i>, <a>)
  parseMode: "HTML" | "MarkdownV2" | "plain";
  buttons: InlineBtn[][] | null;   // 2D: rows of buttons
  photo: string | null;     // URL или data-URL
  editMessageId: string | null;    // если задан — заменить bubble с этим id
};

type InlineBtn = {
  text: string;
  callback_data: string | null;    // если не null — POST /chat/send { callbackData }
  url: string | null;              // если не null — window.open(url)
};
```

Клик по кнопке: если `callback_data` не null — делаем `POST /chat/send { slug, sessionId, callbackData: btn.callback_data, messageId: bubble.id }`. Если `url` не null — просто открываем внешнюю ссылку.

## Минимальный JS-слой (vanilla, для `manicbot-analysis`)

Вставить внутрь существующего iPhone-компонента вместо статичной разметки. ~60 строк без зависимостей.

```js
const ORIGIN = 'https://manicbot.com';
const SLUG = 'preview-landing';
const STORAGE_KEY = `mb.chat.${SLUG}`;

async function postJson(path, body) {
  const r = await fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

let session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
let lastTs = session?.lastTs || 0;

async function init(lang = 'ru') {
  if (!session) {
    const res = await postJson('/chat/init', { slug: SLUG });
    if (!res.ok) throw new Error(res.error);
    session = { sessionId: res.sessionId, lastTs: 0 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    await send({ text: '/start', userLang: lang });
  }
}

async function send({ text, callbackData, messageId, userLang = 'ru' }) {
  const res = await postJson('/chat/send', {
    slug: SLUG,
    sessionId: session.sessionId,
    text, callbackData, messageId, userLang,
  });
  if (!res.ok) return;
  for (const m of res.messages) {
    if (m.ts > lastTs) lastTs = m.ts;
    render(m);
  }
  session.lastTs = lastTs;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function render(m) {
  // Replace bubble with editMessageId, or append a new one.
  // Bind buttons: call send({ callbackData: btn.callback_data, messageId: m.id })
  //   or window.open(btn.url) for url buttons.
  // DOM implementation is up to the landing component.
}

// User composer submits text:
function onComposerSubmit(text) { send({ text }); }

// Poll out-of-band pushes every 3s while visible:
setInterval(() => {
  if (document.hidden || !session) return;
  fetch(`${ORIGIN}/chat/poll?slug=${SLUG}&sessionId=${session.sessionId}&since=${lastTs}`)
    .then(r => r.json())
    .then(d => { if (d.ok) d.messages.forEach(render); });
}, 3000);

init();
```

## Готовый embed-скрипт (опционально)

Для ленивых интеграций воркер отдаёт self-contained JS по адресу `https://manicbot.com/embed/demo-chat.js`. Он сам сделает init, отрендерит bubble-ы и кнопки внутрь указанного контейнера.

```html
<div id="mb-demo" class="mb-demo-mount"></div>
<script src="https://manicbot.com/embed/demo-chat.js"
        data-slug="preview-landing"
        data-target="#mb-demo"
        data-lang="ru"></script>
```

Лендинг отвечает только за iPhone-рамку. Содержимое — message stream + composer — скрипт сам положит внутрь `#mb-demo`.

Минимальные CSS-переменные, которые скрипт уважает (опционально, у всего есть дефолты):

```css
.mb-demo-mount {
  --mb-bubble-bot: #f1f5f9;
  --mb-bubble-user: #8b5cf6;
  --mb-user-text: #ffffff;
  --mb-btn-bg: #ffffff;
  --mb-btn-border: #e2e8f0;
}
```

## Эталонная реализация

В admin-app уже есть полноценный React-клиент:
`admin-app/src/app/(public)/salon/[slug]/chat/ChatClient.tsx` — bootstrap, polling, localStorage, edit-in-place, оптимистичный рендер пользовательского сообщения. Лендинг-дев может взять оттуда любые идеи для UX.

## Быстрая проверка из консоли

```bash
curl -sX POST https://manicbot.com/chat/init \
  -H 'Content-Type: application/json' \
  -d '{"slug":"preview-landing"}' | jq
```

```bash
SID=<sessionId из init>
curl -sX POST https://manicbot.com/chat/send \
  -H 'Content-Type: application/json' \
  -d "{\"slug\":\"preview-landing\",\"sessionId\":\"$SID\",\"text\":\"/start\"}" | jq
```

Ожидаем bubble с приветствием и 4 кнопками (Записаться / Каталог / Прайс / Мои записи).
