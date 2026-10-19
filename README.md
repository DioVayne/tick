<p align="center">
  <img src="docs/logo.svg" width="112" alt="The Tick icon: a yellow map pin with a check mark on slate blue">
</p>

<h1 align="center">Tick</h1>

<p align="center">
  <b>The to-do list that knows where you are.</b><br>
  Your shopping list pops up as you walk into the supermarket.<br>
  The screws, the moment you park at the hardware store. The parcel, as you step out the door.
</p>

<p align="center">
  📍 Reminders by place <i>and</i> time · 💸 No subscription · 🔒 Your own server · ✈️ Works offline
</p>

<p align="center">
  <img src="docs/screenshots/location.png" width="300" alt="The location picker on a phone: a map of Amsterdam with the chosen place and its radius, two favorite places, a radius slider, and the choice between on arrival and on leaving">
</p>

## Why Tick?

Most reminders go off at a time. But "buy oat milk" isn't about 17:30, it's about the supermarket. Remind yourself at 17:30 and you're still at your desk; at 18:10 you walk past the shop and forget.

Tick reminds you **where it matters**:

- **📍 On arrival or on leaving.** Pin a place on the map, set the radius, done. *Arriving* at the hardware store: the screws. *Leaving* home: the parcel, the keys for your neighbour.
- **⭐ Favorite places.** Supermarket, work, the gym: one tap and a task has its spot.
- **🔔 Time and place together.** A task can have both, so nothing slips through.
- **🔒 Nobody tracks you.** Your phone watches the places itself and only tells Tick that a reminder went off. There is no log of where you have been, and it all runs on your own Cloudflare account, not on someone else's servers.
- **💸 Free.** It runs on Cloudflare's free plan. No subscription, no ads, no account with a company that might shut down or raise its prices.

And it's a complete to-do app on top of that: lists, subtasks, repeating reminders, a calendar, sharing with your household, a home-screen widget and offline support.

