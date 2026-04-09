# ManicBot — User Guide

Telegram bot for nail salon booking and salon management. Languages: Russian, Ukrainian, English, Polish.

---

## Bot Commands (menu)

| Command | Description |
|--------|----------|
| `/start` | Main menu |
| `/book` | Book a service |
| `/my` | My appointments |
| `/prices` | Price list |
| `/catalog` | Work catalog (photos) |
| `/contacts` | Contacts and address |
| `/lang` | Change language (RU / UA / EN / PL) |
| `/help` | Command help |

The same actions are available via buttons under messages.

---

## How to Book

1. Press **Book** or type `/book`.
2. If you're not in the database yet — confirm your name and enter your phone number (or use the "Send number" button).
3. Choose a **service** (classic manicure, gel polish, pedicure, etc.).
4. Choose a **date** in the calendar, then a **time**.
5. Confirm the booking with the **Confirm** button.

After confirmation, you'll receive a message with the date, time, address, and a link to add to your calendar (Google Calendar / Apple). The bot will send reminders 24 hours and 2 hours before.

---

## My Appointments

- **`/my`** or the **My Appointments** button — list of upcoming appointments.
- For each appointment, you can press **Cancel** and optionally add a comment for the master.
- There is a **Cancel all appointments** button (with confirmation).

---

## Support and Consultant

- The main menu has a **🆘 Support** button.
- Press it, then type your message — a ticket is created, and the master or support will reply in the same chat.
- You can type freely in the chat — if the bot doesn't understand, it will suggest the **Connect a consultant** button.

---

## Admin (Salon Owner)

### Registering as admin in the bot

In Telegram, send the bot:

```
/admin YOUR_ADMIN_KEY
```

`ADMIN_KEY` — the secret from the worker settings in Cloudflare (Variables and Secrets → ADMIN_KEY). After entering the key, your chat_id becomes admin.

### What the admin can do

- **Management panel** — today's/tomorrow's appointments, masters, clients, services, "About us", billing.
- **Confirm/reject appointments** — incoming appointments can be accepted, rejected, or rescheduled.
- **Masters** — add/remove masters, enable/disable vacation mode.
- **Services** — names, prices, duration, photos, description.
- **About us** — photos, description, Instagram.
- **Billing** — Stripe subscription (if configured), payment portal.
- **Clients** — list with contacts.
- **Export** — CSV of clients and appointments via web admin panel.

### Web Admin Panel

- **Admin panel (clients, appointments, export):**
  https://manicbot.vdovin-kyrylo.workers.dev/admin
  Login: `admin`, password: your `ADMIN_KEY`.

- **Billing by tenants:**
  https://manicbot.vdovin-kyrylo.workers.dev/admin/billing
  (same Basic Auth).

---

## Master

### How to become a master

Admin adds the master in the panel: **Management** → **Masters** → **Add master** (enter Telegram user id or forward a message from the master).

### Commands for master

| Command | Description |
|--------|----------|
| `/master` | Master panel |
| `/panel` | Same (if you're a master or admin) |

### What the master can do

- View today's and tomorrow's appointments.
- Confirm, reject appointments, or suggest a different time.
- Reply in support tickets (the **Claim ticket** button in the new request notification).
- Close the conversation with a client using the **Close ticket** button.

---

## Support

**The support role can only be assigned by an admin.**

### How to add a support agent (admin only)

In Telegram, send the bot **as admin**:

```
/add_support @username
```

or by numeric user ID:

```
/add_support 123456789
```

You can also forward a message from the user or send a contact. Example: to assign support to user @dezbringer, send:

```
/add_support @dezbringer
```

After this, the user will receive notifications about new tickets (the **Claim ticket** button) and can conduct a dialogue with the client.

### Add yourself to support (if you're already admin)

If you're already registered as admin and also want to receive tickets:

```
/support_register YOUR_ADMIN_KEY
```

(The command only works if the sender is already an admin.)

### Remove from support role

Only admin can remove an agent from the support role:

```
/remove_support @username
```
or
```
/remove_support 123456789
```

---

## Client Mode

If you're registered as admin or master but want to use the bot as a regular client:

```
/client
```

The regular booking main menu will open.

---

## Webhook Setup and Migration (for developers)

- **Setup (webhook + commands):**
  https://manicbot.vdovin-kyrylo.workers.dev/setup?key=YOUR_ADMIN_KEY

- **Migration (once after deploy):**
  https://manicbot.vdovin-kyrylo.workers.dev/admin/migrate?key=YOUR_ADMIN_KEY
  Or from terminal: `ADMIN_KEY=... npm run migrate` (see MIGRATION.md).

---

## Useful Links

| Page | URL |
|---------|-----|
| Worker home | https://manicbot.vdovin-kyrylo.workers.dev/ |
| Admin (Basic Auth) | https://manicbot.vdovin-kyrylo.workers.dev/admin |
| Billing | https://manicbot.vdovin-kyrylo.workers.dev/admin/billing |
| Setup | https://manicbot.vdovin-kyrylo.workers.dev/setup?key=ADMIN_KEY |
| Stripe success page | https://manicbot.vdovin-kyrylo.workers.dev/stripe/success |

Replace `ADMIN_KEY` in links with `?key=...`.
