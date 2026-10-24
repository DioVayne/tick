# Locatiemelding op tijd, ook onderweg (auto en fiets)

Status: concept, wacht op akkoord van Dio.

## Waarom

Dio zette een herinnering op de Albert Heijn met een cirkel van ongeveer 200 m, zodat de melding zou komen vóórdat hij er was. Hij kwam met de auto. De melding kwam pas toen hij al in de winkel stond.

De oorzaak: de Android-app laat Google Play-diensten de plekken bewaken (`Geo.java`, geofences). Die bekijken je locatie op de achtergrond maar af en toe; Google noemt een vertraging van gemiddeld 2 à 3 minuten. Te voet maakt dat weinig uit, met de auto rijd je in die tijd kilometers.

**De cirkel die je instelt is de plek waar je de melding wilt krijgen.** Het doel is dus niet "zoveel minuten eerder", maar: de melding komt ongeveer op de rand van jouw cirkel, ook als je eraan komt rijden.

Eerder is een zwaardere aanpak overwogen (in de auto zelf om de paar seconden de locatie volgen, met een vaste melding "Tick volgt je route"). Dio koos voor de eenvoudiger aanpak hieronder: in de auto en op de fiets worden de cirkels groter, met een marge die Tick uit metingen leert. Dio: "het moet natuurlijk ook werken op de fiets".

In dit document betekent **onderweg**: in de auto (`IN_VEHICLE`) of op de fiets (`ON_BICYCLE`). Elke soort heeft een eigen geleerde marge, omdat de snelheden zo verschillen.

## Wat het wordt

Drie delen, in deze volgorde gebouwd en elk los uit te rollen:

1. **Meten.** Bij elke locatiemelding legt de app vast hoe ver je van het midden was toen hij afging, en hoe snel je ging. Daaruit volgt hoe laat meldingen komen, en hoeveel groter de cirkel in de auto moet zijn.
2. **Onderweg de cirkel vergroten.** Zodra Android merkt dat je in de auto rijdt of fietst, zet Tick de aankomstcirkels groter, met de geleerde marge voor die soort. Nooit zo groot dat je er op dat moment al in staat. Als je stopt (uitstappen, afstappen) worden ze weer normaal.
3. **Wegvegen = later opnieuw.** Veeg je een locatiemelding weg, dan staat de herinnering weer klaar voor de volgende keer. Alleen afvinken ruimt hem echt op.

### Doelen
1. Met de auto en op de fiets komt een aankomstmelding ongeveer op de rand van de ingestelde cirkel, en niet pas als je er al bent.
2. Ook als de plek dichtbij huis ligt (je staat binnen de vergrote cirkel als je wegrijdt), komt de melding bij dat ritje.
3. Komt een melding op een moment dat je er niets mee kunt (je reed er alleen langs), dan veeg je hem weg en komt hij de volgende keer terug.
4. De app laat zien hoe laat aankomstmeldingen kwamen, zodat het effect zichtbaar is.
5. De extra toestemming "Fysieke activiteit" wordt vooraf in gewone taal uitgelegd: waarvoor, en dat er niets bewaard of verstuurd wordt. Dio: prima, "zolang maar duidelijk wordt uitgelegd waar het voor dient".

### Geen doelen
- Vertrekcirkels vergroten. Die blijven zoals ze zijn (wegvegen werkt er wel, zie deel 3).
- Lopen. Daarvoor is de vertraging klein genoeg; alleen auto en fiets tellen.
- Zelf actief de locatie volgen tijdens het rijden, of een foreground service.
- Wijzigingen aan de server of de web-app. De server accepteert `location_notified: false` al (`src/index.ts`, PATCH). Alleen de handleiding in `docs/` verandert mee.