> **Good to know:** place reminders need the **Android app**. Download the APK from [Releases](https://github.com/DioVayne/tick/releases/latest) on your phone, open it and type the address of your Tick; no Android SDK needed (building it yourself is still possible, see [SETUP.md](SETUP.md#10-optional-android-app)). On an iPhone, or any other device, Tick works as an installable web app with time reminders.

## Get your own in about 15 minutes

You don't need to be a developer. Open [Claude Code](https://claude.com/claude-code) in an empty folder and paste:

> Clone https://github.com/DioVayne/tick into this folder and set up Tick for me.

Claude asks a few questions (language, time zone, Android app or not), sets everything up on your free Cloudflare account and gives you your own link. Prefer doing it by hand? Follow [SETUP.md](SETUP.md). The details are under [How to install](#how-to-install-short-version) below.

## A quick tour

![Tick in light mode: the task "Buy groceries" is open with a location reminder at the supermarket, 150 m, on arrival](docs/screenshots/desktop-light.png)

**On the desktop:** your lists on the left, the tasks in the middle, the open task on the right. "Buy groceries" here has its 📍 supermarket, and its checklist lives right in the notes. Tick something off and a little burst of confetti comes out of the checkbox.

<p>
  <img src="docs/screenshots/mobile-list.png" width="260" alt="The task list on a phone">
  <img src="docs/screenshots/mobile-task.png" width="260" alt="An open task on a phone">
</p>

**On your phone** Tick is an installable app that also works offline: changes you make without a connection sync once you are back online. The Android app adds a **home-screen widget**: tick tasks off right there (with 3 seconds to undo) or add one with ➕.

![Tick on the desktop in dark mode with a task shared between two people](docs/screenshots/desktop-dark.png)

**Share with your household.** Invite your partner or housemates to your Tick, each with their own account. Share a task as *one* task (done is done for everyone) or give someone their own copy and see how far they are. A reminder on a shared task reaches everyone on it, so whoever passes the supermarket first gets the groceries.

![The share dialog: pick someone, then choose a shared task or a copy](docs/screenshots/sharing.png)

**Also in the box:** a 📅 calendar with a month grid and an agenda, 🔁 repeating reminders (with an end date if you like), 📌 pinning, a daily nudge for overdue tasks with *Done* and *Tomorrow* buttons, a trash that keeps deleted tasks for 30 days, colour themes (such as *Retro 70s*) with your own background photo, TickTick import, and an MCP server so Claude can manage your tasks for you.

<p>
  <img src="docs/screenshots/trash.png" width="49%" alt="The trash with deleted tasks, each with Restore and Delete for good">
  <img src="docs/screenshots/settings.png" width="49%" alt="The settings page">
</p>

*The screenshots use made-up demo tasks.*

## All features
- **Location reminders**: get a notification when you arrive at or leave a place, set on a map (with the Android app).
- Tasks with lists, one level of subtasks, drag to sort, search, and pinning to keep a task at the top of its list.
- Several accounts on one Tick; share a task with someone as one shared task (done is done for everyone) or as a separate copy. They accept or decline the invitation, and reminders on a shared task go to everyone on it. Copies stay linked: you see how far the others are and get a notification when one of them is done.
- A trash: deleted tasks stay there for 30 days; restore them, delete them for good, or empty the trash.
- Reminders with web push; a reminder can repeat (daily, weekly, monthly, yearly, with custom rules), forever or until an end date. A new reminder starts at the next whole hour.
- A daily notification for overdue tasks (09:00 by default, or switch it off), with *Done* and *Tomorrow* buttons.
- A calendar: month grid and agenda of your tasks with a date, including the coming dates of repeating tasks.
- Notes in markdown, with clickable checklists.
- Optional attachments: photos and files on a task, stored in Cloudflare R2. Photos are scaled down and lose their EXIF data (such as the location) before upload.
- Works offline as an installable web app (PWA); changes sync when you are back online.
- Desktop layout with a sidebar and detail panel, where you edit a task's title right in the list; a full-screen task view on mobile.
- Confetti when you tick off a task (not when your device asks for reduced motion).
- Colour themes (default or *Retro 70s*, each in light and dark) and an optional background photo of your own.
- Optional Android app: location reminders, a home-screen widget and quick add. Notifications show up as Tick instead of Chrome, and you link the app with one tap on *Link* in the web app.
- **Home-screen widget** (Android): your open tasks on the home screen, tick off with 3 seconds to undo, tap to open a task in the app, quick add with a reminder, resizable, with its own text size and line spacing.
- **Claude (MCP):** an MCP server at `/mcp`, so Claude Code or Claude Desktop can list, add, change, check off, snooze and delete your tasks with a key of its own (see step 12 of [SETUP.md](SETUP.md)).
- An inbox API for automations (`POST /api/inbox` with its own token).
- A settings page in the app: display (theme, text size, spacing), language per device, time zone, password, keys for your phone and automations, a view of your devices, and backup, restore and TickTick import. After the install you rarely need the config again.
- English and Dutch; your own time zone.

## Requirements
1. [Claude Code](https://claude.com/claude-code) (or do it by hand with [SETUP.md](SETUP.md)).
2. A free [Cloudflare](https://dash.cloudflare.com/sign-up) account. No credit card needed: only the optional attachments ask for a payment method on file (Cloudflare R2, see step 11 of [SETUP.md](SETUP.md)).
3. [Node.js](https://nodejs.org) 22 or newer and [git](https://git-scm.com). Claude Code checks this and tells you if something is missing.

## How to install (short version)
1. Make a free Cloudflare account and open **Workers & Pages** once in the dashboard, so your account gets its `workers.dev` address.
2. Open Claude Code in an empty folder that is **not** inside Google Drive, OneDrive or Dropbox (npm does not work well there).
3. Paste this:
   > Clone https://github.com/DioVayne/tick into this folder and set up Tick for me.
4. Answer Claude's questions: language, time zone, contact email, and whether you want the Android app and attachments.
5. When Claude asks, log in to Cloudflare in the browser window that opens, and type your own password in the terminal (`npx wrangler secret put LOGIN_PASSWORD`). Claude never sees it.
6. Open the URL Claude gives you, log in with an empty email address and that password, and turn on notifications under **⚙ Settings**.

Updating later: open the folder in Claude Code and say *"update Tick"*.

## Built with
A Cloudflare Worker ([Hono](https://hono.dev)) with D1, static assets and a cron trigger. The web app is vanilla JavaScript without a build step. Push through [@pushforge/builder](https://www.npmjs.com/package/@pushforge/builder), maps through [Leaflet](https://leafletjs.com) and OpenStreetMap.

## Commands
| | |
|---|---|
| `npm run dev` | Run locally on `http://127.0.0.1:8787` (copy `.dev.vars.example` to `.dev.vars`; `DEV_AUTH_BYPASS=1` skips the login, but only on `localhost` and `127.0.0.1`) |
| `npm run db:migrate:local` | Apply migrations to the local D1 (do this before `npm run dev`) |
| `npm run db:migrate` | Apply migrations to your production D1 |
| `npm run typecheck` | Check TypeScript (`src` and `test`) |
| `npm test` | Tests in the Workers runtime with a local D1 |
| `npm run deploy` | Deploy (run `npm run db:migrate` first) |
| `npm run vendor` | Copy `sortable.min.js`, `leaflet.js` and `leaflet.css` from `node_modules` to `public/` |
| `node scripts/gen-vapid.mjs` | New key pair for web push |
| `node scripts/import-ticktick.mjs <csv>` | Turn a TickTick backup into `import.sql` (the app can also import it: Settings → Data) |

## Tests
- Vitest stays on 4.1: with Vitest 5, `@cloudflare/vitest-plugin` 1.4 crashes on Windows ("File path must be a file: URL").
- The tests use your `wrangler.jsonc` when it exists and `wrangler.example.jsonc` otherwise (as in CI).

## Database and migrations
The schema lives in `migrations/` and is applied with `wrangler d1 migrations apply` (`npm run db:migrate`). A schema change is always a new file (`0006_….sql`); existing migrations are never edited.

## Security
- Your own login, no Cloudflare Access: email address and password on `/login`, then an HttpOnly cookie for 30 days, renewed automatically when you use Tick in the second half of that period.
- At most 5 login attempts per minute per IP (Workers Rate Limiting), then a 429.
- Android: `Authorization: Bearer <key>` with a key you make in the app (or the old `API_TOKEN`): full access to the tasks, but not to settings, keys or your password.
- Automations: an inbox key (or the old `INBOX_TOKEN`), only `POST /api/inbox`; everything else gives a 403.
- Keys are stored as a SHA-256 hash only and shown once; you can revoke them in the app. The password you set in the app is stored as a PBKDF2 hash.
- A strict Content-Security-Policy (no inline code), plus `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` on every response.
- Without `SESSION_SECRET`, or without any password (none set in the app and no `LOGIN_PASSWORD`), nobody can log in (fail closed).
- **Log out on other devices:** Settings → Account. **Forgot your password:** see "Good to know" in [SETUP.md](SETUP.md).

## Contributing
Issues and pull requests are welcome. Every visible text goes into `public/i18n.js` in both `en` and `nl`; run `npm run typecheck` and `npm test` before you open a pull request.

## License
[MIT](LICENSE)
