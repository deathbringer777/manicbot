/**
 * @fileoverview Adapter registry — maps channel type strings to adapter factory functions.
 *
 * Factories receive ctx and return a ChannelAdapter instance.
 * Registration happens at startup (imported by worker.js after all adapters are loaded).
 *
 * @example
 * import { registerAdapter, getAdapter } from './registry.js';
 * import { TelegramAdapter } from './telegram.js';
 * registerAdapter('telegram', (ctx) => new TelegramAdapter(ctx));
 * const adapter = getAdapter('telegram')(ctx);
 */

/** @type {Map<string, (ctx: object) => import('./interface.js').ChannelAdapter>} */
const _registry = new Map();

/**
 * Register an adapter factory for a given channel type.
 *
 * @param {string} type - Channel type (e.g. 'telegram', 'whatsapp', 'instagram')
 * @param {(ctx: object) => import('./interface.js').ChannelAdapter} factory
 */
export function registerAdapter(type, factory) {
  _registry.set(type, factory);
}

/**
 * Get the adapter factory for a given channel type.
 * Returns null if no adapter is registered for that type.
 *
 * @param {string} type
 * @returns {((ctx: object) => import('./interface.js').ChannelAdapter)|null}
 */
export function getAdapter(type) {
  return _registry.get(type) ?? null;
}

/**
 * List all currently registered channel types.
 * @returns {string[]}
 */
export function listAdapters() {
  return Array.from(_registry.keys());
}
