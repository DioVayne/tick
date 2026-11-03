# Tickmanager — ontwerp

Datum: 2026-11-03 · Status: goedgekeurd ontwerp, nog niet gebouwd · Volgende stap: bouwplan (superpowers:writing-plans)
in `docs/superpowers/plans/`, daarna bouwen.

Dit document is genoeg om in een nieuwe sessie te beginnen. Lees eerst `CLAUDE.md` (regels voor wijzigingen) en
`ARCHITECTURE.md` (hoe Tick is gebouwd). De beslissingen hieronder zijn met de gebruiker doorgesproken; heropen ze niet
zonder reden.

## 1. Doel

Taken waar je lang niet naar hebt gekeken, komen terug, één voor één, en per taak beslis je wat ermee gebeurt. Zo raken
taken zonder herinnering niet weg onderaan een lijst. Als hij aan staat, is dit een hoofdfeature van de app: hij heeft
een eigen opvallende knop naast de plus.

## 2. Beslissingen (met reden)

| Beslissing | Reden |
|---|---|
| Geen prioriteitsveld | Pinnen en slepen zijn al prioriteit; een los veld botst daarmee en raakt vervuild ("alles hoog"). Pas heroverwegen als de behoefte "belangrijk over alle lijsten heen" opduikt. |
| Jij start de ronde (knop met getal), geen melding of vast weekmoment | Valt op zonder te zeuren. |
| "Laten staan" telt als bekeken (`reviewed_at`), los van `updated_at` | Anders komt de taak meteen terug. `updated_at` verandert bij elke wijziging en dient voor sync. |
| Twee termijnen: nieuw 14 dagen, eerder bekeken 30 dagen, allebei instelbaar | Wie iets bewust liet staan, wil het niet elke twee weken terugzien. |
| `reviewed_at` per taak, ook in een gedeelde lijst | "Nog actueel" is een feit over de taak; verwijderen en inplannen werken ook al voor iedereen. |
| Lijsten overslaan per persoon (bijv. "Ooit") | Het gaat om wat jij in jouw ronde wilt zien. |
| Kaart voor kaart | Een klein moment met begin en eind, je kunt halverwege stoppen. |
| Eén Tickmanager-pagina voor start én instellingen | Alles op één plek; lijsten in één oogopslag aan/uit. |
| Aan/uit-schakelaar in de gewone Instellingen, standaard aan | Staat hij uit, dan is de Tickmanager-knop weg en moet je hem ergens anders terug kunnen zetten. |
| Geen opties per lijst (nog) | YAGNI; de lijstrijen zijn wel zo gebouwd dat ze later kunnen uitklappen. |
| Inplannen loopt via een "planner" met voorstellen | Ruimte voor de toekomstige feature: inplannen op basis van een gekoppelde agenda (zie §9). |

## 3. Wanneer is een taak oud

Een taak doet mee in de ronde van persoon P als alles hieronder klopt:

- open hoofdtaak: `done = 0`, `deleted_at IS NULL`, `parent_id IS NULL`;
- P heeft toegang: eigen taak (`tasks.user_id = P`) of een geaccepteerde deelrij (`task_shares.to_user = P`,
  `status = 'accepted'`). Gebruik de bestaande helpers in `src/access.ts` (die voegen `list`, `position`, `pinned` per
  persoon samen) in plaats van eigen joins;
- niet vastgepind voor P (`tasks.pinned` voor de eigenaar, `task_shares.pinned` voor een deelnemer);
- geen herhaling (`repeat_rule IS NULL`);
- geen herinnering in de toekomst (`remind_at IS NULL` of `remind_at <= nu`). Verlopen herinneringen tellen dus mee;
- de lijst (zoals P hem ziet) staat niet in `review_skip_lists` van P;
- langer dan de termijn niet bekeken:
  - `reviewed_at IS NULL` en `created_at` ouder dan **termijn nieuw** (standaard 14 dagen), of
  - `reviewed_at` ouder dan **termijn bekeken** (standaard 30 dagen).

Subtaken doen niet los mee; ze gaan mee met hun hoofdtaak. Volgorde in de ronde: oudste eerst, op
`coalesce(reviewed_at, created_at)`.

## 4. Waar je de Tickmanager vindt

Overal geldt: alleen als de Tickmanager aan staat, en het getal is het aantal oude taken (geen getal bij 0).

**4a. Smal scherm (`max-width: 1023.98px`): de oranje knop.** Een ronde knop linksonder, op dezelfde hoogte als de
bestaande `#fab` (de +, rechtsonder, 56px): `left: 16px`, dezelfde `bottom` als `#fab`, 56px groot. Zo staan de twee
hoofdacties symmetrisch onderin, binnen bereik van beide duimen.

