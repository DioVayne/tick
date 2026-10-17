# Architecture

Tick is a to-do app for one person, running on Cloudflare. This document describes how it is built. Setup steps are in [SETUP.md](SETUP.md).

## Overview
| Part | Choice | Files |
|---|---|---|
| App + API | One Worker (Hono) with static assets and `run_worker_first`, so the files sit behind the login too | `src/index.ts`, `wrangler.jsonc` |
| Storage | D1 (SQLite), schema through `wrangler d1 migrations` | `migrations/` |
| UI | PWA in vanilla JS without a build step (ES modules), mobile first, works offline. SortableJS for drag and drop | `public/` |
| Reminders | Cron every minute: open tasks with `remind_at <= now` and `notified = 0` | `src/push.ts` |
| Notifications | Web push (VAPID, `@pushforge/builder`). Fallback when nothing was delivered after 15 minutes, or when there are no subscriptions: `FALLBACK_WEBHOOK`, a generic webhook | `src/push.ts`, `public/sw.js` |
| Login (person) | Own password page (at most 5 attempts per minute per IP), then a 30-day HMAC session cookie with sliding renewal. A page request without a login goes to `/login?next=<path and query>`, and after logging in you land there again (`safeNext` in `public/next.js` only accepts a path on this site, otherwise `/`). The password is `LOGIN_PASSWORD` until you change it in the app | `src/auth.ts`, `src/login.ts`, `src/password.ts`, `public/login.*`, `public/next.js` |
| Login (Android) | `Authorization: Bearer <key>` with a `full` key the app gets by pairing (or one made in the app, or the old `API_TOKEN`): full access to the task API. A 401 makes the app forget its key | `src/auth.ts`, `src/keys.ts` |
| Login (automations) | `Authorization: Bearer <key>` with an `inbox` key (or the old `INBOX_TOKEN`): only `POST /api/inbox`, and the inbox only accepts this kind | `src/auth.ts`, `src/keys.ts` |
| Settings page | ⚙ Settings in the PWA: display, language and time, notifications, devices, account, data, advanced (keys, default language, webhook) | `public/settingsview.js`, `src/settings-api.ts` |
| Android | Widget with the task list, completing with 3 seconds to undo, quick add, share target. Geofences and notifications for location reminders. The PWA runs inside the app as a Trusted Web Activity (see "In the app (TWA)") | `android/`, `public/androidapp.js` |
| Map | Leaflet 1.9.4, self-hosted in `public/`; OSM tiles; address search through a Nominatim proxy in the Worker | `public/map.js`, `public/places.js`, `src/index.ts` |
| Language | English and Dutch, chosen per device; one shared dictionary | `public/i18n.js` |

## Settings
After the install, you change settings in the app (⚙ Settings in the sidebar). `wrangler.jsonc` (your own copy of `wrangler.example.jsonc`, not in git) and secrets hold the starting values and what only belongs to the install.

**Per installation** (in D1 `settings`, so every device and the server share it). Precedence: a row in `settings` → the config → the built-in default. The config is therefore the starting value; what you choose in the app wins, and a deleted row makes the config count again. An invalid value in a row is ignored.

| Setting | `settings` key | Config fallback | Built-in |
|---|---|---|---|
| Time zone (IANA; the server refuses an unknown zone with a 400) | `timezone` | `TIMEZONE` | `UTC` |
| Time for a reminder without a time | `reminder_time` | | `09:00` |
| Week starts on | `week_start` (`mon`, `sun`) | | Monday |
| Default language: fallback webhook, subscriptions without a language, last resort of "Automatic" | `default_locale` | `LOCALE` | `en` |
| Fallback webhook (`https://` only; an empty row = off, also when the secret is set) | `fallback_webhook` | `FALLBACK_WEBHOOK` | none |

Changing the time zone in the app keeps the wall-clock time: open tasks get the same local date and time in the new zone for `remind_at`, `repeat_start` and `repeat_at` (written in one batch; `repeat_prev` is cleared). Completed tasks are not touched.

**Per device** (in the browser, so not shared): theme (`tick.theme`: automatic, light, dark), text size (`tick.font`: `s`, `m`, `l`, `xl`), spacing between tasks (`tick.density`: compact, normal, roomy) and language (`tick.lang`, also in the cookie `tick_lang`). `public/theme.js` sits in `<head>` (also on the login page) and puts the first three on `<html>` as data attributes before the first paint, so nothing flashes. Notifications also belong to a browser (a push subscription).

