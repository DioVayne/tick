# Gedeelde lijsten

Status: concept, wacht op akkoord van Dio.

## Waarom

Dio gaat met Medy op vakantie. Ze maken samen een lijst met spullen die mee moeten, en allebei willen ze taken toevoegen en afvinken. Zit de strandbal in de tas, dan is hij voor allebei klaar. Hetzelfde voor een vriendengroep die een weekend weggaat en samen een lijst maakt van wat er mee moet.

Dat kan nu alleen per taak: elke taak apart delen, en de ander moet elke uitnodiging accepteren (`docs/sharing.md`). Voor een lijst waar je samen in werkt is dat te omslachtig. Dio wil "een speciale lijst die gedeeld is, waar we allebei taken in kunnen zetten die dan automatisch met elkaar gedeeld zijn". De ander accepteert de lijst één keer, en daarna niet meer per taak.

In een groep speelt nog iets: niet alleen "is het ingepakt", maar ook "wie neemt het mee". Zonder dat nemen twee mensen een barbecue mee, of niemand.

## Wat het wordt

Een lijst kan gedeeld worden met een of meer andere accounts op dezelfde installatie. Elke hoofdtaak in die lijst is een **gedeelde taak** (de bestaande modus `shared`) met iedereen die in de lijst zit, zonder uitnodiging per taak. Daarbovenop krijgt een gedeelde lijst drie dingen die een gewone lijst niet heeft: afgevinkte taken blijven in de lijst staan, je kunt een taak op je naam zetten ("ik neem het mee"), en je kunt meldingen bij afvinken aanzetten.

### Leden en rollen (Dio)
- **De beheerder van Tick** maakt accounts aan, zoals nu. Verder heeft die geen rol in een gedeelde lijst.
- **De eigenaar van een lijst** (wie hem deelde) beheert die lijst: nodigt mensen uit en haalt ze eruit. Alleen de eigenaar kan dat.
- **Leden** mogen verder alles wat de eigenaar mag: taken toevoegen, aanpassen, afvinken, verwijderen en eruit slepen. Dio: "Het is een gedeelde verantwoordelijkheid."
- Een lijst kan met meerdere mensen gedeeld zijn (een vriendengroep van een stuk of zes).

### Gedrag (Dio)
1. **Delen en accepteren.** De eigenaar deelt een lijst met iemand. Die krijgt één uitnodiging (push en balk in de app, zoals bij taken) en accepteert of weigert. Na accepteren staat de lijst bij beide in de zijbalk.
2. **Taken toevoegen.** Iedereen in de lijst kan taken toevoegen. Een nieuwe taak is meteen van alle leden; niemand hoeft iets te accepteren.
3. **Afgevinkt blijft staan.** Een afgevinkte taak verdwijnt niet uit de lijst maar blijft staan tot iemand hem verwijdert. Bij de taak staat wie hem afvinkte en wanneer, bijvoorbeeld "Sanne · vr 17:30". Dio: "Het is er namelijk wel handig om te kunnen zien wanneer iets is afgevinkt."
4. **Verwijderen.** Een verwijderde taak staat bij iedereen in de Prullenbak, zoals een gedeelde taak nu.
5. **Ik neem het mee.** Iedereen kan een open taak die nog van niemand is op zijn naam zetten; de lijst toont dan "Jaap neemt mee".
   - Een taak op naam kan niemand anders overnemen. Alleen wie hem op zich nam, kan hem weer loslaten; daarna kan een ander hem nemen.
   - Een taak op naam kan alleen die persoon afvinken.
