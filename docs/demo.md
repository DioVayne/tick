# Trying Tick without an account (demo)

On a Tick that offers it (like app.ticktodo.nl), **Try the demo** gives you your own Tick straight away, with no email address or password. It disappears again after a while.

## What you get
- A **welcome task** with subtasks that explain Tick.
- A few **sample tasks**: one with a reminder tomorrow, one that repeats every week and one every month, one that is overdue, a pinned task with a note, and lists **Groceries** and **Work**.
- A **shared list** "Weekend away" from Sam, a sample person. You can tick off and add tasks in it, just like in a list you share with someone at home.

Everything works as in a normal account: adding, editing, ticking off, dragging, lists, repeating, the Tickmanager and the settings for display and time.

## What a demo can't do
A demo can't reach other people or devices. Sharing with someone, sending email, notifications on your phone, linking the Android app, keys, attachments, a background photo, linking a calendar, moving and importing all say **That isn't possible in the demo**.

## How long it lasts
The bar at the top shows how long your demo has left. Every time you use it the time starts again (the administrator chooses 30, 60 or 120 minutes), up to 3 hours in total. After that the demo and everything in it is deleted, and you are back on the login screen.

## Keeping your tasks
On a Tick where anyone can create an account, the bar has a **Create account** button. Fill in your name, email address and a password: the demo becomes a normal account and everything stays, including the list from Sam (which is now yours). After that the usual rules apply, such as confirming your email address ([Creating your own account](signup.md)).

## For the administrator
The demo exists only when `DEMO` is `"true"` in the Tick's configuration (see [SETUP.md](../SETUP.md) and `wrangler.example.jsonc`). Then **Settings → Advanced → Demo without an account** lets you turn it off and on and choose how long a demo lasts, and shows how many are running. The link to share is `https://<your Tick>/demo`. Demos don't appear on the accounts page.
