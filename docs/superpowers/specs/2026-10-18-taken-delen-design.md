# Taken delen tussen accounts (en een prullenbak)

Status: concept, wacht op akkoord van Dio.

## Waarom

Tick heeft sinds project 2 meerdere accounts op één installatie; iedereen heeft een eigen, privé Tick. Dio en zijn vriendin willen af en toe een taak samen hebben. Twee voorbeelden van Dio:

- "Lekkere dingen kopen voor vanavond": één taak voor allebei. Wie hem afvinkt, vinkt hem voor allebei af. → **gedeeld**
- "Kadootje kopen voor X": ieder een eigen exemplaar, want het worden twee kadootjes. → **kopie**

Omdat een gedeelde taak door de ander verwijderd kan worden, wil Dio een **prullenbak** waaruit je een taak kunt terugzetten. Die geldt voor alles wat je in Tick verwijdert, niet alleen voor gedeelde taken.

## Wat al vaststond (brainstorm 2026-10-17)

- Eigen lijsten blijven privé. Je deelt per taak, niet per lijst.
- Je voegt iemand toe via accountnaam of e-mailadres.
- Per keer kies je **gedeeld** (één taak, afvinken geldt voor iedereen) of **kopie** (een los exemplaar).
- De ontvanger krijgt een pushmelding met Accepteren/Weigeren. Na accepteren staat de taak in haar Inbox.

## Wat in deze brainstorm besloten is (2026-10-18)

- **Gedeelde taak:** titel, beschrijving, subtaken, herinnering, herhaling en plek zijn van iedereen samen. Wie iets aanpast, past het voor iedereen aan. De herinnering gaat naar iedereen.
- **Kopie:** na accepteren staan de exemplaren helemaal los van elkaar.
- **Verwijderen** zet een taak in de prullenbak. Verwijdert iemand een gedeelde taak, dan staat hij bij iedereen in de prullenbak, en wie hem terugzet, zet hem voor iedereen terug.
- De **prullenbak** geldt voor alles. Na 30 dagen wordt een taak echt gewist.
- **Stoppen met delen** staat los van verwijderen: de ontvanger kan stoppen (de taak verdwijnt bij haar en blijft bij de eigenaar staan) en de eigenaar kan iemand van de taak afhalen.
- Dio heeft de samenvatting met de keuzes hieronder die als *eigen keuze* gemarkeerd zijn goedgekeurd ("looks good").

## Doelen

1. Vanuit een taak (hoofdtaak) kies je "Delen", vul je een accountnaam of e-mailadres in en kies je gedeeld of kopie.
2. De ontvanger krijgt een pushmelding met Accepteren en Weigeren, en ziet openstaande uitnodigingen ook in de app (voor als de melding gemist is of er geen push is).
3. Een geaccepteerde gedeelde taak staat bij de ontvanger in haar Inbox. Afvinken, bewerken, subtaken, herinnering en herhaling gelden voor iedereen.
4. Een geaccepteerde kopie is een eigen taak van de ontvanger, met eigen subtaken, in haar Inbox.
5. Verwijderen gaat altijd naar de prullenbak. Vanuit de prullenbak kun je terugzetten, definitief verwijderen of de prullenbak legen. Na 30 dagen wist de cron een taak definitief.
6. Werkt in de PWA (ook in de Android-app als TWA), in de Android-widget (gedeelde taken staan erin en zijn af te vinken), en voor meldingen (web push en de fallback-webhook van ieder).

## Geen doelen

- Hele lijsten delen.
- Live meekijken: wijzigingen van de ander komen binnen bij de volgende sync (start, terug naar de app, na een eigen wijziging), zoals nu tussen twee toestellen van één persoon.
- Een melding aan de eigenaar als iemand accepteert, weigert, afvinkt of stopt. (Kan later.)
- Rechten per persoon (alleen lezen, alleen afvinken). Iedereen op een gedeelde taak mag alles, behalve mensen toevoegen.
- Delen met iemand buiten deze Tick-installatie.
- Een losse subtaak delen.
- Native Android-schermen voor delen of de prullenbak; de widget toont alleen wat de API teruggeeft.