6. **Meldingen bij afvinken.** Per gedeelde lijst kun je aanzetten dat je een melding krijgt als een taak wordt afgevinkt. Staat dat uit, dan kun je het per taak aanzetten. Die keuze per taak is alleen zichtbaar als het op lijstniveau uit staat.
7. **Taak eruit slepen.** Iedereen mag een taak uit de gedeelde lijst naar een persoonlijke lijst slepen. De taak is daarna alleen nog van degene die sleepte. Bij de anderen verdwijnt hij, zonder melding.
8. **Lid vertrekt.** Verlaat een lid de lijst, dan blijven alle taken in de lijst staan, ook die het lid zelf toevoegde. Ze zijn daarna niet meer van dat lid; het lid ziet de lijst en de taken niet meer.
9. **Lijst verwijderen.** Verwijdert de eigenaar de gedeelde lijst, dan verdwijnt de lijst met alle taken, ook voor de leden. De bevestiging moet dat gevolg echt duidelijk zeggen (Dio: "er moet wel echt duidelijk vermeld worden wat het gevolg is"), met de namen van de leden.

### Keuzes van Claude (voorgelegd, Dio sprak ze niet tegen)
- Herinneringen (tijd en plek) komen bij ieder lid binnen, met de bestaande regels per persoon (`reminder_sent`, `loc_notified` per persoon).
- Een persoonlijke taak die je naar de gedeelde lijst sleept, wordt automatisch gedeeld met de leden, zonder uitnodiging.
- Subtaken gaan altijd mee met hun hoofdtaak (er wordt alleen op hoofdtaken gedeeld, zoals nu).
- Een lid verwijderen werkt hetzelfde als een lid dat zelf vertrekt (punt 8).
- Een taak die een lid eerder naar een eigen lijst sleepte, blijft van dat lid als het lid later vertrekt.
- Afgevinkte taken staan onderaan in een eigen blok "Afgevinkt", met de laatst afgevinkte bovenaan, en tellen niet mee in het getal in de zijbalk. Een knop **Opruimen** haalt ze in één keer weg.
- Meldingen bij afvinken stelt ieder voor zichzelf in; ze staan standaard uit. Je krijgt nooit een melding van je eigen vinkje.
- "Ik neem het mee" werkt in elke gedeelde lijst, ook met twee mensen.
- Verlaat iemand de lijst of wordt iemand eruit gehaald, dan zijn de taken op zijn naam weer van niemand. Zo blijft er nooit een taak vastzitten.

### Keuzes van Claude (nog niet aan Dio voorgelegd)
- **Opruimen** zet de afgevinkte taken voor iedereen in de Prullenbak, net als verwijderen (punt 4).
- Afgevinkte taken uit een gedeelde lijst staan ook onder **Voltooid**, zoals elke afgevinkte taak.
- Een taak op naam zetten of loslaten geeft geen push.
- Zonder melding op lijstniveau en per taak gelden de bestaande meldingen van gedeelde taken (afvinken, plek erbij) niet voor taken in een gedeelde lijst. Anders krijgt Medy een push voor alles wat Dio inpakt.
- **Lijst verwijderen:** de taken gaan voor iedereen naar de Prullenbak. Alleen de eigenaar kan ze daaruit terughalen; ze komen terug als persoonlijke taak in zijn Inbox (de lijstdeling bestaat dan niet meer). De eigenaar houdt de bestaande keuze "taken naar Inbox": dan houdt alleen de eigenaar ze, als persoonlijke taken, en verdwijnen ze voor de leden. De bevestiging noemt in beide gevallen de leden en dat zij de taken kwijt zijn.
- **Lid verwijderen:** het lid krijgt een melding ("Dio heeft je uit Weekend Ardennen gehaald"). De bevestiging voor de eigenaar zegt dat de taken die het lid toevoegde in de lijst blijven.
- **Account van de eigenaar verwijderen:** de lijst gaat over op het lid dat er het langst in zit, met alle taken. Zonder leden verdwijnt alles, zoals nu.

### Doelen
1. Een groep werkt in één lijst, en elke taak daarin is zonder extra stappen van iedereen.
2. Eén keer accepteren is genoeg.
3. Je ziet in de lijst wat er gedaan is, door wie en wanneer.
4. Niemand neemt per ongeluk hetzelfde mee: wie iets op zich neemt, staat erbij, en alleen die persoon vinkt het af.
5. Je krijgt alleen meldingen als je die zelf aanzet.
6. Vertrekken, eruit gehaald worden en verwijderen raken nooit onverwacht iemands taken.