### Anti-doelen (dan is het mislukt, ook als het werkt)
- Tick bewaart of verstuurt waar je geweest bent. `docs/places.md` belooft "Tick keeps no record of where you have been". Metingen bevatten alleen afstanden, snelheden, nauwkeurigheid en tijden, nooit coördinaten, en blijven op de telefoon.
- Een toestemming wordt gevraagd zonder uitleg vooraf.
- Een weggeveegde melding komt meteen opnieuw (terwijl je nog op dezelfde plek bent), of een afgevinkte taak komt terug.
- De gewone locatiemeldingen werken slechter dan nu, ook als "Op tijd melden onderweg" uit staat of de toestemming geweigerd is.

## Deel 1: meten

Bij elke locatiemelding die echt getoond wordt (`GeofenceReceiver`, resultaat `MELDEN`) neemt de app `GeofencingEvent.getTriggeringLocation()` en legt vast:

- **afstand tot het midden (m)** van de plek;
- **ingestelde straal (m)** en **gebruikte straal (m)** (groter als de auto-marge actief was);
- **onderweg:** auto, fiets of geen, de stand op dat moment;
- **snelheid (m/s)** als de locatie die heeft, anders leeg;
- **nauwkeurigheid (m)** en **leeftijd** van de locatie (nu min het tijdstip van de locatie);
- **richting:** aankomst of vertrek;
- **tijdstip.**

Geen coördinaten. De laatste 30 metingen staan in `Prefs` (JSON); oudere vallen eraf. Het zijn gegevens van het toestel: `wipeAccountData` laat ze staan.

**Te laat (m)** = ingestelde straal min afstand tot het midden. Positief: je was al zoveel meter binnen de cirkel die je zelf instelde. Negatief: de melding kwam eerder dan de rand.

**Zichtbaar in "Tick op deze telefoon"** (`MainActivity`), onder de locatiestatus, een regel zodra er aankomstmetingen zijn, bijvoorbeeld: "Aankomstmeldingen kwamen de laatste 6 keer gemiddeld 180 m binnen de cirkel." Als er metingen onderweg zijn, apart per soort: "In de auto: gemiddeld 40 m ervoor. Op de fiets: gemiddeld 10 m erna." Precieze tekst: aan de bouwer, NL en EN (`res/values*/strings.xml`).

De rekenkunde komt in een pure Java-klasse met JUnit-tests, zoals `GeoPlan` en `NotifyDecision`.

## Deel 2: onderweg de cirkel vergroten

### Rijden en fietsen herkennen
- Via de Activity Recognition Transition API van Play-diensten abonneert de app zich op ENTER en EXIT van `IN_VEHICLE` en `ON_BICYCLE` (broadcast naar een eigen receiver).
- De stand (geen, auto of fiets, plus tijdstip) staat in `Prefs`. Een stand die ouder is dan 3 uur zonder EXIT telt als geen (gemiste EXIT).
- Wissel je direct van soort (ENTER fiets terwijl de stand auto is), dan geldt de nieuwe soort, en worden de cirkels opnieuw berekend zoals bij ENTER.
- Het abonnement moet opnieuw na een herstart, een update en "Gedwongen stoppen", net als de geofences nu (`BootReceiver`, `MainActivity.setUp`).

### De marge
Per soort een eigen marge:

| | Startwaarde | Minstens | Hooguit |
|---|---|---|---|
| Auto | 1000 m | 200 m | 3000 m |
| Fiets | 300 m | 50 m | 1000 m |

- De startwaarde geldt zolang er nog geen metingen van die soort zijn.
- **Leren:** uit de laatste 10 aankomstmetingen van die soort met nauwkeurigheid beter dan 100 m. Per meting is de marge die goed geweest zou zijn = gebruikte marge + "te laat". De nieuwe marge is de mediaan daarvan, binnen de grenzen.

### Cirkels zetten
Bij ENTER (gaan rijden of fietsen):
1. De app vraagt één keer de huidige locatie op (`getCurrentLocation`, hoge nauwkeurigheid, met time-out). Lukt dat niet binnen de time-out: de laatst bekende locatie, mits jonger dan 2 minuten. Anders blijven alle cirkels normaal voor dit ritje.
2. Per open aankomstplek (`GeoPlan.select`, alleen `enter`), met d = afstand van jou tot het midden en r = ingestelde straal:
   - d ≤ r (je bent er al): straal blijft r. Gedrag als nu.
   - anders: onderwegstraal = min(r + marge, d − 50 m), maar nooit kleiner dan r.