## Anti-doelen (dan is het mislukt, ook als het technisch werkt)

- Iemand ziet, of krijgt een melding van, een taak die niet met hem gedeeld is: via een id raden, de lijsten, zoeken, de cron, export of een import. Dezelfde eis als bij accounts, nu met één uitzondering: wat expliciet gedeeld én geaccepteerd is.
- Een taak is weg zonder dat je hem nog kunt terugzetten, omdat de ander op verwijderen drukte.
- De lijstindeling van de een verandert door wat de ander doet (zij sleept de taak naar "Boodschappen", hij ziet hem ineens daar).
- Een gedeelde taak die de ontvanger nog niet heeft geaccepteerd, verschijnt al in haar lijsten.

## Hoe het werkt

### 1. Datamodel (migratie `0010_delen.sql`)

**`tasks.deleted_at`** (TEXT, ISO UTC, NULL = niet verwijderd). Plus een partiële index op `deleted_at WHERE deleted_at IS NOT NULL` voor de prullenbak en het opruimen.

**`task_shares`**, één rij per uitnodiging of deelname:

| Kolom | Betekenis |
|---|---|
| `id` | TEXT, uuid |
| `task_id` | de **hoofdtaak**, `REFERENCES tasks(id) ON DELETE CASCADE` |
| `from_user` | wie uitnodigde (altijd de eigenaar van de taak) |
| `to_user` | de ontvanger |
| `mode` | `shared` \| `copy` |
| `status` | `pending` \| `accepted` (alleen `shared` wordt ooit `accepted`; een kopie-rij verdwijnt bij accepteren) |
| `list` | lijst van de ontvanger (NULL zolang `pending`; bij accepteren `Inbox`) |
| `position` | positie van de ontvanger in zijn eigen volgorde (bij accepteren bovenaan, zoals een nieuwe taak) |
| `created_at`, `responded_at` | |

`UNIQUE (task_id, to_user)`: per taak en persoon één uitnodiging of deelname. Index op `(to_user, status)`.

De **eigenaar** van een taak blijft `tasks.user_id`; `tasks.list` en `tasks.position` zijn van de eigenaar. Subtaken van een gedeelde taak hebben altijd `user_id` = de eigenaar van de hoofdtaak, ook als een ontvanger ze aanmaakt (*eigen keuze*). Zo blijft "een subtaak hoort bij zijn ouder" waar en hoeft er per subtaak geen deelname te bestaan.

### 2. Wie mag wat (toegang)

Iemand heeft **toegang** tot een taak als hij de eigenaar is, of als er een `accepted` `task_shares`-rij is voor de hoofdtaak (`COALESCE(parent_id, id)`) met `to_user` = hij. Alle huidige plekken die `WHERE id = ? AND user_id = ?` doen voor één taak (ophalen, wijzigen, afvinken, snoozen, verwijderen, subtaak aanmaken), gaan via één toegangsfunctie. Een id zonder toegang blijft zich gedragen als een id dat niet bestaat (404, of 400 `err.parent_missing`). Updates op subtaken die nu filteren op het `user_id` van de aanvrager, filteren op het `user_id` van de taak (de eigenaar).

| Actie | Eigenaar | Ontvanger (accepted) |
|---|---|---|
| Zien, bewerken, afvinken, snoozen, subtaken, herinnering, herhaling, plek | ja | ja |
| Lijst en volgorde | in `tasks` | in zijn eigen `task_shares`-rij |
| Verwijderen (naar de prullenbak, voor iedereen) | ja | ja |
| Terugzetten uit de prullenbak (voor iedereen) | ja | ja |
| Definitief verwijderen | ja, voor iedereen | alleen uit zijn eigen prullenbak (zie 8) |
| Iemand uitnodigen | ja | nee (403 `err.share_owner_only`) (*eigen keuze, goedgekeurd*) |
| Iemand van de taak afhalen, een uitnodiging intrekken | ja | alleen zichzelf (= stoppen) |

