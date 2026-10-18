# Kopieën blijven verbonden: zien hoe ver de ander is

Status: concept, wacht op akkoord van Dio.

## Waarom

Bij delen als **kopie** maakt Tick nu bij de ontvanger een volledig losse taak (zie `2026-10-18-taken-delen-design.md`, "Kopie: na accepteren staan de exemplaren helemaal los"). Er blijft niets over waarmee je kunt zien wat de ander met diens exemplaar doet.

Dio's voorbeeld: "Alles gepakt voor ons weekendje". Allebei hebben ze dezelfde klus, ieder voor zich. Het is leuk en motiverend om te zien dat de ander al klaar is met pakken, of al een eind op weg. Daarom moeten kopieën na het accepteren aan elkaar gekoppeld blijven, maar **alleen voor de voortgang**. Verder blijven het eigen taken.

## Wat Dio besloten heeft (brainstorm 2026-10-18)

- Het werkt **alle kanten op**. Wie deelde ziet de ontvangers, de ontvangers zien de deler en elkaar.
- Bij afvinken van de hoofdtaak krijgen de anderen een **pushmelding**, en je kunt het ook **terugzien in de taak**.
- Je ziet ook de **voortgang van de subtaken** van de ander.
- **Echte subtaken en `- [ ]`-regels in de beschrijving tellen samen.**
- **Geen getallen** ("3/7"), maar een **balkje dat volloopt**. Iedereen kan het eigen exemplaar aanpassen. Als iemand een subtaak toevoegt, zie je niet ineens "3/8" bij een ander, en dat voorkomt verwarring.
- **In de lijst: losse labeltjes per persoon** (variant B uit de schetsen). Wie klaar is krijgt een groen "Naam ✓", wie bezig is "Naam" met een mini-balkje.
- **In het detailpaneel: een blok "Kopieën"** met iedereen erin (jijzelf ook). Wie klaar is krijgt "✓ klaar, za 10:42", wie bezig is een groter balkje.
- Dio keurde de samenvatting met deze aannames goed ("perfect"):
  - Iemand die nog niet heeft geaccepteerd, krijgt geen labeltje. In het detailpaneel staat die persoon als "wacht op antwoord".
  - Weer uitvinken gebeurt stil, zonder melding.
  - Wie het eigen exemplaar verwijdert, valt eruit.
  - Kopieën die al bestaan, blijven los.
  - Je ziet alleen de voortgang van de ander, niet wat die verder aan de taak wijzigt.
  - Geen melding bij afgevinkte subtaken, alleen bij de hoofdtaak.

## Doelen

1. Een geaccepteerde kopie en het origineel horen bij één **kopiegroep**. Elke volgende kopie van dezelfde taak hoort bij dezelfde groep.
2. `GET /api/tasks` geeft bij een hoofdtaak in een groep de andere leden mee: naam, klaar of niet (met tijdstip), en voortgang als fractie 0–1.
3. De lijst toont labeltjes per ander lid (klaar: groen met ✓, bezig: naam met mini-balkje). Het detailpaneel toont het blok "Kopieën".
4. Afvinken van een hoofdtaak in een groep stuurt de andere leden een pushmelding "{naam} is klaar ✓" met de taaktitel als tekst.

## Geen doelen

- Live bijwerken. Voortgang van de ander komt binnen bij de volgende sync, net als bij gedeelde taken.
- Zien welke subtaken de ander af heeft, of wat die verder aan titel, beschrijving of herinnering wijzigt.
- Meldingen bij subtaken, bij weer uitvinken, of bij accepteren of weigeren.
- Bestaande kopieën achteraf koppelen.
- Een groep handmatig maken of iemand eruit halen, anders dan door je eigen exemplaar te verwijderen.
- Native Android-schermen. De widget verandert niet.

## Anti-doelen (dan is het mislukt, ook als het technisch werkt)

- Iemand ziet titel, beschrijving, subtaken of andere inhoud van het exemplaar van een ander. Alleen naam, klaar/tijdstip en een voortgangsfractie gaan over de lijn.
- Iemand ziet iets van een groep waar diegene geen lid van is, of van een exemplaar dat in de prullenbak staat.
- Een melding die als spam voelt: dubbel, bij elke subtaak, of aan jezelf.
- Kopieën die al los waren, raken ineens gekoppeld.
- Getallen die verspringen en verwarren. De UI toont nooit "x/y".

