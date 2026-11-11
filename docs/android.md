# Android app

The Android app adds what a web app cannot do: [place reminders](places.md), a home-screen widget, quick add, and notifications that show as Tick instead of Chrome. Inside the app you use the same Tick as in the browser.

## Getting it
On your phone, [download Tick.apk](https://github.com/DioVayne/tick/releases/latest/download/Tick.apk) and open it (Android asks to allow installing from your browser). On first start, type the address of your Tick and log in. Building the app yourself is in [SETUP.md, step 10](../SETUP.md#10-optional-android-app).

The app checks GitHub once a day for a new version and notifies you; **Search for updates** in *Tick on this phone* checks right away.

There is also a Google Play version (package `nl.ticktodo.app`, in testing). It starts on app.ticktodo.nl, the hosted Tick; to use your own Tick in it, open **Phone settings → Change address**. Moving your tasks along is in [Moving to another Tick](moving.md). Play keeps it up to date, so it has no GitHub update check. It also leaves out [On time on the road](#on-time-on-the-road), and **Turn off battery restriction** opens the app's settings (choose *Battery*, then *Unrestricted*) instead of asking directly. The two versions are separate apps and can be installed side by side; use one of them.

## Linking
After you log in, the app links itself to your account with a one-time code and asks for permission for notifications and location. Before each Android question it explains what the permission is for; your location stays on the phone. If that does not happen, tap **Link** in the bar in the app. Logging in as someone else in the app links it to that account and clears the previous person's data from the phone.

For place reminders, allow location **all the time**. *Tick on this phone* (the shortcut **Phone settings**, or **⚙ Settings → Devices**) shows whether notifications and location work, and **⚙ Settings → Devices** shows it for each of your phones.

## The widget
Add the Tick widget to your home screen. In its settings you choose:
- what it shows: all tasks, *Today and overdue*, or one list;
- text size and line spacing.

Tick tasks off right there (you get 3 seconds to undo), tap a task to open it in the app, tap the header to open the app on that list, and add a task with **➕** (it goes into the widget's list). Each row shows the reminder, list, pin, repeat, place, sharing (blue people: one shared task; grey sheets: a copy, everyone has their own) and open subtasks. The widget can be resized.

## On time on the road
Android notices a place a few minutes late, so by car or bike you would be past it. Turn on **On time on the road** in *Tick on this phone* and Tick makes arrival circles bigger while you drive or cycle. How it works: [Places, On the road](places.md#on-the-road). Not in the Google Play version.

## Quick add and sharing to Tick
**➕** on the widget, the **New task** shortcut on the app icon, and *Share* from another app all open a panel at the bottom of the screen. Type the title and tap **↑** (or Send on the keyboard). Under the title you can:
- **choose the list** with the button at the top (it starts on the widget's list, or Inbox);
- **set a reminder** with *Today* (the next whole hour), *Tomorrow* or *Next week* (09:00), or *Pick…* for any date and time. Tap the chosen button again to remove the reminder. From a *Today and overdue* widget the panel starts on *Today*, so the new task shows up in that widget;
- **add a place** with *Place*: one of your favorites, a place you used recently, your current location, or an address you search for. Then choose **On arrival** or **On leaving**. The radius is the favorite's, or 500 m on arrival and 200 m on leaving; a recent place keeps the radius and choice you used then. To move the pin, change the radius or add more places, open the task in the app afterwards. More about places: [Places](places.md);
- **repeat** the task every day, every week or every other week on that weekday, every month on that day, or every year;
- **add a description** with *Description*.

Tick *Add another one after this* to keep the panel open, so you can type several tasks in a row; Tick remembers this choice. If adding fails (for example without a connection), the panel stays open with your text and says why, so you can try again.

A date here uses 09:00, not your own reminder time.

## When something does not work
- **No place notifications:** check in *Tick on this phone* that location is allowed all the time and that battery saving does not stop the app.
- **The widget says "not linked":** the key was revoked (for example under **⚙ Settings → Devices**). Open the app and link again.
- **Notifications twice:** if Chrome on the same phone also has notifications on, turn them off there; the app offers this hint once.
