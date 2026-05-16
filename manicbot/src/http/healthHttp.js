/**
 * /api/health — public liveness endpoint.
 *
 * Purpose: external uptime monitors (UptimeRobot, BetterStack, Pingdom)
 * need a cheap, stable URL that returns 200 when the Worker is up and
 * 5xx when it isn't. Before this endpoint existed, hitting `/api/health`
 * fell through the Pages landing proxy and returned the marketing page
 * with status 200 — useless for monitoring because it would still 200
 * even if the Worker was completely cold-dead.
 *
 * Contract:
 *   GET  /api/health → 200 application/json
 *     { status: "ok", time: <ISO>, service: "manicbot" }
 *   HEAD /api/health → 200 (no body, same headers)
 *   other methods    → 405
 *
 * Headers:
 *   - Cache-Control: no-store  (every probe must reach the Worker)
 *   - Content-Type: application/json; charset=utf-8 for GET
 *
 * Non-goals:
 *   - This is liveness, not readiness. We do NOT touch D1, KV, or any
 *     binding. A failing D1 must NOT take down the liveness probe —
 *     the in-house captureError + Workers Logs already cover that lane.
 *   - No secrets, no env values are echoed. The body is fixed shape.
 */

export function handleHealthRequest(request) {
  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }
  if (request.method !== 'GET') {
    return new Response('method not allowed', {
      status: 405,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const body = JSON.stringify({
    status: 'ok',
    time: new Date().toISOString(),
    service: 'manicbot',
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
