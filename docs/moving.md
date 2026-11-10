# Moving to another Tick

Tasks can only be shared between people on the same Tick. If you want to switch, you can take your whole account with you: from app.ticktodo.nl to your own Tick, from your own Tick to app.ticktodo.nl, or between any two Ticks. Your own Tick can run on a free Cloudflare account (see [SETUP.md](../SETUP.md)).

## How to move

1. On your **new** Tick, log in. Don't have an account there yet? Create one first (on an open Tick: [Creating your own account](signup.md); on your own Tick you are the administrator).
2. On your **old** Tick, open **Settings › Data › Move to another Tick** and tap **Make code**. You get one line, the moving code, with a **Copy** button. Keep it to yourself: anyone with the code can read your account for an hour.
3. On your **new** Tick, open **Settings › Data › Move here from another Tick**, tap **Paste code**, paste the line and tap **Next**.
4. Tick shows where the code comes from and what will come along (number of tasks, places, attachments and so on). Tap **Move**.
5. Keep the screen open. First your tasks and settings arrive, then the attachments one by one with a counter.
6. At the end you see what arrived, and what to do next:
   - using the Android app? Open **Phone settings › Change address** and enter the new address ([Android app](android.md));
   - check that everything is there;
   - then, if you like, delete your old account on the old Tick (**Settings › Account › Delete account**, see [Settings](settings.md)), and let the people you shared with know where you went.

The code works for one hour. **Stop code** in the same window makes it stop at once; making a new code also stops the previous one. Changing your password, choosing a new one through a reset link, or **Log out on all other devices** on the old Tick stops the code too (see [Settings](settings.md#account)); make a new one if you still want to move.

## What comes along

- All your tasks: open, completed and in the trash, with subtasks, notes, reminders, repeats, the place on a task, and pinned tasks.
- Your favourite places, your empty lists, and the lists you skip in the [Tickmanager](tickmanager.md).
- The files of your attachments and your background photo.
- Your settings: time zone, reminder time, overdue nudge, week start, driving mode, Tickmanager and its days, and your fallback webhook.
- Your [linked calendars](calendar.md). The new Tick stores their secret addresses with its own key and fetches them the next time you open the app.

## Shared tasks and lists

Sharing only works within one Tick, so it cannot move along.

- **Tasks and lists shared with you** come along as your own tasks, in the list where you had them. They no longer change when the others change them, and the others keep their task on the old Tick.
- **Tasks and lists you shared** come along as your own tasks too. On the old Tick nothing changes until you delete your old account. Then tasks you shared on their own disappear for the others too, and a shared list passes to another member (see [Settings](settings.md)).

## What does not come along

- Your password, keys, linked phones and notification settings: they belong to the Tick you use. Link your phone again on the new Tick.
- Invitations, blocks and reports.
- Attachments, if the new Tick doesn't store files (its administrator has not set up attachments), or if a file is bigger than the new Tick allows. Calendars, if linking calendars is off on the new Tick. The window before you move says how many.

## Good to know

- **Nothing is deleted.** Your tasks on the new Tick stay, and the old Tick keeps everything until you delete your old account yourself.
- **Moving again is safe.** If moving stops halfway (no connection, the screen closed), move again with the same code: what already arrived is updated, not added twice.
- **Both Ticks need this feature.** If the old Tick is from before it, its owner has to update it first ([SETUP.md](../SETUP.md#updating)); you then see "The other Tick can't do this yet".
- A backup file (**Settings › Data › Download backup**) is something else: it holds only your own tasks and places, without settings or files.
