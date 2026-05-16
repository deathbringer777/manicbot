# Google OAuth Verification — Submission Kit

Operator runbook for submitting **ManicBot** to Google for OAuth app verification.
Scopes: `calendar.events` + `calendar.readonly` (both **sensitive**, not restricted →
free verification, no CASA assessment, individual developer submission OK).

Companion to the plan at `~/.claude/plans/https-accounts-google-com-signin-oauth-w-snappy-flask.md`.
Code-side prep already shipped — PR [#98](https://github.com/deathbringer777/manicbot/pull/98)
(Privacy Policy Limited Use disclaimer + Google Calendar UI disclaimer).

Three sections below — copy-paste-ready:

1. [Scope justifications](#1-scope-justifications-cloud-console-form)
2. [Demo video shot list](#2-demo-video-60-90-sec-youtube-unlisted)
3. [Reviewer rebuttal templates](#3-reviewer-rebuttal-templates)

---

## 1. Scope justifications (Cloud Console form)

Paste verbatim into **OAuth Consent Screen → Scopes → "Tell us why your app needs
this scope"** for each scope. ~300 characters each. The English wording is what
Google reviewers expect — don't paraphrase to Russian or shorten further.

### `https://www.googleapis.com/auth/calendar.events`

> ManicBot is a SaaS booking platform for independent nail salons. When a salon
> owner connects their Google Calendar, ManicBot writes a Calendar event for every
> appointment booked through our Telegram, Instagram, and WhatsApp bots, and
> updates or deletes that event when the customer reschedules or cancels. We
> request `calendar.events` (not the broader `calendar` scope) because we only
> ever read, modify, or delete events that ManicBot itself created — never events
> created by the user or by other applications.

### `https://www.googleapis.com/auth/calendar.readonly`

> ManicBot reads the salon owner's calendar to detect existing busy time blocks
> — personal events, meetings, vacations — so unavailable slots are hidden from
> clients booking through our bots, preventing double-booking. We use the
> read-only scope because we never modify these events; we only need their
> start/end timestamps to compute availability. Event titles and descriptions
> are not stored. This is the standard pattern used by Calendly, Acuity, and
> other booking systems.

### Application description (overall, single field)

> ManicBot is a SaaS booking assistant for independent nail salons. Salon owners
> install ManicBot on their Telegram, Instagram, and WhatsApp accounts; clients
> book appointments by chatting with the bot in natural language; ManicBot
> handles slot lookup, confirmation, reminders, and rescheduling. The Google
> Calendar integration syncs every booking to the salon owner's Google Calendar
> so they see all appointments on their phone, watch, and PC — and so personal
> events the owner adds to Google Calendar automatically block bookings from
> the bots. The integration is strictly per-salon-owner: each owner connects
> their own Google account voluntarily from the admin panel at manicbot.com,
> and can disconnect at any time. No personal information from connected
> calendars is ever shared, sold, or used to train AI/ML models.

---

## 2. Demo video (60–90 sec, YouTube unlisted)

### Why video, not GIF

Google's verification form has a "Demo video" field that requires a **YouTube URL**.
A GIF won't be accepted for the official submission. The GIF format also can't carry
voiceover, which Google reviewers expect.

That said — the same recording can double as a GIF for marketing / onboarding
tooltips. Extract with FFmpeg after recording:

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=720:-1:flags=lanczos" -loop 0 demo.gif
```

### Equipment (macOS)

- **QuickTime Player → File → New Screen Recording** (built-in, 1080p, no install)
- Or **OBS Studio** if you want cleaner audio + multiple sources
- External mic preferred for voiceover; macbook built-in mic is workable
- Browser: Chrome in **Incognito mode** (clean profile, no extension overlays)
- Pre-set Chrome window to **1280×720** for consistent framing
- Record at native 1080p, export at 1080p — YouTube re-encodes to 720p anyway

### Pre-recording checklist

- [ ] Spin up a **fresh Cloud Console project** OR use the current `manicbot.com@gmail.com`
      Google account that's already in test users — the unverified warning screen
      must appear during recording (this is what Google reviewers want to see)
- [ ] Use a **clean salon test tenant** with no existing Google Calendar connection
      (so the recording starts from disconnected state). The seeded test accounts
      from `npm run seed:test-accounts` work — pick one without GCal connected.
- [ ] Have **Google Calendar (web)** open in a second tab so you can switch quickly
- [ ] Clean desktop background, close all distracting apps, hide the dock
- [ ] DnD on, close Slack/Telegram so notifications don't pop up
- [ ] URL bar must show **`manicbot.com`** for every shot of the admin app
      (NOT `localhost:3000`, NOT `8788`, NOT `claude.ai`)

### Shot list (total ~78 sec)

| # | Time | Screen | Voiceover (EN) | Demonstrates |
|---|------|--------|----------------|--------------|
| 1 | 0:00–0:05 | `manicbot.com` landing | "ManicBot is a SaaS booking platform for nail salons on Telegram, Instagram, and WhatsApp." | branding |
| 2 | 0:05–0:10 | Click "Войти" → admin login page → enter test salon credentials → land on Dashboard | "Salon owners log into the admin panel at manicbot.com." | branding consistency |
| 3 | 0:10–0:16 | Settings → Plugins → click "Google Calendar" plugin card → opens runtime | "From here they connect their Google Calendar to sync bookings." | feature setup |
| 4 | 0:16–0:22 | Show the DisconnectedState with **the Limited Use disclaimer visible below the "Continue with Google" button**. Hover briefly so the URL preview shows `developers.google.com/terms/api-services-user-data-policy`. Click "Continue with Google". | "We display Google's Limited Use Policy notice in close proximity to the consent grant." | **Limited Use compliance** |
| 5 | 0:22–0:30 | Google account chooser → pick test account → **unverified warning screen** ("Google hasn't verified this app") → click Advanced → "Go to manicbot.com (unsafe)" | (silent — let reviewers see the screen they're about to remove) | OAuth flow |
| 6 | 0:30–0:38 | Consent screen showing **both scopes** ("View and edit events on all your calendars" + "See and download any calendar you can access"). Hover on each line briefly. Click Continue. | "The salon owner sees the exact two scopes we request: edit events and read calendars." | scope transparency |
| 7 | 0:38–0:43 | Redirect back to admin → ConnectedState appears with account email + last sync timestamp + the same Limited Use disclaimer. | "The salon owner is now connected." | success state |
| 8 | 0:43–0:51 | Switch to Calendar (Day view) tab in admin → click empty slot → create manual appointment "Manicure 14:00" for the test client → save | "When a new booking is created in ManicBot..." | `calendar.events` (write) |
| 9 | 0:51–0:58 | Cmd+Tab to Google Calendar web → show the event "Manicure" appeared at the same time | "...the event appears in Google Calendar within seconds." | `calendar.events` (verified) |
| 10 | 0:58–1:04 | Back to admin → drag the appointment to 16:00 → release | "If the customer reschedules..." | `calendar.events` (update) |
| 11 | 1:04–1:09 | Cmd+Tab to Google Calendar → show event now at 16:00 | "...the Google Calendar event updates automatically." | `calendar.events` (verified) |
| 12 | 1:09–1:14 | In Google Calendar create a personal "Lunch" event at 13:00 → Cmd+Tab back to admin Day view → show 13:00 slot is now greyed out / unavailable | "And busy blocks the owner adds in Google Calendar..." | `calendar.readonly` |
| 13 | 1:14–1:18 | Cursor hovers the greyed slot showing tooltip "Unavailable" | "...automatically block bookings from the bots." | `calendar.readonly` (verified) |
| 14 | 1:18–1:22 | Cut to `manicbot.com/privacy` page → scroll to "Section 8. Google API Services User Data" → hold for 2s | "Our use of Google API data complies with the Limited Use Policy. Thank you." | policy compliance |

**Total: 1:22 = 82 seconds. Within Google's preferred 60–90 sec window.**

### Recording rules (Google grep checklist)

- ✅ The OAuth **unverified warning screen** is visible and recorded (do NOT edit it out)
- ✅ The OAuth **consent screen with both scopes** is on camera for at least 4 sec
- ✅ Each scope is shown being USED (events created/updated/deleted; busy block read)
- ✅ URL bar shows **`manicbot.com`** throughout (NOT localhost)
- ✅ App name **ManicBot** is visible on landing + admin nav + privacy page footer
- ✅ The Limited Use disclaimer in the runtime is on camera for at least 1 sec
- ❌ No fast cuts on OAuth screens (reviewers want continuous flow)
- ❌ No personal data of real customers (use seeded test accounts)
- ❌ Don't trim out the unverified warning to "make it look nicer" — Google requires the warning to be in the recording

### Post-recording

1. Trim with QuickTime (Cmd+T) to exactly the shot-list timing
2. Export at **1080p MP4 (H.264)** — keep audio (voiceover)
3. Upload to YouTube → set visibility = **Unlisted** (NOT Private — Google reviewers need URL access without sign-in)
4. Copy the URL → paste into Cloud Console verification form
5. Title hint: `ManicBot — Google Calendar OAuth demonstration (verification submission)`

---

## 3. Reviewer rebuttal templates

`oauth-verification@google.com` typically responds within 5–10 business days with
one of these stock requests. Reply within **48 hours** to keep the review active —
silence beyond 7 days = case auto-closed and you start over.

### Template A. "Provide more detail on scope justification"

> Hello,
>
> Thank you for the review. Below is expanded justification for the requested scope:
>
> **Scope:** `https://www.googleapis.com/auth/calendar.events`
>
> **Specific functionality this scope enables:**
> 1. When a salon client books an appointment through one of ManicBot's chat
>    channels (Telegram / Instagram DM / WhatsApp), the application calls
>    `POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
>    to create a Calendar event whose title is the service name (e.g. "Manicure
>    classic — Anna K.") and whose time range matches the booking duration.
> 2. When the same client uses the bot to reschedule, the application calls
>    `PATCH .../events/{eventId}` to update the event's `start` and `end` fields.
> 3. When the client cancels, the application calls `DELETE .../events/{eventId}`.
>
> **Why this scope and not a broader one:** We deliberately do NOT use
> `https://www.googleapis.com/auth/calendar` because we have no need to read,
> create, or modify events that ManicBot did not itself create. The narrower
> `calendar.events` scope limits our access to exactly the events the salon
> owner expects ManicBot to manage.
>
> **Where users see this in action:** [link to the timestamp in the demo video,
> e.g. https://youtu.be/XYZ?t=43]
>
> Please let me know if any additional detail would help.
>
> Best,
> [Your Name]

### Template B. "Demo video doesn't clearly show usage of scope X"

> Hello,
>
> Thank you for the review. Here are the timestamps in the demo video where
> each requested scope is demonstrated in active use:
>
> | Scope | Demonstration | Timestamp |
> |-------|---------------|-----------|
> | `calendar.events` (create) | A new appointment is created in ManicBot's admin panel; the corresponding event appears in Google Calendar | 0:43–0:58 |
> | `calendar.events` (update) | The appointment is rescheduled by drag-and-drop; the Google Calendar event's time updates | 0:58–1:09 |
> | `calendar.readonly` (read) | A "Lunch" event is added directly in Google Calendar; ManicBot's day view marks that time slot as unavailable | 1:09–1:14 |
>
> If a re-recording with closer captions on each step would help, I am happy to
> shoot a second version.
>
> Best,
> [Your Name]

### Template C. "App name on consent screen does not match app name elsewhere"

> Hello,
>
> Thank you for catching the inconsistency. I have updated [the OAuth Consent
> Screen / the application home page / the favicon and meta tags] so the app
> name is consistently rendered as **ManicBot** (one word, capital M and B,
> no `.com` suffix in the OAuth Console) across:
>
> - OAuth Consent Screen → App name: `ManicBot`
> - Application home page header: `ManicBot`
> - Privacy Policy page header: `ManicBot`
> - Terms of Service page header: `ManicBot`
>
> The supporting commit / deploy is live at https://manicbot.com (please
> re-verify in a fresh incognito window — Cloudflare's edge cache may take up
> to 10 minutes to propagate).
>
> Best,
> [Your Name]

### Template D. "Privacy Policy does not address Google API data handling"

> Hello,
>
> Thank you for the feedback. The Privacy Policy was updated to include a
> dedicated section addressing Google API data handling and Limited Use Policy
> compliance:
>
> **URL:** https://manicbot.com/privacy
> **Section:** "8. Google API Services User Data"
>
> The new section explicitly states:
>
> - ManicBot's use and transfer of information received from Google APIs adheres
>   to the Google API Services User Data Policy, including the Limited Use
>   requirements (with a direct link to
>   https://developers.google.com/terms/api-services-user-data-policy)
> - The specific operations performed (read busy blocks, create/update/delete
>   events for ManicBot-managed appointments)
> - Data is not sold, not used to train AI/ML models, and not used for
>   advertising
> - Only the narrowest scopes are requested: `calendar.events` and
>   `calendar.readonly`
>
> Please confirm this addresses the concern, and let me know if additional
> wording is requested.
>
> Best,
> [Your Name]

### Template E. "Demo video shows the unverified warning but does not proceed past it"

> Hello,
>
> Apologies — the original recording cut off prematurely. The re-recorded
> video continues past the unverified warning through the consent grant and
> demonstrates each scope in active use. The new URL is:
>
> https://youtu.be/[NEW_VIDEO_ID]
>
> Key timestamps:
> - 0:30 Advanced → continue past the unverified warning
> - 0:38 Consent screen with both scopes visible
> - 0:43 Connected state in the admin panel
> - 0:43–1:14 Each scope demonstrated end-to-end (see Template B for the per-scope timestamps)
>
> Please re-review when you have a moment. Happy to record another version if
> any specific clarification is requested.
>
> Best,
> [Your Name]

### Template F. "Domain is not verified in Google Search Console"

> Hello,
>
> I have added `manicbot.com` as a **Domain property** in Google Search Console
> under the same Google account (`manicbot.com@gmail.com`) used for this OAuth
> Console project. Verification was completed via DNS TXT record on Cloudflare;
> Search Console confirms ownership as of [DATE].
>
> Please re-run the brand verification step.
>
> Best,
> [Your Name]

### Template G. Generic stalling response (if you need more than 48h to fix)

> Hello,
>
> Thank you for the feedback. I am working on the requested changes and will
> have an updated submission within the next [N] business days. I will reply
> on this thread when the changes are deployed so the review can resume.
>
> Best,
> [Your Name]

---

## Quick reference: where to find each artifact

| Artifact | Location | Notes |
|----------|----------|-------|
| Scope justifications | This doc, §1 | Paste into Cloud Console → OAuth Consent → Scopes |
| App description | This doc, §1 | Paste into Cloud Console → OAuth Consent → App information |
| Demo video script | This doc, §2 | Use as shot list when recording with QuickTime / OBS |
| Privacy Policy with Google API disclaimer | `manicbot/src/http/legalPagesHttp.js` §8 | Live at https://manicbot.com/privacy |
| In-UI Limited Use disclaimer | `manicbot/admin-app/src/components/plugins/runtimes/GoogleCalendarRuntime.tsx` | Visible in DisconnectedState + ConnectedState |
| Reviewer rebuttal templates | This doc, §3 | Use when replying to `oauth-verification@google.com` |
| OAuth client ID + secret | Worker secrets `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | DO NOT regenerate during review — it invalidates the submission |

---

## Do NOT change these during an active review

Once submitted, leave these untouched until verification approval comes back —
modifying them resets the review to step 1:

- OAuth client ID / secret
- Authorized redirect URIs
- Requested scopes
- App name in OAuth Consent Screen
- Privacy Policy / Terms URL paths

If you spot a bug that requires changing one of these, finish the verification
first (4–8 weeks), then make the fix in a follow-up update — Google has a
separate "scope change" flow for post-approval updates.