### Geen doelen (aparte features, eventueel later)
- **Ieder een eigen exemplaar:** een lijst waarvan elke taak per persoon een kopie wordt (ochtendroutine per kind). Wel: de opslag van een lijstdeling krijgt een modus (`shared`, later eventueel `copy`), zodat dit later zonder lastige migratie kan. Alleen `shared` wordt gebouwd.
- **Sjabloon weggeven:** een eenmalige, losse kopie van een hele lijst voor iemand anders.
- **Eén taak apart in een gedeelde lijst** (de tandenborstel die ieder zelf nodig heeft): kan al met kopiedelen per taak.
- Delen met mensen buiten de installatie.
- Leden die zelf anderen uitnodigen.

### Anti-doelen (dan is het mislukt, ook als het werkt)
- Iemand raakt taken kwijt zonder het te weten bij vertrekken, eruit gehaald worden of de lijst verwijderen. (Eruit slepen gaat bewust zonder melding, zie punt 7.)
- Een lid moet alsnog per taak iets accepteren.
- Een stroom meldingen die niemand vroeg.
- Taken uit een gedeelde lijst lekken naar iemand die niet (meer) in de lijst zit.

## Randvoorwaarden
- De regels in `CLAUDE.md`: nieuwe migratie (`0017_…` en verder), teksten via `public/i18n.js` (en en nl), fouten als `HttpError(status, key)`, nieuwe modules in `SHELL` van `public/sw.js` met een hogere `CACHE`, user guide in `docs/sharing.md` (en `docs/tasks-and-lists.md` waar nodig) en `ARCHITECTURE.md` bijwerken.
- Bouw voort op het bestaande delen: `task_shares` (modus `shared`, met lijst, volgorde, pin en `loc_notified` van de ontvanger), `src/access.ts`, `src/shares.ts`, de meldingen in `src/push.ts`. Gedrag van losse gedeelde taken (buiten een gedeelde lijst) blijft zoals het is.
- Tick houdt nu niet bij wie een taak afvinkte, alleen wanneer (`done_at`). Dat moet erbij, net als op wiens naam een taak staat.
- Een lijst is nu een naam per persoon (`tasks.list`, tabel `lists`, `list_ids`); een gedeelde lijst heeft een identiteit nodig die voor alle leden dezelfde is.
- Offline: delen werkt nu alleen online. Taken toevoegen, afvinken en op naam zetten in een gedeelde lijst moeten offline werken via de outbox, net als een gewone taak. Wie als eerste een taak op naam zet, wint bij synchroniseren.
- Android-widget en `/mcp` moeten gedeelde lijsten blijven tonen zoals andere lijsten. Een taak op naam van een ander kan daar ook niet worden afgevinkt.
- Een schets van de lijst staat in het gesprek van 25 oktober 2026: kopregel met naam, leden en belletje; open taken met "Jaap neemt mee" of een knop "Ik neem het mee"; onderaan het blok "Afgevinkt" met naam en tijd en "Opruimen". De vormgeving volgt verder de stijl van Tick.

## Aan de bouwer
- Het datamodel: een tabel voor lijstdelingen, en hoe een taak in een gedeelde lijst gedeeld is (automatische `task_shares`-rijen of toegang via lidmaatschap).
- Van wie een taak is die een lid toevoegt, binnen de regels hierboven (bij vertrek blijven alle taken bij de eigenaar).
- De naam van de lijst bij een lid, en wat er gebeurt als dat lid al een lijst met dezelfde naam heeft.
- Hoe een gedeelde lijst eruitziet in de zijbalk en het lijstmenu (Delen, leden, Verlaten, meldingen).
- Hoe bestaande per-taak-delen zich verhouden tot een taak in een gedeelde lijst.
- Wat er met de naam op een taak gebeurt als je de taak weer openzet (afvinken ongedaan maken).
