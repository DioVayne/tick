# Places

A task can have a place: Tick notifies you when you **arrive** there or when you **leave**. The shopping list at the supermarket, the parcel as you step out the door.

> [!NOTE]
> Place reminders need the [Android app](android.md). You can set a place in the web app on any device, but only an Android phone with the app notifies you.

## Setting a place
Open a task and tap **Location**. A map opens:
1. Search for an address (press Enter), drag the map so the pin sits on the place, tap "my location", or pick a favorite.
2. Choose **On arrival** or **On leaving**.
3. Set the radius, 200 m to 2 km. Until you move it yourself, it is 500 m on arrival and 200 m on leaving.

In the Android app you can also add a place straight from **➕** on the widget, without the map: pick a favorite, a recent place, your current location or a search result, then *On arrival* or *On leaving*. See [Android, Quick add](android.md#quick-add-and-sharing-to-tick).

The place is named after the favorite or search result, or "Pinned place". You get one notification per task; changing the place arms it again. A repeating task arms it again each time it moves on.

Not the right moment? **Swipe the notification away** and it comes back the next time you arrive (or leave), not while you are still there. Tap **Done** to finish the task for good.

Already notified, and you want it again? Under the place it says "Already notified"; tap **Notify again** there. It then notifies you the next time you arrive (or leave). **Clear** next to the place removes it from the task.

## More than one place
Buy milk at whichever supermarket you pass first? Give the task more than one place, up to 10:
1. Choose the first place on the map as usual.
2. Tap **+ Another place**. The place moves to the list **Also at** and shows as a light, dotted circle on the map.
3. Move the map to the next place (search, a favorite, or drag) and tap **+ Another place** again, or tap **Use these places** to finish. The place under the pin counts too.

- You get **one** notification, at the first of these places you arrive at (or leave). After that the task is done with all its places, just like with one place; **Notify again** arms all of them.
- *On arrival* or *On leaving* counts for all the places of a task; each place has its own radius.
- In the list "Also at", tap a place to move it or change its radius, or ✕ to remove it.
- The task shows all names; the list shows the first one with "+2".
- You pick the places yourself. Tick does not look up shops for you and does not know which supermarket you went to: your phone only tells Tick that a notification went off.
- Quick add on the widget sets one place; add more in the app.
- The phone needs Android app version 1.13.0 or newer for this. An older app only watches the first place.
- Each place counts toward the phone's limit (see [Good to know](#good-to-know)).

## Favorite places
**Save as favorite** on the map keeps a place with its name and radius, so next time it is one tap. Manage your favorites under **⚙ Settings → Places**. A favorite is a template: editing or deleting it does not change tasks that already use it.

## On the road
Android notices that you reached a place only a few minutes later. On foot that hardly matters; by car or bike you are past your circle by then. Under **⚙ Tick on this phone** (in the Android app) you can turn on **On time on the road** (not in the Google Play version):

- While you drive or cycle, Tick makes arrival circles bigger, so the notification comes around the edge of the circle you set. It then says "Almost at …".
- How much bigger, Tick learns from your earlier notifications, separately for car and bike. The screen shows the margin it uses now.
- A circle never grows so big that you are already inside it when you set off, so a shop around the corner works too.
- When you get out or off, the circles go back to normal.
- Tick asks for the permission **Physical activity**, only to know *whether* you drive or cycle; it is not a health or fitness feature. Only how late earlier notifications came is kept, on the phone; nothing about where you are or how you travel is sent.
- Android itself takes up to a minute or so to notice you started driving or cycling, so a place a few hundred metres from where you set off may still come late.

## Why the radius has limits
- Below 200 m the location drifts too much indoors and you get false alarms.
- A car crosses a small circle in seconds, so arrival uses 500 m by default.
- Android reports places with a delay of a few minutes (see [On the road](#on-the-road)).

## Good to know
- If you are already at the place when you set it, the arrival notification only comes the next time you arrive.
- On a shared task everyone on it gets their own notification, so the first person to arrive does not use it up for the others. With more places, each person is notified at the first place *they* reach.
- A place set on a laptop reaches your phone within about 15 minutes; set on the phone itself, within about a minute.
- Android watches at most 100 places at once per app. A task with three places counts as three. Tick fills them in list order, and a task gets all its places or none: if one no longer fits, it is skipped and a later task with fewer places may still fit. Tasks that are done or already notified do not count. **⚙ Tick on this phone** says how many tasks are not being watched, and the map warns you when your open tasks have more than 100 places together.
- The map needs a connection. Maps come from OpenStreetMap.
- Your phone watches the places itself and only tells Tick that a notification went off; Tick keeps no record of where you have been.
- The Android app shows under **Tick on this phone** how far inside the circle recent arrival notifications came. It keeps only those distances, on the phone, never where you were.
