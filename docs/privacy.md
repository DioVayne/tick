# Privacy

Every Tick has a public privacy page at `/privacy` on its address (for example `https://tick.example.com/privacy`). It works without logging in, in English and Dutch, so you can link to it from an app store or a website.

## What the page says

- **Who is responsible:** the person or organization that runs this Tick. Set the name in `OPERATOR_NAME` in the config; without it the page says "the person or organization that gave you your account". The contact address comes from `ADMIN_CONTACT` (not while it is still the `example.com` placeholder).
- **What Tick keeps:** your account (name, email, a hashed password, when you last used Tick), what you put in (tasks, lists, places, attachments, your background photo, settings), linked phones and the address for notifications.
- **Your location:** Tick only keeps places you save. Your phone checks arriving and leaving itself; your position is not sent to Tick. Driving mode and *my location* on the map use your position only in the app; the GitHub Android app's *On time on the road* (Physical activity) also stays on the phone.
- **Linked calendars:** when you link a calendar with its secret iCal address ([Linking your calendar](calendar.md)), Tick fetches it about once an hour and when you open the app, and keeps only the title, start and end of each appointment for the next 14 days; every fetch replaces the previous copy. Descriptions, locations and attendees are not read or kept. The address is stored encrypted and never shown or shared. Unlinking, or deleting your account, erases it all at once, and it is not in the backup download. The section only appears when the feature is on (`CALENDAR_FEEDS` is not `"false"`). The page also says that *Add to calendar* › Google Calendar opens Google Calendar with the task's title and time filled in.
- **What Tick doesn't do:** no ads, tracking or analytics. One cookie keeps you logged in.
- **Services Tick uses:** Cloudflare (hosting), the push service of your browser or phone, and OpenStreetMap (address search and map images). With email set up (`RESEND_API_KEY` and `MAIL_FROM`, see [SETUP.md](../SETUP.md#good-to-know)) the page also names Resend, which delivers the "Forgot password?" emails, and that Tick keeps a note of sent emails for two days.
- **On an open Tick** (`OPEN_SIGNUP`, see [Creating your own account](signup.md)): the page also says that sharing with an address without an account sends that address an invitation email (the address is kept for at most 30 days), and that unconfirmed accounts are deleted after 30 days.
- **How long and your rights:** data stays while you have an account; the trash empties after 30 days; deleting your account removes everything at once and backups are gone within 30 days. You can download your tasks under Settings › Data and [delete your account](settings.md) yourself.

The page is written for a Tick that runs as Tick does out of the box. If you add other services to your own Tick, your privacy page should say so.
