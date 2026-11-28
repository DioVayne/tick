# Condities bij een taak combineren met en/of

Datum: 2026-11-28. Status: plan (nog niets gebouwd). Wachtrij: Q-4.

## Kort voor Dio

1. **Nu** heeft een taak drie soorten "wanneer": een **tijd** (Herinner me), **plekken** (Als ik aankom bij / vertrek bij) en **Home Assistant-triggers** (Meld als). Elke soort meldt **los**: een taak met een tijd én een plek geeft twee meldingen. Binnen één soort is het al "of": meerdere plekken of triggers geven één melding, bij de eerste.
2. **Jouw vermoeden klopt grotendeels:** één schakelaar voor de hele taak is het best te begrijpen. Maar dan wel met twee regels erbij, anders gaat het mis:
   - de schakelaar werkt alleen **tussen soorten** (tijd, plek, trigger), nooit binnen een soort. "Aankomen bij AH én aankomen bij Jumbo" kan nooit tegelijk, dus binnen een soort blijft het altijd "of";
   - bij "allemaal" wordt de tijd **"vanaf"** ("na vr 17:00, als ik bij AH ben"). Twee momenten vallen bijna nooit precies samen; "vanaf" wel.
3. Verbindingswoorden per regel ("A en B of C") en groepjes met haakjes zijn voor gewone mensen te moeilijk: in de voorbeelden hieronder raden de meeste mensen de betekenis verkeerd. Die bouwen we niet.
4. **Advies, stap 1:** een schakelaar die alleen verschijnt als een taak twee soorten heeft: *Meld bij elk* (zoals nu) of *Meld pas als alles klopt*. Onder de stappen een zin die zegt wat er gebeurt ("Je krijgt één melding: als je na vr 17:00 bij AH bent."). Eerst als testfunctie op je eigen Tick, met tijd + plek en tijd + trigger. Plek + trigger samen nog niet (Tick weet niet waar je bent; dat los je beter in Home Assistant op).
5. **Stap 2 (later):** een eindtijd ("tussen 17:00 en 19:00 bij AH"). **Nooit:** haakjes en geneste logica.
6. **Play:** stap 1 heeft een **nieuwe Android-build** nodig (de telefoon moet bij een plek wachten tot de tijd voorbij is). Geen Play Console-werk, zolang we geen "exacte wekker"-toestemming gebruiken (dat hoeft niet).

Vragen voor jou staan onderaan ("Open vragen").

---

## 1. Hoe het nu werkt

| Soort | Waar opgeslagen | Wie beslist en meldt | Binnen de soort | Hoe vaak |
|---|---|---|---|---|
| **Tijd** (`Herinner me vr 27 nov, 17:30`) | `tasks.remind_at` (UTC), `reminder_sent` per persoon; herhalen met `repeat_rule` | Server: cron elke minuut, web push (en de vangnet-webhook) | Één tijd per taak | Eén melding per `remind_at`; herhalen schuift de taak door |
| **Plek** (`Als ik aankom bij AH Centrum +2`) | `loc_*` + `loc_more` (tot 10 plekken), `loc_trigger` (`enter`/`exit`) voor de hele taak, `loc_notified` (eigenaar) en per deelnemer in `task_shares` | **Alleen de Android-telefoon** (geofences, vangnet elke 15 min). De server weet nooit waar je bent | Al "of": één melding bij de eerste plek | Eén melding, tot wegvegen of *Opnieuw melden* |
| **Home Assistant** (`Meld als Wasmachine klaar of Post bezorgd`) | `user_settings` `hatrigger:tasks`, `hatrigger_fired` | Server: `POST /api/hatrigger/fire` vanuit HA | Al "of" (`hatrigger.or`): de eerste trigger meldt | Eén melding tot *Opnieuw melden*, een andere keuze of de volgende herhaling |
| Agenda | `calendar_events` | Server | – | Geen voorwaarde: de agenda helpt kiezen en meldt een botsing ("Botst met je agenda"). Valt buiten dit plan |

Belangrijk voor dit plan:

