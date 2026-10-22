# Tick

A self-hosted to-do app on Cloudflare (Worker + D1 + a PWA in `public/`). How it works: [ARCHITECTURE.md](ARCHITECTURE.md).

## Setting up or updating an instance
Use the skill `setup-tick` (`.claude/skills/setup-tick/SKILL.md`); it follows [SETUP.md](SETUP.md).

## Rules for changes
- **Config is local.** `wrangler.jsonc` belongs to the person running Tick and is not in git; `wrangler.example.jsonc` is the template. A new setting goes into both (the example with a safe default and a comment) and into the `Env` type in `src/index.ts`.
- **Texts:** every visible text goes through `public/i18n.js`, with an `en` and an `nl` value (`test/i18n.test.ts` checks that both have the same keys). Server errors throw `HttpError(status, key, vars)`, never a sentence.
- **Migrations:** a schema change is a new file in `migrations/` (`0006_….sql` and up); never edit an existing migration.
- **PWA:** no build step and no inline scripts or styles (CSP). When you add a module to the app, add it to `SHELL` in `public/sw.js` and bump `CACHE` (`test/offline.test.ts` checks the list).
- **Time:** store UTC; times without a zone and repeat rules use `TIMEZONE` (`setTimeZone` in `public/repeat.js`).
- **Docs:** a new or changed feature also updates its page in the user guide in `docs/` (index: `docs/README.md`, in English, for people using Tick) and, when it changes how Tick is built, `ARCHITECTURE.md`. A new topic gets its own page and a row in the index.
- **Verify:** `npm run typecheck` and `npm test` must pass. For UI changes also check the app in the browser with `npm run dev`.
- **Deploy:** `npm run db:migrate`, then `npm run deploy`, then check with `npx wrangler deployments list`.
