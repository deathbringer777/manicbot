# ManicBot — Secret Rotation Runbook

**Audience:** platform owner / on-call engineer
**Last reviewed:** 2026-05-09

---

## TL;DR

Two long-lived secrets need rotation if you suspect compromise OR on a regular cadence (recommended: every 6 months):

1. `ADMIN_KEY` — Worker secret (used to gate admin HTTP endpoints)
2. `AUTH_SECRET` — admin-app NextAuth secret (signs session JWTs)

A third secret has its own dedicated runbook and is NOT covered here:

3. `BOT_ENCRYPTION_KEY` — see [`scripts/rotate-bot-encryption-key.js`](scripts/rotate-bot-encryption-key.js) for the zero-downtime old/new dual-key rotation flow.

---

## Pre-flight checks (run in order)

```bash
# 1. Confirm no in-flight commit accidentally added .dev.vars or .env to git history.
git log --all --full-history -- ".dev.vars" "manicbot/.dev.vars" "admin-app/.env" "manicbot/admin-app/.env"
# → must return zero lines.

# 2. Confirm CI Gitleaks is wired (we want green on every push).
test -f .github/workflows/security.yml && grep -i "gitleaks" .github/workflows/security.yml

# 3. Pull current secret values into your shell so you can compare before/after.
wrangler secret list                       # Worker
# admin-app: visit Cloudflare Pages dashboard → admin-app project → Settings → Environment variables
```

If git history shows the file was ever committed (even briefly), treat that secret as **fully compromised** — rotation alone is not enough; also revoke any tokens that were minted with it.

---

## ADMIN_KEY rotation (Worker)

ADMIN_KEY gates HTTP endpoints in `manicbot/src/http/adminKeyHttp.js`. It must travel only as `Authorization: Bearer <key>`; query-param fallback was removed in commit history (see SECURITY_FINDINGS.md M1, FIXED).

### Steps

```bash
# 1. Generate a new 64-char hex key.
NEW_KEY=$(openssl rand -hex 32)
echo "$NEW_KEY"   # save somewhere secure — you will paste it below

# 2. Push it to Cloudflare as the active secret.
cd manicbot
wrangler secret put ADMIN_KEY
# Paste $NEW_KEY when prompted.

# 3. Verify the deploy picked it up.
curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer wrong-value" \
     https://manicbot.com/admin/migrate
# → 403

curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer $NEW_KEY" \
     https://manicbot.com/admin/migrate
# → 200 (or 500 if D1 not bound — that's fine, 403 vs 200 is what we're checking)
```

### Rollback

`wrangler secret put ADMIN_KEY` is immediate; there is no scheduled rotation. To roll back, push the previous value:

```bash
wrangler secret put ADMIN_KEY   # paste the OLD value
```

### Update local dev

```bash
# manicbot/.dev.vars (do NOT commit)
# Update the line:
ADMIN_KEY=<new value>
```

`.dev.vars` is in `.gitignore` (root, manicbot/, manicbot/admin-app/).

### Side effects to expect

- Anyone holding the old key (e.g., admin scripts, Postman collections) will get 403 on next call.
- Cloudflare access logs will show 403 spikes from those callers — that's how you find them.

---

## AUTH_SECRET rotation (admin-app)

AUTH_SECRET is consumed by NextAuth v5 (`@auth/core` HMAC) to sign JWT session tokens. Rotating it forces every active session to re-authenticate.

### Steps

```bash
# 1. Generate a new 64-char hex secret.
NEW_AUTH_SECRET=$(openssl rand -hex 32)

# 2. Update Cloudflare Pages env vars:
#    Cloudflare dashboard → Pages → admin-app project → Settings →
#    Environment variables → Production → Edit AUTH_SECRET → paste $NEW_AUTH_SECRET → Save
#    Repeat for Preview environment if you use it.

# 3. Trigger a redeploy:
#    Pages dashboard → Deployments → Retry latest production deployment
#    (or push an empty commit: git commit --allow-empty -m "chore: redeploy after AUTH_SECRET rotation" && git push)

# 4. Verify all sessions are invalidated:
#    Open admin-app in a browser where you were already signed in.
#    Expected: redirect to /login?reason=session_expired (or similar).
```

### Rollback

