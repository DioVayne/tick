# Reminders

## A reminder at a time
**Remind me…** on a task (the line with the bell) offers *Today*, *Tomorrow* and *Next week*; *Other day and time…* opens the date and time picker. At that moment Tick sends a notification to each device where you turned notifications on. A new reminder starts at the next whole hour; a date without a time uses your *reminder without a time* setting (09:00 unless you changed it). With a [linked calendar](calendar.md) the menu also lists free moments from your calendar and says **Busy: …** when you already have an appointment at a suggested time. **Add to calendar** (below the reminder) puts the task in Google Calendar or downloads an .ics file for Outlook and Apple.

The reminder is also the task's deadline: there is no separate due date.

In the list the time is shown in grey under the task, so it does not stand out. Once the time has passed it turns red.

A notification has two buttons: **Done** ticks the task off, **In 1 hour** moves the reminder an hour later. If the button can't reach Tick (no connection, or you were logged out), the notification comes back so you can try again. Tapping the notification opens the task.

Reminders can be up to a minute late, because Tick checks once a minute.

## Repeating
Under **Repeat** at a reminder you choose how often: daily, weekly, monthly or yearly, every so many days/weeks/months, on certain weekdays, on a day of the month or on, say, the third Sunday. You can add an end date.

- Ticking off a repeating task moves it on to the next time; it stays open. Subtasks reopen.
- Missed times are skipped: the next time is always in the future.
- Snoozing, *Tomorrow* or another date in the picker only move this one time; the date picker says so. To change all times, change the rhythm under **Repeat**.
- Removing the reminder also removes the repeat.
- Times follow the clock of your time zone, so 10:00 stays 10:00 when daylight saving time changes. "On the 31st" falls on the last day of shorter months.

## Overdue tasks
Once a day (09:00 by default) Tick sends a notification for each task whose reminder was before today and that is still open, at most 10, oldest first. Each has **Done** and **Tomorrow**. Change the time or switch it off under **⚙ Settings → Language and time**.

## The calendar
**📅 Calendar** in the sidebar shows your open tasks with a date, as a month grid and as an agenda. Repeating tasks show their coming times too. The week starts on Monday or Sunday, as set in Settings. Appointments from a [linked calendar](calendar.md) show as grey blocks with their titles.

## The counter on the icon
The app icon, the browser tab and the favicon show how many tasks are due today, overdue ones included. The favicon gets a red dot when something is overdue. Switch it off per device in Settings.

To see which tasks the number stands for, look at the top of the list: a bar **Due today** shows the same number, red when something is overdue. Tap it to fold it open: it lists those tasks from all your lists (shared ones too), the earliest first, each with the name of its list. Tap a task to open it, or tick it off right there. The bar stays open or closed on that device the way you left it, and it is gone when nothing is due or the counter is switched off.

## Notifications on your devices
Turn notifications on per device under **⚙ Settings → Notifications**, and use *Send test notification* to check.

- **Android:** the [Android app](android.md) shows notifications as Tick, and adds place reminders.
- **iPhone and iPad:** notifications only work when Tick is on the home screen: Share → *Add to Home Screen*, then open Tick from there. See [iPhone and iPad](iphone.md).
- **Desktop:** any modern browser.
- When no notification could be delivered within 15 minutes, or you have no device with notifications, Tick can send it to a webhook instead (see [Integrations](integrations.md#fallback-webhook)).
