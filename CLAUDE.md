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
- **Website:** a new or changed feature people can see also goes on the website in `site/public/` (served on ticktodo.nl; see the Website section of `ARCHITECTURE.md`), in **both** `index.html` (NL) and `en/index.html` (EN):
  - a tile with emoji and an expandable story with a screenshot, in "Alle functies";
  - a row in the "Wat werkt waar" table when it differs between web, Android, iPhone and self-hosted;
  - an FAQ entry if it raises an obvious question.
  Same CSP rules as the PWA. `test/site.test.ts` checks that NL and EN match; a new section anchor goes into its NL→EN map. The copy lives in `docs/superpowers/specs/2026-11-09-website-copy.md`. Never promise what the app doesn't do.
  - **The site texts are edited live** by the owner via `/beheer` (mini-CMS, see `ARCHITECTURE.md`). An edit in KV wins over the HTML, so git can lag behind what is live. Before changing site texts, write the live edits back into the HTML with `site/cms-sync.mjs` (`--site-dir <deploy folder>`): first a dry run, then `--write`; commit, deploy the site, and only then `--clear` (removes from KV exactly the keys that now equal the HTML). Then make your change in the HTML. Report the script's "let op: alleen NL/EN aangepast" lines to the owner with a proposal for the other language; don't translate on your own.
  - A new text block gets `data-edit="key"` + `data-edit-label="Dutch name"`; the EN page uses the same key with `en-` in front. Never nest them, and don't put them on text a script fills in. Renaming or removing a key orphans its saved edit (the page falls back to the HTML).
  - NL and EN can drift apart through the CMS (an edit to one language only); the tests can't see that.
- **Google Play:** after every change, say which Play step it needs (no release / Play Console only / new build / build + Play Console), using [store/google-play/README.md](store/google-play/README.md). A new Android permission or a new kind of data always means Play Console work: tell the owner the exact steps.
- **Verify:** `npm run typecheck` and `npm test` must pass. For UI changes also check the app in the browser with `npm run dev`.
- **GitHub:** the repo is public. When a change is finished and verified, commit it on `main` and push to `origin`. Never commit `wrangler.jsonc`, secrets, keys or personal data.
- **Deploy:** `npm run db:migrate`, then `npm run deploy`, then check with `npx wrangler deployments list`.

## Checklist for a new feature
1. Code + `public/i18n.js` (en + nl) + a migration if needed.
2. Tests; `npm run typecheck` and `npm test`.
3. User guide page in `docs/` (+ row in `docs/README.md`); `ARCHITECTURE.md` if the build changes.
4. Website: tile, story, table, FAQ (NL + EN).
5. Commit and push to GitHub; deploy the app and the website.
6. Play line: what (if anything) has to happen in Google Play.

If `CLAUDE.local.md` exists, it holds the owner's own setup (where to run commands, which servers to deploy to). Follow it.
