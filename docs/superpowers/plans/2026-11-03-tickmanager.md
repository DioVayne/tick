# Tickmanager: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Taken die lang niet bekeken zijn één voor één terugbrengen in een opruimronde (inplannen, bovenaan, laten staan, weg), met een eigen knop, pagina en instellingen.

**Architecture:** De server bewaart alleen `tasks.reviewed_at`, de overgeslagen lijsten per persoon (`review_skip_lists`) en drie instellingen per persoon; hij krijgt twee kleine routes (`src/review.ts`). Wat "oud" is beslist de PWA uit `state.open` met een pure regel (`public/review.js`), zodat getal en ronde offline werken. De pagina en de ronde staan in `public/manager.js`; voorstellen voor inplannen komen uit `public/planner.js`, dat later een agenda-bron kan krijgen.

**Tech Stack:** Cloudflare Worker (Hono), D1, vitest met `@cloudflare/vitest-plugin`, PWA in vanilla JS zonder build.

**Spec:** `docs/superpowers/specs/2026-11-03-tickmanager-design.md` (lees §2 en §3 vóór elke taak; die beslissingen staan vast).

## Global Constraints

- Schema alleen via een nieuwe `migrations/0018_tickmanager.sql`; bestaande migraties niet aanpassen.
- Elke zichtbare tekst via `public/i18n.js` met `en` én `nl` (`test/i18n.test.ts`). Nieuwe UI-sleutels onder `mgr.` (pagina, ronde, knop) en `planner.`; meervoud met het bestaande `_one`-patroon (zoals `add.subtasks_one`). Serverfouten: `HttpError(status, key, vars)`.
- Geen inline scripts of stijlen (CSP), geen build-stap. Nieuwe modules `review.js`, `planner.js`, `manager.js` in `SHELL` van `public/sw.js` en in de `modulepreload`-lijst van `public/index.html` (`test/offline.test.ts` controleert beide); `CACHE` `tick-shell-v67` → `tick-shell-v68`.
- Tijden in UTC-ISO. "Vandaag/morgen" volgen `TIMEZONE`/de zone van de persoon (`zonedParts`/`zonedToUtc` in `public/repeat.js`), nooit de klok van de browser.
- Termijnen: nieuw standaard **14** dagen, bekeken standaard **30** dagen, elk een geheel getal **1–365**.
- Een dag is `86_400_000` ms. Een taak is oud als haar leeftijd **≥** de termijn is (precies N dagen telt als oud).
- Geen nieuwe config in `wrangler.jsonc`.
- Kleuren: token `--manager` / `--manager-text`; licht `#f4a259`/`#3a1d00`, donker (beide varianten) `#e8964a`/`#2a1400`, retro (alle drie de retro-blokken) `#cd853f` met donkere tekst `#2a1400`. Contrast tekst/icoon ≥ 3:1.
- Icoon `bolt`: pad `M13 2 4 14h7l-1 8 9-12h-7l1-8z`.
- Waar draaien: npm en wrangler alleen in een kopie onder `C:\dev` (bijv. `C:\dev\tick-mgr`: `robocopy "H:\My Drive\Git\tick" C:\dev\tick-mgr /MIR /XD node_modules .git .wrangler`, dan `npm ci`). git werkt op H:. Vóór elke testronde opnieuw robocopy'en.
- Klaar per taak: `npm run typecheck` en `npm test` slagen in de kopie. Commitberichten in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pushen en deployen mag zonder te vragen (Task 9).

## Review Focus

1. **Taak verdwijnt tijdens de ronde** (op een ander apparaat afgevinkt, verwijderd of door de eigenaar van een gedeelde lijst weggehaald): de ronde slaat de kaart over in plaats van een lege of verouderde kaart te tonen en een fout te krijgen. → `nextIndex` in Task 4.
2. **Lijst hernoemd na overslaan:** de lijst blijft overgeslagen (id uit `list_ids`), en een verwijderde lijst laat geen rij achter. → test in Task 3.
3. **Andere tijdzone dan de browser:** "Vandaag" verschijnt alleen als de standaardtijd in de zone van de persoon nog komt, en "Morgen" is morgen in die zone. → test in Task 5.
4. **Bovenaan zetten zonder gewone buren** (lijst met alleen vastgepinde taken, of de taak staat al bovenaan): geen sprong naar een rare positie. → `topOf`-tests in Task 4.
5. **Instellingen als tekst of breuk** (`"14"`, `1.5`, `0`, `366`, `null`): 400, en niets bewaard. → test in Task 2.

---

### Task 1: Migratie, kolom in de back-up

