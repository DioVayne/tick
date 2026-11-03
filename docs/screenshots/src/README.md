# How the screenshots are made

The images in `docs/screenshots/` are made from a local Tick filled with demo data. Nothing here is real data.

Two folders are involved: **the repo** (a copy outside any synced drive, for example `C:\dev\tick-readme`, where Tick runs) and **a scripts folder** with `playwright@1.56` and `sharp@0.34` in its `node_modules`, where you copy the `.mjs` files from here and run them (`import 'playwright'` is resolved from the script's own folder).

1. **A local Tick** (in the repo): `npm ci`, put `DEV_AUTH_BYPASS=1` in `.dev.vars`, and turn on `r2_buckets` in `wrangler.jsonc` (the demo task has a photo; local R2 needs no bucket and no payment method).
2. **A fresh database** (in the repo, Tick stopped): `bash docs/screenshots/src/reset.sh <state-dir>`. It loads `demo-users.sql`: Robin, Sanne and Alex with their demo keys. **Local only.**
3. **Demo tasks.** Start Tick with the login bypass *off*, so Sanne and Alex act as themselves (in the repo):
   `npx wrangler dev --port 8801 --persist-to <state-dir> --var DEV_AUTH_BYPASS:0`.
   Run `node seed.mjs` in the scripts folder. Then, in the repo, make the Tickmanager tasks old and fix the times things were ticked off:
   `npx wrangler d1 execute DB --local --persist-to <state-dir> --file docs/screenshots/src/seed-old.sql`.
   The dates in `seed.mjs` fit a clock of 3 November 2026; seeding on another day can leave "ticked off" times in the future.
4. **Raw screens.** Restart Tick with the bypass on (without `--var`), so the browser is Robin. In the scripts folder: `node shots.mjs <repo>/docs/screenshots/src/raw [scene ...]` takes the scenes listed in `shots.mjs` (phone 390×844 and desktop 1280×800, both at 2×, clock fixed at 3 November 2026, 16:20, Europe/Amsterdam).
5. **Framing.** In the scripts folder: `node compose.mjs <repo>/docs/screenshots [name ...]` renders `compose.html` (phone frames, close-ups, tiles) to the transparent PNGs in `docs/screenshots/`, compressed to palette PNGs with `sharp`.

The Android widget is not in the images: the app only talks to Tick over HTTPS, and the local Tick is HTTP.
