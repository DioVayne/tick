# Setting up your own Tick

About 15 minutes. You end up with your own Tick on Cloudflare's free plan: a to-do app with reminders, offline support and (optionally) an Android widget with location reminders.

You only do this once. Afterwards you change everything in the app itself (**⚙ Settings**): language, time zone, password, keys for your phone, backups. No terminal, config file or new deploy needed.

**Easiest:** open this folder in [Claude Code](https://claude.com/claude-code) and say *"set up Tick"*. Claude follows the steps below with you (skill `setup-tick`), generates the keys and asks you for the choices. You type your own password; Claude never sees it.

## What you need
- A Cloudflare account. The free plan is enough: Workers, D1, Cron Triggers and Rate Limiting. Tick uses one cron trigger; the free plan allows 5 per account, so if you already have 5, the deploy reports *"reached the Workers Free limit of 5 cron triggers"* and reminders will not be sent until you free one up.
- Node.js 22 or newer, and git.
- Optional: Claude Code. Optional for the Android app: JDK 17+ and the Android SDK.

## 1. Get the code
```bash
git clone https://github.com/DioVayne/tick.git
cd tick
npm ci
```
Put the folder somewhere outside a synced folder (Google Drive, OneDrive, Dropbox): npm does not work well there.

## 2. Log in to Cloudflare
```bash
npx wrangler login
npx wrangler whoami
```
Without a custom domain Tick runs on `https://tick.<your-subdomain>.workers.dev`. A new account picks its `workers.dev` subdomain once, in the dashboard under **Workers & Pages**.

## 3. Create your config and database
```bash
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 create tick
```
Put the `database_id` that the second command prints into `wrangler.jsonc`. That file is yours and stays out of git.

Then fill in `vars` in `wrangler.jsonc`:
| Var | Example | |
|---|---|---|
| `LOCALE` | `en` or `nl` | Starting value for the default language. Every device picks its own language in the app; change the default there too |
| `TIMEZONE` | `Europe/London` | Starting value for your time zone ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)). Reminders without a time zone and repeating tasks use it. You can change it later in the app |
| `ADMIN_CONTACT` | `mailto:you@example.com` | Contact for push services and OpenStreetMap's address search |

`LOCALE`, `TIMEZONE` and `FALLBACK_WEBHOOK` are only starting values: once you choose something in the app, that choice wins over the config (and you can leave them out).

**Own domain (optional):** for a domain that is on your Cloudflare account, set `"workers_dev": false` and add `"routes": [{ "pattern": "tick.example.com", "custom_domain": true }]`. Cloudflare creates the DNS record and the certificate on deploy.

## 4. Keys for push notifications
```bash
node scripts/gen-vapid.mjs
```
This prints two lines. Put the value of `VAPID_PUBLIC_KEY` in `wrangler.jsonc`. Keep `VAPID_PRIVATE_KEY` (the JSON) for step 6.

## 5. Database tables and first deploy
```bash
npm run db:migrate
npm run deploy
```
The deploy prints your URL. Logging in does not work yet: that needs the secrets.

## 6. Secrets
| Secret | | Value |
|---|---|---|
| `LOGIN_PASSWORD` | required | The administrator's first password; type it yourself. Log in with an empty email address and this password. You can change it in the app afterwards (it stays the emergency password, see "Good to know"). It never works for other accounts |
| `SESSION_SECRET` | required | Random |
| `VAPID_PRIVATE_KEY` | required | The JSON from step 4 |
| `API_TOKEN` | optional | Random; an old-style key for the Android app. Easier: connect the phone in the app (step 10) |
| `INBOX_TOKEN` | optional | Random; an old-style key for automations. Easier: make an inbox key in the app (step 9) |
| `FALLBACK_WEBHOOK` | optional | Starting value for the webhook that receives a reminder as JSON when push did not arrive; in the app you can replace it, switch it off, or reset to this value |

A random value:
```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```
Set each secret with the command below and paste the value when it asks. Do not pipe values in with `echo`: that adds a newline to the secret.
```bash
npx wrangler secret put LOGIN_PASSWORD
```
For `VAPID_PRIVATE_KEY`, paste the whole JSON from step 4 on one line, braces included.

Several random values at once: write them to a JSON file outside the project (`{"SESSION_SECRET": "…", "API_TOKEN": "…"}`), run `npx wrangler secret bulk <file>`, and delete the file afterwards. Set `VAPID_PRIVATE_KEY` with `secret put` as above: in a bulk file it would have to be an escaped string.

Keep the values somewhere safe, for example in your password manager. If you set `API_TOKEN` or `INBOX_TOKEN`, they keep working until you switch them off in the app (**Settings → Advanced → Keys**).

## 7. Check
- Open your URL, log in and add a task.
- Open **⚙ Settings** at the bottom of the sidebar, go to **Notifications**, switch them on and allow them; use **Send test notification**.
- Add a task with a reminder in two minutes and wait for it.
- `npx wrangler deployments list` shows your deploy; the cron (`* * * * *`) is under **Settings → Triggers** of the Worker in the dashboard.

## 8. On your phone
Open your URL in the browser and install it (Android: menu → **Install app**; iPhone: Share → **Add to Home Screen**). On iPhone push only works from the home screen.