- **Tussen de soorten bestaat nu geen logica**: elke soort meldt los (`notified`, `loc_notified`, `hatrigger_fired` staan los van elkaar). Afvinken stopt alles.
- **De tijd is ook de deadline.** Er is geen `due_at`; een taak met een tijd in het verleden is "verlopen" en komt in de dagelijkse verlopen-melding (`src/overdue.ts`).
- **De plek is privé op de telefoon.** De belofte op de website en in de privacyverklaring: *Tick weet niet waar je bent.* De telefoon meldt alleen *dat* er gemeld is. Elke "en" waarbij de server moet weten of je ergens bent, breekt die belofte.
- **De telefoon wordt niet door de server gewekt.** De Android-app ververst bij openen, via `tick://sync` vanuit de PWA en elke ~15 minuten. Web push komt via Chrome binnen, niet bij de app zelf.
- **Geofences melden overgangen**, geen toestand. Wie al binnen is als een geofence wordt gezet, krijgt zonder "initial trigger" geen melding (zo is het nu bewust).
- **De tijdlijn** (`public/steps.js`, gebruikt door `composer.js` en `detail.js`) toont per soort één zin met een stip: *Herinner me* · *Herhalen* · *Als ik aankom bij* · *Meld als* · *In Inbox*. Er is nu geen plek voor een verbindingswoord tussen de stappen.
- **iPhone en web zonder Android**: plekken melden daar nooit.
- **Home Assistant kan zelf al voorwaarden**: de integratie heeft per trigger "bleef een tijd in die toestand" en "alleen tussen twee tijden", en in HA zelf kun je elke combinatie maken (ook "iemand is thuis").

## 2. Eerst de kern: momenten en toestanden

Waarom "en" lastig is: de meeste voorwaarden zijn **momenten** (het wordt 17:00, ik kom aan, ik vertrek, de wasmachine is klaar). Twee momenten vallen bijna nooit op dezelfde seconde. "17:00 én aankomen bij AH" letterlijk genomen meldt dus nooit.

Wat mensen met "en" bedoelen, is bijna altijd: **het laatste moment telt, en de rest moet dan nog kloppen**. Daarvoor moet elke voorwaarde ook een **toestand** hebben:

| Voorwaarde | Als moment | Als toestand ("klopt nog") | Wie weet de toestand |
|---|---|---|---|
| Tijd 17:00 | het wordt 17:00 | **vanaf** 17:00 (tot de taak af is, of tot een eindtijd in stap 2) | iedereen (klok) |
| Aankomen bij X | ik kom aan | ik **ben** bij X | alleen de telefoon |
| Vertrekken bij X | ik vertrek | ik ben **niet** bij X (maar zie onder) | alleen de telefoon |
| HA-trigger | hij gaat af | hij **is afgegaan** sinds de taak klaarstaat (HA meldt niet wanneer het weer "terug" is) | de server |

Lastige gevallen:
- **Vertrekken + tijd.** "Als ik vertrek bij werk, na 17:00": wie om 15:00 al vertrokken is, is om 17:00 "niet bij werk", maar bedoelt niet dat de melding dan komt. Voor vertrekken telt dus alleen een **echt vertrek na de tijd**, geen toestand.
- **Twee aankomsten met "en"** (AH én Jumbo): kan alleen als de cirkels overlappen. Zinloos.
- **Aankomen én vertrekken** (bij dezelfde of andere plek): dat is een volgorde ("eerst hier, dan daar"), geen "en". Zinloos als voorwaarde; dan maak je twee taken.
- **Twee HA-triggers met "en"**: kan ("beide zijn afgegaan"), maar HA doet dit zelf beter (met echte toestanden). Niet in Tick.

Gevolg voor elke optie hieronder: **binnen één soort blijft het "of"** (zoals nu), en "en" heeft alleen zin **tussen soorten**, met de tijd als "vanaf".

## 3. De opties

### (a) Eén schakelaar voor de hele taak: "elk" of "allemaal"

Verschijnt pas als een taak voorwaarden van **twee of meer soorten** heeft. Twee standen:
- **Meld bij elk** (standaard, = nu): elke soort meldt los.
- **Meld pas als alles klopt**: één melding, op het moment dat de laatste voorwaarde gebeurt terwijl de rest klopt. De tijd betekent dan "vanaf".

In de tijdlijn: tussen de stappen een klein woord **én** (bij "allemaal") en onder de stappen een samenvattende zin.

