# Linking your calendar

Tick can read your online calendar (Google, Outlook, iCloud or any other calendar with an iCal address). It then knows when you're busy and suggests free moments for your tasks: in the reminder menu, in the Tickmanager's **Schedule**, and as grey blocks in the 📅 Calendar. Tick only reads your calendar; it never changes it. To put a task *in* your calendar, use **Add to calendar** (below).

## Linking a calendar
1. Find the secret iCal address of your calendar (see below) and copy it.
2. In Tick, open **Settings › Calendars**, paste the address, give it a name if you like (for example *Work* or *Home*) and tap **Link calendar**.
3. Tick fetches it right away. Under the name you see how many appointments it found in the next 14 days and when it last updated, or why it could not fetch it.

You can link up to 10 calendars, for example your work and your private calendar. **Unlink** removes the calendar and everything Tick fetched from it.

### Where to find the address
- **Google Calendar:** on a computer, open Settings (the gear), choose your calendar under *Settings for my calendars*, then *Integrate calendar* › **Secret address in iCal format**. (Not the public address: that one only works for a public calendar.)
- **Outlook.com or Microsoft 365:** Settings › Calendar › *Shared calendars* › **Publish a calendar**. Choose the calendar and *Can view all details*, click **Publish** and copy the **ICS** link.
- **iCloud:** in the Calendar app on your iPhone, tap ⓘ next to the calendar, turn on **Public Calendar** and tap *Share Link*. Note that this link is public rather than secret: anyone who has it can see the calendar.
- **Other calendars:** look for "iCal", "ICS", "subscribe" or "publish". Addresses starting with `webcal://` work too.

### The address stays secret
Anyone who has the address can see your calendar, so treat it like a password. Tick stores it encrypted, never shows it again (only the name and the website it comes from) and never writes it to a log. Don't share it with others.

## What Tick fetches
- Only the **title**, **start** and **end** of each appointment (and whether it lasts all day), for **today and the next 14 days**. Descriptions, locations and attendees are not read or kept.
- Tick fetches each calendar about **once an hour**, and when you open the app if the last time was more than 15 minutes ago. Every fetch replaces the previous copy. If a fetch fails, the previous copy stays and the settings show the error.
- Appointments marked as *free* (in Outlook: *Show as: Free*) and cancelled appointments are skipped. Repeating appointments work, including exceptions; a repeat pattern Tick doesn't understand is skipped.
- Unlinking a calendar, or deleting your account, removes everything Tick fetched at once. Calendar appointments are not part of the backup download.

## Free moments
With a calendar linked, Tick suggests up to three free half hours in the next 14 days:
- the **first free moment** from now,
- the first free **evening** (from 18:00 on a weekday),
- the first free moment in the **weekend**.

Free moments fall between 08:00 and 22:00 in your time zone, on any day: Tick doesn't assume office hours. All-day appointments (a birthday, a holiday) don't count as busy.

Where you see them:
- **The reminder menu** (tap *Remind me* on a task): the quick choices (today, tomorrow, next week) move to the first free moment that day, so they never land on an appointment. A day without any free moment until 22:00 is left out. The menu then says *Suggestions based on your calendar*.
- **Tickmanager › Schedule:** the free moments come first; *Tomorrow* and *Next week* show **Busy: …** when they clash.
- **📅 Calendar:** your appointments appear as grey, slanted rows (in the agenda, with their times) and grey bars (in the month view), next to your tasks. An appointment that runs over several days, or past midnight, shows on every day it covers. You can't open them in Tick.

## Add to calendar
A task with a reminder has **Add to calendar** in its panel, below the reminder. It makes an appointment of 30 minutes at the reminder time:
- **Google Calendar** opens Google Calendar with the title and time filled in; you save it there.
- **Outlook, Apple or other (.ics file)** downloads a file that your calendar app opens.

Only the title and the time go along. This works without linking a calendar.

## For whoever runs Tick
The feature is on unless `CALENDAR_FEEDS` is `"false"` in `wrangler.jsonc` (see [SETUP.md](../SETUP.md#good-to-know)). Turned off, Settings has no Calendars block and the API does not exist; *Add to calendar* still works.
