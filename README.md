# Graphics Scheduler

A shared graphics workflow app: admins create designer accounts, the weekly poster rotation keeps running, designers submit finished work with WeTransfer links, admins review it, and reminders go out by email.

## Features

- Email/password accounts with admin and designer roles.
- Weekly rotation across `BT-MGS`, `BT-GDADM`, and `KMZ`, due Thursday with Friday as the final day.
- Submissions with a validated WeTransfer link, optional note, and `pending` / `approved` / `needs changes` status.
- Admin review queue with a live badge, approval, and reviewer notes.
- Upcoming events managed by admins.
- Automated Monday assignment reminders and Wednesday final-day/pending-review emails.
- Warp-inspired UI: warm dark canvas by default, warm light theme toggle, Inter + DM Mono, tight radii, hairline borders.

## Installable app

The site is a PWA: supported browsers show an **Install** button when `beforeinstallprompt` fires, and the manifest plus service worker make it installable from the browser menu. Static assets are cached for offline shell loads; `/api/*` requests are never cached. Bump `CACHE` in `sw.js` when changing static assets so clients refresh.

## Setup

Existing Vercel Blob storage is used. Add these environment variables in Vercel (or `.env.local` for `vercel dev`):

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Existing Vercel Blob token. |
| `ADMIN_EMAIL` | Email for the first admin account. |
| `ADMIN_PASSWORD` | Initial password for the first admin account. |
| `RESEND_API_KEY` | Resend API key for reminder and review emails. |
| `EMAIL_FROM` | Verified sender, e.g. `Graphics Scheduler <no-reply@yourdomain.com>`. |
| `APP_URL` | Public app URL used in emails. |
| `CRON_SECRET` | Secret used by Vercel Cron to protect `/api/cron`. |

On first load, an admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Sign in and change the password from the Admin page.

## Local development

```bash
npm install
npx vercel dev
```

Then open `http://localhost:3000`. Without a deployment, the API routes still require Blob access; the old browser-local fallback was removed because accounts and reviews must be shared.

## Reminders

`vercel.json` runs `/api/cron` daily at 08:00 UTC. The handler checks the weekday:

- Monday: emails each designer their assigned posters for that week.
- Wednesday: emails designers with missing submissions and sends admins a digest of posters waiting for review.

Vercel passes `Authorization: Bearer $CRON_SECRET`. The route also accepts `?secret=` for manual testing.

## Storage

Data lives in separate private Blob JSON files: `auth.json`, `schedule.json`, `submissions.json`, `events.json`, and `mail-state.json`. All API access goes through `lib/store.js`, so a future move to Supabase/Postgres can replace that adapter without rewriting the UI or route logic.

## Checks

```bash
npm run check
```