Voor de gebruiker
- + Eén keuze, één plek, geen volgorde of haakjes. Past in de bestaande zinnen: de stappen blijven gelijk, alleen het verbindingswoord en de samenvatting veranderen.
- + De samenvatting ("Je krijgt één melding: als je na vr 17:00 bij AH bent") laat zien wat Tick ervan maakt; daar vangen mensen hun eigen fout.
- − "Allemaal" met drie soorten (tijd + plek + trigger) wordt al lastig te voorspellen. Daarom in stap 1 niet toegestaan met plek + trigger.
- − Wie "alles" kiest en nooit bij de plek komt, krijgt **geen** melding op de tijd. Moet in de samenvatting staan, en de taak moet in de lijst "wacht op AH" tonen.

Voor de bouw
- Datamodel: één kolom `tasks.cond_all INTEGER NOT NULL DEFAULT 0` (migratie `0038_…`), of als testfunctie een `user_settings`-rij (`condall:tasks`, JSON zoals `hatrigger:tasks`), zonder migratie.
- Server: de cron slaat de tijdmelding over bij `cond_all` (de tijd wordt een poort). Tijd + HA volledig op de server: een trigger die vóór de tijd afgaat, wordt onthouden (`hatrigger_fired` met "wacht op tijd"), de cron stuurt hem op de tijd; na de tijd meteen.
- Android: tijd + plek volledig op de telefoon (werkt offline, privacy blijft): `NotifyDecision` krijgt een uitkomst `TE_VROEG` (geofence vóór `remind_at`: niets melden, `loc_notified` niet zetten). Op de tijd zelf: geofences voor aankomst opnieuw zetten **met** initial trigger, zodat "je bent er al" ook meldt. Dat kan zonder exacte wekker: een onnauwkeurige wekker (`setAndAllowWhileIdle`) of de sync van elke 15 minuten; een paar minuten te laat is aanvaardbaar. Geen nieuwe toestemming, dus geen Play Console.
- Oude Android-apps kennen `cond_all` niet en melden de plek te vroeg. Daarom toont de PWA de schakelaar alleen als je telefoon (tabel `devices`, `app_version`) nieuw genoeg is, en anders "Werk de Android-app bij".
- Widget: verandert niet (snel toevoegen maakt één soort). Wel "wacht op" in de regel van de lijst.
- MCP/API: `location`, `remind_at` blijven; extra veld `conditions: "each" | "all"`. MCP-tekst: "after Fri 17:00, when arriving at AH".
- Kopieën, back-up (`TASK_COLUMNS`), verhuizen: de kolom gaat mee.
- Gedeelde taken: de stand hoort bij de taak; elke deelnemer krijgt zijn eigen melding (eigen telefoon, eigen `loc_notified`).
- Herhalen: na een herhaling staat alles weer klaar; de poort schuift mee met `repeat_at`.

### (b) Verbindingswoord per regel, zonder haakjes ("A en B of C")

Tussen elke twee voorwaarden een knopje *en* / *of*.

Voor de gebruiker
- + Lijkt flexibel en "zoals je praat".
- − **Dubbelzinnig.** "Na 17:00 én bij AH óf als de post er is": is de post genoeg op zich, of ook pas na 17:00? Wiskundig gaat "en" voor "of", in gewone taal leest iedereen het anders. Zonder haakjes is er geen manier om het te laten zien.
- − De volgorde van de stappen ligt vast in de tijdlijn (tijd, herhalen, plek, trigger, lijst). Verbindingswoorden tussen vaste stappen voelen willekeurig.
- − Binnen een soort (meerdere plekken) zou je dan ook "en" kunnen kiezen, wat zinloos is (zie §2).

Voor de bouw
- Een lijst van voorwaarden met een operator ertussen, voorrangsregels, en elke uitkomst moet zowel op de server als op de telefoon berekend worden. Ongeveer zoveel werk als (c), met slechter begrip. Afgeraden.

### (c) Groepen op één niveau

Bijvoorbeeld: "Meld als **alles** hiervan klopt: [na 17:00] [een van: AH, Jumbo]" of omgekeerd.

Voor de gebruiker
- + Geen dubbelzinnigheid; de groep laat zien wat bij elkaar hoort.
- − Een tweede laag in een kaart die nu bewust plat is; op een telefoon past dat slecht in de zinnen.
- − In de praktijk zijn de groepjes die zin hebben al de soorten zelf (plekken = één groep "of", triggers = één groep "of"). Optie (a) **is** dus al "één niveau groepen", maar dan vanzelf, zonder dat je groepen hoeft te maken.

