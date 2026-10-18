# Kopieën blijven verbonden: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kopieën van een taak blijven na het accepteren gekoppeld in een kopiegroep. Iedereen in de groep ziet per ander lid of die klaar is of hoe ver (een balkje), en krijgt een pushmelding als een ander lid de hoofdtaak afvinkt.

**Architecture:** Migratie `0011_kopiegroep.sql` voegt `tasks.copy_group` toe. `src/shares.ts` zet de groep bij het accepteren van een kopie en weigert een tweede exemplaar per persoon. Een nieuwe module `src/copies.ts` rekent per kijker het veld `copies` uit (leden, klaar, voortgang) en verstuurt de melding bij afvinken. `present()` in `src/index.ts` krijgt `copies` erbij, en `setDone`/`rollRepeat` melden of ze echt iets veranderden. De PWA krijgt `public/copies.js` voor de labeltjes in de lijst en het blok in het detailpaneel.

**Tech Stack:** Cloudflare Worker (Hono), D1, vitest met `@cloudflare/vitest-plugin`, PWA in vanilla JS zonder build.

**Spec:** `docs/superpowers/specs/2026-10-18-kopie-voortgang-design.md`

## Global Constraints

- Een schemawijziging is alleen `migrations/0011_kopiegroep.sql`. Bestaande migraties niet aanpassen.
- Elke zichtbare tekst gaat via `public/i18n.js`, met `en` én `nl` (`test/i18n.test.ts`). Serverfouten: `HttpError(status, key, vars)`, nooit een zin.
- Geen inline scripts of stijlen (CSP). Een nieuwe module komt in `SHELL` van `public/sw.js`, en `CACHE` gaat van `tick-shell-v13` naar `tick-shell-v14`.
- Tijden in UTC.
- Over de lijn gaat van een ander lid alleen: naam, `done`, `done_at` en `progress` (0–1 of `null`). Nooit titel, beschrijving of subtaken van een ander.
- De UI toont nooit "x/y"-getallen, alleen een balkje of ✓.
- Klaar per taak: `npm run typecheck` en `npm test` slagen.
- Commitberichten in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Niet uitrollen, niet pushen.

## Review Focus

1. **Een copy-uitnodiging wordt geaccepteerd nadat het origineel in de prullenbak is gegaan.** Er hoort dan 410 `err.share_gone` te komen (bestaand gedrag). Er mag geen halve groep ontstaan waarbij het origineel `copy_group` heeft maar er geen kopie is. → test in Task 1.
2. **Een ontvanger heeft de herhaling van het eigen exemplaar weggehaald, en het lid niet (of andersom).** De klaar-regel valt dan terug op `done` en de voortgang, en "klaar" mag niet altijd waar of altijd onwaar zijn. → test in Task 2.
3. **Een beschrijving met `- [x]` in een codeblok of citaat, of met `* [ ]`.** Alleen echte takenlijst-items tellen, met dezelfde regels als de app. → test in Task 2.
4. **De widget of de knop "Klaar" in een herinnering vinkt een groepstaak af** (`POST /api/tasks/:id/done`, `PATCH done` via de service worker). Ook dan gaat de melding naar de anderen, maar maar één keer als de outbox het verzoek herhaalt. → test in Task 3.
5. **Een lid heeft geen pushabonnement maar wel een fallback-webhook.** De melding gaat dan naar die webhook, en niet naar de webhook van de beheerder. → test in Task 3.

---

### Task 1: Kopiegroep vormen bij accepteren

**Files:**
- Create: `migrations/0011_kopiegroep.sql`
- Modify: `src/index.ts` (`TaskRow`: `copy_group: string | null`; `asBool` haalt `copy_group` uit wat naar de client gaat)
- Modify: `src/shares.ts` (`POST /`, `POST /:id/accept`, `copyStmts`)
- Modify: `public/i18n.js` (`err.copy_exists` in `en` en `nl`)
- Test: `test/kopie-groep.test.ts` (nieuw), `test/backup.test.ts`, `test/migratie-delen.test.ts` (of een nieuwe `test/migratie-kopiegroep.test.ts` in dezelfde stijl)

**Interfaces:**
- Produces: kolom `tasks.copy_group TEXT NULL`, alleen gezet op hoofdtaken. Foutsleutel `err.copy_exists` (409).

