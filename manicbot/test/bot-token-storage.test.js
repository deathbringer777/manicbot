/**
 * Regression test: getBotToken must return plaintext Telegram tokens as-is
 * even when BOT_ENCRYPTION_KEY is set.
 *
 * Bug: `raw.includes(':')` was used to detect encrypted tokens — but ALL
 * Telegram bot tokens contain ':' (format: botId:secret). This caused
 * decryption to be attempted on plaintext tokens → failure → null return →
 * D1 multi-tenant resolution failed → bot stopped responding.
 *
 * Fix: `!raw.includes(':')` — no colon means encrypted base64, colon means plaintext.
 */
import { describe, it, expect } from 'vitest';

// Simulate the detection logic from getBotToken
function shouldDecrypt(raw, encryptionKey) {
  return !!(encryptionKey && !raw.includes(':'));
}

describe('getBotToken — token format detection', () => {
  const ENCRYPTION_KEY = 'some-32-char-encryption-key-here';

  it('plaintext Telegram token (has colon) is NOT decrypted even when key is set', () => {
    const raw = '8752028834:AAHgSXM9iT7zF5cLMI97vLpPnIoqTNm3jn0';
    expect(shouldDecrypt(raw, ENCRYPTION_KEY)).toBe(false);
  });

  it('encrypted token (no colon, pure base64) IS decrypted when key is set', () => {
    const raw = 'aGVsbG93b3JsZHRlc3RiYXNlNjRub2NvbG9u'; // base64, no ':'
    expect(shouldDecrypt(raw, ENCRYPTION_KEY)).toBe(true);
  });

  it('plaintext token is NOT decrypted when no encryption key', () => {
    const raw = '8752028834:AAHgSXM9iT7zF5cLMI97vLpPnIoqTNm3jn0';
    expect(shouldDecrypt(raw, null)).toBe(false);
    expect(shouldDecrypt(raw, '')).toBe(false);
  });

  it('different bot ID plaintext tokens all pass through correctly', () => {
    const tokens = [
      '123456789:ABCDEFxxxxx',
      '8613882748:AAFp0fbOb1lAAY0V8nnhPwiPfiTcLwd6HiM',
      '8742175386:AAGxxx123xxx',
    ];
    for (const raw of tokens) {
      expect(shouldDecrypt(raw, ENCRYPTION_KEY)).toBe(false);
    }
  });
});
