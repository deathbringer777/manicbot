/** Current Unix timestamp in seconds (integer). Use instead of inlined
 *  `Math.floor(Date.now() / 1000)` for consistency. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
