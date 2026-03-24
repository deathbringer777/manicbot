# Что за миграция

## Предварительное условие: D1

Перед запуском любой миграции убедись, что D1 инициализирована:

1. `npx wrangler d1 create manicbot-db` (или уже существует — проверь в `wrangler.toml`)
2. `npx wrangler d1 execute manicbot-db --remote --file src/db/schema.sql`

**Если D1 уже содержит данные с timestamp в миллисекундах** (старые записи до исправления):
```bash
npx wrangler d1 execute manicbot-db --remote --command "
UPDATE tenants SET created_at = created_at/1000 WHERE created_at > 9999999999;
UPDATE tenants SET updated_at = updated_at/1000 WHERE updated_at > 9999999999;
UPDATE tenants SET trial_ends_at = trial_ends_at/1000 WHERE trial_ends_at IS NOT NULL AND trial_ends_at > 9999999999;
UPDATE appointments SET created_at = created_at/1000 WHERE created_at > 9999999999;
UPDATE masters SET added_at = added_at/1000 WHERE added_at IS NOT NULL AND added_at > 9999999999;
"
```

---



**Миграция** — это одноразовый шаг, который переводит бота из режима «один бот = один кусок KV» в режим **мультитенанта**: один и тот же воркер может обслуживать много ботов/салонов, данные изолированы по тенантам.

## Что именно делается

1. **Создаётся тенант `default`**  
   В KV появляется запись `tenant:default` (название салона, адрес, план биллинга и т.д.).

2. **Регистрируется твой бот**  
   Текущий бот (из секрета `BOT_TOKEN`) прописывается в реестр: `bot:{botId}`, `botmap:{botId} → default`. С этого момента запросы на `/webhook/{botId}` определяют тенант по этому боту.

3. **Переносятся все данные**  
   Все ключи с префиксом **`b:{botId}:`** (пользователи, записи, состояние, языки, мастера и т.д.) **копируются** в ключи с префиксом **`t:default:`**. Старые ключи не удаляются — просто появляется вторая копия под новым префиксом. Дальше воркер читает/пишет уже из `t:default:*`.

4. **Ставится флаг**  
   В KV пишется `migration:v1:done`, чтобы миграцию больше не запускать (она идемпотентна: повторный вызов просто вернёт «already done»).

## Зачем это нужно

- **До миграции:** данные лежат в `b:123456789:lang:...`, `b:123456789:ap:...` и т.д. Один бот = один префикс.
- **После миграции:** те же данные в `t:default:lang:...`, `t:default:ap:...`. Воркер при запросе к `/webhook/123456789` находит тенант `default` и использует префикс `t:default:`. В будущем можно добавить второй тенант (второй салон/бота) — у него будет свой префикс `t:tenant2:` и свои данные.

Итого: **миграция не меняет твои данные по смыслу**, она только вводит «тенанта» и перекладывает ключи в новый префикс, чтобы один воркер мог обслуживать несколько ботов с изоляцией.

## Как запустить

Нужен **ADMIN_KEY**, совпадающий с секретом воркера в Cloudflare.

### Если ключ уже есть в .dev.vars

Сгенерированный ключ записан в **.dev.vars** (файл в .gitignore, не коммитится). Чтобы миграция принималась воркером, в Cloudflare должен быть **тот же** ключ:

1. В Cloudflare: **Workers & Pages** → **manicbot** → **Settings** → **Variables and Secrets** → **ADMIN_KEY** → **Rotate** — вставь значение из `.dev.vars` (строка `ADMIN_KEY=...`).
2. В терминале:
   ```bash
   cd manicbot
   npm run migrate
   ```
   Скрипт сам подхватит `ADMIN_KEY` из `.dev.vars`.

### Если ключа в .dev.vars нет

- Либо скопируй `.dev.vars.example` в `.dev.vars` и подставь свой ключ.
- Либо запусти с переменной: `ADMIN_KEY=твой_ключ npm run migrate`.

### Из браузера

После того как ключ в Cloudflare совпадает с тем, что в `.dev.vars` (или с тем, что подставляешь в URL):

```
https://manicbot.vdovin-kyrylo.workers.dev/admin/migrate?key=КЛЮЧ_ИЗ_DEV_VARS
```

В ответе: `{"ok":true,"copied":N,"message":"..."}` или `{"ok":true,"skipped":true}` если миграция уже делалась.

После миграции обнови webhook бота:  
https://manicbot.vdovin-kyrylo.workers.dev/setup?key=ТВОЙ_ADMIN_KEY — в ответе будет нужный URL.
