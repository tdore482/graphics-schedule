# Graphics Scheduler

A shared graphics workflow app: admins create designer accounts, the weekly poster rotation keeps running, designers submit finished work with WeTransfer links, admins review it, and reminders go out by email.

## Features

- Email/password accounts with admin and designer roles.
- Weekly rotation across `BT-MGS`, `BT-GDADM`, and `KMZ`, due Thursday with Friday as the final day.
- Submissions with a validated WeTransfer link, optional note, and `pending` / `approved` / `needs changes` status.
- Separate admin console at `/admin` with review, schedule control, people/rotation, events, and account security.
- Admin-only ready marks; designers see read-only progress and submit work but cannot change poster status.
- Admin-editable descriptions on individual schedule cards, visible on the main schedule.
- Admin review queue with a live badge, approval, and reviewer notes.
- Upcoming events managed by admins.
- Automated Monday assignment reminders and Wednesday final-day/pending-review emails.
- Warp-inspired UI: red, white and black palette with dark and light themes, Inter + DM Mono, tight radii, hairline borders.

## Installable app

The site is a PWA: supported browsers show an **Install** button when `beforeinstallprompt` fires, and the manifest plus service worker make it installable from the browser menu. Static assets are cached for offline shell loads; `/api/*` requests are never cached. Bump `CACHE` in `sw.js` when changing static assets so clients refresh.

## Setup

Existing Vercel Blob storage is used. Add these environment variables in Vercel (or `.env.local` for `vercel dev`):

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Existing Vercel Blob token; keep during migration. |
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase service account JSON, or use the three variables below. |
| `FIREBASE_PROJECT_ID` | Firebase project ID when using separate service-account variables. |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email. |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key; escaped newlines are supported. |
| `FIRESTORE_DATABASE_ID` | Optional Firestore database ID; defaults to `(default)`. |
| `FIRESTORE_COLLECTION` | Optional Firestore collection; defaults to `app_state`. |
| `ADMIN_EMAIL` | Email for the first admin account. |
| `ADMIN_PASSWORD` | Initial password for the first admin account. |
| `RESEND_API_KEY` | Resend API key for reminder and review emails. |
| `EMAIL_FROM` | Verified sender, e.g. `Graphics Scheduler <no-reply@yourdomain.com>`. |
| `APP_URL` | Public app URL used in emails. |
| `CRON_SECRET` | Secret used by Vercel Cron to protect `/api/cron`. |

On first load, an admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Open `/admin`, sign in, and change the password from the Account panel. Designers use the main site and never see admin controls.

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

Data lives in separate private Blob JSON files: `auth.json`, `schedule.json`, `submissions.json`, `events.json`, and `mail-state.json`. When Firebase service-account env vars are configured, `lib/store.js` switches to Cloud Firestore and automatically copies any missing Blob state into the `app_state` collection on first request. Keep `BLOB_READ_WRITE_TOKEN` until that migration has completed. All API access goes through `lib/store.js`, so storage backends can change without rewriting the UI or route logic.

## Checks

```bash
npm run check
```
