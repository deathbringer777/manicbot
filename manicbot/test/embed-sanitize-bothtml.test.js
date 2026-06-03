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
import { sanitizeBotHtml, DEMO_CHAT_SRC } from '../src/embed/demoChat.js';

describe('embed IIFE self-containment — esbuild keep-names __name shim', () => {
  // wrangler bundles the Worker with esbuild keepNames:true. That rewrites an
  // inner `function esc(){}` to `function esc2(){}; __name(esc2,"esc")`, and
  // that __name call rides along when sanitizeBotHtml is inlined into the
  // browser IIFE via `.toString()`. esbuild defines __name in the Worker module
  // scope — NOT inside the served IIFE — so without a shim the widget throws
  // "ReferenceError: __name is not defined" on the first bot-bubble render.
  // The exported-function unit tests above never exercise the inlined string,
  // which is why the break shipped. This guards the inlined surface directly.
  it('defines a __name shim inside the served IIFE', () => {
    expect(DEMO_CHAT_SRC).toMatch(/\bvar __name\s*=/);
  });

  it('keeps every __name() reference backed by a definition', () => {
    if (/__name\s*\(/.test(DEMO_CHAT_SRC)) {
      expect(DEMO_CHAT_SRC).toMatch(/\bvar __name\s*=/);
    }
  });
});

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

/**
 * #X-01 (T05 regression pins) — edge cases the original suite did not name.
 *
 * The shipped suite above pins the common vectors (`onmouseover`/`onload`/
 * `onclick`, a lowercase `javascript:` href). These add the obfuscation
 * variants an attacker actually reaches for once the obvious ones are blocked:
 * MIXED-CASE tag names + handlers, modern pointer-event handlers, and the
 * non-`javascript:` dangerous schemes (`data:`, `vbscript:`) plus case- and
 * whitespace-obfuscated `javascript:`. Each assertion was verified to go RED
 * against the pre-fix "un-escape the whole tag incl. attributes" implementation
 * (the bug PR #336 fixed) and GREEN against the current reconstruct-no-attrs
 * renderer — so they cannot silently regress. Behavior is identical in the
 * browser because `sanitizeBotHtml` is inlined into DEMO_CHAT_SRC verbatim via
 * `.toString()` (asserted at line 880 of demoChat.js).
 */
describe('#X-01 — sanitizeBotHtml edge cases (mixed-case + dangerous schemes)', () => {
  it('strips a handler AND lowercases a mixed-case tag name (regex /gi + toLowerCase)', () => {
    // Pre-fix leaked `<B OnClick="alert(1)">` verbatim into the visitor DOM.
    expect(sanitizeBotHtml('<B OnClick="alert(1)">hi</B>', 'HTML')).toBe('<b>hi</b>');
    expect(sanitizeBotHtml('<STRONG OnMouseEnter=evil()>x</STRONG>', 'HTML')).toBe('<strong>x</strong>');
  });

  it('strips a modern pointer-event handler (onpointerenter) the original suite never named', () => {
    expect(sanitizeBotHtml('<u onpointerenter="x()">z</u>', 'HTML')).toBe('<u>z</u>');
    expect(sanitizeBotHtml('<i onPointerOver="y()">w</i>', 'HTML')).toBe('<i>w</i>');
  });

  it('rebuilds a mixed-case anchor while keeping a safe (mixed-case-attr) https href', () => {
    expect(sanitizeBotHtml('<A HREF="https://e.com/x">y</A>', 'HTML'))
      .toBe('<a href="https://e.com/x" rel="noopener noreferrer nofollow" target="_blank">y</a>');
  });

  it('neutralizes a data: scheme href (allowlist is https/mailto/tel only)', () => {
    // The <script> riding inside the data: URI must end up escaped, never live.
    const out = sanitizeBotHtml('<a href="data:text/html,<script>alert(1)</script>">d</a>', 'HTML');
    expect(out.startsWith('<a rel="noopener noreferrer nofollow" target="_blank">')).toBe(true);
    expect(out).not.toContain('href="data:');
    expect(out).not.toContain('<script>');
  });

  it('neutralizes a vbscript: scheme href', () => {
    expect(sanitizeBotHtml('<a href="vbscript:msgbox(1)">v</a>', 'HTML'))
      .toBe('<a rel="noopener noreferrer nofollow" target="_blank">v</a>');
  });

  it('neutralizes a case-obfuscated JaVaScRiPt: href (scheme check is case-insensitive)', () => {
    expect(sanitizeBotHtml('<a href="JaVaScRiPt:alert(1)">j</a>', 'HTML'))
      .toBe('<a rel="noopener noreferrer nofollow" target="_blank">j</a>');
  });

  it('neutralizes a leading-whitespace javascript: href (href is trimmed before the scheme test)', () => {
    expect(sanitizeBotHtml('<a href="  javascript:alert(1)">o</a>', 'HTML'))
      .toBe('<a rel="noopener noreferrer nofollow" target="_blank">o</a>');
  });

  it('keeps mailto: and tel: schemes (allowlisted) with forced rel/target', () => {
    expect(sanitizeBotHtml('<a href="mailto:a@b.com">m</a>', 'HTML'))
      .toBe('<a href="mailto:a@b.com" rel="noopener noreferrer nofollow" target="_blank">m</a>');
    expect(sanitizeBotHtml('<a href="tel:+123">t</a>', 'HTML'))
      .toBe('<a href="tel:+123" rel="noopener noreferrer nofollow" target="_blank">t</a>');
  });

  it('treats parseMode as strict "HTML" — lowercase "html" is fully escaped (no tag survives)', () => {
    expect(sanitizeBotHtml('<b onclick=x>hi</b>', 'html')).toBe('&lt;b onclick=x&gt;hi&lt;/b&gt;');
  });
});