- [ ] **Step 1: Write the failing tests** in `test/kopie-groep.test.ts`. Gebruik de hulpjes uit `test/delen.test.ts` (share, accept, createUser). Lees `copy_group` direct uit `env.DB`.
  - `accepteren van een kopie zet dezelfde copy_group op origineel en kopie`: `group(orig) !== null`, `group(kopieVanB) === group(orig)`. De subtaken van de kopie hebben `copy_group` NULL.
  - `een tweede ontvanger komt in dezelfde groep`: C accepteert ook, en `group(kopieVanC) === group(orig)`.
  - `een kopie van een kopie komt in dezelfde groep`: B deelt het eigen exemplaar als kopie met C, C accepteert, en `group(kopieVanC) === group(orig)`.
  - `twee gelijktijdige accepts geven één groep`: `Promise.all([accept(b), accept(c)])`, daarna drie taken met dezelfde, niet-lege `copy_group`.
  - `één exemplaar per persoon`: nadat B een kopie accepteerde, geeft `share(orig, b, 'copy')` 409 met `err.copy_exists`, en `share(kopieVanB, admin, 'copy')` (als B) ook 409. Een `shared`-deling van `orig` met B geeft ook 409.
  - `accept controleert opnieuw`: twee copy-uitnodigingen naar B voor taken die intussen in dezelfde groep zitten. De eerste accept geeft 200, de tweede 409 `err.copy_exists`, en de uitnodigingsrij is daarna weg.
  - `origineel in de prullenbak`: accepteren geeft 410, en het origineel kreeg geen `copy_group`.
  - `bestaande kopieën blijven los`: een taak met `copy_group` NULL krijgt bij het lezen of bij een gewone wijziging geen groep.
  - `copy_group gaat niet naar de client`: `GET /api/tasks` heeft geen sleutel `copy_group` op taken.

- [ ] **Step 2: Run** `npx vitest run test/kopie-groep.test.ts`. Expected: FAIL (kolom bestaat niet).

- [ ] **Step 3: Migratie** `migrations/0011_kopiegroep.sql`: `ALTER TABLE tasks ADD COLUMN copy_group TEXT;` en `CREATE INDEX idx_tasks_copy_group ON tasks (copy_group) WHERE copy_group IS NOT NULL;`. Een korte Nederlandse kopcommentaar zoals in `0010_delen.sql`.

- [ ] **Step 4: Groep zetten in `POST /:id/accept` (copy).** Zet `copyStmts(db, src, kids, userId, position, group: string)` de `copy_group` op de nieuwe hoofdtaak. In dezelfde batch, vóór de insert: `UPDATE tasks SET copy_group = ? WHERE id = ? AND copy_group IS NULL` met een vers uuid. De insert leest de groep met een subquery `(SELECT copy_group FROM tasks WHERE id = <origineel>)`, zodat twee gelijktijdige accepts dezelfde groep krijgen. Laat de bestaande volgorde intact: eerst de deelrij claimen, dan de batch.

- [ ] **Step 5: Eén exemplaar per persoon.** Helper `hasCopyInGroup(db, taskId, userId): Promise<boolean>` in `src/shares.ts`. Die is waar als `userId` eigenaar is van een niet-verwijderde hoofdtaak met dezelfde (niet-NULL) `copy_group` als `taskId`. Aanroepen:
  - in `POST /` voor beide modes, na het bepalen van `toUser`: 409 `err.copy_exists`;
  - in accept (copy), na de claim en vóór de batch: 409, de rij is dan al weg.

  Vertaling: `en` "They already have a copy of this task." en `nl` "Die heeft al een kopie van deze taak."

- [ ] **Step 5b: Export en import.** Voeg `copy_group` **niet** toe aan `TASK_COLUMNS` in `src/data.ts`. Test in `test/backup.test.ts`: een export van een groepstaak bevat geen `copy_group`, en een backup-import van die taak laat de bestaande `copy_group` staan.

- [ ] **Step 6: Run** `npx vitest run test/kopie-groep.test.ts test/delen.test.ts test/migratie*.test.ts`, en daarna `npm run typecheck`. Expected: PASS.

- [ ] **Step 7: Commit** `git add migrations/0011_kopiegroep.sql src/shares.ts src/index.ts public/i18n.js test/` met als bericht "Kopiegroep: kopieën blijven gekoppeld na accepteren".

---

### Task 2: Het veld `copies` in de taken-API

**Files:**
- Create: `src/copies.ts`
- Modify: `src/index.ts` (`present`, `presentOne`, de drie takken van `GET /api/tasks`)
- Test: `test/kopie-groep.test.ts` (uitbreiden), `test/helpers.ts` (`Task.copies`)

