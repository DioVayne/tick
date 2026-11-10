# Google Play: what a change needs

Tick is in Google Play as `nl.ticktodo.app` (built with `-PtickPreset=play`, see `android/`). After every change, decide which of these four applies and say it in one line:

| Change | Play line |
|---|---|
| Only the server, the PWA (`public/`), the website (`site/`) or docs | **Play: no release needed.** The app loads the web app from the server, so users get it right away. |
| Only the store listing changes (texts, screenshots, website or privacy URL) | **Play: only Play Console** (say what to fill in). |
| Anything in `android/` | **Play: new build + upload.** Raise `versionCode` (and `versionName`) in `android/app/build.gradle`. |
| `android/` changes **and** one of the triggers below | **Play: build + Play Console.** Give the owner the exact steps. |

## Triggers that need Play Console work

Check `git diff` for `android/app/src/main/AndroidManifest.xml` and for new kinds of data.

| Trigger | What to do in Play Console |
|---|---|
| A new `<uses-permission>` | **App content** › check if it's a sensitive permission. Normal ones (internet, network state, boot) need nothing. |
| `ACCESS_BACKGROUND_LOCATION` added or its use changed | **App content › Location permissions**: describe the feature (place reminders) and upload a short video showing it. |
| `ACTIVITY_RECOGNITION` | **Data safety**: physical activity is used on the device only, not collected. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Must stay justified by the reminders feature; Google can ask about it in review. |
| A foreground service or `foregroundServiceType` | **App content › Foreground service permissions**: declare the type and add a video. |
| New data sent to the server (a new kind: e.g. contacts, photos, health, precise location) | **Data safety** form: update what is collected, why, and whether it's shared. Also update `docs/privacy.md` and the privacy page. |
| New account features (sign-in, deleting data) | **Data safety › Data deletion**: the delete-account link must still work (`/delete-account`). |
| Ads, payments or subscriptions | **Monetisation** settings and the store listing; payments need Play Billing. |
| Target SDK raised (`targetSdk`) | Check Google's behaviour changes for that Android version; new permissions may need a runtime prompt. |

## Store listing

- Screenshots: `store/google-play/nl/` and `en/` (made with `docs/screenshots/src/`). Replace them when the main screens change visibly.
- Website and privacy URL: https://ticktodo.nl and https://app.ticktodo.nl/privacy.
- When the app goes live in Play: put the Play link on the website (`site/public`, Android button, NL and EN).
