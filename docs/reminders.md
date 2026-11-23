# Reminders

## A reminder at a time
**Remind me…** on a task (the line with the bell) opens with **Pick day and time** at the top, which opens the date and time picker. Below it, as a shortcut, are up to three quick choices: today, tomorrow and next week, each with its time. At that moment Tick sends a notification to each device where you turned notifications on. You can also type the moment in the title of a new task, such as *call dentist tomorrow 15:00*: see [A date in your text](tasks-and-lists.md#a-date-in-your-text). A new reminder starts at the next whole hour; a date without a time uses your *reminder without a time* setting (09:00 unless you changed it). With a [linked calendar](calendar.md) the quick choices never land on an appointment: Tick moves each one to the first free moment that day (or leaves it out when the day is full), and the menu says *Suggestions based on your calendar*. It then also has **Pick in your calendar**: your days side by side, with your appointments in grey, and you tap a half hour (see [Pick in your calendar](calendar.md#pick-in-your-calendar)). **Add to calendar** (below the reminder) puts the task in Google Calendar or downloads an .ics file for Outlook and Apple.

The reminder is also the task's deadline: there is no separate due date.

Times are shown and picked in the time zone set in [Settings](settings.md#language-and-time), also when your device is in another zone. If you pick Monday 20:00, it is Monday 20:00 in that zone, in the list, the repeat menu and the calendar alike.

In the list the time is shown in grey under the task, so it does not stand out. Once the time has passed it turns red.

A notification has two buttons: **Done** ticks the task off, **In 1 hour** moves the reminder an hour later. If the button doesn't work, the notification comes back and says why: no connection or a server error (the buttons stay, so you can try again), or you're not logged in (no buttons; tap it to open Tick and log in). Tapping the notification opens the task.

Reminders can be up to a minute late, because Tick checks once a minute.

## Repeating
Under **Repeat** at a reminder you choose how often: daily, weekly, monthly or yearly, every so many minutes/hours/days/weeks/months (1 to 99), on certain weekdays, on a day of the month or on, say, the third Sunday. You can add an end date (**Until**, the last time counts). Choose minutes or hours under **Custom…**; with those the end has a time too, such as every hour until 17:30. A time without a date ends on the first day. In the Repeat menu a typed time is saved when you press Enter or tap elsewhere; Esc leaves it as it was.

- Ticking off a repeating task moves it on to the next time; it stays open. Subtasks reopen.
- Missed times are skipped: the next time is always in the future.
- Snoozing, *Tomorrow* or another date in the picker only move this one time; the date picker says so. To change all times, change the rhythm under **Repeat**.
- Removing the reminder also removes the repeat.
- Every so many minutes or hours counts from the reminder: every 2 hours from 10:15 is 12:15, 14:15 and so on. Like the other rhythms it moves on when you tick the task off, to the next of those times after now; it does not remind you again while the task is still open. These steps are real hours, also on the night daylight saving time changes. In the calendar such a task shows once per day.
- Times follow the clock of your time zone, so 10:00 stays 10:00 when daylight saving time changes. "On the 31st" falls on the last day of shorter months.

## Overdue tasks
Once a day (09:00 by default) Tick sends a notification for each task whose reminder was before today and that is still open, at most 10, oldest first. Each has **Done** and **Tomorrow**. Change the time or switch it off under **⚙ Settings → Notifications**.

## The calendar
**📅 Calendar** in the sidebar shows your open tasks with a date, as a month grid and as an agenda. Repeating tasks show their coming times too. The week starts on Monday or Sunday, as set in Settings. Appointments from a [linked calendar](calendar.md) show as grey blocks with their titles.

## The counter on the icon
The app icon, the browser tab and the favicon show how many tasks are due today, overdue ones included. The favicon gets a red dot when something is overdue. Switch it off per device in Settings.

To see which tasks the number stands for, look at the top of the list: a bar **Due today** shows the same number, red when something is overdue. Tap it to fold it open: it lists those tasks from all your lists (shared ones too), the earliest first, each with the name of its list (tap that name to open the list). Tap a task to open it, or tick it off right there. The bar stays open or closed on that device the way you left it, and it is gone when nothing is due or the counter is switched off.

## Notifications on your devices
Turn notifications on per device under **⚙ Settings → Notifications**, and use *Send test notification* to check.

Save a reminder on a device where notifications are still off, and a bar appears at the top of your list: *Notifications are off*. **Turn on notifications** does the same as *Turn on and send test notification* in Settings. If your phone or browser blocks notifications, the bar explains where to allow them instead. **Not now** hides it on this device for 30 days; once notifications are on, it does not come back. If you turned notifications off yourself in Settings, the bar leaves you alone. A place reminder only brings up the bar in the Android app, because only the app notifies you at a place. In an Android work profile, the bar and the permission are separate from your personal profile.

- **Android:** the [Android app](android.md) shows notifications as Tick, and adds place reminders.
- **iPhone and iPad:** notifications only work when Tick is on the home screen: Share → *Add to Home Screen*, then open Tick from there. See [iPhone and iPad](iphone.md).
- **Desktop:** any modern browser.
- When no notification could be delivered within 15 minutes, or you have no device with notifications, Tick can send it to a webhook instead (see [Integrations](integrations.md#fallback-webhook)).