**Files:**
- Create: `migrations/0018_tickmanager.sql`
- Modify: `src/index.ts` (`TaskRow`: `reviewed_at: string | null`), `src/data.ts:12-16` (`TASK_COLUMNS`)
- Test: `test/migratie-tickmanager.test.ts`, `test/backup.test.ts`

**Interfaces:**
- Produces: kolom `tasks.reviewed_at TEXT` (NULL = nooit bekeken); tabel `review_skip_lists(user_id, list_id)`; `TaskRow.reviewed_at`. Taken in `GET /api/tasks` krijgen `reviewed_at` vanzelf mee (`t.*`).

- [ ] **Step 1: Write the failing tests**

`test/migratie-tickmanager.test.ts` naar het patroon van `test/migratie-lijst-ids.test.ts`:
- `'migratie 0018: bestaande taken krijgen reviewed_at = NULL en review_skip_lists bestaat'` — migraties `< '0018'` toepassen, taak invoegen, alles toepassen; `SELECT reviewed_at` is `null`; `INSERT INTO review_skip_lists (user_id, list_id) VALUES (ADMIN, 'abc')` lukt en een tweede keer dezelfde rij faalt (primaire sleutel).

In `test/backup.test.ts`: `'back-up bevat reviewed_at en import zet hem terug'` — taak met `reviewed_at = '2026-10-01T00:00:00.000Z'` (direct via `env.DB`), export bevat die waarde, import op een lege staat geeft dezelfde waarde terug.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/migratie-tickmanager.test.ts test/backup.test.ts`
Expected: FAIL (kolom/tabel bestaat niet; export mist het veld).

- [ ] **Step 3: Implement**

De migratie is letterlijk de SQL uit spec §7. `reviewed_at` toevoegen aan `TaskRow` en aan `TASK_COLUMNS` (niet aan `NOT_NULL`).

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run test/migratie-tickmanager.test.ts test/backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/0018_tickmanager.sql src/index.ts src/data.ts test/migratie-tickmanager.test.ts test/backup.test.ts
git commit -m "Tickmanager: reviewed_at en overgeslagen lijsten in de database"
```

### Task 2: Instellingen per persoon

**Files:**
- Modify: `src/prefs.ts` (`UserPrefs`, `loadUserPrefs`), `src/settings-api.ts` (`view`, `PATCH`), `src/index.ts:571-579` (`/config.js`), `public/settings.js:60` (CONFIG-typedef), `public/settingsview.js` (typedef `Settings` r. 30, fallback r. 232, overnemen r. 220), `public/i18n.js` (foutsleutels)
- Test: `test/instellingen-api.test.ts`

**Interfaces:**
- Produces: `UserPrefs.tickmanager: boolean`, `UserPrefs.reviewNewDays: number`, `UserPrefs.reviewSeenDays: number`; dezelfde drie namen in `GET/PATCH /api/settings` en in `CONFIG` (`/config.js`). Rijen in `user_settings`: `tickmanager` = `'off'` (aan = geen rij), `review_new_days` / `review_seen_days` = het getal als tekst. Fouten: `400 err.invalid_tickmanager`, `400 err.invalid_review_days`.

- [ ] **Step 1: Write the failing tests** (in `test/instellingen-api.test.ts`, met de bestaande `patch`/`session`)

- `'Tickmanager: standaard aan, 14 en 30 dagen'` — `GET /api/settings` met sessie geeft `{ tickmanager: true, reviewNewDays: 14, reviewSeenDays: 30 }`; `/config.js` bevat `"tickmanager":true`, `"reviewNewDays":14`, `"reviewSeenDays":30`.
- `'Tickmanager uit en termijnen bewaren'` — `patch({ tickmanager: false, reviewNewDays: 7, reviewSeenDays: 60 })` geeft die waarden; rij `tickmanager` = `'off'`; `patch({ tickmanager: true })` verwijdert die rij; `/config.js` volgt.
- Uitbreiden van de bestaande `it.each` met ongeldige bodies (Review Focus 5): `{ tickmanager: 'off' }`, `{ reviewNewDays: '14' }`, `{ reviewNewDays: 1.5 }`, `{ reviewNewDays: 0 }`, `{ reviewSeenDays: 366 }`, `{ reviewSeenDays: null }` → 400; daarna is er geen rij `review_*` voor `ADMIN_ID`.
- `'grenzen 1 en 365 mogen'` — `patch({ reviewNewDays: 1, reviewSeenDays: 365 })` → 200 met die waarden.
- Een kapotte rij (`review_new_days` = `'abc'`, direct in de DB) geeft bij `GET` de standaard 14.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/instellingen-api.test.ts`
Expected: FAIL (velden ontbreken).

- [ ] **Step 3: Implement**

In `loadUserPrefs`: `tickmanager: row.get('tickmanager') !== 'off'`; de dagen met een helper `days(v: string | undefined, def: number): number` (geheel getal 1–365, anders `def`). In `PATCH` hetzelfde patroon als `driveMode` (r. 90-94): `tickmanager` → `['tickmanager', v ? null : 'off']`; elk dagenveld moet `Number.isInteger(v) && v >= 1 && v <= 365` zijn, schrijft `String(v)`. Alle drie in `view()` en in de config van `/config.js`. Typedefs in `settings.js`/`settingsview.js` uitbreiden; de offline-fallback (r. 232) neemt `CONFIG.tickmanager !== false`, `CONFIG.reviewNewDays ?? 14`, `CONFIG.reviewSeenDays ?? 30`; r. 220 neemt de drie over in `CONFIG` als ze het juiste type hebben. Foutsleutels `err.invalid_tickmanager` en `err.invalid_review_days` in `en` en `nl`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run test/instellingen-api.test.ts test/i18n.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/prefs.ts src/settings-api.ts src/index.ts public/settings.js public/settingsview.js public/i18n.js test/instellingen-api.test.ts
git commit -m "Tickmanager: instellingen per persoon (aan/uit, termijnen)"
```