**Only in the config** (install-level, not in the app): `ADMIN_CONTACT` (`mailto:` contact for push services and Nominatim), `VAPID_PUBLIC_KEY` (var), `VAPID_PRIVATE_KEY` and `SESSION_SECRET` (secrets), `ANDROID_PACKAGE` (var, optional: applicationId of your own Android build, so the PWA can wake it after a location change), `ANDROID_CERT_SHA256` (var, optional: SHA-256 fingerprint(s) of your signing key, comma-separated; with `ANDROID_PACKAGE` it makes `/.well-known/assetlinks.json` link the app to this domain), `DEV_AUTH_BYPASS`.

**Still read from the config, now optional:** `LOGIN_PASSWORD` (until you set a password in the app, and for the emergency route), `API_TOKEN` and `INBOX_TOKEN` (old keys that keep working until you switch them off in the app).

`loadPrefs` (`src/prefs.ts`) reads all of this with one query per request and per cron run. The PWA gets the values from `/config.js`, a module the Worker generates: `locale` (the language of this device), `defaultLocale`, `timeZone`, `reminderTime`, `weekStart` and `androidPackage`. `public/settings.js` imports it first, so language and time zone are set before the other modules load. The service worker caches it with the shell, so offline use keeps the right language and zone; another device picks up a change on its next start.

