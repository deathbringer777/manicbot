# FIX-04: Rate Limiting на Auth Endpoints (HIGH)

## Проблема

Admin Mini-App (`manicbot/admin-app/src/server/api/trpc.ts`) не имеет rate limiting на:
- Логин через email/пароль (`/api/auth/callback/credentials`)
- tRPC процедуры (включая `auth.getMyRole`)

Это позволяет:
- Brute-force атаки на пароли через web-логин
- DDoS через массовые запросы к tRPC
- Перебор email-адресов (timing attack на ответы)

Worker (`manicbot/src/services/state.js`) имеет `checkRateLimit()` для Telegram, но admin-app полностью без защиты.

## Затронутые файлы

- `manicbot/admin-app/src/server/api/trpc.ts` — tRPC middleware
- `manicbot/admin-app/src/server/auth/auth.ts` — NextAuth config

## Предложенное решение

### Вариант A: tRPC Middleware (рекомендуется)

```typescript
// admin-app/src/server/api/rateLimit.ts — новый файл
import { TRPCError } from '@trpc/server';

const attempts = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 15 * 60 * 1000; // 15 минут
const MAX_ATTEMPTS = 20; // 20 запросов на окно

export function checkRateLimit(identifier: string, limit = MAX_ATTEMPTS): void {
  const now = Date.now();
  const key = identifier;
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count > limit) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again later.',
    });
  }
}

// Периодическая очистка (раз в 5 минут)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt < now) attempts.delete(key);
  }
}, 5 * 60 * 1000);
```

```typescript
// trpc.ts — добавить в protectedProcedure:
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user && !ctx.webUser) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // Rate limit по user ID
  const userId = ctx.user?.id?.toString() || ctx.webUser?.id || 'unknown';
  checkRateLimit(`trpc:${userId}`, 100); // 100 запросов / 15 мин

  return next({ ctx });
});
```

### Вариант B: Cloudflare Rate Limiting Rules (без кода)

В Cloudflare Dashboard → Pages → Settings → Rate Limiting:

```
Rule: auth-rate-limit
Path: /api/auth/*
Limit: 10 requests per minute per IP
Action: Block (429)

Rule: trpc-rate-limit
Path: /api/trpc/*
Limit: 60 requests per minute per IP
Action: Challenge
```

### Вариант C: NextAuth Rate Limiting для логина

```typescript
// auth.ts — в Credentials provider authorize():
const loginKey = `login:${credentials.email}`;
const entry = loginAttempts.get(loginKey);

if (entry && entry.count >= 5 && Date.now() < entry.lockedUntil) {
  throw new Error('Account temporarily locked. Try again in 15 minutes.');
}

// ... проверка пароля ...

if (!isValid) {
  const current = loginAttempts.get(loginKey) || { count: 0, lockedUntil: 0 };
  current.count++;
  if (current.count >= 5) {
    current.lockedUntil = Date.now() + 15 * 60 * 1000;
  }
  loginAttempts.set(loginKey, current);
  throw new Error('Invalid credentials');
}

// Успешный логин — сбросить счётчик
loginAttempts.delete(loginKey);
```

## Рекомендация

Комбинация **Вариант A + Вариант B**: tRPC middleware для application-level защиты + Cloudflare rules для infrastructure-level защиты.

## Стратегия тестирования

```typescript
test('rate limiter blocks after threshold', () => {
  for (let i = 0; i < 20; i++) {
    checkRateLimit('test-user', 20); // ОК
  }
  expect(() => checkRateLimit('test-user', 20)).toThrow('TOO_MANY_REQUESTS');
});

test('rate limiter resets after window', () => {
  // Mock Date.now
  checkRateLimit('test-user-2', 1);
  expect(() => checkRateLimit('test-user-2', 1)).toThrow();
  // Advance time by 15 min
  // checkRateLimit('test-user-2', 1); // ОК
});
```

## Effort

- Вариант A (tRPC): 30 мин
- Вариант B (Cloudflare): 10 мин
- Вариант C (NextAuth): 20 мин
- Тесты: 20 мин
- **Итого: ~1 час (все три варианта)**
