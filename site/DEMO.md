# Hero demo "Loop naar de winkel" — integration notes

Files (all in `site/public/`): `demo.js` (ES module, no dependencies), `demo.css`,
`img/icon.svg` (copy of the Tick pin), `img/demo-static.svg` (no-JS still, language-neutral).
Used in `index.html` and `en/index.html`.

## Markup to paste

In `<head>`:

```html
<link rel="stylesheet" href="demo.css">
<script type="module" src="demo.js"></script>
```

Where the demo goes (NL page):

```html
<div class="tdemo" data-tick-demo
     data-hint="Sleep mij naar de winkel"
     data-walk="Loop maar"
     data-arrived="📍 Aangekomen bij de supermarkt"
     data-arrived-bike="📍 Bijna bij de supermarkt"
     data-task="Melk kopen"
     data-done-label="Afvinken"
     data-dismiss-label="Melding wegvegen"
     data-after-done="Melk in de tas. Afgevinkt."
     data-after-dismiss="Weggeveegd? Dan komt hij terug zodra je er weer bent."
     data-bike="Op de fiets"
     data-bike-note="Op de fiets: eerder een seintje, zodat je niet voorbij fietst."
     data-radius="200 m"
     data-radius-bike="400 m"
     data-reset="Opnieuw"
     data-footnote="Meldingen op een plek werken in de Android-app."
     data-app="Tick"
     data-now="nu"
     data-icon="img/icon.svg"
     data-aria-map="Kaartje met een huis, een straat en een supermarkt met een cirkel eromheen."
     data-aria-walker="Wandelaar. Gebruik de pijltjestoetsen of sleep naar de cirkel; Enter loopt naar de winkel."
     data-aria-notification="Melding van Tick">
  <img class="tdemo-fallback" src="img/demo-static.svg" width="560" height="340"
       alt="Kaartje: iemand loopt een cirkel rond de supermarkt in en krijgt een melding van Tick: Melk kopen.">
</div>
```

EN page: same markup with
`data-hint="Drag me to the shop" data-walk="Walk there" data-arrived="📍 Arrived at the supermarket"
data-arrived-bike="📍 Almost at the supermarket" data-task="Buy milk" data-done-label="Complete"
data-dismiss-label="Swipe away notification" data-after-done="Milk in the bag. Ticked off."
data-after-dismiss="Swiped away? It comes back as soon as you are there again." data-bike="By bike"
data-bike-note="By bike: a heads-up a little earlier, so you don't ride past." data-reset="Start over"
data-footnote="Notifications at a place work in the Android app." data-now="now"`
plus English aria texts. Missing attributes fall back to English defaults in `demo.js`.

The JS replaces the fallback `<img>` with the live demo; without JS the still image stays.
`data-icon` is resolved relative to the page, so adjust it if the page is not at the site root.

## Wording = the real app

The notification copies the Android location notification (`android/app/src/main/res/values*/strings.xml`,
built in `Notify.java`): title is the task, text is the place line, one action button, swipe-away re-arms.

| What | NL | EN | Source |
|---|---|---|---|
| Text on arrival (on foot) | `📍 Aangekomen bij %s` | `📍 Arrived at %s` | `loc_arrived` |
| Text on arrival by bike/car (road mode) | `📍 Bijna bij %s` | `📍 Almost at %s` | `loc_almost` |
| Action button | `Afvinken` | `Complete` | `done` |

Web push (`public/i18n.js`, `push.done` / `push.snooze`) uses `Klaar` / `Over 1 uur` and `Done` / `In 1 hour`,
but that is the time-based reminder in the browser, not the place notification, so the demo does not use it.

## CSS hooks

The page may set these on `.tdemo` (or any ancestor):

- `--tdemo-font` (default `inherit`), `--tdemo-radius` (default `22px`), `--tdemo-max-width` (default `560px`).
- Colour tokens `--tdemo-*` are defined in `demo.css` for light and dark. Dark applies with
  `prefers-color-scheme: dark` unless `<html data-theme="light">`, and always with `<html data-theme="dark">`
  (or `data-theme` on the `.tdemo` element itself).

JS only sets custom properties via `el.style.setProperty` (`--tdemo-fs`, `--tdemo-lx`, `--tdemo-ly`,
`--tdemo-swipe`, `--tdemo-swipe-o`), so it runs under `style-src 'self'`.

## Behaviour

Drag the walker (pointer events, `touch-action: none` on the walker only), arrow keys when focused
(Shift = bigger steps, Enter = walk), or "Loop maar". Entering the circle shows the notification (aria-live).
Afvinken ticks it with a few sparks; swipe sideways or × dismisses it and it returns on the next arrival
(not after Afvinken). "Op de fiets" grows the circle and switches the text to "Bijna bij…". Reduced motion:
the walker jumps, no slides or sparks. `mountDemo(el)` is exported for elements added later.
