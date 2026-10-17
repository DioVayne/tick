---
name: setup-tick
description: Use when the user wants to set up, deploy or update their own Tick instance on Cloudflare, or connect the Android app.
---

# Set up Tick

Walk the user through [SETUP.md](../../../SETUP.md) and do the work for them. SETUP.md is the source of truth for the commands; this skill adds how to run them.

## Before you start
1. Check the basics: `node --version` (22 or newer) and `npx wrangler whoami`. Not logged in: ask the user to run `npx wrangler login` themselves (it opens a browser) and wait.
2. Check what already exists, so you can resume instead of starting over:
   - Does `wrangler.jsonc` exist, and does it still have the placeholder `database_id` (all zeros)?
   - `npx wrangler d1 list`: is there already a database called `tick`?
   - `npx wrangler secret list`: which secrets are already set? (This only works after the first deploy.)
3. Ask in one go for what only the user can decide:
   - language (`en` or `nl`),
   - time zone (offer the one from the user's system as the default),
   - contact e-mail for `ADMIN_CONTACT`,
   - own domain or `workers.dev`,
   - whether they want the inbox API (`INBOX_TOKEN`) and the Android app.

## Doing it
- Run `npm ci`, copy `wrangler.example.jsonc` to `wrangler.jsonc`, run `npx wrangler d1 create tick`, and write the `database_id` and the vars into `wrangler.jsonc` yourself.
- Run `node scripts/gen-vapid.mjs`. Put the public key in `wrangler.jsonc`. Keep the private key only for the secret step: do not write it into any file in the project, and do not echo it back in chat.
- Run `npm run db:migrate`. Before `npm run deploy`, tell the user what will be deployed and where (the URL or the domain), and get a yes.
- **Secrets:**
  - Generate `SESSION_SECRET`, `API_TOKEN` and, if wanted, `INBOX_TOKEN` with `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`.
  - Set them through `npx wrangler secret bulk <file>`, using a JSON file in a temporary folder outside the project.
  - Add `VAPID_PRIVATE_KEY` to that file as a string: the JWK JSON from `gen-vapid.mjs` stringified, so `JSON.stringify(jwk)` is the value, not the object itself. The Worker does `JSON.parse` on it.
  - Delete that file right after.
  - Never pipe values with `echo`: that adds a newline.
- **Password:** never ask for it in chat and never generate it. Ask the user to run this in their own terminal:
  ```
  npx wrangler secret put LOGIN_PASSWORD
  ```
  They log in the first time with an empty email address and that password (`LOGIN_PASSWORD` only works for the administrator, and only until they set a password in the app).
- **Forgotten administrator password** (emergency route, also in SETUP.md): after a yes, run
  ```
  npx wrangler d1 execute DB --remote --command "UPDATE users SET password_hash = NULL WHERE role = 'admin'"
  ```
  Then the administrator logs in with `LOGIN_PASSWORD` and an empty email address (or their email address if they had already set one), and chooses a new password in the app.
- **Inviting someone else:** the administrator adds their own email address first (Settings › Account), then uses Settings › Accounts › "+ Invite someone" and shares the link (for example through WhatsApp; once, valid for 7 days). Someone who lost their password gets a "Reset link" next to their account (once, valid for 1 hour). Do not make accounts or links yourself.
- **The user's copy of the secrets:** tell them which tokens they will need again (`API_TOKEN` for Android, `INBOX_TOKEN` for automations), and ask them to save those in their password manager. If they want the values shown, show them once.

## Checking
- `npx wrangler deployments list` shows the new deploy.
- `curl -s -o /dev/null -w "%{http_code}" <url>/login` gives `200`.
- Ask the user to log in, add a task, and turn on notifications in the sidebar; that sends a test notification.
- Mention the cron trigger (every minute) and where to see it: the Worker's **Settings → Triggers** in the dashboard.

## Android (only if wanted)
Follow step 10 of SETUP.md:
1. Ask the user to make their own signing key with `keytool -genkeypair -v -keystore tick-release.jks -alias tick -keyalg RSA -keysize 2048 -validity 10000` (from `android/`). They choose the passwords; never invent or type them yourself.
2. Write `android/tick.properties` with `tickBase` (their URL) and `tickPackage` (ask for a unique id, for example `com.<name>.tick`). The user adds the four signing lines themselves: `tickKeystore`, `tickKeystorePassword`, `tickKeyAlias`, `tickKeyPassword`.
3. Build with `gradlew testDebugUnitTest assembleRelease`. Without the signing lines only `assembleDebug` works.
4. Have the user run `keytool -list -v -keystore tick-release.jks -alias tick` and give you the **SHA256** line.
5. Add `ANDROID_PACKAGE` and `ANDROID_CERT_SHA256` (that fingerprint) to `vars` in `wrangler.jsonc` and deploy again, after asking.
6. Tell them: if they have app 1.2 or older (debug key) installed, uninstall it first (Android refuses a different signing key; widget and location need setting up again; linking is automatic after login). Then install the APK and open it; after logging in the app links itself. The same APK works for others on the same Tick (same key). Remove an old Firefox web-app install of Tick or turn off its notifications. Without Chrome (or another TWA browser) the app opens with an address bar.

If the JDK or the Android SDK is missing, say so and stop. Installing them is the user's call.

## Updating an existing instance
Run `git pull`, `npm ci`, `npm run db:migrate`, then deploy after a yes, then check with `npx wrangler deployments list`.

## Never
- Commit `wrangler.jsonc`, `.dev.vars`, `android/tick.properties`, a keystore or any secret.
- Delete a D1 database or a Worker without an explicit request from the user.