3. De onderwegstralen (taak-id → straal) gaan in `Prefs`, en `Geo.apply` registreert opnieuw. De straal zit al in de signature, dus de bestaande logica merkt de wijziging.

Zolang de stand auto of fiets is, gebruikt elke `Geo.apply` (ook vanuit `SyncJob`) de opgeslagen onderwegstralen. Een plek die tijdens het ritje bijkomt, krijgt r + marge, begrensd met de laatst bekende locatie op dezelfde manier, of r als die er niet is.

Bij EXIT (uitgestapt, afgestapt): onderwegstralen wissen, `Geo.apply` zet alles terug naar normaal.

Het opnieuw registreren gebeurt alleen bij ENTER en EXIT, niet tussendoor. `Geo.java` waarschuwt dat opnieuw registreren een nog niet afgeleverde aankomst kan wissen. Dat risico is er bij deze twee momenten ook. Het wordt geaccepteerd, want ze komen maar een paar keer per dag voor.

### Melding
Gaat een vergrote cirkel af, dan zegt de melding "Bijna bij Albert Heijn" in plaats van "Je bent bij Albert Heijn". De request-id of de opgeslagen onderwegstralen vertellen `GeofenceReceiver` dat het een vergrote cirkel was. Verder is het dezelfde melding, met dezelfde controles (`NotifyDecision`) en boekhouding.

### Bekende grens
Android herkent rijden en fietsen zelf ook met wat vertraging, vaak een minuut of zo na het vertrek. Bij een plek op een paar honderd meter van huis kan de vergroting dus te laat komen. Dan gedraagt het zich als nu.

### Aanzetten en uitleg
Dio vroeg uitdrukkelijk om goede uitleg. Daarom staan de teksten hier als concept. De bouwer mag ze bijschaven, maar niet inkorten tot alleen een knop. EN-versie erbij.

- Nieuwe permissie in het manifest: `ACTIVITY_RECOGNITION`.
- In "Tick op deze telefoon", onder de locatieknop, een knop **"Op tijd melden onderweg"**. Hij staat uit tot Dio hem aanzet, en werkt alleen als de gewone locatiemeldingen al aan staan.
- Direct onder de knop staat altijd een korte uitleg, ook als hij uit staat:

  > Android meldt plekken een paar minuten te laat. Met de auto of fiets ben je dan al voorbij je cirkel. Zet je dit aan, dan maakt Tick de cirkels groter zolang je rijdt of fietst, zodat de melding op tijd komt.

- Bij aanzetten **eerst een uitlegdialoog**, pas daarna de systeemvraag:

  > **Op tijd melden onderweg**
  >
  > Android merkt pas na een paar minuten dat je bij een plek bent. Met de auto of fiets ben je dan al voorbij.
  >
  > Tick lost dat op door de cirkels groter te maken zolang je rijdt of fietst. Hoeveel groter, leert Tick vanzelf van je eerdere meldingen.
  >
  > Daarvoor moet Tick weten óf je rijdt of fietst. Android vraagt daarom zo om toestemming voor "Fysieke activiteit".
  >
  > Tick gebruikt dit alleen om de cirkels groter of weer normaal te maken. Er wordt niets bewaard of verstuurd over waar je bent of hoe je reist.
  >
  > [Doorgaan] [Niet nu]

- Weigert Android de vraag (twee keer geweigerd), dan opent de app de app-instellingen met een korte Toast, zoals nu bij "Altijd toestaan".
- **Status** onder de knop als hij aan staat, bijvoorbeeld:
  - "Aan. In de auto worden cirkels 650 m groter, op de fiets 150 m."
  - "Aan, maar toestemming voor Fysieke activiteit ontbreekt."
  - "Werkt pas als locatiemeldingen aan staan."
