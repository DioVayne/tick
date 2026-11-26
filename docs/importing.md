# Moving from another app

Tick can bring in your tasks from **TickTick** and **Todoist**. You see what comes in first, and you can undo the whole import in one go.

## How it works

1. Make an export in your old app (see below).
2. In Tick: **⚙ Settings → Data → Get tasks from another app**, and tap **TickTick** or **Todoist**.
3. Pick the file. Tick shows a preview: how many tasks, how many with a date, repeating or pinned, which lists, and what doesn't come along. Nothing is saved yet.
4. Tap **Import**. The tasks land in lists with the same names as in your old app.

Importing the same file again adds nothing twice: tasks that are already there are skipped, and your changes in Tick stay.

## Undo

After an import, **Settings → Data** shows **Undo last import** with the app, the date and the number of tasks. **Undo** moves exactly those tasks to the [trash](tasks-and-lists.md) (plus subtasks you added under them since). Tasks you already had, or made yourself, stay. Tasks that went into a shared list are undone too, as long as you're still in that list; if you left it, Tick tells you how many stayed. From the trash you can still bring a task back. Only the last import can be undone.

## TickTick

In TickTick: **Settings → Account → Backup**, which gives a `.csv` file.

- **Lists, subtasks, notes** come along. TickTick allows subtasks of subtasks; Tick has one level, so they go under the main task.
- **Dates:** an open task with a due date gets that date as its reminder. An all-day date lands on that day at your **Reminder without a time**. A date that has already passed comes in as overdue, without a notification for each one. Completed tasks come in as completed, without a date.
- **Repeats** come along when Tick knows them: every day, week (on chosen days), month (on a date, or for example the second Tuesday) or year, also "every 2 weeks" and with an end date. Repeats Tick doesn't know ("5 times", skipping holidays, repeating from the moment you complete it) come in without a repeat; the preview says how many.

## Todoist

In Todoist you can export one project at a time (**⋯ on the project → Export as a template → Download as CSV**), or take the backup of everything (**Settings → Backups**, a `.zip`). In Tick you can pick several `.csv` files at once, or the `.zip`; Tick unpacks it on your device.

- **Each project becomes a list** with the project's name. **Sections** don't exist in Tick: their tasks go into the list itself.
- **Indented tasks** become subtasks (deeper levels go under the main task). **Comments** go into the note, under the description.
- **Dates and repeats:** Todoist writes them as words ("every monday at 9am", "elke 2 weken", "Nov 25"). Tick reads English and Dutch; in another language the task comes in without a date. Repeats work like with TickTick. "every!" (repeat from when you complete it) comes in without a date or repeat.
- A **deadline** becomes a line in the note.
- Todoist doesn't put **completed tasks** in its export, so they don't come along.

## Priority

Tick has no priorities. So that nothing gets lost, the priority becomes the last line of the note: **Priority: high**, **medium** or **low** (in Dutch: **Prioriteit: hoog**, **middel**, **laag**). Tasks with **high** priority (TickTick: high, Todoist: p1) are also **pinned**, so they stay at the top of their list.

## Microsoft To Do, Things, Apple Reminders

These apps have no export file Tick can read, so they can't be imported (yet).