### Task 3: Server-routes

**Files:**
- Create: `src/review.ts`
- Modify: `src/index.ts` (route `reviewed`, `review` in `GET /api/lists` r. 990-1012, opruimen in `POST /api/lists/delete` r. 1068-1110, de router aankoppelen)
- Test: `test/tickmanager-api.test.ts`

**Interfaces:**
- Consumes: `getTask` (= `getAccess`) uit `src/access.ts`; `list_ids` (id per naam per persoon).
- Produces:
  - `POST /api/tasks/:id/reviewed` → `200 { ok: true, reviewed_at: string }`; zet `reviewed_at` én `updated_at` op hetzelfde moment `now()`; `404 err.not_found` zonder toegang.
  - `PUT /api/review/lists/:listId` met `{ include: boolean }` → `200 { ok: true }`; `include: false` = rij in `review_skip_lists`, `true` = rij weg; `listId` moet in `list_ids` van P staan (anders `404 err.not_found`); `include` geen boolean → `400 err.must_be_bool { field: 'include' }`.
  - `GET /api/lists`: elk item krijgt `review: boolean` (`false` als de id in `review_skip_lists` van P staat).
  - `src/review.ts` exporteert `reviewApi` (Hono-router, gemount op `/api/review`) en `markReviewed(db: D1Database, id: string): Promise<string>` (geeft de tijd terug; de route in `index.ts` doet de toegangscheck en roept dit aan).

- [ ] **Step 1: Write the failing tests** (`test/tickmanager-api.test.ts`, helpers `call`, `callAs`, `createTask`, `createUser`, `json`)

- `'reviewed zet reviewed_at en updated_at'` — taak maken; `POST …/reviewed` → 200; `reviewed_at` uit het antwoord is een ISO-tijd ≥ het begin van de test; in `GET /api/tasks` heeft de taak dat `reviewed_at`, en `updated_at` is gelijk aan `reviewed_at`; `created_at` is ongewijzigd.
- `'reviewed: 404 zonder toegang en voor een onbekend id'` — taak van ADMIN, `callAs(cookie van ander lid)` → 404; willekeurige UUID → 404.
- `'reviewed: deelnemer van een gedeelde lijst mag het, en de eigenaar ziet het'` — gedeelde lijst opzetten zoals in `test/gedeelde-lijsten.test.ts` (`POST /api/shared-lists`, lid accepteert); lid stuurt `reviewed` → 200; de eigenaar ziet hetzelfde `reviewed_at`.
- `'review-lijst aan en uit'` — `GET /api/lists` geeft voor Inbox `review: true`; `PUT /api/review/lists/<id van Inbox> { include: false }` → 200 en daarna `review: false`; nog eens `false` → 200 (idempotent); `{ include: true }` → weer `true`.
- `'review-lijst: 404 voor andermans of onbekende id, 400 zonder boolean'` — id uit `list_ids` van een ander lid → 404; `'zzz'` → 404; `{ include: 'nee' }` → 400.
- Review Focus 2 — `'overslaan overleeft hernoemen; verwijderen ruimt de rij op'` — lijst `Ooit-<uniq>` met een taak, overslaan; `POST /api/lists/rename` naar `Later-<uniq>` → `review: false` bij de nieuwe naam; `POST /api/lists/delete { name, tasks: 'inbox' }` → geen rij meer in `review_skip_lists` met die id.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/tickmanager-api.test.ts`
Expected: FAIL (404 op de nieuwe routes, `review` ontbreekt).

- [ ] **Step 3: Implement**

`reviewApi` naar het voorbeeld van `settingsApi`, maar zonder `sessionOnly` (ook de Bearer-sleutel mag het, zoals andere taakroutes). `GET /api/lists`: één extra query `SELECT list_id FROM review_skip_lists WHERE user_id = ?` en `review: !skip.has(id)` in de bestaande `map`. In de batch van `POST /api/lists/delete`: `DELETE FROM review_skip_lists WHERE user_id = ? AND list_id = (SELECT id FROM list_ids WHERE user_id = ? AND name = ?)`, vóór het verwijderen van de `list_ids`-rij. `ARCHITECTURE.md`: rij in het overzicht (`reviewed_at`, `review_skip_lists`, de twee routes, "oud bepaalt de client") en de drie nieuwe instellingen.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npm test`
Expected: PASS (ook de bestaande lijsttests: `review` is een extra veld).

