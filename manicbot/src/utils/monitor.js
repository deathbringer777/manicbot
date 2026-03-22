/**
 * Monitoring groundwork — lightweight error/metric tracking.
 * Currently logs to console; future: Sentry/analytics integration.
 */

export function createMonitor(ctx) {
  return {
    trackError(category, error, meta) {
      console.error(`[${category}]`, error.message, meta);
    },
    trackMetric(name, value, tags) {
      /* future: Sentry/analytics */
    },
  };
}
