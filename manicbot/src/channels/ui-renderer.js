/**
 * @fileoverview Universal UI renderer — channel-agnostic message sending.
 *
 * Delegates to ctx.channel for actual wire format, allowing handlers to send
 * messages without knowing which channel (Telegram, WhatsApp, Instagram) is active.
 */

/** Maximum button title length for WA reply-buttons and IG quick replies. */
export const BUTTON_TITLE_MAX = 20;

/**
 * Render and send a message through the current channel.
 * This is the primary helper for channel-agnostic sends from handler code.
 *
 * @param {object} ctx - Context with ctx.channel set
 * @param {string} userId - channelUserId
 * @param {string} text
 * @param {Array<Array<{text:string, callbackData:string}>>|null} [buttons]
 * @param {{ editMessageId?: string|null }} [options]
 * @returns {Promise<any>}
 */
export async function renderMessage(ctx, userId, text, buttons = null, options = {}) {
  const channel = ctx.channel;
  if (!channel) throw new Error('ctx.channel not set');

  const outbound = { text, buttons, parseMode: 'HTML', editMessageId: options.editMessageId ?? null };

  if (options.editMessageId) {
    return channel.edit(userId, options.editMessageId, outbound);
  }
  return channel.send(userId, outbound);
}

/**
 * Adapt a raw button rows array for a specific channel type.
 * Returns the channel-native structure via adapter.renderButtons().
 *
 * @param {import('./interface.js').ChannelAdapter} channel
 * @param {Array<Array<{text:string, callbackData:string}>>} rows
 * @returns {object}
 */
export function adaptButtonsForChannel(channel, rows) {
  return channel.renderButtons(rows);
}

/**
 * Truncate button text to the channel-appropriate maximum length.
 * Currently relevant for WhatsApp (≤20 chars) and Instagram (≤20 chars).
 *
 * @param {string} text
 * @param {number} [maxLen=20]
 * @returns {string}
 */
export function truncateButtonText(text, maxLen = BUTTON_TITLE_MAX) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Split a flat list of buttons into pages of `pageSize` for WA list pagination.
 *
 * @param {Array<{text:string, callbackData:string}>} buttons - Flat button array
 * @param {number} [pageSize=10]
 * @returns {Array<Array<{text:string, callbackData:string}>>}
 */
export function splitIntoPages(buttons, pageSize = 10) {
  const pages = [];
  for (let i = 0; i < buttons.length; i += pageSize) {
    pages.push(buttons.slice(i, i + pageSize));
  }
  return pages;
}

/**
 * Convert a Telegram reply_markup inline_keyboard (legacy format) to normalized button rows.
 * Useful for adapting existing UI functions that return Telegram-format objects.
 *
 * @param {{ reply_markup?: { inline_keyboard?: object[][] } }} tgExtra
 * @returns {Array<Array<{text:string, callbackData:string}>>|null}
 */
export function extractButtonRows(tgExtra) {
  const kb = tgExtra?.reply_markup?.inline_keyboard;
  if (!kb) return null;
  return kb.map(row =>
    row.map(btn => ({ text: btn.text ?? '', callbackData: btn.callback_data ?? '' }))
  );
}

/**
 * Adapt a calendar grid (7-column Telegram keyboard) for WhatsApp/Instagram.
 *
 * Telegram's calKb() produces a ~42-button grid (7 columns × 6 rows) that exceeds
 * WhatsApp's 10-button and Instagram's 13-button limits. This function strips
 * NOOP buttons (empty cells, day-of-week headers) and keeps only:
 *   - Navigation buttons (cm:0, cm:2) — prev/next month
 *   - Selectable date buttons (dt:YYYY-MM-DD)
 *   - Action buttons (e.g. "Other service" → book)
 *
 * Detection heuristic: more than maxButtons total AND ≥50% are NOOP or date buttons.
 * Non-calendar button sets (service lists, time slots, etc.) pass through unchanged.
 *
 * @param {Array<Array<{text:string, callbackData:string}>>} rows - Normalized button rows
 * @param {number} maxButtons - Channel button budget (10 for WA list, 13 for IG quick replies)
 * @returns {Array<Array<{text:string, callbackData:string}>>} Adapted rows (1 button per row)
 */
export function adaptCalendarForMeta(rows, maxButtons = 10) {
  if (!rows) return rows;

  // Flatten and count to detect calendar pattern
  const allBtns = rows.flat();
  if (allBtns.length <= maxButtons) return rows; // Already fits, no adaptation needed

  const datePrefix = 'dt:';
  const noopPrefix = '_';
  const calMonthPrefix = 'cm:';
  const dateAndNoop = allBtns.filter(b => b.callbackData.startsWith(datePrefix) || b.callbackData === noopPrefix);
  if (dateAndNoop.length < allBtns.length * 0.5) return rows; // Not a calendar

  // Extract meaningful buttons
  const navButtons = []; // month prev/next
  const dateButtons = []; // selectable dates
  const actionButtons = []; // "Other service", "Back", etc.

  for (const btn of allBtns) {
    if (btn.callbackData === noopPrefix) continue; // Skip empty/header cells
    if (btn.callbackData.startsWith(calMonthPrefix)) {
      navButtons.push(btn);
    } else if (btn.callbackData.startsWith(datePrefix)) {
      dateButtons.push(btn);
    } else {
      actionButtons.push(btn);
    }
  }

  // Build adapted layout: nav buttons + date buttons (limited) + action buttons
  const result = [];

  // Navigation (prev/next month) — put in one row
  if (navButtons.length) {
    result.push(navButtons);
  }

  // Date buttons — limit to fit, one per row for WA/IG
  const dateBudget = maxButtons - result.flat().length - actionButtons.length;
  const visibleDates = dateButtons.slice(0, Math.max(1, dateBudget));
  for (const btn of visibleDates) {
    result.push([btn]);
  }

  // Action buttons (e.g., "Other service")
  for (const btn of actionButtons) {
    result.push([btn]);
  }

  return result;
}
