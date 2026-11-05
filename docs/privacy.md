# Privacy

Every Tick has a public privacy page at `/privacy` on its address (for example `https://tick.example.com/privacy`). It works without logging in, in English and Dutch, so you can link to it from an app store or a website.

## What the page says

- **Who is responsible:** the person or organization that runs this Tick. Set the name in `OPERATOR_NAME` in the config; without it the page says "the person or organization that gave you your account". The contact address comes from `ADMIN_CONTACT` (not while it is still the `example.com` placeholder).
- **What Tick keeps:** your account (name, email, a hashed password, when you last used Tick), what you put in (tasks, lists, places, attachments, your background photo, settings), linked phones and the address for notifications.
- **Your location:** Tick only keeps places you save. Your phone checks arriving and leaving itself; your position is not sent to Tick.
- **What Tick doesn't do:** no ads, tracking or analytics. One cookie keeps you logged in.
- **Services Tick uses:** Cloudflare (hosting), the push service of your browser or phone, and OpenStreetMap (address search and map images).
- **How long and your rights:** data stays while you have an account; the trash empties after 30 days; deleting your account removes everything at once and backups are gone within 30 days. You can download your tasks under Settings › Data and [delete your account](settings.md) yourself.

The page is written for a Tick that runs as Tick does out of the box. If you add other services to your own Tick, your privacy page should say so.