- [ ] **Step 5: Commit**

```bash
git add src/review.ts src/index.ts test/tickmanager-api.test.ts ARCHITECTURE.md
git commit -m "Tickmanager: routes voor bekeken en lijsten overslaan"
```

### Task 4: De regel (`public/review.js`)

**Files:**
- Create: `public/review.js` (puur: geen DOM, geen imports buiten pure modules)
- Test: `test/review.test.ts`

**Interfaces:**
- Consumes: de taakvorm van de client (`id, list, parent_id, done, pinned, repeat, remind_at, created_at, reviewed_at, position`; `pinned` is al per persoon, zie `overlay` in `src/access.ts`).
- Produces:
  - `const DAY = 86_400_000`
  - `reviewPrefsOf(config): { on: boolean, newDays: number, seenDays: number }` — uit `CONFIG` (`tickmanager !== false`, `reviewNewDays ?? 14`, `reviewSeenDays ?? 30`).
  - `isStale(task, prefs, skipped: Set<string>, now: number): boolean` — alle regels uit spec §3; `skipped` zijn lijstnamen zoals P ze ziet.
  - `staleTasks(tasks, prefs, skipped, now): Task[]` — gefilterd, oudste eerst op `coalesce(reviewed_at, created_at)`, bij gelijke tijd op `id`.
  - `staleDays(task, now): number` — hele dagen sinds `coalesce(reviewed_at, created_at)` (afgerond naar beneden).
  - `topOf(task, tasks): number` — positie voor "bovenaan zetten": kleinste `position` van de andere open, niet-vastgepinde hoofdtaken in `task.list`, min `1_000_000`; zijn er geen, of staat de taak al het hoogst, dan `task.position`.
  - `nextIndex(ids: string[], from: number, openIds: Set<string>): number` — eerste index `≥ from` waarvan de id nog in `openIds` staat; `ids.length` als er geen meer is.

- [ ] **Step 1: Write the failing tests** (`test/review.test.ts`; een `task(overrides)`-maker met een open hoofdtaak die 100 dagen oud is; `NOW = Date.parse('2026-11-03T12:00:00Z')`; `P = { on: true, newDays: 14, seenDays: 30 }`)

