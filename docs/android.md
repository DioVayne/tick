# Android app

The Android app adds what a web app cannot do: [place reminders](places.md), a home-screen widget, quick add, and notifications that show as Tick instead of Chrome. Inside the app you use the same Tick as in the browser.

## Getting it
On your phone, [download Tick.apk](https://github.com/DioVayne/tick/releases/latest/download/Tick.apk) and open it (Android asks to allow installing from your browser). On first start, type the address of your Tick and log in. Building the app yourself is in [SETUP.md, step 10](../SETUP.md#10-optional-android-app).

The app checks GitHub once a day for a new version and notifies you; **Search for updates** in *Tick on this phone* checks right away.

## Linking
After you log in, the app links itself to your account with a one-time code and asks for permission for notifications and location. If that does not happen, tap **Link** in the bar in the app. Logging in as someone else in the app links it to that account and clears the previous person's data from the phone.

For place reminders, allow location **all the time**. *Tick on this phone* (the shortcut **Phone settings**, or **⚙ Settings → Devices**) shows whether notifications and location work, and **⚙ Settings → Devices** shows it for each of your phones.

## The widget
Add the Tick widget to your home screen. In its settings you choose:
- what it shows: all tasks, *Today and overdue*, or one list;
- text size and line spacing.

Tick tasks off right there (you get 3 seconds to undo), tap a task to open it in the app, tap the header to open the app on that list, and add a task with **➕** (it goes into the widget's list). Each row shows the reminder, list, pin, repeat, place, sharing and open subtasks. The widget can be resized.

## Quick add and sharing to Tick
**➕** on the widget, the **New task** shortcut on the app icon, and *Share* from another app all add a task. A date without a time gets 09:00 here, not your own reminder time.

## When something does not work
- **No place notifications:** check in *Tick on this phone* that location is allowed all the time and that battery saving does not stop the app.
- **The widget says "not linked":** the key was revoked (for example under **⚙ Settings → Devices**). Open the app and link again.
- **Notifications twice:** if Chrome on the same phone also has notifications on, turn them off there; the app offers this hint once.