Extra regels (*eigen keuze*):
- Alleen een hoofdtaak kan gedeeld worden (400 `err.share_subtask`). Een taak die zelf een subtaak wordt (via `parent_id`), kan alleen onder een ouder met **dezelfde eigenaar** komen; anders 400 `err.parent_missing`. Een gedeelde hoofdtaak kan geen subtaak worden (400 `err.share_is_shared`), anders zouden de deelnames aan een subtaak hangen.
- Een taak in de prullenbak kan niet gedeeld worden (404).

### 3. Uitnodigen

`POST /api/shares` `{ task_id, to, mode }` (sessie of `full`-sleutel):
- `to` is een e-mailadres (exact, hoofdletterongevoelig) of een accountnaam (exact na trimmen, hoofdletterongevoelig). Geen of meer dan één account met die naam: 404 `err.share_user_unknown` of 409 `err.share_user_ambiguous` (vraag dan om het e-mailadres). Jezelf: 400 `err.share_self`.
- Bestaat er al een rij voor deze taak en persoon: 409 `err.share_exists`.
- Maakt een `pending`-rij en stuurt een pushmelding naar alle abonnementen van de ontvanger (`sendToAll`), in de taal van elk abonnement: titel `share.push_title` ("{name} deelt een taak met je" / "{name} stuurt je een kopie"), tekst de taaktitel, knoppen `accept` en `decline`, data `{ shareId, url: '/?share=<id>' }`. Geen abonnement: dan via de fallback-webhook van de ontvanger, zonder knoppen. Mislukt de melding, dan blijft de uitnodiging gewoon staan; ze is altijd in de app te zien.
- Antwoord `201` met de rij. Geen rate limit nodig (alleen tussen accounts van één installatie).

Waar je de naam vandaan haalt: de deeldialoog toont als suggestie de mensen met wie je al eerder deelde (uit `task_shares`, `from_user` = jij) (*eigen keuze*). Een lijst van alle accounts op de installatie toont de app niet.

### 4. Uitnodiging bekijken, accepteren, weigeren

- `GET /api/shares/incoming`: jouw `pending`-rijen met `{ id, mode, task: { title, description, subtasks: n, remind_at }, from: { name }, created_at }`. Rijen waarvan de taak in de prullenbak staat, telt het niet mee.
- `POST /api/shares/:id/accept`:
  - `shared`: `status = accepted`, `list = 'Inbox'`, `position` = bovenaan in jouw volgorde, `responded_at`. De taak staat daarmee in je Inbox.
  - `copy`: maakt in één batch een nieuwe taak van jou met nieuwe ids, in `Inbox`, bovenaan: titel, beschrijving, herinnering, herhaling en plek **zoals ze nu zijn** (niet zoals bij het versturen) (*eigen keuze*), plus de subtaken (allemaal open; volgorde blijft) (*eigen keuze*). `notified` en `loc_notified` 0, maar een herinnering die al voorbij is telt als gemeld (zoals bij de backup-import). `source = 'share'`. Daarna wordt de rij verwijderd.
  - Staat de taak in de prullenbak of bestaat hij niet meer: 410 `err.share_gone` en de rij verdwijnt.
  - Niet jouw uitnodiging of al verwerkt: 404.
- `POST /api/shares/:id/decline`: verwijdert de rij. 404 als hij niet van jou is.
- Beide werken met sessie en `full`-sleutel, zodat de knoppen in de melding (service worker, met cookie) werken.

### 5. Stoppen met delen

- `DELETE /api/shares/:id`: de ontvanger stopt (de taak verdwijnt uit zijn lijsten en blijft bij de eigenaar), of de eigenaar haalt iemand van de taak af of trekt een uitnodiging in. Voor anderen 404.
- Het detailpaneel toont bij een gedeelde taak wie er op zitten, met per persoon "verwijderen" (eigenaar) of bij jezelf "Stoppen met delen" (ontvanger). Er komt een bevestiging (bestaande `dialog.js`).
- De eigenaar kan niet "stoppen": hij kan iedereen eraf halen of de taak verwijderen.