- `'nieuw: oud vanaf precies 14 dagen'` — `created_at = NOW - 14*DAY` → true; `NOW - 14*DAY + 1` → false.
- `'bekeken: oud vanaf precies 30 dagen, ook als created_at oud is'` — `reviewed_at = NOW - 30*DAY` → true; `NOW - 29*DAY` → false (terwijl `created_at` 100 dagen oud is).
- `'andere termijnen volgen prefs'` — `{ newDays: 3 }` met 3 dagen oud → true.
- `'doet niet mee'` — elk apart false: `pinned: true`; `repeat: { rule: 'FREQ=DAILY', … }`; `remind_at = NOW + 60_000`; `parent_id: 'x'`; `done: true`; lijst in `skipped`.
- `'verlopen herinnering telt mee'` — `remind_at = NOW - 60_000` → true; `remind_at = NOW` → true.
- `'gedeelde lijst: bekeken door een ander telt ook'` — taak met `share: {…}` en `reviewed_at` 2 dagen geleden → false.
- `'staleTasks: oudste eerst'` — drie taken met verschillende `coalesce(reviewed_at, created_at)` komen in volgorde terug; een niet-oude valt weg.
- `'staleDays rondt naar beneden af'` — `created_at = NOW - 20.9*DAY` → 20.
- `'topOf'` (Review Focus 4) — lijst met posities 5e6, 7e6 (en de taak zelf op 9e6) → `4e6`; vastgepinde taak op 1e6 in dezelfde lijst telt niet mee; taken in een andere lijst tellen niet; alleen vastgepinde buren → `task.position`; de taak heeft al de kleinste positie → `task.position`.
- `'nextIndex slaat verdwenen taken over'` (Review Focus 1) — `ids = ['a','b','c']`, `openIds = {'a','c'}`: `nextIndex(ids, 1, open)` → 2; `nextIndex(ids, 3, open)` → 3; alles weg → 3.
- `'reviewPrefsOf: standaarden en uit'` — `{}` → `{ on: true, newDays: 14, seenDays: 30 }`; `{ tickmanager: false }` → `on: false`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/review.test.ts`
Expected: FAIL (module bestaat niet).

- [ ] **Step 3: Implement** de functies hierboven in `public/review.js`, met JSDoc-types zoals in `public/calendar.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run test/review.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/review.js test/review.test.ts
git commit -m "Tickmanager: de regel voor oude taken (puur, getest)"
```

### Task 5: De planner (`public/planner.js`)

**Files:**
- Create: `public/planner.js`
- Modify: `public/i18n.js` (`planner.today`, `planner.tomorrow`, `planner.next_week`)
- Test: `test/planner.test.ts`

**Interfaces:**
- Consumes: `zonedParts`, `zonedToUtc`, `getDefaultTime`, `chipDays` uit `public/repeat.js`; `quickDays` uit `public/calendar.js`; `t` uit `public/i18n.js`.
- Produces:
  - `/** @typedef {{ at: string, label: string, source: string }} Slot */`
  - `suggest(task, ctx = {}): Promise<Slot[]>` met `ctx.now?: number` (standaard `Date.now()`). Geeft in deze volgorde: vandaag (alleen als vandaag op de standaardtijd `> now`), morgen, volgende week (`quickDays(…).nextWeek`), elk op de standaardtijd in de ingestelde zone, `source: 'fixed'`, `label` = `t('planner.today' | 'planner.tomorrow' | 'planner.next_week')`. `task` wordt nu niet gebruikt (de agenda-bron later wel).

- [ ] **Step 1: Write the failing tests** (`test/planner.test.ts`; `setTimeZone`/`setDefaultTime` uit `repeat.js`, in `afterEach` terugzetten)

- `'vóór de standaardtijd: vandaag, morgen, volgende week'` — zone `Europe/Amsterdam`, tijd `09:00`, `now = Date.parse('2026-11-03T07:00:00Z')` (08:00 lokaal, dinsdag) → `at`'s `'2026-11-03T08:00:00.000Z'`, `'2026-11-04T08:00:00.000Z'`, `'2026-11-09T08:00:00.000Z'`; alle `source: 'fixed'`.
- `'na de standaardtijd: geen vandaag'` — `now = 2026-11-03T09:00:00Z` → twee slots, eerste is morgen.
- `'precies op de standaardtijd: geen vandaag'` — `now = 2026-11-03T08:00:00Z` → twee slots.
- Review Focus 3 — `'volgt de ingestelde zone, niet UTC'` — zone `Pacific/Auckland` (UTC+13), `now = 2026-11-03T22:00:00Z` (4 nov 11:00 lokaal) → eerste slot is morgen = 5 nov 09:00 lokaal = `'2026-11-04T20:00:00.000Z'`.
- `'is async'` — `suggest({})` is een `Promise`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/planner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** `suggest` in `public/planner.js` (één bron-functie `fixedSlots(now)` die `suggest` aanroept, zodat een agenda-bron er later naast kan). Sleutels in `en` ("Today", "Tomorrow", "Next week") en `nl` ("Vandaag", "Morgen", "Volgende week").

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npx vitest run test/planner.test.ts test/i18n.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/planner.js public/i18n.js test/planner.test.ts
git commit -m "Tickmanager: planner met vaste voorstellen, klaar voor een agenda-bron"
```

### Task 6: Store en route

**Files:**
- Modify: `public/store.js` (op-type `reviewed`, `markReviewed`, `setListReview`, `staleNow`), `public/route.js`, `public/render.js:350-357` (`writeHash`)
- Test: `test/store.test.ts`, `test/route.test.ts`

