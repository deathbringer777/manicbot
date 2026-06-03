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
      // Unused vars: surface as warnings (don't fail the gate) and allow the
      // conventional `_`-prefixed intentional-ignore pattern already used here.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Empty blocks are fine for the deliberate `catch {}` swallow pattern.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // ESLint 9 recommended adds these; they flag style/modernization, not
      // bugs. Downgrade to warn (or off) so the gate fails only on real defects
      // (undeclared vars, unreachable code, dupe keys, etc.). A follow-up can
      // `--fix` the escapes and address the warnings incrementally.
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off',
    },
  },
];