## Hoe het werkt

### 1. Datamodel (migratie `0011_kopiegroep.sql`)

- **`tasks.copy_group`** (TEXT, NULL = geen groep), plus een partiële index `WHERE copy_group IS NOT NULL`.
- Alleen hoofdtaken krijgen een `copy_group`. Subtaken nooit.
- Er is geen aparte groepstabel. De leden zijn alle niet-verwijderde hoofdtaken met dezelfde `copy_group`, en de eigenaar van elk lid (`tasks.user_id`) is de persoon.

### 2. Groep vormen (bij accepteren van een kopie)

In `POST /api/shares/:id/accept` met `mode = 'copy'`, in dezelfde batch als `copyStmts`:
- Heeft het origineel nog geen `copy_group`, dan krijgt het een nieuw uuid (`UPDATE … SET copy_group = ? WHERE id = ? AND copy_group IS NULL`). Daarna lees je de groep opnieuw, of gebruik je `COALESCE` in een subquery, zodat twee gelijktijdige accepts in dezelfde groep landen.
- De nieuwe hoofdtaak van de ontvanger krijgt dezelfde `copy_group`.
- Deelt een ontvanger het eigen exemplaar weer als kopie, dan komt die nieuwe kopie in dezelfde groep (*eigen keuze*: "iedereen met een kopie van dezelfde klus").
- **Eén exemplaar per persoon per groep** (*eigen keuze*). `POST /api/shares` met `mode = 'copy'` weigert met 409 `err.copy_exists` als de ontvanger al eigenaar is van een niet-verwijderd exemplaar in de groep van de taak. Bij `accept` gebeurt dezelfde controle nog een keer, want tussen uitnodigen en accepteren kan er iets veranderd zijn. Zonder deze regel kan de groep dubbele labeltjes met dezelfde naam tonen, of jezelf als "de ander". Een kopiegroep-taak delen met mode `shared` met iemand die al een exemplaar in de groep heeft, wordt om dezelfde reden geweigerd (`err.copy_exists`).

### 3. Wie zie je in de groep

Leden zijn de hoofdtaken met dezelfde `copy_group` en `deleted_at IS NULL`, behalve je eigen exemplaar. Per lid:
- `name`: naam van de eigenaar van dat exemplaar
- `done`, `done_at`
- `progress`: getal 0–1, of `null` als het exemplaar geen subtaken en geen `- [ ]`-regels heeft

Daarnaast, alleen voor de eigenaar van een taak met openstaande kopie-uitnodigingen: die uitnodigingen als `{ name, status: 'pending' }`. Die zijn nu verborgen in `shareInfo` ("een openstaande kopie telt niet als deelnemer"), en dat blijft zo voor `share.members`. Ze komen alleen in het nieuwe veld.

Het veld heet `copies` op de hoofdtaak in `GET /api/tasks`: `null` zonder groep (en zonder openstaande kopie-uitnodigingen), anders `{ members: [...], pending: [...] }`. Subtaken krijgen `copies: null`. Ook op `?done=1`; in de prullenbak (`?deleted=1`) altijd `null`. Dit kost één extra query per `GET`, alleen als er een taak met `copy_group` in het antwoord zit (zelfde patroon als `anyShared`/`shareInfo`).

**Een kopiegroep-taak die ook gedeeld is** (mode `shared`): de deelnemers zien dezelfde `copies` als de eigenaar, want het is hun gezamenlijke taak. Het exemplaar telt als één lid met de naam van de eigenaar (*eigen keuze*).

### 4. Voortgang berekenen

`progress = (afgevinkte subtaken + afgevinkte `- [x]`-regels) / (alle subtaken + alle `- [ ]`/`- [x]`-regels)`, over niet-verwijderde subtaken en de beschrijving van de hoofdtaak. Voor de regels gebruik je dezelfde parser als de app (`parseMarkdown` uit `public/markdown.js`, net zoals `src/` nu al `public/i18n.js` importeert), zodat een regel in een codeblok niet meetelt. Is het exemplaar afgevinkt, dan is het `done` en speelt `progress` in de UI geen rol.