### 6. Taken ophalen met gedeelde taken erin

`GET /api/tasks` (open, `?done=1` en `?q=`) geeft je eigen taken plus de taken waar je `accepted` op zit (hoofdtaak en subtaken), nooit taken met `deleted_at`. Voor gedeelde taken waar je ontvanger bent, worden `list` en (bij de hoofdtaak) `position` vervangen door die uit jouw `task_shares`-rij; subtaken krijgen de lijst van hun ouder bij jou. Sorteren op positie gebeurt na dat vervangen.

Elke taak krijgt een veld `share`:
- `null` voor een taak die met niemand gedeeld is (ook geen openstaande uitnodiging);
- anders `{ owner: { id, name }, mine: boolean, members: [{ share_id, user_id, name, status }] }` op de hoofdtaak (`mine` = jij bent de eigenaar). Subtaken krijgen `share: null`; de app kijkt naar de ouder. Openstaande kopie-uitnodigingen tellen niet als `members`.

Dit kost één extra query per `GET` (alle deelrijen van de taken in het antwoord, met de namen uit `users`).

**Lijsten:** `GET /api/lists` telt gedeelde taken mee in jouw lijst. `POST /api/lists/rename` hernoemt ook je eigen `task_shares.list`. `POST /api/lists/delete`:
- `tasks: 'inbox'`: ook je gedeelde taken in die lijst gaan naar je Inbox (in je `task_shares`-rij).
- `tasks: 'delete'`: alles in die lijst gaat naar de prullenbak, ook gedeelde taken waar je ontvanger bent, dus voor iedereen (*eigen keuze*: hetzelfde als ze één voor één verwijderen, en ze zijn terug te zetten).

**Wijzigen** (`PATCH /api/tasks/:id`) door een ontvanger: `list` en `position` gaan naar zijn `task_shares`-rij (en `rebalanceIfNeeded` werkt dan op zijn eigen volgorde: zijn eigen hoofdtaken plus zijn deelnames). Alle andere velden gaan naar de taak zelf, voor iedereen. Last write wins per veld, zoals nu. Tijdberekeningen (herhaling doorschuiven, een tijd zonder zone) gebruiken de zone van wie de wijziging doet, zoals nu; voor Dio en zijn vriendin is dat dezelfde zone (*eigen keuze*).

### 7. Herinneringen en meldingen

- De cron (`runReminders`) slaat taken in de prullenbak over en stuurt een verlopen herinnering naar de eigenaar **en** iedereen met `accepted`, elk naar zijn eigen abonnementen in zijn eigen taal, en elk met zijn eigen fallback-webhook als er bij hem niets aankwam.
- **Bezorging per persoon** (*eigen keuze*): een nieuwe tabel `reminder_sent (task_id, user_id, remind_at, PRIMARY KEY (task_id, user_id))` (in `0010`, `ON DELETE CASCADE` op de taak) onthoudt per persoon voor welke `remind_at` hij al een melding kreeg (of opgegeven is na het retry-venster). De cron slaat iemand over als zijn rij de huidige `remind_at` heeft. `tasks.notified` gaat pas op 1 als iedereen op de taak klaar is (bezorgd of na het retry-venster). Zo krijgt niemand dubbele meldingen en houdt ieder zijn eigen 15-minutenvenster en fallback. Omdat de rij aan `remind_at` hangt, hoeven snoozen, doorschuiven en wijzigen niets extra te resetten: een nieuwe `remind_at` telt vanzelf als nog niet gemeld. Voor een taak die met niemand gedeeld is, werkt het precies als nu.
- De knoppen "Klaar" en "+1 uur" in de melding werken voor iedereen op de taak (via de toegangsfunctie). "+1 uur" verzet de herinnering voor iedereen; dat volgt uit "herinnering is gedeeld".
- **Plek:** de plek is gedeeld, en `loc_notified` ook. Wie er het eerst is, krijgt de melding; daarna is hij gemeld voor iedereen (*eigen keuze*; voor "boodschappen halen" klopt dat, en per persoon bijhouden is een groter project).

