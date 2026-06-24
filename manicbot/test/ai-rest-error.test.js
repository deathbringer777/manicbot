/**
 * Regression: runWorkersAIViaRESTOne must log the error body and return null
 * on a non-2xx REST response — never throw.
 *
 * The original code built the log line with
 *   `await res.text().catch(() => '').slice(0, 200)`
 * which binds `.slice` to the Promise that `.catch()` returns (operator
 * precedence: `await` wraps the whole expression), throwing a TypeError while
 * constructing the log arguments on every non-429 failure. That swallowed the
 * diagnostic body and took the exception path instead of the clean
 * "return null, try the next model" path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runWorkersAIViaRESTOne } from '../src/ai.js';

afterEach(() => vi.unstubAllGlobals());

describe('runWorkersAIViaRESTOne — REST error handling', () => {
  it('returns null (does not throw) and can read the body on a 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'x'.repeat(500),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runWorkersAIViaRESTOne({}, 'acct', 'token', '@cf/model', { messages: [] });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on a 429 without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    const result = await runWorkersAIViaRESTOne({}, 'acct', 'token', '@cf/model', { messages: [] });

    expect(result).toBeNull();
  });
});
