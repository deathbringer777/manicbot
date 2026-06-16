/**
 * Regression pin for the chat-widget button overlap bug visible on the
 * landing's iPhone mockup: with `white-space: nowrap` set on `.mb-btn` and
 * `flex: 1 1 auto; min-width: 38px` on multi-button rows, long labels like
 * "Классический маникюр" or "◀ Главное меню" bled past their button box
 * and the next button in the row painted on top of the overflowed text.
 *
 * Fix: allow text to wrap inside buttons (`white-space: normal`) and use a
 * tight `line-height` so 2-line labels read cleanly without the chip
 * doubling in height.
 */
import { describe, it, expect } from 'vitest';
import { DEMO_CHAT_SRC } from '../src/embed/demoChat.js';

// Grab the BASE `.mb-btn { … }` rule body — split the source on `}` and find
// the rule whose selector is exactly `.mb-btn` (no parent selector like
// `.mb-btn-row-grid .mb-btn`, no pseudo like `.mb-btn:hover`, no chained
// selector like `.mb-btn.active`).
function baseMbBtnBody() {
  const rules = DEMO_CHAT_SRC.split('}');
  for (const rule of rules) {
    // Rule looks like `…junk…\n…\'.mb-btn{…body…` after the split (the
    // closing `}` was consumed). The selector starts right after the last
    // single-quote / `+` / `'` we can find for this concatenation.
    const m = rule.match(/'([^']+)\{([^']*)$/);
    if (!m) continue;
    if (m[1].trim() === '.mb-btn') return m[2];
  }
  return null;
}

describe('demoChat .mb-btn — button text wraps instead of overflowing', () => {
  it('does not declare white-space:nowrap on the base .mb-btn rule', () => {
    const body = baseMbBtnBody();
    expect(body, 'base .mb-btn rule must exist').not.toBeNull();
    expect(body).not.toMatch(/white-space\s*:\s*nowrap/);
  });

  it('declares white-space:normal so long labels wrap to a second line', () => {
    const body = baseMbBtnBody();
    expect(body).not.toBeNull();
    expect(body).toMatch(/white-space\s*:\s*normal/);
  });

  it('keeps a tight line-height so wrapped labels stay compact', () => {
    const body = baseMbBtnBody();
    expect(body).not.toBeNull();
    // line-height between 1.05 and 1.3 keeps a 2-line button readable
    // without doubling its height vs. a 1-line button.
    const lh = body.match(/line-height\s*:\s*([\d.]+)/);
    expect(lh, 'line-height must be set on .mb-btn').not.toBeNull();
    const value = parseFloat(lh[1]);
    expect(value).toBeGreaterThanOrEqual(1.05);
    expect(value).toBeLessThanOrEqual(1.3);
  });

  it('lets multi-button rows actually shrink (flex-basis:0 + min-width:0)', () => {
    // Old rule used `flex:1 1 auto;min-width:38px` which kept chips at their
    // content width and shrunk text into the next sibling. New rule allows
    // proper distribution + shrinking.
    expect(DEMO_CHAT_SRC).toContain(
      '.mb-btn-row:not(.mb-btn-row-solo):not(.mb-btn-row-grid) .mb-btn{flex:1 1 0;min-width:0}'
    );
  });
});

describe('demoChat — catalog "back" chip renders as a compact square arrow', () => {
  it('defines a fixed 40px square .mb-btn-back rule with higher specificity than flex:1', () => {
    // Must out-specify the multi-button flex:1 rule (one extra class) so the
    // square keeps a fixed width instead of stretching to share the row.
    expect(DEMO_CHAT_SRC).toContain(
      '.mb-btn-row:not(.mb-btn-row-solo):not(.mb-btn-row-grid) .mb-btn.mb-btn-back{flex:0 0 40px;width:40px;min-width:40px;height:40px;padding:0;gap:0;align-self:center;color:var(--mb-muted)}'
    );
  });

  it('tints the chevron with the muted block grey, not a hard emoji colour', () => {
    // Arrow colour follows --mb-muted (the block grey), and the glyph is an
    // inline stroked SVG (currentColor) — NOT a coloured ◀️ emoji that would
    // ignore `color`.
    expect(DEMO_CHAT_SRC).toMatch(/\.mb-btn-back svg\{[^}]*width:17px/);
    expect(DEMO_CHAT_SRC).toContain('stroke="currentColor"');
  });

  it('detects the catalog back chip by callback_data and renders it first (left)', () => {
    // Detection is by callback_data === 'cat' (CB.CATALOG), so "Главное меню"
    // (CB.MAIN) and other backs are untouched, and only multi-button rows
    // (the service card) get the square treatment.
    expect(DEMO_CHAT_SRC).toMatch(/row\[bk\]\.callback_data === 'cat'/);
    expect(DEMO_CHAT_SRC).toMatch(/makeBtn\(row\[backIdx\], true\)/);
    // makeBtn gains an isBack arg that swaps the label for the chevron SVG
    // while keeping the original text as the accessible name.
    expect(DEMO_CHAT_SRC).toMatch(/function makeBtn\(b, isBack\)/);
    expect(DEMO_CHAT_SRC).toMatch(/setAttribute\('aria-label', b\.text\)/);
  });

  it('only squares back chips inside multi-button rows, never solo back rows', () => {
    // The detection loop is guarded by row.length > 1 so a standalone "Wstecz"
    // row in the catalog list keeps its full label.
    expect(DEMO_CHAT_SRC).toMatch(/if \(row\.length > 1\) \{\s*for \(var bk/);
  });
});