### 8. Prullenbak

- `DELETE /api/tasks/:id` zet `deleted_at = now` op de taak en haar subtaken (zelfde tijdstempel), in plaats van ze te wissen. Werkt voor eigenaar en ontvanger. Een 404 blijft een 404 (de outbox laat die stil vallen).
- `GET /api/tasks?deleted=1&limit=&offset=`: jouw verwijderde taken plus verwijderde gedeelde taken waar je `accepted` op zat, nieuwste eerst, met `deleted_at`. Een verwijderde subtaak waarvan de ouder óók verwijderd is (met hetzelfde tijdstempel), staat er niet los in maar hoort bij de ouder.
- `POST /api/tasks/:id/restore`: zet `deleted_at = NULL` op de taak en de subtaken met hetzelfde `deleted_at`. Een subtaak terugzetten waarvan de ouder in de prullenbak staat, zet de ouder ook terug (*eigen keuze*). Een herinnering die intussen voorbij is, telt als gemeld.
- `DELETE /api/tasks/:id?purge=1` (alleen op een taak in de prullenbak): de **eigenaar** wist hem echt, met subtaken en `task_shares`-rijen. Doet een **ontvanger** dit, dan verdwijnt de taak alleen uit zijn eigen prullenbak (zijn `task_shares`-rij gaat weg, net als stoppen met delen) en blijft hij bij de eigenaar terug te zetten (*eigen keuze*, volgt uit het anti-doel "weg zonder dat je hem nog kunt terugzetten").
- `POST /api/trash/empty`: wist al jouw taken in de prullenbak die je **bezit**; verwijderde gedeelde taken van een ander verdwijnen alleen uit jouw prullenbak als de eigenaar ze wist of na 30 dagen (*eigen keuze*: "prullenbak legen" wist niet ongevraagd andermans taak).
- De cron wist eens per run alles met `deleted_at` ouder dan 30 dagen (met de `task_shares`-rijen; D1 dwingt de foreign key af, maar wis ze ook expliciet, zoals bij subtaken).
- In de prullenbak telt een taak niet mee in lijsten, zoeken, de widget, herinneringen of uitnodigingen.
- **Export:** alleen je eigen taken die niet in de prullenbak staan; gedeelde taken van een ander niet (*eigen keuze*). **Backup-import:** een taak uit het bestand die bij jou in de prullenbak staat, komt terug (`deleted_at = NULL`), net als nu een gewiste taak terugkomt.
- **Account verwijderen** (beheerder) blijft echt wissen. De `task_shares`-rijen van en naar die persoon gaan mee; taken die hij bezat verdwijnen ook bij de ontvangers (*eigen keuze*: eigendom overdragen is een groter project).

### 9. De app (PWA)