Voor de bouw
- Nieuw datamodel (lijst van groepen met voorwaarden), alle bestaande kolommen worden een speciaal geval, de Android-app moet het ook lezen. Veel werk voor weinig winst boven (a).

### (d) Volledige geneste logica (haakjes, niet, enzovoort)

- + Alles kan.
- − Niemand buiten techniek gebruikt het goed; fouten worden stille fouten (een taak die nooit meldt).
- − Bouwen, testen en uitleggen is groot; botst met de belofte dat de plek op de telefoon blijft (willekeurige combinaties met plekken vragen al snel om locatie op de server).
- Wie dit wil, heeft **Home Assistant**: daar kan het al, en een HA-trigger kan het resultaat aan Tick doorgeven. **Nooit bouwen.**

### (e) "Meld als … alleen als …" (gebeurtenis + voorwaarde)

Zoals bij Home Assistant-automatiseringen: één regel **Meld als** (momenten, onderling "of": aankomen, vertrekken, trigger, tijd), en een regel **Alleen als** (toestanden: na een tijd, tussen twee tijden, op werkdagen).

- + Logisch zuiver: momenten en toestanden zijn gescheiden, dus geen zinloze "en".
- − Twee nieuwe begrippen in de kaart; mensen moeten weten wat een "moment" en wat een "toestand" is. Voor de doelgroep (huishouden, niet technisch) een stap te ver.
- Bruikbaar als **binnenkant** van (a): de schakelaar "allemaal" maakt van de tijd stilletjes een "alleen als (vanaf)". Zo krijgt de gebruiker de eenvoud van (a) en de juiste werking van (e).

### (f) Vaste patronen (presets)

Een paar kant-en-klare zinnen in het keuzemenu: "Na een tijd, zodra ik bij … ben", "Tussen … en … bij …", "Na een tijd, zodra … (trigger)".

- + Heel duidelijk; geen fout mogelijk.
- − Elke nieuwe combinatie is een nieuw patroon; het menu groeit; het past slecht bij de bestaande losse stappen (je kiest nu eerst een plek, dan een tijd, in elke volgorde).
- Bruikbaar als **hulp** bij (a): het keuzemenu van een plek kan "Pas na een tijd…" aanbieden, wat tijd + schakelaar in één keer zet. Niet als eigen model.

## 4. Begrijpelijkheid: voorbeelden zoals je ze zou zien

Per voorbeeld: wat er in de tijdlijn staat, wat Tick doet, en of een gewone gebruiker het zonder uitleg goed raadt (✔ ja, ~ twijfel, ✘ nee).

### Optie (a): één schakelaar

1. **Boodschappen voor Sanne**
   - Herinner me **vr 27 nov, 17:00**
   - **én** Als ik aankom bij **AH Centrum +2**
   - *Meld pas als alles klopt* — samenvatting: "Je krijgt één melding: als je na vr 17:00 bij AH Centrum of een van de 2 andere plekken bent."
   - Tick: om 16:30 aankomen geeft niets; om 17:00 nog in de winkel → melding (iets na 17:00). ✔ (dankzij de samenvatting)
2. **Was ophangen**
   - Herinner me **za 28 nov, 10:00**
   - **én** Meld als **Wasmachine klaar**
   - Samenvatting: "Je krijgt één melding: als Wasmachine klaar is, maar niet vóór za 10:00."
   - Tick: wasmachine klaar om 8:00 → melding om 10:00. ✔
3. **Pakketje ophalen bij Alex**
   - Herinner me **ma 30 nov, 09:00**
   - Als ik aankom bij **Thuis**
   - *Meld bij elk* (standaard) — samenvatting: "Je krijgt een melding om ma 09:00, en nog een als je thuiskomt."
   - Zoals nu. ✔
4. **Lamp in de gang** (vertrekken)
   - Herinner me **vandaag, 17:00** **én** Als ik vertrek bij **Werk**
   - Samenvatting: "Je krijgt één melding: als je na 17:00 bij Werk vertrekt."
   - Wie om 15:00 al weg was, krijgt vandaag niets. ~ (de samenvatting zegt het; toch zullen sommigen verrast zijn. Het lijstje toont "wacht op: vertrek bij Werk", en de verlopen-melding van de volgende ochtend vangt het op)
