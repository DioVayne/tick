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
Add the Tick widget to your home screen. Each widget has its own settings (they open when you add it, or long-press the widget and choose its settings; **Widget settings** in *Tick on this phone* asks which widget first). You choose:
- what it shows: all tasks, *Today and overdue*, or one list;
- the layout: **Automatic**, **Compact** or **Roomy**;
- text size and line spacing.

So a small shopping list and a big day overview can sit side by side, each looking its own way. A preview at the top of the settings shows the widget with a few example tasks and changes as you move the sliders.

**Compact** shows one title line per task (two on a narrow but tall widget, such as 3 columns by 3 rows), without tiles or icons, so a lot fits in a small widget. **Roomy** shows titles on two lines, more details under the title, a little more space and headings between groups: *Overdue* and *Today* in a *Today and overdue* widget, *Pinned* and *Other tasks* in other widgets (only when there are pinned tasks). The order of the tasks is the same in both. **Automatic** picks by size: Roomy from about 4 columns wide and 3 rows high, Compact when the widget is smaller; resize the widget and it switches by itself. The circle, **Undo** and the buttons stay easy to tap (at least 48 dp) in both layouts.

Tick tasks off right there: tap the circle. The task stays in its place for 6 seconds, struck through, with an **Undo** button; tap it to put the task back (a repeating task goes back to the date it had). After that the task disappears. Because the list doesn't move during those seconds, you can tick off several tasks in a row without hitting the wrong one. Tap a task's title to open it in the app, tap the header to open the app on that list, and add a task with **➕** (it goes into the widget's list). The widget can be resized.

**What a row shows.** The title comes first. Under it, the widget only shows what helps you decide what to do next; open the task for everything else:
- the reminder time (red when it is overdue);
- the list, in widgets with *All tasks* or *Today and overdue*. On a wide widget it sits as a small label next to the title; on a narrow widget it moves to the line under the title, so the title keeps its room;
- who is doing it, for a task in a shared list that someone else took on, for example *Sam is doing this*;
- in Roomy also: how many subtasks are still open (*3 subtasks open*), who a shared task is shared with (*Shared with Sam*, or *Shared with Sam and 2 others*), and on a wide widget small icons for repeat and place.

When the line under the title is too long, the end is cut off first, so the time and the list stay visible.

**Messages at the top.** Normally the widget shows only your tasks. A line at the top appears only when something needs you, and you can tap it:
- *Link Tick to see your tasks* (the phone isn't linked): opens Tick to link it;
- *No connection · try again* or *Not updated: server error … · try again*: tap to refresh right away;
- *2 changes waiting for connection · try again* (see below);
- *Nothing planned for today · Add a task* (or *Nothing to do* / *Nothing in this list*): opens quick add.

When the list hasn't been updated for more than an hour, a small *Updated 14:05* shows at the top. The time of the last update is also read out with the refresh button (for screen readers).

### Without a connection
The widget keeps working offline. It shows the tasks from the last update; ticking off, **Undo** and adding a task with **➕** are saved on the phone first and sent as soon as there is a connection again. A task you ticked off stays hidden and a task you added shows up at once, also before Tick has them. While changes are waiting, the line at the top of the widget says so, for example "2 changes waiting for connection · try again"; tap it to send them right away. If you tick something off and undo it before it was sent, Tick sends nothing at all.

Sometimes Tick can't save a change later, for example when the task was deleted in the meantime or is no longer shared with you. Then the widget shows the task as it is in Tick again and says for a few minutes what was not saved. A repeating task you ticked off offline moves to its next date once the change is sent.

## On time on the road
Android notices a place a few minutes late, so by car or bike you would be past it. Turn on **On time on the road** in *Tick on this phone* and Tick makes arrival circles bigger while you drive or cycle. How it works: [Places, On the road](places.md#on-the-road). Not in the Google Play version.

## Quick add and sharing to Tick
**➕** on the widget, the **New task** shortcut on the app icon, and *Share* from another app all open a panel at the bottom of the screen. It starts small: the list, the title and **Add**. Type the title and tap **Add** (or Send on the keyboard).

- **Choose the list** with the button at the top. It starts on the widget's list (Inbox for *All*, *Today and overdue* and the shortcut).
- **The reminder is always spelled out** under the title, for example *Reminder today at 15:00*, in 24-hour time on your phone's clock. From a *Today and overdue* widget the panel starts with a reminder at the next whole hour (after 23:00: right away), because otherwise the new task would not show up in that widget. Tap the line to pick another date and time, or **✕** to remove the reminder; the line then says the task will not show in *Today* (tap it to put the reminder back).

**More options** opens the rest:
- **set a reminder** with *Today* (the next whole hour), *Tomorrow* or *Next week* (09:00), or *Pick…* for any date and time. Tap the chosen button again to remove the reminder;
- **add a place** with *Place*: one of your favorites, a place you used recently, your current location, or an address you search for. Then choose **On arrival** or **On leaving**. The radius is the favorite's, or 500 m on arrival and 200 m on leaving; a recent place keeps the radius and choice you used then. To move the pin, change the radius or add more places, open the task in the app afterwards. More about places: [Places](places.md);
- **repeat** the task every day, every week or every other week on that weekday, every month on that day, or every year;
- **add a description** with *Description*;
- tick **Add another one after this** to keep the panel open, so you can type several tasks in a row. The list you chose stays and the keyboard stays open; the reminder, place, repeat and description start over. Tick remembers this choice.

When *More options* is closed but you set a place, repeat or description, the button turns blue so you can see something is set.

**Closed by accident?** If you close the panel without adding (back, tapping outside it, switching apps), Tick keeps what you typed as a draft. The next time you open quick add, the title, description, place, repeat and reminder are back, with *Draft restored* and **Discard**; *More options* opens by itself when the draft uses them. Adding the task or tapping **Discard** removes the draft; so does clearing the title and description. Two rules keep a draft from ending up in the wrong place:
- the draft only keeps its **list** if you picked that list yourself. Otherwise it goes to the list of the widget you tapped now. So a draft started in the *Work* widget and reopened from the *Groceries* widget goes to *Groceries*, unless you had picked another list (say *Home*) by hand: then it stays in *Home*;
- the draft only keeps its **reminder** if you set or removed it yourself, and only if that time has not passed. Otherwise the panel starts with its usual reminder (from *Today*: the next whole hour).

A draft is kept for a week. *Share* from another app always starts with the shared text and leaves an earlier draft alone. Logging in as someone else removes the draft.

Adding also works without a connection: the task shows up in the widget at once and goes to Tick when the phone is online again (see [Without a connection](#without-a-connection)).

A date here uses 09:00, not your own reminder time.

## When something does not work
- **No place notifications:** check in *Tick on this phone* that location is allowed all the time and that battery saving does not stop the app.
- **The widget says "not linked":** the key was revoked (for example under **⚙ Settings → Devices**). Open the app and link again.
- **Notifications twice:** if Chrome on the same phone also has notifications on, turn them off there; the app offers this hint once.