- **Delen:** in het detailpaneel van een hoofdtaak een knop "Delen". Een dialoog met een veld (naam of e-mailadres, met eerdere deelgenoten als suggestie) en een keuze gedeeld / kopie, met per keuze één zin uitleg. Alleen online (anders de bestaande "alleen online"-melding).
- **Wie er op zitten:** onder de knop de deelnemers met hun status ("wacht op antwoord", "doet mee"), en per persoon de acties uit punt 5.
- **Herkennen in de lijst:** een gedeelde taak krijgt in de takenlijst een klein icoontje met de naam van de ander(en) (title-attribuut en schermlezertekst).
- **Uitnodigingen:** bovenaan de takenlijst een balk per openstaande uitnodiging: "{naam} deelt '{titel}' met je" (of "stuurt je een kopie van") met Accepteren en Weigeren. Opgehaald bij elke sync; offline niet getoond. `/?share=<id>` (uit de melding) opent de app met die balk in beeld.
- **Melding:** de service worker kent de knoppen `accept` en `decline`: `POST /api/shares/<shareId>/accept` of `/decline`. Daarna een korte bevestigingsmelding is niet nodig; de app ververst bij de volgende start.
- **Prullenbak:** in de zijbalk onder "Afgerond" een item "Prullenbak". Een weergave zoals "Afgerond" (online opgehaald), per taak "Terugzetten" en "Definitief verwijderen", bovenaan "Prullenbak legen" met bevestiging, en een regel uitleg ("Taken worden na 30 dagen definitief verwijderd").
- **Verwijderen** houdt de bestaande bevestiging (`confirm`), met nieuwe tekst: "Naar de prullenbak?", en bij een gedeelde taak dat hij voor iedereen naar de prullenbak gaat. Er komt geen ongedaan-maaktoast; terugzetten gaat via de prullenbak (*eigen keuze*).
- **Lokale cache/offline:** gedeelde taken gaan als gewone taken in IndexedDB. Wijzigingen gaan via de bestaande outbox. Delen, uitnodigingen en de prullenbak zijn alleen online.
- Nieuwe modules (bijvoorbeeld `share.js`, `trash.js`) in `SHELL` en `CACHE` ophogen.
- Alle teksten via `public/i18n.js` in `en` en `nl`; serverfouten als `HttpError(status, key)`.

### 10. Android-widget

Geen wijziging in de native code nodig: de widget leest `GET /api/tasks` en vinkt af via `/api/tasks/:id/done`, die gedeelde taken via de toegangsfunctie meenemen. Gedeelde taken staan in de widget in de lijst van de ontvanger.

### 11. Documentatie

`ARCHITECTURE.md`: datamodel (`deleted_at`, `task_shares`), de nieuwe routes, de toegangsregel ("een id van een ander account gedraagt zich als een id dat niet bestaat, tenzij de taak met je gedeeld is"), de cron (meldingen naar deelnemers, opruimen na 30 dagen) en de prullenbak. README alleen als er een functielijst in staat.

## Tests (verplicht, naast typecheck en de bestaande suite)

- Isolatie: zonder `accepted` (dus ook `pending`) ziet de ontvanger de taak niet in `GET /api/tasks`, `?q=`, `?done=1`, `/api/lists`, en krijgt hij 404 op `PATCH`/`DELETE`/`done`/`snooze`. Een derde account ziet nooit iets.
- Gedeeld: accepteren zet hem in haar Inbox; haar `list`/`position` raken de eigenaar niet en andersom; titel/afvinken/subtaak/herinnering gelden voor beiden; een subtaak van haar heeft de eigenaar als `user_id`.
- Kopie: accepteren maakt eigen taken met nieuwe ids en subtaken; wijzigen raakt het origineel niet.
- Uitnodigen: naam, e-mail, onbekend, dubbele naam, jezelf, al bestaand, een subtaak, alleen de eigenaar.
- Stoppen: ontvanger stopt, eigenaar haalt af; daarna weer 404 voor de ontvanger.
- Prullenbak: verwijderen, terugzetten (ook subtaak met ouder), definitief (eigenaar wist, ontvanger verdwijnt alleen uit zijn eigen prullenbak), legen (alleen eigen), cron na 30 dagen, gedeelde taak bij beiden in de prullenbak, geen herinneringen voor verwijderde taken.
- Cron: herinnering naar eigenaar en deelnemer, ieder in zijn eigen taal; bezorgd bij de een en niet bij de ander geeft geen dubbele melding en laat de ander zijn eigen retry en fallback houden.
- Account verwijderen ruimt `task_shares` op.
- Migratie: `0010` op een database met bestaande data.

## Wat aan de bouwer is

De precieze SQL (één toegangs-subquery of een helper die de rij plus de deelrij teruggeeft), de verdeling over bestanden (een `src/shares.ts` ligt voor de hand), de opmaak van dialoog, balk en icoontje binnen de bestaande stijl, en de exacte i18n-sleutels.