5. **Zinloos: twee soorten zonder tijd, plek + trigger**
   - Als ik aankom bij **Thuis** **én** Meld als **Post bezorgd**
   - In stap 1 kan "allemaal" hier niet: de schakelaar is grijs met "Een plek en een trigger samen kan Tick niet: Tick weet niet waar je bent. Tip: maak in Home Assistant een trigger 'Post bezorgd terwijl ik thuis ben'." ✔ (duidelijk wat wel kan)
6. **Zinloos: twee plekken**
   - Als ik aankom bij **AH Centrum, Jumbo**
   - Geen schakelaar (één soort). De bestaande notitie blijft: "Eén melding, bij de eerste van deze plekken waar je aankomt." ✔

Oordeel: met de samenvatting raden mensen 5 van de 6 goed; de twijfel zit bij vertrekken, en dat is ook een twijfelgeval in gewone taal.

### Optie (b): verbindingswoord per regel

1. Herinner me **vr 17:00** **en** Als ik aankom bij **AH** — ✔ zelfde als (a).
2. Herinner me **vr 17:00** **en** Als ik aankom bij **AH** **of** Meld als **Post bezorgd**
   - Bedoeling A: (na 17:00 bij AH) of (post). Bedoeling B: na 17:00 én (AH of post). ✘ de helft raadt verkeerd; Tick kan niet laten zien welke het is zonder haakjes.
3. Als ik aankom bij **AH** **en** **Jumbo** (binnen één soort) — ✘ meldt nooit; moet verboden worden, waarmee de knop per regel deels betekenisloos is.
4. Herinner me **vr 17:00** **of** Meld als **Wasmachine klaar** — ✔ maar dit is gewoon (a) "elk", met minder duidelijke gevolgen (één melding of twee?). ~
5. Als ik vertrek bij **Werk** **en** Als ik aankom bij **Thuis** — ✘ bedoeld als volgorde, kan nooit tegelijk.

Oordeel: 1–2 van de 5 goed. Afgeraden.

### Optie (c): groepen op één niveau

1. **Alles van:** [Herinner me vr 17:00] [**Een van:** AH, Jumbo] — ~ goed te volgen als je het ziet, maar zelf in elkaar zetten op een telefoon lukt weinigen.
2. **Een van:** [Meld als Post bezorgd] [**Alles van:** vr 17:00, Thuis] — ✘ de omgekeerde nesting begrijpt bijna niemand zonder uitleg.
3. **Alles van:** [vr 17:00] [Wasmachine klaar] — ✔ (maar dit is (a)).
4. **Alles van:** [AH] [Jumbo] — ✘ zinloos, moet de app tegenhouden.

Oordeel: wat begrijpelijk is, kan (a) ook; de rest niet.

### Optie (d): geneste logica

1. (vr 17:00 **en** (AH **of** Jumbo)) **of** (Post bezorgd **en niet** Thuis) — ✘ en het tweede deel kan Tick niet eens (Tick weet niet waar je bent).

Oordeel: niet voor deze app.

### Optie (e): "Meld als … alleen als …"

1. Meld als ik aankom bij **AH** · Alleen als **na vr 17:00** — ✔ duidelijk, maar twee soorten regels in de kaart.
2. Meld als **Wasmachine klaar** · Alleen als **na za 10:00** — ~ "dan pas om 10:00?" Velen denken dat een melding om 8:00 gewoon wegvalt.
3. Meld als **om vr 17:00** · Alleen als ik **bij AH ben** — ✘ de omgekeerde vorm verwart (en kan alleen de telefoon).
4. Meld als ik vertrek bij **Werk** · Alleen als **tussen 17:00 en 19:00** — ✔

Oordeel: zuiver maar wennen; goed als binnenkant van (a), niet als wat je ziet.

### Optie (f): vaste patronen

1. **Na een tijd, zodra ik bij een plek ben:** vr 17:00 · AH — ✔
2. **Tussen twee tijden bij een plek:** 17:00–19:00 · AH — ✔
3. **Na een tijd, zodra een trigger afgaat:** za 10:00 · Wasmachine klaar — ✔
4. Wil je iets wat geen patroon is (twee plekken en een trigger), dan kan het niet. ~

Oordeel: alles wat bestaat is duidelijk; maar het is een lijstje dat steeds langer wordt.

## 5. Randgevallen (voor de gekozen richting, (a))