### 5. Melding bij afvinken

- Gaat een hoofdtaak met `copy_group` van open naar klaar (via `PATCH done`, `/api/tasks/:id/done`, de knop "Klaar" in een melding of de widget, dus overal waar `setDone` met `done = true` iets verandert), dan krijgen alle **andere** leden van de groep een push via `sendToAll`, ieder in de eigen taal: titel `copy.push_done` ("{name} is klaar ✓" / "{name} is done ✓"), tekst de taaktitel zoals die bij de ontvanger van de melding heet (diens eigen exemplaar), en `url` naar die eigen taak. Zonder abonnement gaat de melding via de eigen fallback-webhook, net als bij uitnodigingen.
- Wie de melding krijgt: de eigenaar van elk **ander** lid-exemplaar, plus de `accepted` deelnemers als dat exemplaar gedeeld is. Nooit iemand op het exemplaar dat net afgevinkt werd: die ziet het al in de eigen taak (*eigen keuze*).
- `{name}` in de melding is wie afvinkte, dus de aanvrager, niet de eigenaar van het exemplaar (*eigen keuze*). Het labeltje in de lijst blijft de naam van de eigenaar dragen.
- Alleen een echte overgang telt. `setDone` zet `done = 1` met een `WHERE done = 0` en stuurt alleen als er een rij veranderde, zodat twee gelijktijdige afvinkacties (outbox, widget, meldingsknop) maar één melding geven.
- De payload heeft geen `taskId` en `actions: []`, zodat `sw.js` er niet de standaardknoppen Klaar/+1 uur bij zet.
- Versturen gebeurt via `waitUntil`. Een mislukte melding laat het afvinken niet mislukken.
- Weer uitvinken stuurt niets. Vinkt iemand af, uit en weer af, dan komt er een tweede melding (*eigen keuze*. Onderdrukken kan later, als het stoort).
- Herhalende taken: zie punt 10.

### 6. Prullenbak en verwijderen

- Een exemplaar in de prullenbak telt niet als lid en krijgt geen meldingen. Na terugzetten telt het weer mee (de kolom blijft staan).
- Definitief verwijderen haalt het exemplaar weg, en daarmee het lid.
- Wordt het origineel verwijderd, dan blijven de andere exemplaren elkaar zien. De groep hangt aan de kolom, niet aan het origineel.
- Een groep met nog maar één exemplaar toont niets (`copies: null`, tenzij er openstaande uitnodigingen zijn).

### 7. Export en import

- **Export** neemt `copy_group` niet mee (*eigen keuze*: het is een koppeling met andere accounts, geen inhoud).
- **Backup-import** laat `copy_group` van bestaande taken staan en zet hem niet op nieuwe.

### 8. De app (PWA)

- **Lijst** (`render.js`): bij een hoofdtaak met `copies.members` per lid een labeltje in de meta-regel. Klaar: groen, "Naam ✓". Bezig: "Naam" plus een mini-balkje (breedte = `progress`; bij `null` geen balkje, alleen de naam). Een `title`/`aria-label` per labeltje, bijvoorbeeld "Sam: klaar" of "Sam: ongeveer de helft" (*eigen keuze*: in woorden afgerond op kwarten, geen getallen). Labeltjes staan na de bestaande meta (herinnering, plek, 👥).
- **Detailpaneel** (`detail.js`): een blok "Kopieën" onder of bij het bestaande deelblok, alleen bij een hoofdtaak met `copies`. Per lid een regel met de naam en ofwel "✓ klaar, {dag tijd}" (in de eigen tijdzone, met de bestaande datumopmaak) ofwel een groter balkje. "Jij" staat er ook in, op basis van de eigen taak zoals de client die kent, dus ook offline actueel. Openstaande uitnodigingen staan als "wacht op antwoord".
- **Service worker**: de nieuwe melding heeft geen knoppen. Klikken opent `url`.
- Stijl: binnen de bestaande kleuren en tokens. Groen voor klaar, de accentkleur voor het balkje. Werkt in licht en donker.
- Nieuwe module (bijvoorbeeld `copies.js`) in `SHELL`, en `CACHE` ophogen.
- Alle teksten via `public/i18n.js` in `en` en `nl`.

