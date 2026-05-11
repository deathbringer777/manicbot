# DMARC reporting setup (P2-17, relax.md §3)

> Operator-facing instructions for Kirill. **No CLI tooling here** — every
> step is a UI action in the Cloudflare DNS dashboard. Nothing in this
> file is auto-applied; it's a runbook.

## Why

`dig TXT _dmarc.manicbot.com` currently returns:

```
"v=DMARC1; p=reject;"
```

Strict `p=reject` is excellent for deliverability and impersonation
defence — but **we have no idea when DMARC is rejecting legitimate mail**
because there is no `rua` (aggregate reporting) address. If a partner's
forwarder breaks SPF/DKIM, or a new sending IP is silently dropped, we
find out from a missing reply, never from a report.

Adding `rua=mailto:postmaster@manicbot.com` flips on aggregate XML
reports — once per ~24 h, every receiving MX that supports DMARC
(Google, Microsoft, Yahoo, etc.) emails a summary of pass/fail counts to
that address. The report addresses tell us:

- which senders are passing or failing SPF / DKIM alignment
- whether we have a stray legitimate sending source (Brevo, Resend, a
  forwarder, a CRM tool) that's being rejected
- whether anyone is actually trying to spoof `@manicbot.com`

## Target value

```
v=DMARC1; p=reject; rua=mailto:postmaster@manicbot.com
```

We are deliberately **not** adding `ruf=` (forensic / per-message
reports). `ruf` ships full message contents and IPs to the reporting
address; most MTAs ignore it anyway, and the privacy cost on EU SMB
mailboxes (potentially containing client PII in support emails) is not
worth the marginal signal.

Keep `p=reject` — do not weaken to `quarantine` or `none`.

## Step-by-step (Cloudflare DNS dashboard)

1. Open https://dash.cloudflare.com → select the **manicbot.com** zone.
2. **DNS → Records.**
3. Filter on **Type = TXT** and **Name contains `_dmarc`**.
4. You should see exactly one record:
   - **Type:** `TXT`
   - **Name:** `_dmarc`
   - **Content:** `v=DMARC1; p=reject;`
   - **TTL:** Auto (or whatever was set)
   - **Proxy status:** DNS only (TXT records are never proxied)
5. Click the **Edit** (pencil) icon on that row.
6. Replace the **Content** field with **exactly**:
   ```
   v=DMARC1; p=reject; rua=mailto:postmaster@manicbot.com
   ```
   No quotation marks. No trailing semicolon. Single line.
7. Click **Save**.
8. From a terminal anywhere on the internet, verify:
   ```
   dig +short TXT _dmarc.manicbot.com
   ```
   Expected output:
   ```
   "v=DMARC1; p=reject; rua=mailto:postmaster@manicbot.com"
   ```

## `postmaster@manicbot.com` mailbox

The address you point `rua` at must accept mail. **Don't ship the new
DMARC record before the mailbox exists** — receiving MTAs sometimes drop
zones whose `rua` mailbox bounces, which is the opposite of what we
want.

Two acceptable patterns:

### Option A — Cloudflare Email Routing (simplest)

1. Cloudflare dashboard → zone `manicbot.com` → **Email → Email Routing**.
2. Enable Email Routing if not already on. Cloudflare adds three MX
   records and an SPF include automatically — do NOT remove them.
3. Add a **Custom Address** route:
   - From: `postmaster@manicbot.com`
   - Action: Send to → your Gmail / Proton / Fastmail of choice
4. Verify the destination (Cloudflare emails a confirm link).
5. The mailbox is now live in ~30 seconds.

### Option B — Resend inbound address

Already paying for Resend for outbound mail; Resend also supports inbound
on a paid plan. Less recommended because mixing transactional outbound
and admin-only inbound on the same provider risks one outage taking down
both. Use Option A unless there's a billing reason not to.

## Aftercare

- Wait 24–48 h after the DNS update.
- First aggregate XML reports should arrive in `postmaster@manicbot.com`.
- Use any DMARC report viewer (Postmark's free dmarc-reports, dmarcian,
  Valimail Monitor) to upload / forward the XML. **Do not** publish the
  raw XML — IPs are operational data.
- If a legitimate sender starts failing, add it to SPF (`include:`) or
  publish DKIM, then re-check.
- Keep `p=reject`. Do NOT switch to `p=none` "temporarily" — you'd lose
  the impersonation defence while gaining no extra visibility.

## Rollback

If `rua=` ever causes downstream issues (extremely unlikely), the rollback
is a one-line DNS edit back to:

```
v=DMARC1; p=reject;
```

No queues, no waits — DNS TTL is the only timer.

## References

- [RFC 7489 — DMARC](https://datatracker.ietf.org/doc/html/rfc7489)
- [Cloudflare docs — DNS records for DMARC](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/#dmarc-records)
- [Postmark DMARC checker](https://dmarc.postmarkapp.com/)
