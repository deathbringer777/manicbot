# ManicBot Landing

Отдельный лендинг для manicbot.com. Не связан с логикой бота.

- **Стек:** React 18, Vite
- **Языки:** RU, EN, UA, PL (переключатель в шапке)
- **Деплой:** Cloudflare Pages

## Локально

```bash
npm install
npm run dev
```

## Деплой на Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name=manicbot-landing
```

После деплоя лендинг доступен по адресу https://manicbot-landing.pages.dev.  
Бот на manicbot.com проксирует запросы к главной странице на этот URL (см. `manicbot/wrangler.toml` → `LANDING_URL`).

## Кастомный домен

В Cloudflare Dashboard → Pages → manicbot-landing → Custom domains можно привязать домен (например для прямого доступа к лендингу). Основной домен manicbot.com уже отдаёт лендинг через Worker.
