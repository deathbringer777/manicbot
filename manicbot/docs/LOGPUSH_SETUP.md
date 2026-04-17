# Cloudflare Logpush — Structured Logs Export

All structured events emitted by `logEvent()` (see `src/utils/events.js`) are
written to `console.log|warn|error` as JSON lines. Cloudflare Workers streams
these to Logpush destinations when configured.

## Log line schema

```json
{
  "timestamp": "2026-04-17T21:00:00.000Z",
  "level": "info" | "warn" | "error",
  "type": "booking.created",
  "tenantId": "t_xxx" | null,
  "botId": "1234567890" | null,
  "userId": "u_xxx" | null,
  "traceId": "uuid" | null,
  "message": "…",
  "data": { /* event-specific */ }
}
```

## Standard event types

- `booking.created` / `booking.cancelled` / `booking.completed` / `booking.no_show`
- `post_visit.prompt_sent` / `post_visit.prompt_due`
- `promo.returning_candidate` / `promo.birthday_issued` / `promo.redeemed`
- `billing.trial_will_end` / `billing.invoice_upcoming` / `billing.dispute`
- `stripe.event` / `webhook.telegram` / `webhook.meta`
- `security.role_rejected` / `integration.needs_reauth` / `google.invalid_grant`
- `error.cron` / `error.handler`
- `ai.call`

## Setting up Logpush → ClickHouse / BigQuery / R2

### 1. Enable Workers Logpush in the Cloudflare dashboard

```bash
# From account admin:
# Workers & Pages → Overview → manage Workers Logs → Create Logpush job
#
# Dataset: "Workers traces"
# Filter (optional): outcome=ok
# Destination: R2 / S3 / Datadog / Splunk / custom HTTP endpoint
```

### 2. Alternative — via API (recommended for IaC)

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/logpush/jobs" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "name": "manicbot-workers-logpush",
  "destination_conf": "r2://manicbot-logs?account-id=$CF_ACCOUNT_ID&access-key-id=$R2_KEY&secret-access-key=$R2_SECRET",
  "dataset": "workers_trace_events",
  "enabled": true,
  "output_options": {
    "output_type": "ndjson",
    "field_names": [
      "Event", "EventTimestampMs", "Outcome", "Logs", "Exceptions",
      "ScriptName", "ScriptVersion"
    ]
  }
}
EOF
```

### 3. Parse JSON logs in your warehouse

Each row in `Logs` is a JSON string matching the schema above. In ClickHouse:

```sql
CREATE TABLE manicbot_events (
    timestamp DateTime,
    level Enum('info' = 1, 'warn' = 2, 'error' = 3),
    type String,
    tenant_id Nullable(String),
    bot_id Nullable(String),
    user_id Nullable(String),
    trace_id Nullable(String),
    message String,
    data String -- JSON
) ENGINE = MergeTree()
ORDER BY (timestamp, type, tenant_id);
```

Ingest via your R2-to-ClickHouse pipeline of choice (e.g. `clickhouse-local`
batch import, or a Worker that pulls from R2 and INSERTs via HTTP).

### 4. Recommended Grafana dashboards

- **Request rate per tenant** — `COUNT(*) by tenant_id, toStartOfMinute(timestamp)`
- **Error rate per integration** — filter by `type LIKE 'integration.%' OR type LIKE 'error.%'`
- **AI cost per tenant per day** — aggregate `data.cost_cents` on `type='ai.call'`
- **Queue depth** — Cloudflare Queues emits their own metrics; correlate with
  `type='cron.scheduled.enqueued'` from our logs.

## Retention / cost

- Workers Logpush is billed per million events. At ~1M req/day across all
  tenants, expect ~$0.05/day.
- Recommend 30-day retention at the destination; aggregate daily rollups past
  that into a smaller table.