### 9. Documentatie

`ARCHITECTURE.md`: `tasks.copy_group`, hoe een groep ontstaat, het veld `copies` en de melding bij afvinken. In het ontwerp voor taken delen staat dat een kopie "helemaal los" is. Laat dat document staan en verwijs vanuit `ARCHITECTURE.md` naar dit document. In de README bij de beschrijving van delen één zin toevoegen.

## Tests (verplicht, naast typecheck en de bestaande suite)

- Accepteren van een kopie zet `copy_group` op origineel en kopie. Een tweede ontvanger komt in dezelfde groep. Een kopie van een kopie ook. Twee gelijktijdige accepts geven één groep.
- `copies` in `GET /api/tasks`: de deler ziet de ontvangers, de ontvangers zien de deler en elkaar. Een derde account buiten de groep ziet niets. Er gaat geen titel, beschrijving of subtaak van een ander over de lijn.
- Voortgang: alleen subtaken, alleen `- [ ]`-regels, beide samen, regels in een codeblok tellen niet, verwijderde subtaken tellen niet, niets te tellen geeft `null`.
- Openstaande kopie-uitnodiging: alleen de eigenaar ziet `pending`, en die verschijnt niet in `share.members`.
- Prullenbak: een verwijderd exemplaar valt eruit en komt terug na terugzetten. Verwijderen van het origineel laat de rest gekoppeld.
- Melding: afvinken stuurt naar de andere leden (en hun gedeelde deelnemers), niet naar jezelf. Uitvinken stuurt niets. Afvinken via `/done` en via de knop in de melding doen het ook. Een exemplaar in de prullenbak krijgt niets.
- Bestaande kopieën (`copy_group` NULL) blijven los.
- Migratie `0011` op een database met bestaande data.
- i18n: nieuwe sleutels in `en` en `nl`. `offline.test.ts` met de nieuwe module.

### 10. Herhalende taken

Een kopie neemt de herhaling over (`copyStmts`). Afvinken schuift zo'n taak door (`rollRepeat`), en `done` wordt nooit 1. Dio koos (2026-10-18) voor: **elke keer afvinken telt als "klaar voor deze keer"**.

- **Melding.** Elke keer dat een herhalend exemplaar doorschuift (een echte doorschuif in `rollRepeat` met `done = true`), gaat dezelfde melding "{name} is klaar ✓" naar de andere leden. Een doorschuif ongedaan maken stuurt niets.
- **Klaar in `copies`, relatief aan wie kijkt.** Een herhalend lid geldt als `done` als zijn `repeat_at` later is dan de `repeat_at` van het exemplaar van de kijker. Sam is dan een ronde verder. Vinkt de kijker ook af, dan staan ze weer gelijk en toont het labeltje weer het balkje. De server rekent dit per kijker uit.
- **Geen tijdstip.** Bij een herhalend lid toont het detailpaneel "✓ klaar" zonder tijdstip (*eigen keuze*: er is geen kolom die het laatste doorschuiven bewaart, en een tijdstip voegt hier weinig toe). `done_at` is dan `null`.
- **Voortgang** is die van de huidige ronde. Subtaken gaan bij doorschuiven weer open, zoals nu al gebeurt.
- **Randgeval.** Heeft de kijker of het lid de herhaling eraf gehaald, dan vergelijk je niet. Het lid is dan gewoon `done` als zijn `done` 1 is, en anders toon je de voortgang (*eigen keuze*).
- **Tests.** Doorschuiven stuurt een melding. Ongedaan maken stuurt niets. "Klaar" verschilt per kijker, dus Sam verder dan jij geeft ✓ en gelijk geeft het balkje.

## Wat aan de bouwer is

De precieze SQL, waar de groepsquery woont (`src/access.ts` of `src/shares.ts`), de opmaak van labeltjes en balkjes binnen de bestaande stijl, en de exacte i18n-sleutels.
