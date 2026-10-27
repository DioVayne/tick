# Places

A task can have a place: Tick notifies you when you **arrive** there or when you **leave**. The shopping list at the supermarket, the parcel as you step out the door.

> [!NOTE]
> Place reminders need the [Android app](android.md). You can set a place in the web app on any device, but only an Android phone with the app notifies you.

## Setting a place
Open a task and tap **Location**. A map opens:
1. Search for an address (press Enter), drag the map so the pin sits on the place, tap "my location", or pick a favorite.
2. Choose **On arrival** or **On leaving**.
3. Set the radius, 200 m to 2 km. Until you move it yourself, it is 500 m on arrival and 200 m on leaving.

The place is named after the favorite or search result, or "Pinned place". You get one notification per place; changing the place arms it again. A repeating task arms it again each time it moves on.

Not the right moment? **Swipe the notification away** and it comes back the next time you arrive (or leave), not while you are still there. Tap **Done** to finish the task for good.

Already notified, and you want it again? Tap the small **Already notified** label next to the place. It then notifies you the next time you arrive (or leave). The **✕** next to it removes the place.

## Favorite places
**Save as favorite** on the map keeps a place with its name and radius, so next time it is one tap. Manage your favorites under **⚙ Settings → Places**. A favorite is a template: editing or deleting it does not change tasks that already use it.

## On the road
Android notices that you reached a place only a few minutes later. On foot that hardly matters; by car or bike you are past your circle by then. Under **⚙ Tick on this phone** (in the Android app) you can turn on **On time on the road**:

- While you drive or cycle, Tick makes arrival circles bigger, so the notification comes around the edge of the circle you set. It then says "Almost at …".
- How much bigger, Tick learns from your earlier notifications, separately for car and bike. The screen shows the margin it uses now.
- A circle never grows so big that you are already inside it when you set off, so a shop around the corner works too.
- When you get out or off, the circles go back to normal.
- Tick asks for the permission **Physical activity**, only to know *whether* you drive or cycle. Nothing about where you are or how you travel is stored or sent.
- Android itself takes up to a minute or so to notice you started driving or cycling, so a place a few hundred metres from where you set off may still come late.

## Why the radius has limits
- Below 200 m the location drifts too much indoors and you get false alarms.
- A car crosses a small circle in seconds, so arrival uses 500 m by default.
- Android reports places with a delay of a few minutes (see [On the road](#on-the-road)).

## Good to know
- If you are already at the place when you set it, the arrival notification only comes the next time you arrive.
- On a shared task everyone on it gets their own notification, so the first person to arrive does not use it up for the others.
- A place set on a laptop reaches your phone within about 15 minutes; set on the phone itself, within about a minute.
- Android allows at most 100 places at once.
- The map needs a connection. Maps come from OpenStreetMap.
- Your phone watches the places itself and only tells Tick that a notification went off; Tick keeps no record of where you have been.
- The Android app shows under **Tick on this phone** how far inside the circle recent arrival notifications came. It keeps only those distances, on the phone, never where you were.
