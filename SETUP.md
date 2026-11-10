# Setting up your own Tick

About 15 minutes. You end up with your own Tick on Cloudflare's free plan: a to-do app with reminders, offline support and (optionally) an Android widget with location reminders.

You only do this once. Afterwards you change everything in the app itself (**⚙ Settings**): language, time zone, password, keys for your phone, backups. No terminal, config file or new deploy needed.

**Easiest:** open this folder in [Claude Code](https://claude.com/claude-code) and say *"set up Tick"*. Claude follows the steps below with you (skill `setup-tick`), generates the keys and asks you for the choices. You type your own password; Claude never sees it.

The folder `site/` is the website ticktodo.nl; you can ignore it for your own Tick.

## What you need
- A Cloudflare account. The free plan is enough: Workers, D1, Cron Triggers and Rate Limiting. Tick uses one cron trigger; the free plan allows 5 per account, so if you already have 5, the deploy reports *"reached the Workers Free limit of 5 cron triggers"* and reminders will not be sent until you free one up.
  No credit card needed: only the optional attachments (step 11) ask for a payment method on file.
- Node.js 22 or newer, and git.
- Optional: Claude Code. The Android app is a download; only building it yourself needs JDK 17+ and the Android SDK.

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
| `ADMIN_CONTACT` | `mailto:you@example.com` | Contact for push services and OpenStreetMap's address search. Also shown on the public pages `/delete-account` and `/privacy` for people who can't log in (not while it is still the `example.com` placeholder) |
| `OPERATOR_NAME` | empty | Optional: who runs this Tick (a person or organization), named on the public privacy page `/privacy`. Empty: the page says "the person or organization that gave you your account" |

`LOCALE`, `TIMEZONE` and `FALLBACK_WEBHOOK` are only starting values: once you choose something in the app, that choice wins over the config (and you can leave them out). `FALLBACK_WEBHOOK` from the config only applies to the administrator; other accounts set their own webhook in the app.

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
| `RESEND_API_KEY` | optional | An API key from [Resend](https://resend.com) with sending access; turns on "Forgot password?" by email (see "Good to know") |
| `FALLBACK_WEBHOOK` | optional | Starting value for the administrator's webhook that receives a reminder as JSON when push did not arrive; in the app you can replace it, switch it off, or reset to this value. It does not apply to other accounts |

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

**Download it (recommended).** No computer or Android SDK needed.
1. Deploy this version of Tick first (step 5 or [Updating](#updating)): the app checks your address with `/api/hello`, and `/.well-known/assetlinks.json` vouches for the official app, so it opens without an address bar. You don't need to set anything for that.
2. On your phone, download the app from https://github.com/DioVayne/tick/releases/latest/download/Tick.apk and open it. Android asks once to allow installing apps from your browser.
3. Open the app and type the address of your Tick (for example `tick.example.com`). Log in; the app links itself and turns on notifications.
   Or the other way round: open your Tick in the phone's browser, log in and tap **Settings → Devices → Connect the Android app**. That opens the app with your address already filled in (or the download page if the app isn't installed yet).
4. Add the widget from your home screen. Afterwards the phone shows up under **Settings → Devices** with its notification and location status.
5. For location reminders turn on location notifications in the app and choose **Allow all the time** in the permission screen.

Updates: the app checks once a day and shows a notification when there is a new version; tap it, then open the downloaded file. You can also download the newest APK yourself: https://github.com/DioVayne/tick/releases/latest/download/Tick.apk. [Obtainium](https://obtainium.imranr.dev) can do that for you: add `https://github.com/DioVayne/tick` as a source. To use another Tick later, open **Phone settings → Change address**; the app then forgets the tasks and location reminders of the old one.

**Or build it yourself** (JDK 17+ and the Android SDK; for your own package id, name or icon, or if you'd rather not install someone else's APK):
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
   `tickPackage` must be a unique application id of your own (not `nl.detussenpartij.tick`, that is the official app). `tickBase` is optional: with it the app starts on your address, without it the app asks, like the downloaded one. `tickKeystore` is relative to `android/` (or an absolute path). Without the four signing lines `assembleDebug` still works, but `assembleRelease` refuses.
3. Build (from `android/`; on Windows `gradlew.bat`):
   ```bash
   ./gradlew testDebugUnitTest assembleRelease
   ```
   The APK is in the `tick-android-build` folder under your local app data (or the temp folder).
4. Get the fingerprint of your key and copy the line after **SHA256**:
   ```bash
   keytool -list -v -keystore tick-release.jks -alias tick
   ```
5. Add `"ANDROID_PACKAGE": "com.yourname.tick"` and `"ANDROID_CERT_SHA256": "AA:BB:…"` (that fingerprint) to `vars` in `wrangler.jsonc` and deploy again. With both, `/.well-known/assetlinks.json` also vouches for your build, so it opens without an address bar.
6. Install the APK and continue with step 3 above.

Good to know:
- **Switching from your own build to the downloaded app:** the official app has its own package id, so it installs next to your build. Install it, connect it (step 3), set up the widget and location again, then uninstall your own build. You can remove `ANDROID_PACKAGE` and `ANDROID_CERT_SHA256` afterwards.
- Coming from app 1.2 or older (signed with a debug key)? Uninstall it first — Android refuses to update an app signed with a different key. Set up the widget and location again afterwards; linking happens by itself after you log in.
- To test a debug build, add the debug key's SHA-256 to `ANDROID_CERT_SHA256` after a comma.
- Installed Tick in Firefox as a web app before? Remove that installation, or turn off its notifications, or you get every notification twice.
- The app needs Chrome (or another browser that supports Trusted Web Activities). Without one it opens with an address bar. It also opens with an address bar if your Tick runs an older version without the official app in `assetlinks.json`.

### Releasing the Android app (maintainers)
The official APK is built by [.github/workflows/android-release.yml](.github/workflows/android-release.yml) when you push a tag `android-v<versionName>`. It needs the project's release key, which only the maintainer holds:
1. Once: make the key (`keytool -genkeypair -v -keystore tick-official.jks -alias tick -keyalg RSA -keysize 4096 -validity 10000`), keep it and its passwords in a password manager **and** an offline backup. Losing it means no more updates for anyone who installed the app; leaking it means someone can publish a fake update.
2. Once: add four repository secrets (**Settings → Secrets and variables → Actions**): `TICK_KEYSTORE_BASE64` (the file as base64, e.g. `base64 -w0 tick-official.jks`), `TICK_KEYSTORE_PASSWORD`, `TICK_KEY_ALIAS`, `TICK_KEY_PASSWORD`.
3. Once: put the key's SHA-256 fingerprint (`keytool -list -v -keystore tick-official.jks -alias tick`) in `OFFICIAL_APP.certs` in `src/assetlinks.ts`. The workflow refuses to publish an APK whose signature isn't there.
4. Each release: raise `versionCode` and `versionName` in `android/app/build.gradle`, merge, then `git tag android-v1.5.0 && git push origin android-v1.5.0`. The workflow runs the JUnit tests, builds, checks the signature and attaches `Tick-1.5.0.apk` and `Tick.apk` to a new release. Installed apps notice the new version within a day.

### Google Play app (maintainers)
The Play app is a fixed build of the same code: package `nl.ticktodo.app` (can never change; never `nl.detussenpartij.tick`, that is the GitHub app), it starts on `https://app.ticktodo.nl`, and the address stays changeable under **Phone settings → Change address**. It does not look for updates on GitHub; Play updates it. Both apps can be installed side by side. It also leaves out two permissions Play only allows with a declaration (`src/play/AndroidManifest.xml`): `ACTIVITY_RECOGNITION` (so no *On time on the road*) and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (the battery button opens the app's settings). In Play Console declare background location (place reminders) with a demo video, and answer the health declaration with *no health features*.

Play App Signing: Google keeps the **app signing key** and signs what phones install; you keep an **upload key** and sign what you upload with it. Lose the upload key and Google can reset it; the app signing key can't be lost by you.

1. Once: make the upload key (from `android/`), with passwords of your own in a password manager plus an offline backup of the file:
   ```bash
   keytool -genkeypair -v -keystore ticktodo-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Once: create `android/play.properties` (not in git; only the four signing lines, package and address are fixed):
   ```properties
   tickKeystore=ticktodo-upload.jks
   tickKeystorePassword=your-keystore-password
   tickKeyAlias=upload
   tickKeyPassword=your-key-password
   ```
3. Each release: raise `versionCode` (and `versionName`) in `android/app/build.gradle`, then build the bundle (from `android/`; on Windows `gradlew.bat`):
   ```bash
   ./gradlew -PtickPreset=play testDebugUnitTest bundleRelease
   ```
   The `.aab` is in `tick-android-build/app/outputs/bundle/release/` under your local app data (or the temp folder). Upload it in Play Console under **Test and release** (internal testing first). A `versionCode` can be used only once per app on Play.
4. Once, after the first upload: copy the SHA-256 of the **app signing key** from Play Console (**Test and release → App integrity → App signing**) into `PLAY_APP.certs` in `src/assetlinks.ts`, so every Tick vouches for the Play app (it can be pointed at any Tick). On app.ticktodo.nl also set `"ANDROID_PACKAGE": "nl.ticktodo.app"` and `"ANDROID_CERT_SHA256"` (the app signing key, plus the upload key after a comma for testing your own uploaded builds) in its `wrangler.jsonc`, deploy, and check `https://app.ticktodo.nl/.well-known/assetlinks.json`.

## 11. Optional: attachments
Photos and files on a task. They are stored in Cloudflare R2, and R2 only switches on once your account has a payment method on file, even though Tick stays within the free tier (10 GB storage) for a long time. Without this step Tick works the same, just without attachments; you can add it any time later.
1. In the dashboard, open **R2 Object Storage**, add a payment method and switch R2 on.
2. Create the bucket:
   ```bash
   npx wrangler r2 bucket create tick-files
   ```
3. In `wrangler.jsonc`, remove the `//` in front of `"r2_buckets"`. Optionally set `MAX_UPLOAD_MB` in `vars` (default 10, at most 100), and `MAX_ACCOUNT_MB` for the most storage per account (no limit by default).
4. Deploy again with `npm run deploy`. Open a task: it now has **📎 Add photo or file**.

Photos are scaled down in the browser before upload, which also strips their EXIF data (such as where the photo was taken). Attachments only work online. Against surprises: set up a billable-usage notification under **Billing** in the dashboard.

## 12. Optional: Claude (MCP)
Tick has an MCP server at `/mcp`, so Claude can list, add, change, check off, snooze and delete your tasks. It cannot touch accounts, keys or settings. Make a key for it: **Settings → Advanced → Keys → New key**, kind *Full*, name `Claude` (so you can revoke it on its own).

Claude Code:
```bash
claude mcp add --transport http tick https://tick.example.com/mcp --header "Authorization: Bearer tick_..."
```
Claude Desktop (through `mcp-remote`, because its own connectors need OAuth): in `claude_desktop_config.json`
```json
{ "mcpServers": { "tick": { "command": "npx", "args": ["mcp-remote", "https://tick.example.com/mcp", "--header", "Authorization: Bearer tick_..."] } } }
```
claude.ai and the Claude phone app are not supported yet (they need OAuth).

## Updating
```bash
git pull
npm ci
npm run db:migrate
npm run deploy
```
Open the app once online afterwards, so the service worker caches the new version.

**Updating to the version with accounts:** everyone logs in once more afterwards. As administrator, leave the email field empty as long as you have not set an address (the login page says so), then add your address under **Settings → Account**. Android phones with app 1.3 pair themselves again after you log in inside the app; installing app 1.4 is better. The separate "Android" keys that app 1.3 left behind can be revoked under **Settings → Advanced → Keys**.

## Good to know
- **More people on one Tick:** as administrator, add your email address first (**Settings → Account**). Then **Settings → Accounts → + Invite someone** shows a link; share it, for example through WhatsApp. It works once and is valid for 7 days. The other person chooses a name, email address and password there and has their own tasks, devices and settings. Lost password of another account: **Reset link** next to that account (once, valid for 1 hour). **Delete** erases all data of that account.
- **Forgot password? by email (optional):** with email set up, the login page shows **Forgot password?**. Someone enters their email address and gets a one-time link (valid for 1 hour) to choose a new password. It works for members only; the administrator keeps the emergency route below. Setting it up:
  1. Make an account at [Resend](https://resend.com) and add and verify your domain there (a few DNS records).
  2. Make an API key with sending access and set it: `npx wrangler secret put RESEND_API_KEY`.
  3. In `wrangler.jsonc`, under `vars`, set `"MAIL_FROM": "Tick <noreply@your-domain>"` (an address on the verified domain) and deploy.

  Tick sends at most `MAIL_DAILY_LIMIT` emails a day (UTC, default 50; Resend's free plan allows 100). When the limit is reached, the administrator gets one push notification that day, and further requests get no email until the next day. Per account it is at most one email per 5 minutes and 5 a day. The answer on the page is always the same, so nobody can find out which addresses have an account.
- **Open sign-up (optional, for a Tick open to strangers):** only if you host Tick for people you don't know, like a public app. Set email up first (above): without it, nobody can confirm their address, so nobody can share. Then, under `vars` in `wrangler.jsonc`:
  - `"OPEN_SIGNUP": "true"`: the login page gets **Create account** (`/signup`). New accounts must confirm their email address before they can share; unconfirmed accounts are deleted after 30 days. Accounts can no longer see each other: sharing goes by typing a full email address, and an address without an account gets an invitation email. Invitation emails use at most half of `MAIL_DAILY_LIMIT`, and confirmation emails also at most half (and at most 3 per address per 24 hours, so **Send email again** works), so password emails keep working.
  - `"PLAY_STORE_URL"` (optional): a Google Play link the invitation email mentions.
  - `"SIGNUP_DAILY_LIMIT"` (optional, default 100): most sign-ups per day (UTC); a sign-up still counts after its account is deleted. When it is reached, the administrator gets one push notification that day.
  - `"FREE_SHARE_PEOPLE"` (optional, default 1): with how many different people one account can share (tasks, lists and invitations by email together; what others share with them does not count). The administrator has no limit.

  Leave `OPEN_SIGNUP` out for a household or small team: then you invite people yourself (**Settings → Accounts**) and everyone can pick each other when sharing.
- **Linking calendars:** everyone can link their online calendar under **Settings → Calendars** with its secret iCal address (see [Linking your calendar](docs/calendar.md)); Tick fetches it about once an hour (the cron does a few calendars every 5 minutes) and keeps only titles and times for 14 days. The addresses are stored encrypted with a key derived from `SESSION_SECRET`: if you change that secret, everyone has to link their calendars again (the settings say so). To switch the feature off, set `"CALENDAR_FEEDS": "false"` under `vars` and deploy; for a Tick in an app store, update the store's privacy form first (on Google Play: *Data safety* › *Calendar events*).
- **Log out on other devices** (for example after losing a phone): **Settings → Account → Log out on other devices**. This device stays logged in. Keys for phones and automations keep working; revoke those under **Advanced → Keys**.
- **Forgot your password?** A password you set in the app is stored as a hash in the database and overrides `LOGIN_PASSWORD`. For the administrator, go back to `LOGIN_PASSWORD` by deleting it:
  ```bash
  npx wrangler d1 execute DB --remote --command "UPDATE users SET password_hash = NULL WHERE role = 'admin'"
  ```
  Then log in with the `LOGIN_PASSWORD` secret and an empty email address (or your email address if you had already set one; set a new one with `npx wrangler secret put LOGIN_PASSWORD` if you lost that too) and choose a new password in the app. Deleting the hash does not log out other sessions: use **Log out on other devices** afterwards (choosing a new password in the app also does that).
- **Backup:** **Settings → Data → Download backup** gives a JSON file with your tasks and places. Restoring merges by id and never deletes anything. Settings, keys and the password are not in it.
- **Time zone:** changing it in the app keeps the clock time of open reminders and repeats (9:00 stays 9:00).
- **Quick add on Android** keeps its own default of 09:00 for a date without a time; it does not follow the reminder time you set in the app.
- **Rate limits:** the `namespace_id`s of `LOGIN_LIMITER` and `GEOCODE_LIMITER` only need to be unique within your Cloudflare account. Running two Tick instances on one account? Give the second one other numbers.
- **Local development:** `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local`, `npm run dev`. With `DEV_AUTH_BYPASS=1` you skip the login on localhost.
- **Moving from TickTick:** in the app, **Settings → Data → Import from TickTick** and pick the backup `.csv`. Importing again skips tasks that are already there. The script `node scripts/import-ticktick.mjs <backup.csv>` still works too: it writes `import.sql`, which you load with `npx wrangler d1 execute DB --remote --file import.sql`.