If users complain en masse and you need to roll back, paste the previous value back into the Pages dashboard and redeploy. Sessions will be re-validated against the old secret.

### Update local dev

```bash
# manicbot/admin-app/.env (do NOT commit)
AUTH_SECRET=<new value>
```

### Side effects to expect

- Every active web session is invalidated. Users will need to sign in again.
- Outstanding Google OAuth flows in mid-redirect may fail with a "callback signature mismatch" — they retry on next attempt.
- Email verification / password-reset codes are NOT affected (they're hashed in DB, not signed by AUTH_SECRET).

---

## When to rotate immediately (incident response)

Rotate without delay if any of these are true:

- A `.dev.vars` or `.env` file was discovered in a public repo / paste / Slack thread.
- A laptop with the secret saved was lost or stolen.
- A team member with secret access leaves the company.
- CI Gitleaks fired with a real positive that points at one of these secrets.
- An internal log aggregator was found to retain raw `Authorization: Bearer ...` headers.

After rotation, also review:

- Cloudflare access logs for unauthorised admin endpoint calls in the last 30 days.
- D1 `audit_log` rows where `actor` looks anomalous.
- Stripe customer events for subscription changes you didn't initiate (webhook signature is independent — but check just in case).

---

## Routine cadence

- Every 6 months: rotate `ADMIN_KEY` and `AUTH_SECRET` together (combine into one maintenance window — sessions are invalidated, but admins relog right after).
- After every personnel change with secret access.
- After any security finding that touches the auth path.

Add a calendar reminder. The rotation itself takes ~5 minutes per secret.

---

## What we do NOT need to rotate (these are safe)

- `STRIPE_WEBHOOK_SECRET` — already rotates if you create a new Stripe webhook endpoint.
- `STRIPE_SECRET_KEY` — Stripe-side rotation only.
- `RESEND_API_KEY` — Resend-side rotation only; rotation does not require Worker/admin-app changes besides the env var update.
- `META_APP_SECRET`, `META_VERIFY_TOKEN_*` — Meta-side rotation only; coordinate with WhatsApp/Instagram channel owners.
- `WORKERS_AI_API_TOKEN` — Cloudflare-side; rotate via Cloudflare dashboard.
- `BOT_ENCRYPTION_KEY` — has its own dual-key rotation playbook, see [`scripts/rotate-bot-encryption-key.js`](scripts/rotate-bot-encryption-key.js).

---

## Verification checklist after rotation

- [ ] `git log --all --full-history -- ".dev.vars" "admin-app/.env"` returns nothing
- [ ] Worker `/admin/migrate` returns 403 with old key, 200 with new
- [ ] Admin-app login still works with new AUTH_SECRET
- [ ] Old admin-app session cookies are rejected
- [ ] `wrangler secret list` shows the rotated secret with a recent timestamp
- [ ] Cloudflare Pages dashboard shows the redeploy completed
- [ ] No new errors in Cloudflare Logpush (worker errors, admin-app 500s)

---

## Reference: secret inventory

| Secret | Where stored | Rotated by | Run-frequency | Last rotated |
| --- | --- | --- | --- | --- |
| `ADMIN_KEY` | Worker secrets | `wrangler secret put` | 6 months / on incident | _fill in after rotation_ |
| `AUTH_SECRET` | Pages env | dashboard + redeploy | 6 months / on incident | _fill in after rotation_ |
| `BOT_ENCRYPTION_KEY` | Worker + Pages env | `scripts/rotate-bot-encryption-key.js` | 12 months | _fill in_ |
| `STRIPE_WEBHOOK_SECRET` | Worker secrets | Stripe dashboard | when adding endpoint | _fill in_ |
| `STRIPE_SECRET_KEY` | Worker secrets | Stripe dashboard | on Stripe-side rotation | _fill in_ |
| `RESEND_API_KEY` | Pages env | Resend dashboard | on incident | _fill in_ |
| `META_APP_SECRET` | Worker secrets | Meta App dashboard | on incident | _fill in_ |
| `META_VERIFY_TOKEN_WA` / `_IG` | Worker + Pages env | regenerate on rotation | on incident | _fill in_ |
| `WORKERS_AI_API_TOKEN` | Worker secrets | Cloudflare dashboard | 12 months | _fill in_ |

Update the "Last rotated" column in this table whenever you rotate.