- Uitzetten: abonnement opzeggen, onderwegstralen wissen, `Geo.apply`.

## Deel 3: wegvegen = later opnieuw

Geldt voor alle locatiemeldingen, aankomst en vertrek, ook als "Op tijd melden onderweg" uit staat.

- `Notify.build` krijgt een `setDeleteIntent` naar `ActionReceiver` (nieuwe actie, bijvoorbeeld `ACTION_DISMISSED`, met taak-id en de key van de plek). Een tik op de melding (die opent de taak) en "Afvinken" tellen niet als wegvegen. Alleen vegen en "alles wissen" tellen.
- Bij wegvegen:
  1. `Prefs.dropLocFired` voor die taak, alleen als de key nog dezelfde is (zo wist hij geen nieuwere melding);
  2. PATCH `{"location_notified": false}`. Mislukt dat (offline), dan opnieuw proberen bij de volgende `Sync.refresh`, zoals het nu andersom met `true` gaat. Hoe dat het netst in de bestaande boekhouding (`locFired`/`locSynced`) past: aan de bouwer, met tests;
  3. `Geo.applyFromCache`: de geofence staat weer.
- Omdat de geofence wordt gezet met `setInitialTrigger(0)`, gaat hij niet meteen weer af terwijl je er nog bent. Pas bij de volgende aankomst (of het volgende vertrek). Dat is precies het gewenste gedrag.
- Is de taak intussen afgevinkt of de plek veranderd, dan gebeurt er niets.
- Op een gedeelde taak geldt het wegvegen alleen voor jou; de server houdt `loc_notified` al per lid bij.

## Documentatie
- `docs/places.md`: een stukje "On the road" (auto en fiets: wat er gebeurt, de toestemming "Physical activity", dat er niets bewaard wordt, de bekende grens), en bij "Good to know": wegvegen zet de herinnering weer klaar, afvinken ruimt hem op. De zin "You get one notification per place" past zich daarop aan.
- `docs/android.md` als daar de toestemmingen worden opgesomd.
- `ARCHITECTURE.md`: activity-transitions en onderwegstralen bij het stuk over geofences.
- Versie van de Android-app ophogen per uitgerold deel.

## Eerste stap van het plan
Voordat deel 2 gebouwd wordt: op Dio's telefoon controleren dat de app een overgang (`IN_VEHICLE`, `ON_BICYCLE`) op de achtergrond ontvangt en daarbij een huidige locatie krijgt. Sommige merken (Samsung, Xiaomi) beperken dat met hun batterijbeheer. Dio's telefoon is een Google Pixel 7a met Android 17 (API 37), Tick 1.6.2, met "Altijd toestaan" voor locatie en vrijgesteld van batterijoptimalisatie (uitgelezen op 2026-10-24). Een Pixel heeft geen extra batterijbeheer van de fabrikant, dus het risico is klein, maar alleen een echte rit of fietstocht bewijst het. Deel 1 en 3 hangen daar niet van af en kunnen eerst.

## Wat aan de bouwer is
- Klassenamen, de vorm van de opslag in `Prefs`, en hoe de request-id een vergrote cirkel aangeeft.
- Time-outs, en het bijschaven van de teksten (NL en EN), zonder de uitleg in te korten.
- Of deel 1 een knop "Metingen wissen" krijgt.

## Keuzes die ik (Claude) gemaakt heb, niet door Dio besproken
- Marges: auto start op 1000 m (200 tot 3000 m), fiets op 300 m (50 tot 1000 m), leren via de mediaan van de laatste 10 metingen per soort.
- 50 m afstand tussen jou en de rand van de vergrote cirkel bij vertrek.
- "Op tijd melden onderweg" staat standaard uit en is een aparte knop, omdat er een extra toestemming bij hoort.
- Een vergrote cirkel geeft de tekst "Bijna bij …".
- Wegvegen werkt voor alle locatiemeldingen, ook vertrek.
- Metingen: alleen afstanden en snelheden, de laatste 30, alleen op de telefoon.