- **Tijd als moment of als venster.** Bij "allemaal" is de tijd altijd "vanaf". Een eindtijd ("tot 19:00") is stap 2. Zonder eindtijd blijft de taak wachten tot je afvinkt.
- **Nooit samen.** Komt de plek nooit na de tijd, dan geen melding. Vangnet: de lijstregel toont "wacht op AH", de taak gaat na de tijd als verlopen mee in de dagelijkse verlopen-melding (`overdue.ts`) zoals nu. Open vraag voor Dio of dat gewenst is.
- **Al ter plekke.** Om 17:00 al in de winkel → wel een melding (initial trigger bij het opnieuw zetten van de geofence). Bij vertrekken niet: daar telt alleen een echt vertrek na de tijd.
- **Herhalen.** De poort is de huidige `repeat_at`/`remind_at`. Na afvinken of doorschuiven staat alles weer klaar (plek: `loc_notified` terug, trigger: `rep` ≠ `repeat_at`, zoals nu).
- **Snoozen** ("Over 1 uur") verschuift de poort. Logisch, maar zeggen in de samenvatting.
- **Gedeelde taken.** De stand is van de taak (eigenaar kiest; deelnemers zien hem). Tijd en trigger gelden voor iedereen, de plek per persoon. Iedereen krijgt zijn eigen ene melding.
- **Geen Android-telefoon** (iPhone, alleen web): "allemaal" met een plek meldt dan nooit. De PWA kijkt in `devices`; zonder Android-telefoon (of te oude app) is "allemaal" met een plek niet te kiezen, met uitleg.
- **Offline.** Tijd + plek beslist de telefoon met zijn cache, dus werkt offline. Tijd + trigger beslist de server; HA en de server moeten online zijn (zoals nu).
- **Oude apps.** Een Android-app van vóór deze functie meldt de plek gewoon direct (te vroeg). Opgevangen door de schakelaar alleen te tonen bij een nieuwe app (`devices.app_version`).
- **Wijzigen.** Elke wijziging van tijd, plek, trigger of de schakelaar zet alles weer klaar (zoals nu al bij plek en trigger).
- **Quick add / widget / quickdate.** Maken één soort; de schakelaar zet je in de app. "morgen 17:00 bij AH" uit quickdate wordt **niet** automatisch "allemaal": te verrassend.
- **Agenda-botsing** blijft over de tijd gaan, ook als die een poort is.

## 6. Advies en fasering

**Kies (a), met (e) als binnenkant en (f) als hulpje.** Eén schakelaar tussen soorten, de tijd wordt "vanaf", en een samenvattende zin die zegt wat Tick gaat doen.

### Stap 1: schakelaar "Meld bij elk / Meld pas als alles klopt" (eerst als testfunctie `condall`)

Wat:
- Alleen zichtbaar bij twee of meer soorten, alleen voor de eigenaar van een hoofdtaak.
- Toegestaan bij "allemaal": **tijd + plek** en **tijd + trigger**. Plek + trigger (met of zonder tijd) nog niet, met uitleg en de Home Assistant-tip.
- Tijdlijn: woord **én** tussen de stappen, samenvattende zin onder de stappen (in kaart en paneel, via `steps.js`), en "wacht op …" in de lijstregel.
- Hulp in het plekmenu: "Pas na een tijd…" (zet tijd + "allemaal" in één keer). Optioneel.

Bouw (testfunctie-regels uit CLAUDE.md):
- Eigen bestanden: `src/condall.ts`, `public/condall.js`, `test/condall.test.ts`; in gedeelde bestanden alleen de schakelaarcheck met een commentaar `// condall`.
- Opslag zonder migratie: `user_settings`-rij `condall:tasks` (JSON `{taskId: true}`, per eigenaar, zoals `hatrigger:tasks`).
- Server: cron slaat de tijdmelding over voor zulke taken; hatrigger-fire vóór de tijd wordt bewaard en op de tijd verstuurd.
- `GET /api/tasks` geeft `conditions: "all"` mee aan de Android-app.
- Android (nieuwe build): `NotifyDecision` `TE_VROEG`, geofences op de tijd opnieuw met initial trigger (onnauwkeurige wekker of sync), JUnit-tests; `app_version` omhoog, zodat de PWA weet dat hij het kan.
- Rij in de tabel "Test features" in `ARCHITECTURE.md`, naam in `TEST_FEATURES` in `src/features.ts`, aan in Dio's eigen `wrangler.jsonc`.
- Als testfunctie: geen handleiding, geen website, geen news.js, geen Play Console.

