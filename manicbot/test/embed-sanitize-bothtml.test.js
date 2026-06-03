/**
 * #X-01 — Embed chat-widget bot-HTML sanitizer.
 *
 * The widget renders bot messages via innerHTML. The previous `sanitizeBotHtml`
 * escaped the message, then RE-ALLOWED a small tag set by un-escaping the whole
 * matched tag INCLUDING its attributes — so an injected event handler
 * (`<b onmouseover=...>`) survived and executed in the visitor's DOM on the
 * embedding site (outside ManicBot's CSP). Source chain: a salon owner sets the
 * address/phone via the Telegram bot, which is rendered into the bot reply with
 * parseMode:'HTML'.
 *
 * The fix reconstructs allowlisted tags WITHOUT any attributes (mirroring the
 * admin-app `sanitizeChatHtml.ts` reconstruct-not-unescape contract); `<a>` is
 * rebuilt with a single sanitized href only.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeBotHtml } from '../src/embed/demoChat.js';

describe('#X-01 — sanitizeBotHtml drops attributes on allowlisted tags', () => {
  it('strips an on* event handler from a formatting tag', () => {
    expect(sanitizeBotHtml('<b onmouseover="alert(1)">hi</b>', 'HTML')).toBe('<b>hi</b>');
    expect(sanitizeBotHtml('<i onload=evil()>x</i>', 'HTML')).toBe('<i>x</i>');
    expect(sanitizeBotHtml('<code class="x" onclick="y">c</code>', 'HTML')).toBe('<code>c</code>');
  });

  it('neutralizes a javascript: href (anchor rebuilt with no href)', () => {
    expect(sanitizeBotHtml('<a href="javascript:alert(1)">x</a>', 'HTML'))
      .toBe('<a rel="noopener noreferrer nofollow" target="_blank">x</a>');
  });

  it('keeps a safe https href and forces rel/target', () => {
    expect(sanitizeBotHtml('<a href="https://example.com/p?a=1">x</a>', 'HTML'))
      .toBe('<a href="https://example.com/p?a=1" rel="noopener noreferrer nofollow" target="_blank">x</a>');
  });

  it('drops a piggy-backed handler even when a safe href is present', () => {
    expect(sanitizeBotHtml('<a href="https://x.com" onclick="evil()">y</a>', 'HTML'))
      .toBe('<a href="https://x.com" rel="noopener noreferrer nofollow" target="_blank">y</a>');
  });

  it('escapes non-allowlisted tags (no execution)', () => {
    expect(sanitizeBotHtml('<script>alert(1)</script>', 'HTML'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeBotHtml('<img src=x onerror=alert(1)>', 'HTML'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('preserves the basic Telegram formatting tag set', () => {
    expect(sanitizeBotHtml('<b>bold</b> <i>it</i> <u>u</u> <s>s</s> <code>c</code>', 'HTML'))
      .toBe('<b>bold</b> <i>it</i> <u>u</u> <s>s</s> <code>c</code>');
  });

  it('escapes everything in non-HTML mode and converts newlines', () => {
    expect(sanitizeBotHtml('a & b <x>\nnext', 'plain')).toBe('a &amp; b &lt;x&gt;<br>next');
  });

  it('handles nullish input', () => {
    expect(sanitizeBotHtml(null, 'HTML')).toBe('');
    expect(sanitizeBotHtml(undefined, 'plain')).toBe('');
  });
});
