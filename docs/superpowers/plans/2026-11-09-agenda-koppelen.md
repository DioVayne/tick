# Calendar feeds (ICS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link secret iCal (ICS) URLs so the planner suggests free moments around busy blocks, plus an "Add to calendar" step per task.

**Architecture:** `src/ics.ts` parses only the 14-day window (reusing `public/repeat.js` for RRULE/zone maths); `src/calendar.ts` stores feeds (URL AES-GCM encrypted with a key derived from `SESSION_SECRET` via HKDF), refreshes them (cron every 5 minutes for feeds older than 1 hour, and on app open for feeds older than 15 minutes) and serves the busy blocks. On the client, `public/agenda.js` caches the blocks and feeds `public/planner.js` (source `calendar`), the when menu, the Tickmanager and the calendar page. `public/ics.js` builds the Google link and the .ics file for one task (served at `GET /api/tasks/:id/calendar.ics`).

**Tech Stack:** Cloudflare Worker (Hono), D1, vanilla JS PWA, Vitest (workers pool).

**Spec:** owner's brief of 2026-11-09 (in the session that produced this plan).

## Global Constraints
- Migration `0024_agenda.sql`; never edit older ones.
- Store per event only title, start, end, all-day. Never DESCRIPTION, ATTENDEE, LOCATION. Window now → +14 days, replaced on each fetch.
- The URL is never returned by the API and never logged.
- `CALENDAR_FEEDS`: anything but `"false"` = on; `"true"` in `wrangler.example.jsonc`; `"false"` in the app.ticktodo.nl config.
- Every text in `public/i18n.js` (en + nl); errors as `HttpError(status, key)`.
- New PWA modules (`agenda.js`, `ics.js`) go into `SHELL` in `sw.js`, and `CACHE` is bumped.
- Free slots: 30 minutes, 08:00–22:00 local, evenings and weekends included; all-day events don't block.

## Review Focus
- An Outlook feed with Windows TZIDs ("W. Europe Standard Time"): it maps to IANA, not to UTC.
- An RRULE with COUNT, BYSETPOS or a UNTIL with a time: it is translated or skipped, and never crashes the feed.
- A huge feed (years of history): early cut-off outside the window and at most 500 events stored.
- An unreachable URL / HTML instead of ICS: status error with a code, and the old events stay.
- A feed that is deleted while a refresh is running: no stray events left behind (the delete runs in the same batch and the insert checks that the feed exists).

### Task 1: ICS parser (`src/ics.ts`, `test/ics.test.ts`)
`parseIcs(text, { from, to, zone, max? }): CalEvent[]` with `CalEvent = { title, start, end, allDay }` (ms). Tests: single event, UTC/TZID/floating, all-day, weekly RRULE, EXDATE, RECURRENCE-ID (moved + cancelled), COUNT, Windows TZID, folded lines and escapes, outside the window, TRANSPARENT/CANCELLED skipped, an unknown RRULE skipped.

### Task 2: Storage + API + cron (`migrations/0024_agenda.sql`, `src/calendar.ts`, `test/agenda.test.ts`)
Tables `calendar_feeds(id, user_id, name, url_enc, url_hash, host, created_at, fetched_at, status, error, events)` and `calendar_events(feed_id, user_id, title, start_at, end_at, all_day)`. Routes under `/api/calendar` (session only, 404 when the flag is off): `GET/POST /feeds`, `DELETE /feeds/:id`, `POST /refresh`, `GET /events`. Tests: the URL is never in any answer or in D1 in plain text, an invalid URL gives 400, max 10 feeds, unlinking removes the events, deleting the account removes everything, the flag off gives 404, the cron step refreshes old feeds (fetch mocked).

### Task 3: Planner + UI
`planner.js`: `freeSlots(busy, now, n)`, `busyAt(ms, busy)`, and `suggest` with `ctx.busy` (or `setBusySource`). Tests in `test/planner.test.ts`: an evening slot and a weekend slot, skipping a busy block, a fixed slot carries `busy`. UI: `agenda.js`, the when menu, the Tickmanager, calendarview, the settings block, the Add to calendar step + `public/ics.js` (tests in `test/ics-taak.test.ts`).

### Task 4: Docs, privacy, config, verification
`docs/calendar.md` + its row in `docs/README.md`, `docs/privacy.md`, `privacyPage` (calendar section when on), ARCHITECTURE.md, SETUP.md, wrangler.example.jsonc, `Env`. Typecheck, tests, browser at desktop and 375px with a local fixture ICS server.
