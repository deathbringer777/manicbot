# Seed Test Data: 2 Salons + Masters

Run the seed once — it creates/updates 2 tenants with different services, prices, and photos; if a username is provided, the master is added to both salons.

## Running the seed

Open in browser (substitute your `ADMIN_KEY` and worker domain):

```
https://YOUR_WORKER.workers.dev/admin/seed?key=YOUR_ADMIN_KEY&master=dezbringer
```

Or seed only without assigning a master (add masters manually later):

```
https://YOUR_WORKER.workers.dev/admin/seed?key=YOUR_ADMIN_KEY
```

Default `master` parameter: `dezbringer`. You can specify a different username without `@`.

## What the seed does

1. **Tenants**
   If there are fewer than 2 tenants — creates up to two (Nails Studio, Luxe Manicure). If 2 already exist — uses the first two and updates their names.

2. **Salon 1 — Nails Studio**
   - Services: classic manicure 80 zł, gel polish 140, pedicure 120, extensions 250, design 50, combo 220.
   - Unique service photos and "About us" block.

3. **Salon 2 — Luxe Manicure**
   - Services: same items, but higher prices (100, 180, 150, 300, 70, 280 zł).
   - Different photos and different "About us" text.

4. **Master**
   If `master=dezbringer` (or another username) is passed and one of the tenants has a registered bot, the seed calls the Telegram API `getChat(@username)`, gets the `chat_id`, and:
   - assigns this user as **master** in both salons;
   - assigns them as **owner** (tenant_owner) in both salons;
   - writes `cfg:admin` in each tenant.

If unable to resolve the username (bot not found or user hasn't messaged the bot), the response will have `masterAssigned: false` with a hint to add the master manually.

## Commands after seed (if master wasn't assigned automatically)

In **salon 1 bot** (Nails Studio) send:

```
/grant_master @dezbringer
```

In **salon 2 bot** (Luxe Manicure) — the same:

```
/grant_master @dezbringer
```

(Command is issued by the salon owner or system_admin.)

To assign a **salon owner** from the system admin bot (if you know the `chat_id` and `tenantId`):

```
/grant_owner CHAT_ID TENANT_ID
```

Example:

```
/grant_owner 123456789 t_abc123
```

## Seed Response (JSON)

- `ok: true` — seed completed.
- `log` — array of step strings.
- `tenants` — array of two tenantIds.
- `masterAssigned: true/false` — whether the master was added by username.
- `masterChatId` — if master was added.
- `hint` — present when `masterAssigned: false`: a `/grant_master` command hint for manual assignment.

After the seed, each salon will have its own prices, photos, and "About us"; with a successful `masterAssigned`, @dezbringer will be master and owner in both.
