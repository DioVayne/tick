# Settings

Everything is under **⚙ Settings** in the sidebar. Your name at the top of the sidebar is a shortcut to **Account**: tap it and Settings opens with that part already open. Some settings belong to **this device** only, some to **you** (all your devices), and a few to the **whole Tick** (administrator only). Offline, the settings page opens but shows the last known values for what can only change online.

## Display (this device)
- **Theme:** automatic, light or dark.
- **Color theme:** default or *Retro 70s*, each in light and dark.
- **Text size** and **space between tasks.** An example task changes along.
- **Background photo** (when attachments are set up): one photo for all your devices; another device picks it up after you open Settings there.
- **Driving mode** (you, on all your devices): on by default. See [Driving mode](driving-mode.md).
- **Show Tickmanager** (you, on all your devices): on by default. Off hides the orange button, the sidebar item and the card next to your list. See [Tickmanager](tickmanager.md).

## Places
Your favorite places: add, edit, delete. See [Places](places.md#favorite-places).

## Calendars
Shown when linked calendars are switched on for your Tick. See [Linking your calendar](calendar.md).

## Notifications
- **Notifications on this device** (this device): on or off for this browser, with **Send test notification**. On an iPhone, add Tick to your home screen first (see [iPhone and iPad](iphone.md)).
- **Daily reminder for overdue tasks** (you, on all your devices): on or off, and its time. See [Reminders](reminders.md#overdue-tasks).
- **Counter on the icon** (this device): the number of tasks due today, overdue included; red when something is overdue.

## Language and time
- **Language** (this device): automatic, English or Nederlands. Error messages and the login page on this device follow it too. Notifications come in the language of the device they go to.
- **Time zone** (you), with a button to take the zone of this device. Changing it keeps your reminders at the same clock time in the new zone. All times in Tick are shown and picked in this zone, also when your device is set to another one (when you travel, for instance): *Today*, *Tomorrow*, overdue and the calendar follow it too. Travelling for a while? Change the zone here, or use the button.
- **Reminder without a time** (you): used when you only pick a date. 09:00 by default.
- **Week starts on** Monday or Sunday (you).

## Account
Your name and email address, change your **Password**, **Log out on all other devices** (you stay logged in here) and **Log out here only**.

- **Changing your email address** asks for your current password: when you type a different address, a password field appears under it. Only the name, or the same address in other capitals, needs no password. The administrator of a Tick without a password of their own uses the login password from the setup.
- **Changing your password** and **Log out on all other devices** also stop what is still open outside a login: a [moving code](moving.md) you made, and any unused link to choose a new password. The same happens when you choose a new password through such a link (**Forgot password?** or a link from the administrator). Your keys and linked phones keep working.

**Delete account** erases everything in your account: tasks and subtasks, places, attachments, your background photo, settings, keys, linked devices and notifications. You confirm with your password, and it can't be undone. Shared lists pass to another member. Tasks you shared on their own disappear for the others too; copies stay. Your data is removed from Tick right away. Backups are erased automatically within 30 days. On an open Tick, a report you made or that was about you stays as an anonymised record, without your name, email address or note (see [Reporting and blocking](reporting.md#when-an-account-is-deleted)). Afterwards you are logged out and see a confirmation on the login page. Want to keep your tasks? Download a backup first (see [Data](#data)).

The administrator can't delete their own account, so a Tick never ends up without an administrator.

The same steps are on a public page, `/delete-account` on your Tick's address (for example `https://tick.example.com/delete-account`), which works without logging in. It also explains how to delete only some of your data (tasks, lists, attachments, places, linked phones and keys) and keep your account, and it tells people who can't log in whom to email: the address in `ADMIN_CONTACT`.

## Devices
This browser, your other browsers with notifications, and your Android phones with when they were last seen and whether notifications and location work, with a hint when something is off. **+ Link Android phone** is here too: normally not needed, because logging in on the phone links it automatically. On an Android phone in the browser there is also **Connect the Android app**, which opens the Tick app and connects it to this Tick.

## Accounts (administrator)
Everyone on this Tick with when they were last seen. **+ Invite someone** and **Reset link** make one-time links (see [Sharing](sharing.md#accounts)). Deleting an account erases all of that person's data; a shared list they own goes to the member who has been in it longest, and a list without members disappears.

## Data
- **Backup of all your tasks** (**Download**): a file with your own tasks and places (completed tasks included). Not included: settings, keys, tasks others shared with you, and the files of attachments.
- **Restore a backup** (**Choose file**): shows what is in the file first, then merges by task: tasks in the file overwrite the same task here and deleted ones come back. Nothing is deleted.
- **Get tasks from TickTick** (**Import .csv**): upload the CSV of a TickTick backup. Importing the same file again skips what is already there and keeps your changes. A row with a date Tick can't read is still imported, without that date.
  - **Dates:** an open task with a due date gets that date as its reminder, also when it had no reminder in TickTick. A due date with a time keeps that time; an all-day due date lands on that day (as TickTick had it) at your **Reminder without a time**, in your own time zone. A due date that has already passed comes in as overdue, without a notification for each one. Completed tasks come in without a date.
  - **Not imported:** repeat rules (the task comes in once, on its next due date; set the repeat again in Tick; after the import Tick says how many tasks had one), tags, priority, and notes (only tasks are imported).
- **Move here from another Tick** and **Move to another Tick:** take your whole account to another Tick, with settings, attachments and calendars, using a moving code. See [Moving to another Tick](moving.md).
- **Storage** (only when attachments are set up): how much room your photos and files take, and the limit if your Tick sets one (`MAX_ACCOUNT_MB`). When it is full, delete some attachments to make room.

## Advanced
- **Keys:** for the Android app (*full*) and automations (*inbox*). A key is shown once; revoke it here and it stops working at once. A phone or automation key can never change your password, settings or keys.
- **Default language** of this Tick (administrator): for the fallback webhook and devices without a language.
- **Fallback webhook:** see [Integrations](integrations.md#fallback-webhook).