**Interfaces:**
- Consumes: `staleTasks` uit `public/review.js` (Task 4); routes uit Task 3.
- Produces:
  - `markReviewed(id: string): Promise<void>` — `mutate({ type: 'reviewed', id })`; `applyLocal` zet `t.reviewed_at = op.at`; `toHttp` → `['POST', `/api/tasks/${id}/reviewed`, {}]`.
  - `setListReview(listId: string, include: boolean)` — via `listAction('PUT', `/api/review/lists/${listId}`, { include })` (alleen online, zoals de lijstacties).
  - `skippedLists(): Set<string>` — namen uit `state.serverLists` met `review === false`.
  - `staleNow(prefs): Task[]` — `staleTasks(state.open, prefs, skippedLists(), Date.now())`; `[]` als `prefs.on` false is.
  - Route `{ page: 'manager' }` ↔ `'#/manager'`; `toHash` met `page: 'manager'` gaat net als settings/help voor een taak. `writeHash` leest `manager-open` op `body`.

- [ ] **Step 1: Write the failing tests**

`test/route.test.ts`: `'#/manager'` toevoegen aan beide lussen/verwachtingen (`toHash({ ...view, page: 'manager', task: 'x' })` → `'#/manager'`; `parseHash('#/manager')` → `{ page: 'manager' }`).

`test/store.test.ts`, naar de bestaande opzet daar (outbox, offline): `'markReviewed zet reviewed_at meteen en stuurt POST …/reviewed'` — taak in `state.open`, offline `markReviewed(id)` → `reviewed_at` is gezet en de outbox bevat een op die `toHttp` vertaalt naar `POST /api/tasks/<id>/reviewed`. `'staleNow slaat lijsten met review: false over'` — `state.serverLists = [{ name: 'Ooit', id: 'x', review: false, open: 1 }]`, een oude taak in `Ooit` en een in `Inbox` → alleen die in Inbox; met `prefs.on = false` → `[]`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/route.test.ts test/store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** zoals hierboven; `'manager'` in `PAGES` en in de typedef `Route`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/store.js public/route.js public/render.js test/store.test.ts test/route.test.ts
git commit -m "Tickmanager: bekeken via de wachtrij, route #/manager"
```

### Task 7: De pagina en de ronde (`public/manager.js`)

**Files:**
- Create: `public/manager.js`
- Modify: `public/app.js` (openen/sluiten, `goTo`, `popstate`, de capture-listener op `#side` r. 218-228, `#newlist-input` r. 229-235), `public/sidebar.js` (`updateHeader`: titel, `#add`/`#fab` verborgen met de pagina open), `public/style.css`, `public/i18n.js`, `public/sw.js`, `public/index.html` (modulepreload)
- Test: `test/offline.test.ts` en `test/i18n.test.ts` (bestaand, moeten groen blijven)

**Interfaces:**
- Consumes: `staleNow`, `markReviewed`, `setListReview`, `update`, `lists`, `state`, `on` (store, Task 6); `reviewPrefsOf`, `staleDays`, `topOf`, `nextIndex`, `staleTasks` (Task 4); `suggest` (Task 5); `openDatePicker` (`public/datepicker.js`); `deleteWithUndo` (`public/swipe.js`); `request` (`public/api.js`) voor `PATCH /api/settings`.
- Produces: `openManager({ push = true, start = false } = {})`, `hideManager()`, `closeManager()`, `isManagerOpen(): boolean`, `refreshManager()` — zelfde gedrag als `public/help.js` (body-klasse `manager-open`, history-item `{ manager: true }`, Esc sluit). `start: true` begint meteen de ronde.

**Gedrag** (spec §5 en §6; teksten onder `mgr.`):
- Pagina: kop met het aantal (`mgr.count` / `mgr.count_one`: "N taken zijn al een tijd niet bekeken"), knop **Opruimen starten** (`mgr.start`), bij 0 `mgr.all_clear` ("Alles is bij") zonder knop. Daaronder twee getalvelden (`mgr.new_days`, `mgr.seen_days`, `min=1 max=365 step=1`), die bij `change` `PATCH /api/settings` sturen en `CONFIG` bijwerken; een ongeldige waarde zet het veld terug en toont de fout als toast. Dan **Lijsten** (`mgr.lists`): per lijst uit `lists()` een eigen element `.mgr-list` met naam, aantal oude taken in die lijst (uit `staleTasks(state.open, prefs, new Set(), now)`), en een vinkje **meenemen** (`mgr.include`) dat `setListReview(l.id, checked)` aanroept; een lijst zonder `id` (net gemaakt) heeft een uitgeschakeld vinkje.
- Ronde: bij de start `ids = staleNow(prefs).map(t => t.id)`, vast. Per kaart `nextIndex(ids, i, new Set(state.open.map(t => t.id)))`; kaart met titel, lijst, leeftijd (`mgr.age_days` < 14 dagen, `mgr.age_weeks` < 60 dagen, anders `mgr.age_months`, elk met `_one`), de eerste 140 tekens van `description`, teller `mgr.progress` ("{i} van {n}"), en **Stoppen** (`mgr.stop`, terug naar de pagina).
- Vier knoppen, telkens daarna de volgende kaart:
  - **Inplannen** (`mgr.plan`): `await suggest(task)` als knoppen, plus **Kies datum…** (`mgr.pick_date`, `openDatePicker(anchor, '', value => …)`) en **Annuleren** (kaart blijft). Kiezen: `update(id, { remind_at })`, dan `markReviewed(id)`. De waarde uit de datumkiezer is lokale wandklok (`YYYY-MM-DDTHH:MM`); gebruik dezelfde omzetting als de bestaande aanroepers van `openDatePicker` in `public/detail.js`.
  - **Bovenaan zetten** (`mgr.top`): `update(id, { position: topOf(task, state.open) })`, dan `markReviewed(id)`.
  - **Laten staan** (`mgr.keep`): `markReviewed(id)`.
  - **Verwijderen** (`mgr.delete`): `deleteWithUndo(task)`; geeft die `false` (bevestiging geweigerd), dan blijft de kaart staan.
