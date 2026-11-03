# How the screenshots are made

The images in `docs/screenshots/` are made from a local Tick filled with demo data. Nothing here is real data.

1. **A local Tick.** Copy the repo to a folder outside any synced drive (for example `C:\dev\tick-readme`), run `npm ci`, put `DEV_AUTH_BYPASS=1` in `.dev.vars`.
2. **A fresh database** with the demo users (Robin, Sanne, Alex and their demo keys): `bash reset.sh <state-dir> <demo-users.sql>` from that folder.
3. **Demo tasks.** Start Tick with the login bypass *off*, so Sanne and Alex act as themselves:
   `npx wrangler dev --port 8801 --persist-to <state-dir> --var DEV_AUTH_BYPASS:0`.
   Copy `seed.mjs` next to a `node_modules` with `playwright@1.56` and run `node seed.mjs`. Then make the Tickmanager tasks old and fix the times things were ticked off:
   `npx wrangler d1 execute DB --local --persist-to <state-dir> --file seed-old.sql`.
   The dates in `seed.mjs` fit a clock of 3 November 2026; seeding on another day can leave "ticked off" times in the future.
4. **Raw screens.** Restart Tick with the bypass on (without `--var`), so the browser is Robin. `node shots.mjs <raw-dir> [scene ...]` takes the scenes listed in `shots.mjs` (phone 390×844 and desktop 1280×800, both at 2×, clock fixed at 3 November 2026, 16:20, Europe/Amsterdam).
   `raw/a-*.png` come from the Android emulator (`adb exec-out screencap -p`).
5. **Framing.** `compose.mjs` renders `compose.html` (phone frames, close-ups, tiles) to the transparent PNGs in `docs/screenshots/`.

Run the scripts from a copy next to `node_modules`; `import 'playwright'` is resolved from the script's own folder.
