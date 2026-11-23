# Linking your calendar

Tick can read your online calendar (Google, Outlook, iCloud or any other calendar with an iCal address). It then knows when you're busy and suggests free moments for your tasks: in the reminder menu, in the Tickmanager's **Schedule**, and as grey blocks in the 📅 Calendar. With **Pick in your calendar** you see your days side by side and tap a half hour. Tick only reads your calendar; it never changes it. To put a task *in* your calendar, use **Add to calendar** (below).

## Linking a calendar
1. Find the secret iCal address of your calendar (see below) and copy it.
2. In Tick, open **Settings › Calendars**, paste the address, give it a name if you like (for example *Work* or *Home*) and tap **Link calendar**.
3. Tick fetches it right away. Under the name you see how many appointments it found in the next 6 weeks and when it last updated, or why it could not fetch it.

You can link up to 10 calendars, for example your work and your private calendar. **Unlink** removes the calendar and everything Tick fetched from it.

### Where to find the address
- **Google Calendar:** on a computer, open Settings (the gear), choose your calendar under *Settings for my calendars*, then *Integrate calendar* › **Secret address in iCal format**. (Not the public address: that one only works for a public calendar.)
- **Outlook.com or Microsoft 365:** Settings › Calendar › *Shared calendars* › **Publish a calendar**. Choose the calendar and *Can view all details* (or *Can view when I'm busy* if you don't want Tick to see even the titles: it then only gets busy times), click **Publish** and copy the **ICS** link.
- **iCloud:** in the Calendar app on your iPhone, tap ⓘ next to the calendar, turn on **Public Calendar** and tap *Share Link*. Note that this link is public rather than secret: anyone who has it can see the calendar.
- **Other calendars:** look for "iCal", "ICS", "subscribe" or "publish". Addresses starting with `webcal://` work too.

### The address stays secret
Anyone who has the address can see your calendar, so treat it like a password. Tick stores it encrypted, never shows it again (only the name and the website it comes from) and never writes it to a log. Don't share it with others.

## What Tick fetches
- Only the **title**, **start** and **end** of each appointment (and whether it lasts all day), for **today and the next 6 weeks**. Descriptions, locations and attendees are not read or kept.
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
- **Pick in your calendar** (below): the same suggestions as yellow half hours with a ★ among your days.
- **📅 Calendar:** your appointments appear as grey, slanted rows (in the agenda, with their times) and grey bars (in the month view), next to your tasks. An appointment that runs over several days, or past midnight, shows on every day it covers. You can't open them in Tick.

## Pick in your calendar
With a calendar linked, the reminder menu has a second line under *Pick day and time*: **Pick in your calendar**. The Tickmanager's **Schedule** has the same button. It opens your days side by side:
- On a phone you see **3 days** and swipe for more; on a computer **7 days**, with arrows for the previous and next week. It starts with two weeks; **More days** at the end adds two weeks at a time, up to 6 weeks.
- Each day runs from 00:00 to 24:00 in half hours. It opens an hour before now (not before 06:00, unless it's the middle of the night), or at the time you picked before.
- **Appointments** are grey, with their title. An all-day appointment is a small strip above the day.
- **Free half hours** are blue buttons with the time. The **suggestions** (the first free moment, a free evening and a free weekend moment) are the same buttons in yellow with a ★.
- A **task that already has a reminder** shows as grey text in its half hour. It doesn't block anything.
- **Tap a half hour** and that's the time: the picker closes and the card or panel shows *Remind me …*. Tap the reminder again to pick another time; your choice is blue.
- You can also pick a half hour **during an appointment** (hover or focus shows it). Tick never blocks it; the reminder then says *during …* with the appointment's title.
- Half hours that have already started can't be picked. **Other day or time…** at the bottom opens the normal date picker.

## When a new appointment clashes with a task
When a **new** appointment shows up in a linked calendar at the moment of one of your reminders, Tick sends a notification: *Calendar clash: <task>*, with the appointment and its time. It has two buttons:
- **Reschedule** (or tap the notification): opens the task with the reminder menu already open, so you pick a new moment yourself.
- **Next free time**: moves the reminder to the first free half hour in your calendars after the old time (between 08:00 and 22:00), without opening Tick. A quiet notification tells you the new time. When there is no free half hour in the next two weeks, Tick opens the task so you can choose.

What counts:
- Only appointments that are new since Tick last fetched your calendars. Linking a calendar does not notify about appointments that were already there, and a task you put on top of an existing appointment yourself is not reported.
- Only reminders still to come, for your own tasks and tasks shared with you. A reminder exactly at the end of an appointment, and all-day appointments, don't count.
- One notification per task and reminder time: if the appointment disappears and comes back, you don't get it again. Change the reminder and a new clash notifies again.
- It arrives when Tick fetches your calendar (about once an hour, or when you open the app), so not the second you add the appointment.

For repeating tasks, *Next free time* moves only this time, like snoozing.

## Add to calendar
A task with a reminder has **Add to calendar** in its panel, below the reminder. It makes an appointment of 30 minutes at the reminder time:
- **Google Calendar** opens Google Calendar with the title and time filled in; you save it there.
- **Outlook, Apple or other (.ics file)** downloads a file that your calendar app opens.

Only the title and the time go along. This works without linking a calendar.

## For whoever runs Tick
The feature is on unless `CALENDAR_FEEDS` is `"false"` in `wrangler.jsonc` (see [SETUP.md](../SETUP.md#good-to-know)). Turned off, Settings has no Calendars block and the API does not exist; *Add to calendar* still works.