Als Dio hem daarna een gewone functie maakt (checklist uit CLAUDE.md):
1. Code: schakelaarchecks weg; migratie `0038_condities.sql` met `tasks.cond_all` (en een migratie die de `condall:*`-rijen opruimt); `public/i18n.js` en + nl, bijvoorbeeld:
   - `cond.each` "Meld bij elk" / "Notify for each"
   - `cond.all` "Meld pas als alles klopt" / "Notify only when all are true"
   - `cond.and` "én" / "and"
   - `cond.sum_all` "Je krijgt één melding: {wat}." / "You get one notification: {what}."
   - `cond.sum_each` "Je krijgt een melding voor elk hiervan." / "You get a notification for each of these."
   - `cond.waiting` "wacht op {wat}" / "waiting for {what}"
   - `cond.no_place_ha` "Een plek en een trigger samen kan Tick niet: Tick weet niet waar je bent." / "Tick can't combine a place and a trigger: Tick doesn't know where you are."
   - `cond.need_app` "Werk de Android-app bij om dit te gebruiken." / "Update the Android app to use this."
2. Tests: server (cron overslaan, trigger bewaren, herhalen, delen), PWA (samenvatting, schakelaar alleen bij twee soorten), `test/i18n.test.ts`, Android JUnit (`NotifyDecision`). `npm run typecheck`, `npm test`, browsercontrole met `npm run dev`.
3. Handleiding: een stuk in `docs/reminders.md` (of een eigen pagina `docs/combining.md` met een rij in `docs/README.md`), verwijzingen vanuit `docs/places.md` en `docs/home-assistant.md`. `ARCHITECTURE.md`: kolom, cron, `NotifyDecision`, API-veld.
4. Website (NL + EN, via cms-sync eerst): tegel "Pas als alles klopt" met verhaal en schermafbeelding van de tijdlijn met samenvatting (`nl-…webp`, `en-…webp`); rij in "Wat werkt waar" (met een plek alleen Android); FAQ "Ik kreeg geen melding, hoe kan dat?" aanvullen. De schermafbeelding van het taakpaneel vernieuwen als die verandert.
5. `public/news.js`: één zin, bijvoorbeeld "Een taak met een tijd en een plek kan nu één melding geven: pas als je na die tijd op de plek bent." (en + nl).
6. **Play-regel: nieuwe build** (Android 1.16, versionCode omhoog), **geen Play Console-werk** (geen nieuwe toestemming: geen `SCHEDULE_EXACT_ALARM`, geen nieuwe soort gegevens). Als we toch een exacte wekker zouden willen: dan wel Play Console (verklaring exacte wekkers). Advies: niet doen.

### Stap 2 (later, als stap 1 bevalt)

- **Eindtijd**: "tussen 17:00 en 19:00 bij AH" (kolom `remind_until`, telefoon haalt geofences na de eindtijd weg).
- **Plek + trigger** via de telefoon: als een trigger afgaat, merkt de telefoon het bij de volgende sync (tot ~15 min) en kijkt zelf of je er bent. Kan zonder dat de server je plek kent, maar is traag; alleen als er echt vraag naar is.
- Eventueel "Meld bij de eerste" als derde stand (één melding, de rest zwijgt), als mensen de dubbele meldingen bij "elk" storend vinden.

### Nooit

- Verbindingswoorden per regel (b), zelf groepen maken (c), geneste logica (d).
- "En" binnen één soort (twee plekken, twee triggers).
- Iets waarvoor de server moet weten waar je bent.

## Open vragen voor Dio

1. Bij "Meld bij elk": moet het zoals nu blijven (elke soort een eigen melding), of liever **één** melding bij de eerste (zoals bij meerdere plekken)?
2. Als "allemaal" nooit uitkomt (je komt niet bij de winkel): mag de taak dan gewoon als verlopen meegaan in de dagelijkse verlopen-melding, of wil je op de tijd zelf toch een stille melding "wacht nog op AH"?
3. Vertrekken + tijd: is "alleen een echt vertrek ná de tijd" wat je verwacht, of moet "om 17:00 al weg" ook melden?
4. Eerst als testfunctie op je eigen Tick (met een nieuwe Android-build voor jezelf), of meteen voor iedereen?
5. Is de naam goed: "Meld bij elk" / "Meld pas als alles klopt"? Alternatieven: "Eén van deze" / "Allemaal", of "Los" / "Samen".
