# Home Assistant triggers

If you use [Home Assistant](https://www.home-assistant.io/) at home, a task in Tick can remind you at a moment from your house instead of at a time: *when Sam comes home*, *at sunset*, *when the bathroom light turns on*. You make these moments (**triggers**) once in Home Assistant. After that, you pick them on your tasks in Tick, the same way you pick a place.

## What it does

- In the task panel, tap **Notify on a Home Assistant trigger** and pick one or more triggers. The task then reads **Notify when Sam comes home**.
- The first chosen trigger that goes off sends **one** notification: the task's title, with *Home Assistant: Sam comes home* below it. It goes to you and to everyone the task is shared with.
- After that the task shows **Already notified · Notify again**, so a light that goes on twenty times a day won't keep reminding you. Tap **Notify again** to wait for the next time.
- A **repeating** task waits for the trigger again as soon as it moves on to its next time. Changing the task's triggers rearms it too.
- Tasks that are ticked off or in the trash don't notify.
- Only your own tasks (not subtasks, and not tasks someone else shared with you) can have a trigger. You can still share a task that has a trigger, and the notification reaches everyone on it.

You get the notification wherever you turned on Tick notifications: the Android app, a computer browser, or Tick on your iPhone's home screen. Like other reminders, it can be up to a minute late.

## Setting it up

You need a Home Assistant that can reach your Tick over the internet. Tick never connects to your Home Assistant, so you don't have to open it up from outside.

1. **In Tick:** ⚙ Settings → Advanced → **Keys** → **+ New key**. Pick access **Full access** and name it, for example, "Home Assistant". Tick shows the key only once. The address of your Tick is at the top of Keys, with a Copy button.
2. **In Home Assistant: install the integration.** Copy the folder [`home-assistant/custom_components/tick`](../home-assistant/custom_components/tick) from the Tick repository into the `custom_components` folder of your Home Assistant configuration, then restart Home Assistant. (Installing through HACS is coming.)
3. Settings → Devices & services → **Add integration** → **Tick**. Paste the address and the key.
4. On the Tick integration's page, choose **Add trigger**:
   - **Name in Tick:** how you want to read it in Tick, for example *Sam comes home*.
   - **Watch:** a person, the sun, a light, a door sensor… Leave it empty for a trigger that only goes off from its button or your own automation.
   - On the next screen, **Changes to:** the state, for example *Home* or *On*.
   - Optional: **Only after it stayed so for** (for example 5 minutes, so a short visit doesn't count) and **Only from / Only until** (for example 22:00 to 06:00; that works over midnight).
5. **In Tick:** open a task → **Notify on a Home Assistant trigger** → pick the trigger. To test it, press **Fire now** on the trigger in Home Assistant.

Each trigger in Home Assistant gets a **Fire now** button and a **Last fired** sensor. In an automation you can press the button for anything more complex than "this changes to that". After Tick has handled a trigger, Home Assistant also fires the event `tick_trigger_fired`.

## Sharing triggers with your household

Only one person in the house needs Home Assistant. Under ⚙ Settings → **Home Assistant** you see the connection (when Home Assistant was last heard from) and your triggers:

- **Share all my triggers** shares them with everyone you already share a list or a task with.
- Or tap a trigger → **Share with…** and pick people.

They can then pick your trigger on their own tasks. In their list it says *from* your name. They see its name, but not when it last went off, since that would tell them when someone came home. The first time you share triggers with someone, they get one notification about it.

## Good to know

- Revoking the key in Tick disconnects Home Assistant at once.
- Home Assistant checks in with Tick every 6 hours. If Tick hears nothing for 3 weeks (the integration was removed or the key revoked), the triggers disappear from the app. Your choices are kept and come back as soon as Home Assistant checks in again.
- Renaming a trigger in Home Assistant keeps it on your tasks. Deleting it there hides it on your tasks; it no longer goes off.
- At most 50 triggers per account.
- When you [move to another Tick](moving.md), your triggers don't come along. Connect Home Assistant to the new Tick with a new key.
- Tick only learns the trigger names and when each went off, nothing else about your home.
- A trigger only notifies about tasks you already have. To **add** tasks from Home Assistant (for example when the washing machine is done), use the YAML package or the inbox API: see [Integrations](integrations.md).