- Einde: samenvatting `mgr.summary` met de vier tellers ("{planned} ingepland, {top} bovenaan, {deleted} verwijderd, {kept} laten staan"), knop **Terug naar je lijst** (`mgr.back`) die `closeManager()` doet.
- `CONFIG.tickmanager === false`: `goTo({ page: 'manager' })` en `openManager` doen niets (de gewone lijst blijft).
- `on('change', refreshManager)`: alleen de pagina (niet een lopende kaart) opnieuw opbouwen, zodat getallen kloppen.
- Stijl in `style.css` onder een kopje `/* Tickmanager */`: kaart en knoppen gebruiken bestaande tokens; de startknop gebruikt `--manager`/`--manager-text` (tokens komen in Task 8; tot dan valt hij terug op `--accent`).
- `'/manager.js'`, `'/review.js'`, `'/planner.js'` in `SHELL`, `CACHE` → `tick-shell-v68`, en `<link rel="modulepreload">` voor elk in `index.html`.

- [ ] **Step 1: Bouw `public/manager.js` en de koppelingen** zoals hierboven.

- [ ] **Step 2: Run de tests**

Run: `npm run typecheck && npm test`
Expected: PASS (vooral `offline.test.ts`: SHELL, preload en imports; `i18n.test.ts`: dezelfde sleutels).

- [ ] **Step 3: Controleer in de browser** (`npm run dev` in de kopie, `.claude/launch.json` met `preview_start`): `#/manager` opent de pagina; met een paar taken waarvan `created_at` in D1 lokaal op 40 dagen terug is gezet (`npx wrangler d1 execute DB --local --command "UPDATE tasks SET created_at = …"`) loop je een ronde met alle vier de knoppen; Stoppen halverwege laat de rest staan; de samenvatting klopt; een lijst uitvinken haalt zijn taken uit het getal; termijn 0 invullen geeft een toast en zet het veld terug.

- [ ] **Step 4: Commit**

```bash
git add public/manager.js public/app.js public/sidebar.js public/style.css public/i18n.js public/sw.js public/index.html
git commit -m "Tickmanager: pagina met instellingen en de opruimronde"
```

### Task 8: Ingangen: oranje knop, zijbalk, leeg detailpaneel, schakelaar, help

**Files:**
- Modify: `public/icons.js` (`bolt`), `public/style.css` (tokens en knop), `public/index.html` (knop `#mgr-fab`), `public/sidebar.js` (item en `#mgr-fab`), `public/detail.js` (kaart in het lege paneel), `public/app.js` (klikken), `public/settingsview.js` (schakelaar), `public/help.js` (onderwerp), `public/i18n.js`

**Interfaces:**
- Consumes: `staleNow`, `reviewPrefsOf` (Tasks 4 en 6); `openManager` (Task 7).
- Produces:
  - `detail.js` exporteert `onManagerStart(fn: () => void)`; `app.js` registreert `() => openManager({ push: true, start: true })`. (Zo importeert `detail.js` `manager.js` niet; `render.js` importeert `detail.js` al.)
  - Zijbalk-item `button#btn-manager.item` (zonder `data-list`), klik in `app.js` via delegatie op `#side-lists` → `openManager({ push: true })`; `class 'on'` en `aria-current` als `manager-open`.

