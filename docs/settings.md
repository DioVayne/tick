# Settings

Everything is under **⚙ Settings** in the sidebar. Your name at the top of the sidebar is a shortcut to **Account**: tap it and Settings opens with that part already open. Some settings belong to **this device** only, some to **you** (all your devices), and a few to the **whole Tick** (administrator only). Offline, the settings page opens but shows the last known values for what can only change online.

## Display (this device)
- **Theme:** automatic, light or dark.
- **Color theme:** default or *Retro 70s*, each in light and dark.
- **Text size** and **space between tasks.** An example task changes along.
- **Background photo** (when attachments are set up): one photo for all your devices; another device picks it up after you open Settings there.
- **Driving mode** (you, on all your devices): on by default. See [Driving mode](driving-mode.md).
- **Show Tickmanager** (you, on all your devices): on by default. Off hides the orange button, the sidebar item and the card next to your list. See [Tickmanager](tickmanager.md).

## Language and time
- **Language** (this device): automatic, English or Nederlands. Notifications come in the language of the device they go to.
- **Time zone** (you), with a button to take the zone of this device. Changing it keeps your reminders at the same clock time in the new zone.
- **Reminder without a time** (you): used when you only pick a date. 09:00 by default.
- **Daily reminder for overdue tasks** (you): its time, or off. See [Reminders](reminders.md#overdue-tasks).
- **Week starts on** Monday or Sunday (you).
- **Counter on the icon** (this device).

## Places
Your favorite places: add, edit, delete. See [Places](places.md#favorite-places).

## Notifications (this device)
Turn notifications on or off for this browser and send a test notification. On an iPhone, add Tick to your home screen first (see [iPhone and iPad](iphone.md)).

## Devices
This browser, your other browsers with notifications, and your Android phones with when they were last seen and whether notifications and location work, with a hint when something is off. **Connect an Android phone** is here too.

## Account
Your name and email address, change your password, **log out on other devices**, and log out.

**Delete account** erases everything in your account: tasks and subtasks, places, attachments, your background photo, settings, keys, linked devices and notifications. You confirm with your password, and it can't be undone. Shared lists pass to another member. Tasks you shared on their own disappear for the others too; copies stay. Your data is removed from Tick right away. Backups are erased automatically within 30 days. Afterwards you are logged out and see a confirmation on the login page. Want to keep your tasks? Download a backup first (see [Data](#data)).

The administrator can't delete their own account, so a Tick never ends up without an administrator.

The same steps are on a public page, `/delete-account` on your Tick's address (for example `https://tick.example.com/delete-account`), which works without logging in. It also explains how to delete only some of your data (tasks, lists, attachments, places, linked phones and keys) and keep your account, and it tells people who can't log in whom to email: the address in `ADMIN_CONTACT`.

## Accounts (administrator)
Everyone on this Tick with when they were last seen. **+ Invite someone** and **Reset link** make one-time links (see [Sharing](sharing.md#accounts)). Deleting an account erases all of that person's data; a shared list they own goes to the member who has been in it longest, and a list without members disappears.

## Data
- **Download backup:** a file with your own tasks and places (completed tasks included). Not included: settings, keys, tasks others shared with you, and the files of attachments.
- **Restore backup:** shows what is in the file first, then merges by task: tasks in the file overwrite the same task here and deleted ones come back. Nothing is deleted.
- **Import from TickTick:** upload the CSV of a TickTick backup. Importing the same file again skips what is already there and keeps your changes.
- **Storage** (only when attachments are set up): how much room your photos and files take, and the limit if your Tick sets one (`MAX_ACCOUNT_MB`). When it is full, delete some attachments to make room.

## Advanced
- **Keys:** for the Android app (*full*) and automations (*inbox*). A key is shown once; revoke it here and it stops working at once. A phone or automation key can never change your password, settings or keys.
- **Default language** of this Tick (administrator): for the fallback webhook and devices without a language.
- **Fallback webhook:** see [Integrations](integrations.md#fallback-webhook).
