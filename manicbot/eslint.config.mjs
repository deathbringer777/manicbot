// Flat ESLint config for the Cloudflare Worker backend (plain ESM JS).
//
// Scope: src/**/*.js only — the production Worker code that ships to prod and
// has no TypeScript typecheck behind it. Tests and scripts are excluded for now
// (different global sets); this gate's job is to catch real bugs in shipping code.
//
// Rule philosophy: high-signal correctness rules that flag actual bugs
// (undeclared vars, unreachable code, duplicate keys, etc.). Stylistic noise is
// intentionally left off so the gate stays green and meaningful.
import js from '@eslint/js';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Cloudflare Workers / Web platform runtime
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
        caches: 'readonly',
        WebSocket: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        CompressionStream: 'readonly',
        DecompressionStream: 'readonly',
        WebSocketPair: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        structuredClone: 'readonly',
        // Timers / console
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        console: 'readonly',
        // Intl / standard
        Intl: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Historic Worker files contain many intentional compatibility imports
      // and dead branches kept for Telegram callback parity. Keep the lint
      // gate focused on correctness errors; TypeScript covers admin-app.
      'no-unused-vars': 'off',
      // Empty blocks are fine for the deliberate `catch {}` swallow pattern.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // ESLint 9 recommended adds these; they flag style/modernization, not
      // bugs. Leave them off so `npm run lint` is a quiet correctness gate.
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
];
