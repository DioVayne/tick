# How the screenshots are made

The images in `docs/screenshots/` are made from a local Tick filled with demo data. Nothing here is real data.

1. **A local Tick.** Copy the repo to a folder outside any synced drive (for example `C:\dev\tick-readme`), run `npm ci`, put `DEV_AUTH_BYPASS=1` in `.dev.vars`.
2. **A fresh database** with the demo users (Robin, Sanne, Alex and their demo keys):
   `bash reset.sh <state-dir> <demo-users.sql>` from that folder, then `npx wrangler dev --port 8801 --persist-to <state-dir>`.
3. **Demo tasks:** copy `seed.mjs` next to a `node_modules` with `playwright@1.56` and run `node seed.mjs`. Then make the Tickmanager tasks old:
   `npx wrangler d1 execute DB --local --persist-to <state-dir> --file seed-old.sql`.
4. **Raw screens:** `shot.mjs` takes one screenshot per line of `shots.txt` into `raw/` (phone 390×844 and desktop 1280×800, both at 2×, clock fixed at 27 October 2026, Europe/Amsterdam).
   `raw/a-*.png` come from the Android emulator (`adb exec-out screencap -p`).
5. **Framing:** `compose.mjs` renders `compose.html` (phone frames, close-ups, tiles) to the transparent PNGs in `docs/screenshots/`.

Run the scripts from a copy next to `node_modules`; `import 'playwright'` is resolved from the script's own folder.