**4b. Breed scherm: twee plekken, elk met een eigen rol.**
- **Het lege detailpaneel** (rechts, waar nu "Kies een taak" staat; `public/detail.js`, `.detail-empty`). Als er geen
  taak gekozen is, staat daar een kaart: een korte uitleg van de functie ("Taken waar je lang niet naar keek, komen
  hier terug. Per taak kies je: inplannen, bovenaan, laten staan of weg."), het aantal oude taken en de oranje knop
  **Opruimen starten**, die de ronde meteen start. Bij 0 oude taken een korte, rustige tekst in plaats van de knop.
  "Kies een taak" blijft eronder staan, kleiner. Dit is de plek om de functie te *ontdekken*: hij staat in beeld
  zolang je niets selecteert.
- **De zijbalk** (`public/sidebar.js`): een vast item **Tickmanager** met bliksem-icoon (oranje) en het getal, in het
  bovenste blok direct onder Inbox, dus vlak boven het kopje "Lijsten". Dit is de vaste ingang naar de pagina
  (`#/manager`), ook als er een taak open staat en het detailpaneel bezet is. Het item staat dus niet tússen de
  lijsten: het is geen lijst, en zou anders meeschuiven en tellen als een lijst. Het gebruikt wel dezelfde
  `item`-opmaak (icoon, naam, getal rechts), en is gemarkeerd als de pagina open is (zoals Instellingen).
- Op een smal scherm staat het zijbalk-item ook in de uitschuiflade; dat is dezelfde code.

- **Uiterlijk van de oranje knop (4a en de knop in 4b):** mild oranje achtergrond met een bliksem-icoon (nieuw icoon `bolt` in `public/icons.js`, bijvoorbeeld
  pad `M13 2 4 14h7l-1 8 9-12h-7l1-8z`). De kleur wordt een nieuwe token `--manager` (met `--manager-text`) in
  `public/style.css`, in elk blok waar de andere tokens staan: licht, donker (beide varianten) en het retro-palet.
  Richtwaarden: licht `#f4a259` met donkere tekst `#3a1d00`; donker `#e8964a` met `#2a1400`. In het retro-palet is
  `--accent` zelf al oranje (`#ff8c00`); kies daar een zachtere tint (bijvoorbeeld peru `#cd853f`), zodat de knop te
  onderscheiden blijft van de +. Contrast tekst/icoon op de knop: minstens 3:1.
- **Getal op de ronde knop (4a):** een klein rondje rechtsboven op de knop.
- **Zichtbaar (4a):** volgens dezelfde regels als `#fab` (verborgen als een taak open is, de kaart, de Android-balk of
  het invoerveld in beeld is; zie `style.css` rond `#fab`). Waar de onderste rij nu opschuift voor `#fab` (tray,
  toast), blijft dat zo; de knop staat op dezelfde rij. Controleer dat de knop linksonder niets in de lijst afdekt
  dat nu wel bereikbaar is (de lijst heeft al ruimte onderaan voor `#fab`).
- **Tik op de ronde knop (4a):** opent de Tickmanager-pagina (`#/manager`).
- Toegankelijk: `aria-label` en `title` via i18n ("Tickmanager", met het aantal erin).

## 5. De Tickmanager-pagina (`#/manager`)

- Route: voeg `page: 'manager'` toe in `public/route.js` (zoals `settings` en `help`), met test in `test/route.test.ts`.
- **Bovenaan:** "N taken zijn al een tijd niet bekeken" en een grote knop **Opruimen starten**. Bij 0 een rustige tekst
  ("Alles is bij") en geen knop.
- **Instellingen op de pagina:**
  - termijn nieuw (dagen, standaard 14) en termijn bekeken (dagen, standaard 30); geheel getal 1–365;
  - **Lijsten:** alle lijsten van P (eigen en gedeelde, uit `lists()` in `public/store.js`) onder elkaar, met een
    vinkje **meenemen** en het aantal oude taken in die lijst. Elke rij is een eigen element dat later kan uitklappen
    voor opties per lijst.
- In de gewone Instellingen (`public/settingsview.js`, sectie Weergave): schakelaar **Tickmanager tonen**, standaard
  aan. Uit = geen knop, geen getal; `#/manager` valt dan terug naar de gewone lijst.
- Een ⓘ Help-regel in `public/help.js`.

## 6. De ronde

Start vanaf de pagina. De lijst met oude taken wordt bij de start opgehaald en ligt daarna vast. Kaart voor kaart:
één taak in beeld met titel, lijst, leeftijd ("3 weken niet bekeken") en het begin van de notitie; een teller
("3 van 8"); altijd te stoppen (terug naar de pagina, de rest blijft staan).

| Knop | Effect |
|---|---|
| **Inplannen** | Toont voorstellen van de planner (§9) als knoppen, plus **Kies datum…** (de bestaande `public/datepicker.js`). Kiezen zet `remind_at` (via `store.update(id, { remind_at })`), daarna `reviewed_at` = nu. Annuleren laat de kaart staan. |
| **Bovenaan zetten** | Taak bovenaan zijn lijst, onder de vastgepinde taken (zelfde manier als slepen: `position` voor P, zie `topOrder` in `src/access.ts` en hoe slepen de positie zet); daarna `reviewed_at` = nu. |
| **Laten staan** | Alleen `reviewed_at` = nu. |
| **Verwijderen** | Naar de prullenbak (`store.remove(id)`), met de bestaande ongedaan-maken-toast. |

Aan het eind een samenvatting ("2 ingepland, 1 bovenaan, 1 verwijderd, 4 laten staan") en een knop terug naar je
lijst. Daarna ververst het getal op de knop.

Offline: de acties lopen via de bestaande wachtrij in `store.js` (`mutate`/`enqueue`), dus ook "bekeken" moet daar
een op-type krijgen. Ophalen van de oude taken kan offline uit `state.open` (zie §8), zodat de ronde ook zonder
netwerk werkt.

## 7. Data

Nieuwe migratie `migrations/0018_tickmanager.sql` (nooit een bestaande migratie aanpassen):

```sql
-- Wanneer iemand de taak in de Tickmanager voor het laatst bekeek (laten staan, bovenaan, ingepland). Eén waarde per
-- taak: in een gedeelde lijst geldt bekeken voor iedereen.
ALTER TABLE tasks ADD COLUMN reviewed_at TEXT;
-- Lijsten die iemand niet in zijn opruimronde wil, per persoon. list_id is de vaste id uit list_ids (overleeft hernoemen).
CREATE TABLE review_skip_lists (
  user_id TEXT NOT NULL REFERENCES users(id),
  list_id TEXT NOT NULL,
  PRIMARY KEY (user_id, list_id)
);
```

- `reviewed_at` in UTC-ISO zoals de andere tijden; toevoegen aan de kolomlijst in `src/data.ts` (back-up/import, en
  niet in `NOT_NULL`) en aan de taakgegevens die de PWA krijgt.
- Instellingen per persoon in `user_settings` via `UserPrefs` in `src/prefs.ts`, zelfde patroon als `driveMode`
  (`drive_mode` = 'off', geen rij = standaard):
  - `tickmanager`: aan/uit, standaard aan (rij `tickmanager` = 'off' zet hem uit);
  - `review_new_days`: standaard 14; `review_seen_days`: standaard 30.
  - Geldigheid in `src/settings-api.ts` met `HttpError(400, 'err.…')`; doorgeven in `/api/settings` en `/config.js`.
- Geen nieuwe config in `wrangler.jsonc`: dit zijn instellingen per persoon in de app.

## 8. Server en PWA

**Server** (`src/index.ts`, logica in een nieuw `src/review.ts`):
- `POST /api/tasks/:id/reviewed` — zet `reviewed_at` = nu, en ook `updated_at`, zodat andere apparaten de wijziging
  via sync krijgen. (De leeftijd in §3 kijkt alleen naar `reviewed_at` en `created_at`, nooit naar `updated_at`.)
  Zelfde toegangscheck als andere taakwijzigingen (`getTask`, 404 als niet gevonden).
- `PUT /api/review/lists/:listId` met `{ include: boolean }` — één lijst aan/uit in `review_skip_lists` voor P.
  `listId` moet een lijst van P zijn (anders 404).
- `GET /api/lists` geeft per lijst ook `review: boolean` (meenemen ja/nee), zodat de PWA niets extra hoeft op te halen.
- Inplannen, bovenaan zetten en verwijderen gebruiken de bestaande routes; de bestaande routes veranderen niet.

**Wie bepaalt wat oud is:** de PWA, uit `state.open` (alle open taken staan al in de client) en de instellingen. Zet de
regel in een pure functie (`public/review.js`, `isStale(task, prefs, skipped, now)` en `staleTasks(...)`) die ook in
de server-tests te importeren is, zoals `public/repeat.js` en `public/i18n.js` nu. Zo werken het getal en de ronde
offline, en is er geen extra endpoint nodig om ze op te halen.

**PWA-modules:**
- `public/review.js` — de regel (puur, getest).
- `public/manager.js` — de pagina en de ronde.
- `public/planner.js` — voorstellen voor inplannen (§9).
- Allemaal in `SHELL` in `public/sw.js`, en `CACHE` ophogen (`test/offline.test.ts` controleert dat).
- Ronde knop in `public/index.html` naast `#fab` (met `hidden` en `data-i18n-attr` zoals `#fab`); tonen/verbergen en
  het getal in de module die nu `#fab` regelt (`sidebar.js`), net als het zijbalk-item. De kaart in het lege
  detailpaneel in `public/detail.js`.
- Geen inline scripts of stijlen (CSP), geen build-stap.

**Teksten:** alles in `public/i18n.js` met `en` én `nl` (`test/i18n.test.ts`). Server-fouten als
`HttpError(status, key, vars)`, nooit een zin.

## 9. Voorbereid op inplannen met een gekoppelde agenda (later)

Er komt later een feature die taken inplant op basis van een gekoppelde agenda (Google of een andere). Nu bouwen we
die niet, maar de ronde moet er zonder verbouwing in passen:

- **Eén plek voor voorstellen.** "Inplannen" vraagt `public/planner.js` om voorstellen:
  `suggest(task, ctx) → Promise<Slot[]>`, met `Slot = { at: string /* UTC ISO */, label: string, source: string }`.
  Nu levert de planner vaste voorstellen (`source: 'fixed'`): vandaag (alleen als de standaardtijd nog komt), morgen
  en volgende week op de standaardtijd (`getDefaultTime` in `public/repeat.js`, `quickDays` in `public/calendar.js`).
  Later komt er een bron bij die vrije momenten uit de agenda haalt (`source: 'calendar'`); de UI toont gewoon
  wat de planner teruggeeft en hoeft niet te veranderen.
- **Async vanaf het begin.** `suggest` is async, ook al is de vaste versie dat niet nodig, zodat een agenda-bron
  later via de server kan (bijvoorbeeld een toekomstig `GET /api/planner/slots`).
- **Inplannen zit los van bekeken.** De ronde roept na elk gekozen moment zelf `reviewed`; een toekomstige
  agenda-planner hoeft daar niets van te weten.
- **Wat er later nog bij moet (niet nu bouwen):** een koppeling met de agenda (OAuth, tokens versleuteld per persoon),
  een geschatte duur per taak (nieuwe kolom, bijvoorbeeld `duration_min`) en eventueel meerdere taken tegelijk
  inplannen. Dit ontwerp legt daar niets voor vast in de database.

## 10. Docs

- Nieuwe pagina `docs/tickmanager.md` (Engels, voor gebruikers): wat oud is, de knop, de ronde, de vier keuzes, de
  instellingen, lijsten overslaan. Rij in de index `docs/README.md`.
- `docs/settings.md`: de schakelaar "Show Tickmanager".
- `ARCHITECTURE.md`: rij in het overzicht (`reviewed_at`, `review_skip_lists`, de regel in de client, de endpoints)
  en de nieuwe instellingen.

## 11. Testen en opleveren

**Tests (vitest, map `test/`):**
- `test/review.test.ts` — de regel: beide termijnen, grens van precies N dagen, vastgepind (eigen en deelrij),
  herhalend, herinnering in de toekomst en in het verleden, subtaak, afgevinkt, prullenbak, overgeslagen lijst,
  gedeelde lijst (bekeken door een ander telt ook), sortering oudste eerst.
- API: `reviewed` zet de tijd, 404 zonder toegang, deelnemer van een gedeelde lijst mag het; `PUT /api/review/lists`
  zet en wist; `GET /api/lists` geeft `review`; instellingen valideren (1–365) en standaardwaarden.
- Migratie: `test/migratie*.test.ts`-patroon voor 0018.
- `planner.js`: vaste voorstellen, "vandaag" alleen als de tijd nog komt.
- `route.test.ts`, `i18n.test.ts`, `offline.test.ts` blijven groen.

**Controleren:** `npm run typecheck` en `npm test`. UI in de browser met `npm run dev`: knop op smal en breed scherm,
in licht, donker en retro; pagina; ronde met alle vier de knoppen; schakelaar uit; offline een ronde doen.

**Waar draaien:** het project staat op Google Drive (`H:\My Drive\Git\tick`); een hook blokkeert npm daar. Draai
typecheck, tests, dev-server en deploy in een kopie onder `C:\dev` (robocopy zonder `node_modules`, `.git`,
`.wrangler`, dan `npm ci`). git werkt gewoon op H:.

**Opleveren:** commits in het Nederlands. Pushen en deployen mag zonder te vragen: `npm run db:migrate`, dan
`npm run deploy`, dan `npx wrangler deployments list`.

## 12. Bewust weggelaten

Prioriteitsveld, opties of termijn per lijst, meldingen of een vast weekmoment om op te ruimen, de agenda-koppeling
zelf (alleen de planner-aansluiting, §9).