## Data model (D1)
- `tasks`: id, `user_id` (the owner; `push_subscriptions`, `api_keys` and `pair_codes` have a `user_id` too, default the admin's id), title (max. 500 characters), description (max. 10,000, markdown), list (max. 100 characters: `POST`/`PATCH /api/tasks` refuse more with a 400, `POST /api/inbox` truncates so an automated task is never lost), parent_id (one level of subtasks; a subtask follows the list and completion of its parent), position (fractional index, low = on top; the server redistributes a group as soon as two neighbours are less than 1e-6 apart), remind_at (UTC), notified, `repeat_rule`, `repeat_start`, `repeat_at`, `repeat_prev` (see "Repeating reminders"), done, done_at, source (`app` | `api` | `import`), created_at, updated_at.
- Place on the task: `loc_name` (max. 100 characters), `loc_lat`, `loc_lng`, `loc_radius` (whole number, 100 to 2000 m), `loc_trigger` (`enter` | `exit`) and `loc_notified` (already notified, like `notified`). The five place fields are set or empty together; every change resets `loc_notified` to 0.
- `places`: favourite places (id, `user_id`, name unique per account and case-insensitive (`UNIQUE (user_id, name)`), lat, lng, radius, created_at, updated_at). A favourite is a template: a task gets a copy, so editing or deleting it does not move existing tasks. The trigger belongs to the task.
- `push_subscriptions`: endpoint, p256dh, auth, user_agent, created_at, `locale` (`en` | `nl`; the PWA sends its language when subscribing and on every language change, and every notification goes out in the language of its subscription. No value means the default language).
- `api_keys`: keys made in the app: id, name, kind (`full` | `inbox`), `hash` (SHA-256 hex of the key; the key itself is never stored), `hint` (last 4 characters, to recognise it), created_at, last_used_at (updated at most once an hour).
- `pair_codes`: one-time codes for linking the Android app: id, `hash` (SHA-256 hex of the code; the code itself is never stored), expires_at (2 minutes after creating), used_at. Expired and used rows are removed when the next code is requested.
- `devices`: what an Android phone reports about itself, one row per key (`key_id` is the `api_keys` id, or `env-api` for the old `API_TOKEN`): name, notifications (0/1), location (`always` | `foreground` | `off`), app_version, seen_at. Deleting a key deletes its row.
- `users`: id, name, `email` (unique, case-insensitive, may be empty), `password_hash`, `role` (`admin` | `member`), `session_version`, created_at, last_seen. The migration makes one admin with the fixed id `00000000-0000-4000-8000-000000000001` (name `Tick`, no email) from the old `settings` rows `password_hash` and `session_version`; a fresh install has the same row.
- `user_settings`: user_id, key, value; the per-person settings `timezone`, `reminder_time`, `week_start` and `fallback_webhook`. The migration copies them from `settings` for the admin; the old `settings` rows stay until a later migration removes them and are no longer read.
- `account_links`: invitation and reset links: id, `hash` (SHA-256 hex of the code; the code itself is never stored), `kind` (`invite` | `reset`), user_id, created_by, expires_at, used_at.
- `settings`: key, value. Keys: `session_version`, `password_hash`, `timezone`, `reminder_time`, `week_start`, `default_locale`, `fallback_webhook`, `env_api_token_off` and `env_inbox_token_off` (the switches for the old secrets), `env_api_token_used` and `env_inbox_token_used` (when they were last used).

Until the accounts feature is wired in, the Worker still works for the admin only: code that leaves out `user_id` gets the default. There is no separate `due_at`: the reminder is also the deadline.

## Times
Always stored in UTC. A time without a zone counts as the time zone setting, a bare date as the reminder time (09:00 by default) in that zone (`src/time.ts`). The web app and Android already send UTC. Zone and reminder time come from the settings (D1, then `TIMEZONE`, then the built-in default), see "Settings".

## API
| Route | Purpose |
|---|---|
| `GET /.well-known/assetlinks.json` | Digital Asset Links, without login: the `handle_all_urls` statement for `ANDROID_PACKAGE` and the fingerprints in `ANDROID_CERT_SHA256`; `[]` when either is missing or no fingerprint is valid |
| `GET /api/tasks` | Open tasks in order. `?done=1&limit=&offset=` for completed tasks. `?q=` searches title and description (max. 200 characters) |
| `POST /api/tasks` | Create a task, optionally with `repeat`. Optional `id` (UUID from the client); an existing id returns the existing task (200), so resending is safe |
| `PATCH /api/tasks/:id` | Change fields, including `position` (drag) and `done`. `repeat` (RRULE or `null`); `occurrence` (ISO) next to `done`: the server only moves on or restores when it equals `repeat_at` |
| `DELETE /api/tasks/:id` | Delete, including subtasks |
| `POST /api/tasks/:id/done`, `/reopen` | Complete and undo (Android), like PATCH `done` including subtasks. `/done` moves a repeating task on (it stays open); `/reopen` undoes the last step, within 15 minutes |
| `POST /api/tasks/:id/snooze` | Move the reminder, 60 minutes by default, limited to 1 minute up to 30 days. For a repeating task only this occurrence |
| `location` in `GET`/`POST`/`PATCH /api/tasks` | Object `{name, lat, lng, radius, trigger}` or `null` (clear). Invalid or incomplete gives a 400 |
| `location_notified` in `PATCH /api/tasks/:id` | Boolean; Android sets it to `true` after a notification. A place change in the same PATCH sets it back to `false` |
| `GET`/`POST /api/places`, `PATCH`/`DELETE /api/places/:id` | Favourite places. A duplicate name gives a 409 |
| `GET /api/geocode?q=` | Address search through Nominatim (2 to 200 characters, max. 5 results `{name, lat, lng}`). 429 on too many searches, 502 when Nominatim does not answer |
| `GET /api/lists` | `[{ name, open }]`: every list name on a task (open or done) with the number of open tasks, subtasks included. Inbox is always there |
| `POST /api/lists/rename` | `{ from, to }`: moves all tasks with `list = from` to `to`; an existing `to` merges. Empty, longer than 100 characters or `from = Inbox` gives a 400. Answer `{ moved }` |
| `POST /api/lists/delete` | `{ name, tasks: 'inbox' \| 'delete' }`: tasks to Inbox or deleted (including subtasks and completed ones). Answer `{ moved }` or `{ deleted }` |
| `POST /api/inbox` | Input from automations: `title`, `notes`, `due` (a bare date becomes 09:00), `list` and `repeat`. The Dutch fields `titel`, `omschrijving`, `datum` also work |
| `POST`/`DELETE /api/push/subscribe`, `POST /api/push/test`, `GET /api/config` | Web push. `subscribe` takes the language of the browser (`locale`) |
| `GET /config.js` | Settings for the PWA as a module (see "Settings") |
| `GET`/`PATCH /api/settings` | Installation settings: `timeZone`, `reminderTime`, `weekStart`, `defaultLocale`, `fallbackWebhook`. The answer also has `fallbackFromEnv` (the `FALLBACK_WEBHOOK` secret applies), `fallbackOverride` (a `fallback_webhook` row exists, also `''` = off) and `fallbackEnvSet` (the secret is set); the secret URL itself is never returned (`fallbackWebhook` is then `null`). `PATCH` takes any subset; an invalid value gives a 400; `fallbackWebhook: ''` switches it off (also over the secret), `null` deletes the row, so `FALLBACK_WEBHOOK` counts again. A new `timeZone` also rewrites open tasks, in the same batch as the setting (see "Settings") |
| `POST /api/settings/webhook-test` | Sends an example notification to the fallback webhook (400 when there is none) |
| `GET`/`POST /api/keys`, `DELETE /api/keys/:id` | Keys. `POST {name, kind}` (name up to 60 characters, kind `full` or `inbox`) answers with the key once. `DELETE` revokes at once and removes the phone's status. `GET` also lists the old secrets in `env` (only those that are set) |
| `POST /api/pair`, `GET /api/pair/:id` | Session only. `POST` makes a one-time pairing code (valid 2 minutes) and answers `{id, code, expires_at}`; `GET` answers `{used}` (404 for an unknown id) so the PWA can see that the app picked it up |
| `POST /api/pair/redeem` | No login. `{code, name?}` (name up to 60 characters, default `Android`) trades a valid code for a `full` key, once: `201 {key}`, or 400 `err.invalid_pair_code`. Limited per IP (429) |
| `PATCH /api/keys/env-api`, `/env-inbox` | `{off: true \| false}`: switches an old secret off or on |
| `POST /api/account/password` | `{current, next}` (at least 8 characters). A wrong current password gives a **403**, not a 401, because the app sends a 401 to `/login`. Goes through `LOGIN_LIMITER`. Logs out the other sessions; this device gets a fresh cookie |
| `POST /api/account/logout-others` | Raises `session_version`; this device gets a fresh cookie and stays logged in. Keys keep working |
| `GET /api/devices` | Browsers with a push subscription and phones (every `full` key, plus `API_TOKEN` when it is on) with their last reported status |
| `POST /api/device` | The Android app reports `{name, notifications, location, app_version}`. Only with a full key (or the `API_TOKEN` secret); the status belongs to that key |
| `GET /api/export` | Backup as `tick-backup-YYYY-MM-DD.json`: `{app: "tick", version: 1, exported_at, tasks, places}`, raw rows with all columns, completed tasks included. No settings, password, keys or webhook |
| `POST /api/import/backup` | Restores a backup file by **merging on id**: tasks and places from the file overwrite those with the same id and deleted ones come back; nothing is deleted. A place whose name belongs to another id is skipped. Answer `{tasks, places, skipped}`. An invalid file (or another `app`/`version`) gives a 400 and writes nothing |
| `POST /api/import/ticktick` | Body is the CSV text of a TickTick backup (up to 10 MB). Ids are `tt<taskId>`; existing ids are skipped (`INSERT OR IGNORE`), so re-importing keeps your changes. Answer `{added, existing, skipped}` |
| `GET`/`POST /login`, `POST /logout` | Log in (429 on too many attempts) and log out |

Errors are `{ error }` with a 4xx status, in the language of the installation. Everything else is a 500 that is logged.

## Security
- **Sessions:** the cookie is `exp.version.hmac`. The version must equal `session_version` in `settings`; raising it logs out every session. A cookie lives 30 days; with less than 15 days left the response carries a fresh one (sliding renewal). "Log out on other devices" raises the version and gives this device a fresh cookie.
- **Password:** stored as PBKDF2-SHA-256 with a salt in `settings.password_hash` (100,000 iterations, the maximum in Workers). When that row exists only it counts; otherwise `LOGIN_PASSWORD`. Without either nobody can log in. **Emergency route** when you forgot the password: delete the row, and `LOGIN_PASSWORD` counts again (command in [SETUP.md](SETUP.md)).
- **Keys:** `tick_` plus 32 random bytes as base64url, shown once. Only the SHA-256 is stored; a fast hash is enough for a random 256-bit value. `authorize()` looks in `api_keys` first (only for bearers starting with `tick_`), then at the old `API_TOKEN` and `INBOX_TOKEN` unless they are switched off in the app. A secret cannot be deleted from the app; `npx wrangler secret delete API_TOKEN` removes it for good. Revoking a key deletes the row and works at once.
- **Session only:** all `/api/settings`, `/api/keys`, `/api/account`, `/api/devices`, `/api/export` and `/api/import` routes need a session (or the local dev bypass). A bearer key, even a `full` one, gets a 403, so a leaked phone or automation key cannot change the password, make keys or redirect the webhook. The one exception is `POST /api/device`, which only accepts a full key (or the `API_TOKEN` secret).
- **Rate limit:** `POST /login` first goes through the Workers Rate Limiting binding `LOGIN_LIMITER` (5 per 60 seconds, key `cf-connecting-ip`). It counts per Cloudflare location rather than globally, which is plenty against brute force on one password. A wrong attempt also waits 1.5 seconds.
- **Headers:** a middleware sets `Content-Security-Policy` (`default-src 'self'`, no inline scripts or styles), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and a restrictive `Permissions-Policy` on every response. `img-src` also allows `https://tile.openstreetmap.org` for the map; `geolocation=(self)` is for the "my location" button.
- **Geocode limit:** `GET /api/geocode` goes through `GEOCODE_LIMITER` (10 per 60 seconds, one shared key). The Worker sends its own `User-Agent` with your URL and `ADMIN_CONTACT`, as Nominatim's usage policy asks. The app only searches on Enter.
- **`DEV_AUTH_BYPASS`** only works on `localhost` and `127.0.0.1`.
- Without `SESSION_SECRET`, or without any password (none set in the app and no `LOGIN_PASSWORD`), nobody can log in (fail closed).

## Language
`public/i18n.js` holds every visible text in `en` and `nl` (a test checks both have the same keys). The Worker translates error messages in `onError`: an `HttpError` carries a key and variables, not text. The shell (`/`) is translated on the server with `HTMLRewriter` (`data-i18n` and `data-i18n-attr` attributes), so the service worker caches the translated page; the Worker drops the ETag of the untranslated file so a browser never gets a stale 304. The manifest is adjusted the same way. Notification buttons come translated in the push payload, because the service worker does not know the language.

The language is chosen **per device**: Automatic (the first of `navigator.languages` that is `en` or `nl`), English or Dutch. The PWA keeps the choice in `localStorage` and in the cookie `tick_lang` (`en` | `nl`; no cookie = automatic), so the server uses the same language for the shell, `/config.js`, the manifest, error messages and the login page. Server order: cookie, then `Accept-Language`, then the default language of the installation (see "Settings"). Push notifications are made by the server without a browser, so each subscription stores its `locale`; the fallback webhook uses the default language.

## Offline (web)
- **Modules** in `public/`: `db.js` (IndexedDB: local copy and outbox), `api.js` (fetch), `store.js` (state, changes, sync, all list logic), `render.js` (task list), `sidebar.js` (sidebar and drawer), `detail.js` (detail panel and task screen), `editor.js` (markdown editor), `markdown.js` (renderer), `lists.js` (list names), `listpicker.js`, `listmenu.js`, `dialog.js`, `push.js`, `repeat.js` (repeat engine), `repeatpicker.js`, `i18n.js`, `settings.js` (config and language), `theme.js` (display preferences, loaded in `<head>`), `settingsview.js` (the settings page) and `app.js` (start and events). Map: `map.js` and `places.js`.
- **App shell:** `sw.js` caches the page, all modules (the `SHELL` list, `settingsview.js`, `theme.js`, `androidapp.js`, `applink.js` and `swclick.js` included; when you change it, bump `CACHE`), the CSS, SortableJS, Leaflet, the manifest and the icons. Network first with a 4-second timeout: online you always get the newest version, so old and new modules never mix after a deploy; offline you get the last saved one. Only `res.ok && !res.redirected` goes into the cache, so never a redirect to `/login`. `/api/*` and the login do not go through the cache.
- **Local data:** after every successful `GET /api/tasks` the list is stored in IndexedDB. On start the app shows that copy first and then refreshes from the network.
- **Outbox:** every change is applied locally at once, put in the outbox and sent to the server in order. When that fails it waits; replay happens on `online`, on `visibilitychange`, on start and after every new change. Snoozing becomes a `PATCH remind_at` with an absolute time. A 404 during replay drops the change silently, another 4xx drops it with a message, a 5xx or 401 keeps waiting. Conflicts: last write wins per field.
- **Settings page offline:** it opens offline. The per-device parts (display, language, notifications) work as usual; the per-installation parts show the last known value, disabled, with "Can only be changed while online".
- **Client IDs:** new tasks get their id from the client (`crypto.randomUUID()`), so tasks and subtasks created offline can refer to each other.

## Layout
| | Desktop (from 1024px) | Mobile (below) |
|---|---|---|
| Lists | Fixed sidebar on the left: All, Inbox, other lists with open counts, New list, Completed; at the bottom only ⚙ Settings | ☰ opens a drawer with the same content |
| Settings | One long page in the middle column (where the task list is), a view of its own with `history.pushState` | One column; Android's back button closes it |
| Tasks | Middle, with search, input and drag to sort | One column |
| Task | Detail panel on the right with a resize handle (380px by default, 300 to 700px, kept in `localStorage`) | Full-screen task screen with "‹ list"; Android's back button works through `history.pushState`/`popstate` |

Title and description are saved 800 ms after the last keystroke and right away on blur, task switch, close and `visibilitychange`; everything else at once. `?task=<id>` (from a notification) opens the task.

## Markdown
The description is markdown, rendered by `markdown.js`, a line-by-line parser. Supported: headings `#` to `###`, paragraphs, bold, italics, strikethrough, inline code and code blocks, bullet and numbered lists (one level of nesting), checklists `- [ ]`/`- [x]` (clickable in the read view), quotes, links and bare `https://` addresses, and `---`. Not: tables, images and HTML (shown as text). Only DOM nodes through `textContent`, never `innerHTML`; links only with `http:`, `https:` and `mailto:`.

## Lists
A list is only the `list` column of tasks; there is no list table. **Inbox** is always on top after All and cannot be renamed or deleted. A new list only exists in the session until it contains a task. The list menu (right-click, "⋯", long press on mobile) offers Rename, Merge with… and Delete…; a name that already exists asks to merge. On desktop you can drag a task onto a list in the sidebar.

## Repeating reminders
A top-level task with a reminder can repeat daily, weekly, monthly or yearly. Completing it moves the same task on to the next occurrence.
- **Storage:** `repeat_rule` (an RRULE subset: `FREQ`, `INTERVAL` 1-99, `BYDAY` (with a rank for months, e.g. `3SU`/`-1SU`), `BYMONTHDAY`), `repeat_start` (time of day and phase of "every 2 weeks"), `repeat_at` (the occurrence the task is on now) and `repeat_prev` (internal JSON for undo). The API shows `repeat: {rule, start, at}` or `null`.
- **Completing** moves on to the first occurrence after both now and `repeat_at` (missed ones lapse; subtasks reopen). The PWA sends `occurrence`, so a repeated request from the outbox does nothing. **Undo** within 15 minutes restores the last step.
- **This time only:** snoozing or another date in the picker only moves `remind_at`. Clearing the reminder or making the task a subtask removes the rule.
- **Time:** all calculations use the wall clock of `TIMEZONE`, so 10:00 stays 10:00 across daylight saving changes. "On the 31st" falls on the last day of a short month.

## Settings page
⚙ Settings opens one page of blocks: **Display** (theme, text size, spacing, with an example task that changes along), **Language and time** (language of this device, time zone with a "use this device's" button, reminder time, week starts on), **Notifications** (switch for this device, test notification, the iPhone home-screen hint), **Devices** (this browser, other browsers with notifications, Android phones, and "connect an Android phone"), **Account** (change password, log out on other devices, log out), **Data** (download backup, restore backup, import from TickTick) and **Advanced** (collapsed: keys, default language, fallback webhook). Notifications, Theme and Log out used to be in the sidebar and moved here.
- **Devices:** per phone the name, last seen, whether notifications work and whether location is "always", "only while using" or off, with a hint how to fix a problem. The Android app (version 1.2) sends this to `POST /api/device` after a sync, only when it changed or the last report is over 6 hours old. A phone on an older app (and an automation with a `full` key) shows only "last seen" (from the key) and the note that status needs app 1.2 or newer. Connecting a phone makes a `full` key with a name and shows it once with three short steps.
- **Backup:** `GET /api/export` downloads a file (a `Blob`, no inline code). Restoring shows what is in it before it merges (see the API table). Settings are not part of a backup: restoring them could silently change the time zone. The TickTick import and the script `scripts/import-ticktick.mjs` share one parser, `public/ticktick.js`; the app uploads the CSV and the Worker reads it.
- **Large files** go into D1 in batches, so a backup of thousands of tasks works.

## Search
Open tasks are filtered in the browser (title and description, case-insensitive); a matching subtask shows its parent. Completed tasks are searched on the server (`LIKE`, with `%` and `_` literal). `/` focuses the search field, Escape clears it.

## Location reminders (Android)
A task can have a place where Android alerts you: one notification on arrival (default) or on leaving.
- **PWA:** the Location pill opens a full-screen map: search, a pin in the middle, "my location", radius 100 m to 2 km (500 m by default), arrival or leaving, a name and favourites. Leaflet loads on first use; tiles are not cached.
- **Android:** after every successful refresh the app registers geofences for open tasks with a place that has not fired yet (at most 100, Android's limit), only when the set changed. On a geofence event it checks the task with the server (falling back to its cache), shows "📍 Arrived at X" or "📍 Left X" with a Complete action, and sends `PATCH location_notified = true`. The decision logic is plain Java with JUnit tests (`NotifyDecision`, `GeoPlan`).
- **From the PWA to the phone:** after a place change the PWA opens an intent link `tick://sync?...` (only with `ANDROID_PACKAGE` set), so the app syncs within about a minute. A place set on a laptop arrives through a periodic job, within about 15 minutes.

## In the app (TWA)
The Android app opens the PWA at `/?app=android` (plus `&pair=1` while it has no API key). `initAndroidApp` in `public/androidapp.js` remembers the app in `sessionStorage` (`tick.app`) and removes both parameters from the address bar. With `pair=1` and `ANDROID_PACKAGE` set it calls `POST /api/pair` and hands the one-time code to the app through an intent link (`intent://pair?code=…`, built in `public/applink.js`, which has no imports so the tests can load it). It polls `GET /api/pair/:id` every second; after 3 seconds without `used` it shows a bar with an "Open the Tick app" button, and after 2 minutes the code expires. Once the code is used it switches on web push (errors are swallowed; the switch in Settings is the fallback). When the app and another Android browser both have push on, a hint offers Settings › Devices (once, `tick.dupHint` in `localStorage`). Settings › Devices gets a "Phone settings" button (`intent://settings…`) in the app. A tap on a notification is decided by `public/swclick.js` (a classic script that `sw.js` loads with `importScripts`): no window open gives `/?task=<id>`, an open window gets `postMessage({ type: 'open-task', id })`, which `app.js` handles like `?task=`.

On the phone: `PairActivity` (transparent) handles `tick://pair?code=…` (`PairLink` reads the code), trades it on a background thread through `POST /api/pair/redeem` (no `Authorization`, name `Build.MODEL`), stores the key, syncs, reports the device status, asks for notification permission on Android 13+ and closes, so the TWA is back. On failure it shows a toast and the PWA's own button remains. `MainActivity` is "Tick on this phone" (`tick://settings`, and the "Phone settings" shortcut next to "New task"): link status with an "Open Tick" button, location notifications, widget settings, and the key field collapsed under "Advanced". Taps on a widget task or a location notification go through `WidgetClickActivity` to `Launch.task`, which opens `/?app=android&task=<id>` in the TWA (Browser Helper accepts an intent URL with the same https origin as `DEFAULT_URL`). A 401 on any API call means the key was revoked: `Api.call` clears it and the widget shows "not linked", so the next start pairs again; 403 and 5xx keep the key.

## Tests
Vitest with `@cloudflare/vitest-plugin`: the tests run in the Workers runtime against a local D1 with the same migrations as production (`test/`). They use your `wrangler.jsonc` when it exists and `wrangler.example.jsonc` otherwise; the bindings in `vitest.config.ts` fix `LOCALE` (`en`), `TIMEZONE` (`Europe/Amsterdam`) and the test secrets. Android has JUnit tests for the geofence logic, start URLs, pair links and when to forget the key. CI (`.github/workflows/ci.yml`) runs typecheck and tests on every push and pull request.

## Known limitations
- iPhone push only works when the PWA is on the home screen; `FALLBACK_WEBHOOK` can cover that.
- The cron runs every minute, so reminders can be up to a minute late.
- Offline only works after the app has been opened once online and logged in.
- Location notifications only work on Android. Android reports geofences with a delay; at 80 km/h a small circle is crossed in seconds, hence the 500 m default.
- The map only works online.
- No initial trigger: if you are already at the place when you set it, the arrival notification only comes next time.
- Repeating reminders have no end date or maximum count.
- Quick add in the Android app keeps its own 09:00 for a date without a time; it does not follow the reminder time setting.
- Another device keeps calculating in the old time zone or reminder time until it starts again (the server stays leading when it completes a repeating task).
- A phone on an Android app older than 1.2 does not report its notification and location status; the Devices block shows only "last seen".
- The old secrets (`API_TOKEN`, `INBOX_TOKEN`) can be switched off in the app but only removed with `wrangler secret delete`.
