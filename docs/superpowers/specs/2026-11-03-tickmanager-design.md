# Tickmanager — ontwerp

Datum: 2026-11-03

## Doel

Taken waar je lang niet naar hebt gekeken, komen terug, één voor één, en per taak beslis je wat ermee gebeurt. Zo raken
taken zonder herinnering niet weg onderaan een lijst. Een apart prioriteitsveld komt er niet: pinnen en slepen zijn de
prioriteit.

## Wanneer is een taak oud

Een taak doet mee in de ronde als alles hieronder klopt:

- open hoofdtaak: `done = 0`, `deleted_at IS NULL`, `parent_id IS NULL`;
- niet vastgepind (voor deze persoon: `tasks.pinned` of `task_shares.pinned`);
- geen herhaling;
- geen herinnering in de toekomst (`remind_at IS NULL` of `remind_at` ligt in het verleden);
- de lijst staat niet in `review_skip_lists` van deze persoon;
- langer dan de termijn niet bekeken:
  - `reviewed_at IS NULL` en `created_at` ouder dan **termijn nieuw** (standaard 14 dagen), of
  - `reviewed_at` ouder dan **termijn bekeken** (standaard 30 dagen).

Subtaken doen niet los mee; ze gaan mee met hun hoofdtaak. Volgorde in de ronde: oudste eerst (op de leeftijd hierboven).

## De ronde

Kaart voor kaart: één taak in beeld met titel, lijst, leeftijd ("3 weken niet bekeken") en het begin van de notitie;
een teller ("3 van 8"); altijd te stoppen. De lijst met taken wordt bij de start opgehaald en ligt daarna vast.

| Knop | Effect |
|---|---|
| Inplannen | De bestaande datum/tijdkiezer; de taak krijgt `remind_at`; `reviewed_at` = nu. |
| Bovenaan zetten | Taak bovenaan zijn lijst, onder de vastgepinde taken (`position` voor deze persoon); `reviewed_at` = nu. |
| Laten staan | Alleen `reviewed_at` = nu. |
| Verwijderen | Naar de prullenbak, met de bestaande ongedaan-maken. |

Annuleren in de datumkiezer laat de taak onaangeroerd op de kaart staan. Aan het eind een korte samenvatting
("2 ingepland, 1 bovenaan, 1 verwijderd, 4 laten staan") en een knop terug.

`reviewed_at` hoort bij de taak, niet bij de persoon: in een gedeelde lijst geldt "bekeken" voor iedereen.

## De Tickmanager-pagina

- Zijbalkknop **Tickmanager** met een stil getal (aantal oude taken; geen getal bij 0). Bladwijzer `#/manager`.
- Bovenaan: "N taken zijn al een tijd niet bekeken" + **Opruimen starten**; bij 0 een rustige tekst.
- Instellingen:
  - termijn nieuw (dagen, standaard 14) en termijn bekeken (dagen, standaard 30);
  - alle lijsten van deze persoon (eigen en gedeelde) onder elkaar met een vinkje **meenemen** en het aantal oude
    taken per lijst. De rijen zijn zo opgezet dat ze later kunnen uitklappen voor opties per lijst.
- In de gewone Instellingen: schakelaar **Tickmanager tonen**, standaard aan. Uit = geen zijbalkknop, geen getal; de
  pagina en `#/manager` zijn dan niet bereikbaar.

## Data

Migratie `migrations/0018_tickmanager.sql`:

- `ALTER TABLE tasks ADD COLUMN reviewed_at TEXT;` (UTC, ISO zoals de andere tijden)
- `CREATE TABLE review_skip_lists (user_id TEXT NOT NULL REFERENCES users(id), list_id TEXT NOT NULL, PRIMARY KEY (user_id, list_id));`
  — `list_id` is de vaste id uit `list_ids`, zodat de keuze hernoemen overleeft.

Per persoon in `user_settings` via `UserPrefs` (`src/prefs.ts`): `tickmanager` (aan/uit, standaard aan; rij 'off' =
uit, net als `drive_mode`), `review_new_days` (14), `review_seen_days` (30).

`reviewed_at` gaat mee in back-up en import (`src/data.ts`, kolomlijst) en in de taakgegevens naar de PWA.

## Server

- `GET /api/review` — de oude taken van deze persoon (volgens de regel hierboven), plus het aantal per lijst.
- `POST /api/tasks/:id/reviewed` — zet `reviewed_at` = nu; zelfde toegangscheck als andere taakwijzigingen.
- `PUT /api/review/lists/:listId` met `{ include: boolean }` — één lijst aan/uit in `review_skip_lists`.
- Inplannen, bovenaan zetten en verwijderen gebruiken de bestaande routes; na inplannen en bovenaan zetten roept de
  PWA `POST /api/tasks/:id/reviewed` aan. De bestaande routes veranderen niet.
- Fouten als `HttpError(status, key, vars)`.

## PWA

- Nieuwe modules (bijvoorbeeld `public/manager.js` voor de pagina, `public/review.js` voor de ronde), in `SHELL` in
  `public/sw.js`; `CACHE` ophogen.
- Route `#/manager` in `route.js`, zijbalkknop in `sidebar.js`, schakelaar in `settingsview.js`.
- Alle teksten in `public/i18n.js` met `en` en `nl`. Geen inline scripts of stijlen.
- Het getal in de zijbalk ververst bij het laden en na wijzigingen aan taken.

## Docs

- Nieuwe pagina `docs/tickmanager.md` (Engels) en een rij in `docs/README.md`.
- Schakelaar vermelden in `docs/settings.md`; korte zin in de Help-pagina van de app.
- `ARCHITECTURE.md`: `reviewed_at`, `review_skip_lists` en de nieuwe endpoints.

## Testen

- De "oud"-regel: beide termijnen, vastgepind, herhalend, herinnering in de toekomst/verleden, subtaak, prullenbak,
  overgeslagen lijst, gedeelde lijst (bekeken door een ander telt ook).
- `reviewed`-endpoint: zet de tijd, weigert taken zonder toegang.
- `i18n.test.ts` en `offline.test.ts` blijven groen.
- UI in de browser met `npm run dev`: pagina, ronde met alle vier de knoppen, schakelaar uit.

## Bewust weggelaten

Prioriteitsveld, opties per lijst, een termijn per lijst, meldingen of een vast weekmoment om op te ruimen.