## 9. Optional: automations
`POST /api/inbox` creates a task with an inbox key; that key can do nothing else. Make one in the app: **Settings → Advanced → Keys → New key**, kind *Inbox*. It starts with `tick_` and is shown once, so copy it right away. (An `INBOX_TOKEN` secret from step 6 works the same way.)
```bash
curl -X POST https://tick.example.com/api/inbox \
  -H "Authorization: Bearer $INBOX_KEY" -H "content-type: application/json" \
  -d '{"title": "Call the dentist", "notes": "about the check-up", "due": "2026-11-03", "list": "Home"}'
```
`due` is a date (becomes 09:00 in your time zone), a local time (`2026-11-03T14:30`) or a time with a zone. `repeat` takes a rule such as `FREQ=WEEKLY;BYDAY=MO`.

## 10. Optional: Android app
The app opens your Tick full-screen (a Trusted Web Activity) and adds a widget with your task list, quick add, and location reminders (notify me when I arrive at or leave a place). Notifications of the web app show up as notifications of the app.
1. Make your own signing key, once (from `android/`; `keytool` comes with the JDK). Choose a password and keep the file and the password safe: an update must be signed with the same key.
   ```bash
   keytool -genkeypair -v -keystore tick-release.jks -alias tick -keyalg RSA -keysize 2048 -validity 10000
   ```
   `*.jks` and `*.keystore` are in `.gitignore`.
2. Create `android/tick.properties` (not in git):
   ```properties
   tickBase=https://tick.example.com
   tickPackage=com.yourname.tick
   tickKeystore=tick-release.jks
   tickKeystorePassword=your-keystore-password
   tickKeyAlias=tick
   tickKeyPassword=your-key-password
   ```
   `tickPackage` must be a unique application id of your own. `tickKeystore` is relative to `android/` (or an absolute path). Without the four signing lines `assembleDebug` still works, but `assembleRelease` refuses.
3. Build (from `android/`; on Windows `gradlew.bat`):
   ```bash
   ./gradlew testDebugUnitTest assembleRelease
   ```
   The APK is in the `tick-android-build` folder under your local app data (or the temp folder).
4. Get the fingerprint of your key and copy the line after **SHA256**:
   ```bash
   keytool -list -v -keystore tick-release.jks -alias tick
   ```
5. Add `"ANDROID_PACKAGE": "com.yourname.tick"` and `"ANDROID_CERT_SHA256": "AA:BB:…"` (that fingerprint) to `vars` in `wrangler.jsonc` and deploy again. With both, `/.well-known/assetlinks.json` links the app to your domain, so it opens without an address bar, and the web app can wake the app right after you set a place.
6. Install the APK and open the app. Log in; the app links itself to your Tick and turns on notifications. Add the widget from your home screen. Afterwards the phone shows up under **Settings → Devices** with its notification and location status.
7. For location reminders turn on location notifications in the app and choose **Allow all the time** in the permission screen.

Good to know:
- Coming from app 1.2 or older (signed with a debug key)? Uninstall it first — Android refuses to update an app signed with a different key. Set up the widget and location again afterwards; linking happens by itself after you log in.
- To test a debug build, add the debug key's SHA-256 to `ANDROID_CERT_SHA256` after a comma.
- You can share the APK with others who use the same Tick: it is signed with the same key, so it matches `ANDROID_CERT_SHA256`.
- Installed Tick in Firefox as a web app before? Remove that installation, or turn off its notifications, or you get every notification twice.
- The app needs Chrome (or another browser that supports Trusted Web Activities). Without one it opens with an address bar.

## Updating
```bash
git pull
npm ci
npm run db:migrate
npm run deploy
```
Open the app once online afterwards, so the service worker caches the new version.

## Good to know
- **Log out on other devices** (for example after losing a phone): **Settings → Account → Log out on other devices**. This device stays logged in. Keys for phones and automations keep working; revoke those under **Advanced → Keys**.
- **Forgot your password?** A password you set in the app is stored as a hash in the database and overrides `LOGIN_PASSWORD`. For the administrator, go back to `LOGIN_PASSWORD` by deleting it:
  ```bash
  npx wrangler d1 execute DB --remote --command "UPDATE users SET password_hash = NULL WHERE role = 'admin'"
  ```
  Then log in with the `LOGIN_PASSWORD` secret and an empty email address (or your email address if you had already set one; set a new secret a new one with `npx wrangler secret put LOGIN_PASSWORD` if you lost that too) and choose a new password in the app. Deleting the hash does not log out other sessions: use **Log out on other devices** afterwards (choosing a new password in the app also does that).
- **Backup:** **Settings → Data → Download backup** gives a JSON file with your tasks and places. Restoring merges by id and never deletes anything. Settings, keys and the password are not in it.
- **Time zone:** changing it in the app keeps the clock time of open reminders and repeats (9:00 stays 9:00).
- **Quick add on Android** keeps its own default of 09:00 for a date without a time; it does not follow the reminder time you set in the app.
- **Rate limits:** the `namespace_id`s of `LOGIN_LIMITER` and `GEOCODE_LIMITER` only need to be unique within your Cloudflare account. Running two Tick instances on one account? Give the second one other numbers.
- **Local development:** `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local`, `npm run dev`. With `DEV_AUTH_BYPASS=1` you skip the login on localhost.
- **Moving from TickTick:** in the app, **Settings → Data → Import from TickTick** and pick the backup `.csv`. Importing again skips tasks that are already there. The script `node scripts/import-ticktick.mjs <backup.csv>` still works too: it writes `import.sql`, which you load with `npx wrangler d1 execute DB --remote --file import.sql`.