**Gedrag** (spec §4):
- Tokens `--manager`/`--manager-text` in alle zes de blokken bovenaan `style.css` (licht, beide donker, de drie retro), waarden uit Global Constraints.
- `#mgr-fab` in `index.html` vlak na `#fab`: `type="button" hidden`, `data-i18n-attr="aria-label:mgr.open;title:mgr.open"`, met het `bolt`-SVG en een `<span class="mgr-badge">`. CSS naast `#fab` (r. 260-265): onder `max-width: 1023.98px` `left: 16px`, dezelfde `bottom`, 56px, achtergrond `--manager`, kleur `--manager-text`; dezelfde verbergregels als `#fab` (`task-open`, `map-open`, `.appbar`, `#add:focus-within`); het rondje rechtsboven met het getal. Op breed scherm `display: none`.
- In `updateHeader`: `#mgr-fab.hidden = !prefs.on || help || manager || open || cal || state.showTrash || state.showDone`; `aria-label`/`title` = `t('mgr.open_count', { n })` (`mgr.open` zonder getal bij 0); badge leeg en verborgen bij 0. `#fab` is ook verborgen met de Tickmanager-pagina open.
- `renderSidebar`: als `prefs.on`, in het eerste `side-grp` direct na Inbox het item met `icon('bolt')` (oranje via `.mgr-ico { color: var(--manager) }`), naam `mgr.title` ("Tickmanager") en het getal in `.count` (leeg bij 0).
- `detail.js` `renderDetail`: zonder gekozen taak en met `prefs.on` een kaart `.mgr-card` met `mgr.intro` (de uitlegtekst uit spec §4b, letterlijk), het aantal (`mgr.count`), de oranje knop **Opruimen starten** (`mgr.start`) of bij 0 `mgr.all_clear`, en daaronder kleiner `ui.pick_task`. Bij elke render bijwerken (getal); uit = de oude `.detail-empty`.
- Instellingen, sectie Weergave (na `driveRow()`, r. 366): `managerRow()` naar het voorbeeld van `driveRow` met `save({ tickmanager: want }, …)`, label `set.tickmanager` ("Show Tickmanager" / "Tickmanager tonen") en `set.tickmanager_note`; na opslaan `CONFIG.tickmanager = want` en `render()`.
- Help: `'manager'` in `TOPICS` met `help.manager_h` en `help.manager`.
- `app.js`: klik op `#mgr-fab` → `openManager({ push: true })`.

- [ ] **Step 1: Bouw de ingangen** zoals hierboven.

- [ ] **Step 2: Run de tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Controleer in de browser** (zelfde dev-server): smal (375 breed): oranje knop linksonder met getal, + rechtsonder, beide weg met een taak open en met het invoerveld actief; onderste taak in de lijst blijft bereikbaar boven de knoppen; breed: zijbalk-item onder Inbox met getal en gemarkeerd op `#/manager`, kaart in het lege detailpaneel start de ronde; in licht, donker en retro (contrast van het icoon op de knop ≥ 3:1, meet met `javascript_tool`); schakelaar uit: geen knop, geen item, geen kaart, `#/manager` toont de lijst; offline (DevTools offline of `navigator.onLine`-simulatie via de dienstwerker): een ronde met **Laten staan** werkt en wordt na weer online verstuurd. Screenshot van smal en breed.

- [ ] **Step 4: Commit**

```bash
git add public/icons.js public/style.css public/index.html public/sidebar.js public/detail.js public/app.js public/settingsview.js public/help.js public/i18n.js
git commit -m "Tickmanager: oranje knop, zijbalk, kaart in het lege paneel, schakelaar"
```

### Task 9: Docs en uitrollen

**Files:**
- Create: `docs/tickmanager.md`
- Modify: `docs/README.md` (rij in de index), `docs/settings.md` ("Show Tickmanager"), `ARCHITECTURE.md` (controleren dat Task 3 alles dekt, ook `public/review.js`, `planner.js`, `manager.js`)

- [ ] **Step 1: Schrijf `docs/tickmanager.md`** (Engels, voor gebruikers): wat "old" is (14/30 dagen, wat niet meedoet: pinned, repeating, future reminder, subtasks), waar de knop zit (smal, breed), de ronde en de vier keuzes, de instellingen, lijsten overslaan (per persoon), dat "bekeken" in een gedeelde lijst voor iedereen geldt. Rij in `docs/README.md`; schakelaar in `docs/settings.md`.

- [ ] **Step 2: Volledige controle**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit en push**

```bash
git add docs/tickmanager.md docs/README.md docs/settings.md ARCHITECTURE.md
git commit -m "Tickmanager: gebruikersdocs"
git push -u origin main
```

- [ ] **Step 4: Uitrollen** (in de kopie onder `C:\dev`)

Run: `npm run db:migrate`, dan `npm run deploy`, dan `npx wrangler deployments list`
Expected: migratie `0018_tickmanager.sql` toegepast; de nieuwste deployment staat bovenaan met de tijd van nu.