**Interfaces:**
- Consumes: `tasks.copy_group` (Task 1), `parseMarkdown` uit `public/markdown.js`.
- Produces:
  ```ts
  export type CopyMember = { name: string; done: boolean; done_at: string | null; progress: number | null };
  export type Copies = { members: CopyMember[]; pending: { name: string }[] };
  export function progressOf(description: string, kids: { done: number }[]): number | null;
  export async function copiesFor(db: D1Database, userId: string, rows: TaskRow[]): Promise<Map<string, Copies>>;
  ```
  `present(rows, userId, info, copies: Map<string, Copies>)` geeft elke taak `copies: Copies | null`. Subtaken en taken zonder leden of pending krijgen `null`.

- [ ] **Step 1: Write the failing tests.**
  - `progressOf` (eenheidstest, zonder Worker):
    - `('', [])` → `null`;
    - `('- [x] a\n- [ ] b', [])` → `0.5`;
    - `('', [{done:1},{done:0},{done:0},{done:0}])` → `0.25`;
    - `('- [x] a', [{done:0}])` → `0.5`;
    - `` '```\n- [x] a\n```' `` → `null`;
    - `'> - [x] a\n- [ ] b'` → `0.5`, als `parseMarkdown` citaten met takenlijsten zo ondersteunt (`toggleTask` doet dat). Volg anders `parseMarkdown`;
    - `'* [x] a'` telt mee, als `ITEM` in `markdown.js` `*` toestaat.
  - `de deler ziet de ontvangers, de ontvangers zien de deler en elkaar`: drie accounts. Per kijker zijn de `copies.members`-namen precies de twee anderen. Jezelf zit er nooit in.
  - `alleen naam, klaar en voortgang`: `Object.keys(member).sort()` is `['done','done_at','name','progress']`, en de titel of beschrijving van een ander exemplaar komt nergens in de JSON voor (`JSON.stringify(res)` bevat de unieke titel van B's exemplaar niet, nadat B het hernoemde).
  - `voortgang van een ander`: B vinkt 1 van 2 subtaken af, en A ziet `progress: 0.5`. B vinkt de hoofdtaak af, en A ziet `done: true` met `done_at` gezet.
  - `een derde buiten de groep ziet niets`: `copies` is `null` en er is geen 404-lek.
  - `pending alleen voor de eigenaar`: A stuurt een copy-uitnodiging naar C die nog openstaat. A ziet `pending: [{name: C}]`, B ziet `pending: []`, en `share.members` van A bevat C niet.
  - `prullenbak`: B verwijdert het eigen exemplaar, en A ziet B niet meer. Na terugzetten ziet A B weer. Op `?deleted=1` is `copies` altijd `null`.
  - `origineel verwijderd`: A verwijdert het eigen exemplaar, en B en C zien elkaar nog.
  - `groep van één`: na het verwijderen van alle anderen is `copies` `null`.
  - `?done=1` geeft `copies` mee.
  - `gedeeld exemplaar`: A deelt het eigen groepsexemplaar `shared` met D (D zit niet in de groep). D ziet dezelfde `copies` als A, en A's exemplaar heet bij B "A".
  - `herhalend, relatief aan de kijker`: A en B hebben een herhalend exemplaar met dezelfde `repeat_at`. B vinkt af, waardoor B's `repeat_at` later komt. A ziet B met `done: true, done_at: null`. A vinkt ook af, en A ziet B weer met `done: false`. B ziet A eerst `done: false`.
  - `herhaling weggehaald`: B haalt de herhaling eraf (PATCH `repeat: ''`). A ziet B met `done` gelijk aan B's eigen `done`, en geen relatieve vergelijking.

- [ ] **Step 2: Run** `npx vitest run test/kopie-groep.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `progressOf` en `copiesFor` in `src/copies.ts`.**
  - `progressOf`: tel takenlijst-items uit `parseMarkdown(description)`. Loop de blokken recursief door, net als `blockLines` in `markdown.js`. Exporteer daar zo nodig een kleine `countTasks(src): { done: number; total: number }` in plaats van de boom hier na te bouwen. Tel de `kids` erbij op. Bij totaal 0 is het `null`.
  - `copiesFor`: één query voor alle groepen van de hoofdtaken in `rows` met `copy_group`. Haal de leden op (`deleted_at IS NULL`, `parent_id IS NULL`) met de naam van de eigenaar, `done`, `done_at`, `description`, `repeat_rule` en `repeat_at`, plus per lid de subtaktellingen (`SUM(done)`, `COUNT(*)` over niet-verwijderde subtaken). Sluit het exemplaar van de rij zelf uit (op id, niet op gebruiker), want een gedeelde deelnemer bekijkt andermans exemplaar. Klaar-regel: hebben beide een `repeat_rule`, dan is het lid klaar als `Date.parse(lid.repeat_at) > Date.parse(eigen.repeat_at)`, met `done_at: null`. Anders gelden `done` en `done_at` van het lid. `pending`: alleen als de kijker eigenaar is van de rij. Dat zijn de `task_shares` met `mode = 'copy'` en `status = 'pending'` op deze taak, met de naam van `to_user`. Sorteer de leden op naam.
  - Draai `copiesFor` alleen als er in `rows` een hoofdtaak zit met `copy_group`, of (voor `pending`) een eigen hoofdtaak met een copy-uitnodiging. Gebruik voor dat laatste een goedkope `EXISTS`-kolom in `COLS` van `access.ts`, net als `has_share`, bijvoorbeeld `has_copy_invite`.

- [ ] **Step 4: Inbouwen.** `present()` krijgt de map en zet `copies: map.get(t.id) ?? null` (subtaken `null`). In `GET /api/tasks`: open en `?done=1` krijgen `await copiesFor(...)`, `?deleted=1` krijgt een lege map. `presentOne` doet hetzelfde voor één taak. Voeg `copies` toe aan `Task` in `test/helpers.ts`.

- [ ] **Step 5: Run** `npx vitest run test/kopie-groep.test.ts test/delen.test.ts test/prullenbak.test.ts test/markdown.test.ts`, en daarna `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** met als bericht "Kopiegroep: voortgang en klaar van de anderen in GET /api/tasks".

---

### Task 3: Melding bij afvinken

**Files:**
- Modify: `src/index.ts` (`setDone` en `rollRepeat` geven `Promise<boolean>`, en aanroepen in `PATCH /api/tasks/:id` en `POST /api/tasks/:id/done`)
- Modify: `src/copies.ts` (`notifyCopyDone`)
- Modify: `src/push.ts` (`Payload.tag?: string`)
- Modify: `public/sw.js` (`tag: data.tag || data.taskId || …`)
- Modify: `public/i18n.js` (`copy.push_done`)
- Test: `test/kopie-meldingen.test.ts` (nieuw)

**Interfaces:**
- Consumes: `copy_group` (Task 1), `Sender`/`sendToAll`, `postWebhook`, `loadUserPrefs`, `getUser`.
- Produces:
  ```ts
  /** Push "{name} is klaar ✓" naar de andere leden van de groep van `task` (hoofdtaak). */
  export async function notifyCopyDone(env: Env, task: TaskRow, actorName: string, defaultLocale: Locale, send: Sender = sendToAll): Promise<void>;
  ```
  `setDone(db, t, done, z): Promise<boolean>` is `true` als hij bij `done = true` echt van open naar klaar ging (bij herhaling: echt doorgeschoven). Anders is het `false`.

- [ ] **Step 1: Write the failing tests** in `test/kopie-meldingen.test.ts`. Gebruik een nep-`Sender` zoals `fakeSender` in `test/delen-meldingen.test.ts` voor directe aanroepen van `notifyCopyDone`. Gebruik een fallback-webhook met een fetch-spy (zie `test/instellingen-per-persoon.test.ts`) voor de route-tests.
  - `notifyCopyDone gaat naar de andere leden, niet naar het afgevinkte exemplaar`: groep A, B, C, en B's exemplaar is `shared` met D. Vinkt B af, dan zijn de ontvangers precies {A, C}. Vinkt A af, dan zijn het {B, C, D}.
  - `titel en tekst`: `p.title` is `"Bea is klaar ✓"` (nl) en `p.body` is de titel van het exemplaar van de ontvanger, ook als B het eigen exemplaar anders noemt. `p.taskId` is undefined, `p.actions` is `[]`, en `p.tag` begint met `copy-`.
  - `naam is wie afvinkte`: D vinkt B's gedeelde exemplaar af, en A krijgt "D is klaar ✓".
  - `exemplaar in de prullenbak krijgt niets`.
  - `PATCH done stuurt via de fallback-webhook van de ontvanger`: B heeft `fallbackWebhook` en geen abonnement. A vinkt af, en de spy zag een POST naar B's webhook met de tekst. De webhook van de beheerder (`FALLBACK_WEBHOOK`) kreeg niets voor B.
  - `uitvinken stuurt niets`. `nog een keer PATCH done: true` (outbox) stuurt niets.
  - `POST /api/tasks/:id/done (widget) stuurt ook`.
  - `herhalend exemplaar: doorschuiven stuurt, ongedaan maken niet`.
  - `subtaak afvinken stuurt niets`. `taak zonder groep stuurt niets`.

- [ ] **Step 2: Run** `npx vitest run test/kopie-meldingen.test.ts`. Expected: FAIL.

- [ ] **Step 3: `setDone`/`rollRepeat` geven een boolean.** Bij een gewone taak met `done = true` krijgt de update op de taak zelf `AND done = 0`. De uitkomst is `res.meta.changes > 0`. Doe dat in de batch, waarvan de eerste statement de taak is. Bij `rollRepeat` met `done = true` is de uitkomst `changes` van de parent-update (`AND repeat_at = ?`). Bij `done = false` is het altijd `false`.

- [ ] **Step 4: `notifyCopyDone` in `src/copies.ts`.** Ontvangers zijn de eigenaars van de andere niet-verwijderde hoofdtaken in de groep, plus hun `accepted` `shared`-deelnemers. Ontdubbel en sluit de mensen op het afgevinkte exemplaar uit. Per ontvanger: `make(locale)` geeft `{ title: translate(locale, 'copy.push_done', { name: actorName }), body: <titel van diens exemplaar>, url: '/?task=<id van diens exemplaar>', tag: 'copy-' + group, actions: [] }`. Controleer of de app een `?task=`-link kent (`self.tickClickTarget` in `sw.js`), en neem anders `url: '/'`. Komt er niets aan (`total === 0`), stuur dan naar de eigen fallback-webhook (zoals `notifyInvite` in `src/shares.ts`, zonder `actions`). Vertaling: `nl` "{name} is klaar ✓", `en` "{name} is done ✓".

- [ ] **Step 5: Aanroepen.** In `PATCH /api/tasks/:id` en `POST /api/tasks/:id/done`: als `await setDone(...)` `true` geeft, `!!b.done` (of `done`) waar is, `cur.copy_group` gezet is en `!cur.parent_id`, dan `notifyCopyDone(c.env, cur, c.get('user').name, c.get('install').defaultLocale)` met `.catch(console.warn)`. Gebruik `c.executionCtx.waitUntil` met de bestaande `try/catch`-terugval uit `src/shares.ts`. `c.get('user')` bestaat ook bij een API-sleutel. Controleer dat, en neem anders de naam via `getUser(db, auth.userId)`.

- [ ] **Step 6: `sw.js`.** `tag: data.tag || data.taskId || (data.shareId ? … : 'tick')`. Er komen geen knoppen, want `taskId` en `shareId` ontbreken en `actions` is `[]`. `CACHE` hoeft hier niet omhoog, dat gebeurt in Task 4.

- [ ] **Step 7: Run** `npx vitest run test/kopie-meldingen.test.ts test/herhalen.test.ts test/delen-meldingen.test.ts test/api.test.ts`, en daarna `npm run typecheck`. Expected: PASS.

- [ ] **Step 8: Commit** met als bericht "Kopiegroep: melding aan de anderen bij afvinken".

---

### Task 4: De app: labeltjes, blok "Kopieën" en documentatie

**Files:**
- Create: `public/copies.js`
- Modify: `public/render.js` (meta-regel), `public/detail.js` (blok), `public/style.css`, `public/i18n.js`, `public/sw.js` (`SHELL` + `CACHE` → `tick-shell-v14`)
- Modify: `ARCHITECTURE.md`, `README.md`
- Test: `test/offline.test.ts` (draait mee), `test/i18n.test.ts`

**Interfaces:**
- Consumes: `task.copies` uit Task 2: `{ members: {name, done, done_at, progress}[], pending: {name}[] } | null`.
- Produces:
  ```js
  /** Labeltjes per ander lid voor de meta-regel in de lijst. */
  export function copyPills(task): HTMLElement[];
  /** Het blok "Kopieën" in het detailpaneel; leeg en hidden zonder copies. Bouwt alleen opnieuw op als er iets veranderde. */
  export function fillCopiesBox(box: HTMLElement, task): void;
  ```

- [ ] **Step 1: i18n-sleutels** in `en` en `nl`:
  - `copy.heading`: "Copies" / "Kopieën"
  - `copy.done_at`: "✓ done, {when}" / "✓ klaar, {when}"
  - `copy.done`: "✓ done" / "✓ klaar"
  - `copy.you`: hergebruik `share.you`
  - `copy.pending`: hergebruik `share.pending`
  - `copy.aria_done`: "{name}: done" / "{name}: klaar"
  - `copy.aria_progress`: "{name}: {amount}" / "{name}: {amount}"
  - `copy.amount_0`, `copy.amount_25`, `copy.amount_50`, `copy.amount_75`: "not started" / "nog niet begonnen", "a quarter" / "een kwart", "about half" / "ongeveer de helft", "almost done" / "bijna klaar". Rond `progress` af op het dichtstbijzijnde kwart, en kies bij `0 < p < 0.125` toch "een kwart".
  - `copy.aria_none`: "{name}: busy" / "{name}: bezig", voor `progress: null`.

  Run `npx vitest run test/i18n.test.ts`. Expected: PASS.

- [ ] **Step 2: `public/copies.js`.**
  - `copyPills`: per lid een `span.copy-pill`, plus `.done` als het lid klaar is: tekst "Naam ✓". Anders "Naam" met daarin `span.copy-bar > i`, waarvan de breedte via een CSS-variabele gaat. Inline `style` mag niet (CSP), dus kies een klasse per kwart (`.p0`, `.p25`, `.p50`, `.p75`, `.p100`) of `el.style.setProperty` vanuit JS. Dat laatste is toegestaan, want CSP blokkeert alleen `style`-attributen in HTML, niet CSSOM. Controleer de CSP-header in `src/index.ts` en kies de variant die werkt. Bij `progress: null` geen balkje. `title` en `aria-label` uit de `copy.aria_*`-sleutels.
  - `fillCopiesBox`: `h3` met `copy.heading` en een `ul.copy-list` met een regel per lid. Klaar: `copy.done_at` met `when` = de bestaande datumopmaak (zie `fmt` in `render.js`). Bij `done_at: null`: `copy.done`. Bezig: een groter `copy-bar`. Dan "Jij" op basis van de eigen taak: klaar als `task.done`, anders de voortgang uit de eigen subtaken in `state` plus de eigen beschrijving (via een `countTasks` uit `markdown.js`, Task 2). Dan per `pending` de naam met `share.pending`. Gebruik een `dataset.key`-check zoals `fillShareBox`.

- [ ] **Step 3: Inbouwen.** `render.js`: na de `👥`-meta `meta.push(...copyPills(t))` voor hoofdtaken met `t.copies`. `detail.js`: een `section.dcopies` naast `shareBox`, gevuld in dezelfde update als `fillShareBox`. `style.css`: `.copy-pill` (zoals een klein label, achtergrond `color-mix` of een bestaand token), `.copy-pill.done` groen. Gebruik een bestaand groen token als dat er is, en voeg anders een token toe met een licht- en donkerwaarde. `.copy-bar` heeft in de lijst een breedte van 28px en een hoogte van 4px, en in het detailpaneel 100px en 6px, met de accentkleur. Voeg `./copies.js` toe aan `SHELL` en zet `CACHE` op `tick-shell-v14`.

- [ ] **Step 4: Run** `npm test` en `npm run typecheck`. Expected: PASS, inclusief `offline.test.ts`.

- [ ] **Step 5: In de browser controleren** met `npm run dev`, via preview_start uit `.claude/launch.json`. Gebruik twee accounts (maak er lokaal een aan als beheerder). Maak een taak met 4 subtaken, deel die als kopie en accepteer. Vink bij de ander 2 subtaken af, herlaad bij de eerste, en controleer:
  - labeltje met half balkje;
  - detailblok met de ander, "Jij" en het balkje;
  - na afvinken bij de ander een groen "Naam ✓" en "✓ klaar, …";
  - licht en donker thema;
  - telefoonbreedte (375px): de labeltjes lopen netjes door naar een volgende regel.

  Maak een schermafbeelding.

- [ ] **Step 6: Documentatie.**
  - `ARCHITECTURE.md`: `tasks.copy_group`, hoe een groep ontstaat (accepteren van een kopie, één exemplaar per persoon), het veld `copies` (wat erin zit en wat nooit), de melding bij afvinken (wie, wanneer, herhaling), en een verwijzing naar het ontwerpdocument.
  - `README.md`: bij delen één zin, bijvoorbeeld "Bij een kopie zie je hoe ver de ander is, en je krijgt een melding als die klaar is."

- [ ] **Step 7: Commit** met als bericht "Kopiegroep: labeltjes en blok Kopieën in de app".
