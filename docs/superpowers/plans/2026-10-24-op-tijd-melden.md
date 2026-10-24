# Op tijd melden onderweg: implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Locatiemeldingen komen ongeveer op de rand van de ingestelde cirkel, ook met de auto of fiets. Daarvoor: metingen, onderweg grotere cirkels, en wegvegen zet de herinnering weer klaar.

**Architecture:** Alles zit in de Android-app (`android/`), de server verandert niet. De rekenkunde staat in pure Java-klassen met JUnit-tests (zoals `GeoPlan`, `NotifyDecision`), en de Android-kant blijft dun. De metingen staan als JSON in `Prefs`, net als `locFired`.

**Tech Stack:** Java 17, Android SDK 36 (minSdk 31), Play-diensten location 21.4.0 (geofencing, activity transitions), JUnit 4 + org.json in unit tests.

**Spec:** `docs/superpowers/specs/2026-10-24-op-tijd-melden-design.md`

## Global Constraints
- Nooit coördinaten bewaren of versturen. Metingen bevatten alleen afstanden, snelheden, nauwkeurigheid en tijden, en blijven op de telefoon.
- Elke zichtbare tekst in `res/values/strings.xml` (EN) én `res/values-nl/strings.xml` (NL).
- Unit tests kunnen geen Android-klassen gebruiken (`Location` en dergelijke zijn stubs). Rekenwerk krijgt daarom kale getallen.
- Niets bouwen of testen op Google Drive. Bewerk in `K:\Google Drive\Git\tick`, en draai in de kopie `C:\dev\tick-op-tijd` (zie Task 0).
- Commit alleen de bestanden van de taak (`git add <paden>`). De "(1)"-kopieën en andere losse wijzigingen in de werkmap blijven erbuiten.
- Elke uitgerolde stap verhoogt `versionCode`/`versionName` in `android/app/build.gradle`.
- Gebruikersdocs in het Engels (`docs/places.md`), code-commentaar in het Nederlands, zoals de bestaande code.

## Review Focus
1. **Melding zonder triggering location** (`getTriggeringLocation()` geeft null): de melding moet gewoon komen, er komt alleen geen meting bij. → test in Task 2 (`ArrivalStats.fromFix` met null).
2. **Kapotte of oude JSON in `Prefs`**: geen crash; dan begint het met een lege lijst. → test in Task 1 (`add` en `summary` op `"onzin"`).
3. **Locatie onnauwkeurig of buiten de cirkel** (negatief "te laat"): telt mee als "ervoor" en geeft geen crash of rare tekst. → test in Task 1 (`summary` met negatieve waarden).
4. **Wegvegen terwijl je offline bent**: de herinnering moet alsnog terugkomen zodra er weer netwerk is. → test in Task 3 (`RearmDecision`).
5. **Wegvegen nadat de taak afgevinkt of de plek veranderd is**: er gebeurt niets. → test in Task 3.

---

## Deel 1: meten

### Task 0: Werkkopie en tests draaiend

- [ ] **Step 1:** Kopieer de Android-map naar een eigen werkkopie:
  `robocopy "K:\Google Drive\Git\tick\android" "C:\dev\tick-op-tijd\android" /MIR /XD build .gradle`
- [ ] **Step 2:** Draai de bestaande tests: `cd C:\dev\tick-op-tijd\android; .\gradlew.bat testDebugUnitTest`. Verwacht: BUILD SUCCESSFUL.
- [ ] **Step 3:** Werkwijze voor alle volgende taken: bewerk op Drive, en draai daarna opnieuw de robocopy uit Step 1 gevolgd door gradle.

### Task 1: `ArrivalStats`, de rekenkunde van metingen

**Files:**
- Create: `android/app/src/main/java/nl/detussenpartij/tick/ArrivalStats.java`
- Test: `android/app/src/test/java/nl/detussenpartij/tick/ArrivalStatsTest.java`

**Interfaces:**
- Produces:
  - `static final int KEEP = 30`
  - `static double distanceM(double lat1, double lng1, double lat2, double lng2)`: haversine met R = 6371008.8 m.
  - `static JSONObject measurement(long at, boolean exit, String mode, double radius, double usedRadius, double distance, Double speed, Double accuracy, long ageMs)`: sleutels `at, exit, mode, radius, used, dist, speed, acc, age`. `speed` en `acc` worden weggelaten als ze null zijn. `mode` is `""` (geen), `"car"` of `"bike"`.
  - `static String add(String json, JSONObject m)`: voegt achteraan toe en houdt de laatste `KEEP` over. Onleesbare invoer geldt als `[]`.
  - `static double late(JSONObject m)`: `radius − dist`.
  - `static final class Summary { int count; double avgLate; }` en `static Summary summary(String json, String mode)`: alleen aankomsten (`exit == false`); bij `mode == null` alle soorten, anders alleen die soort. `count == 0` betekent geen metingen.

- [ ] **Step 1: Schrijf de falende tests** in `ArrivalStatsTest`:
  - `afstandKlopt`: `distanceM(52.0, 5.0, 52.0, 5.001)` is ongeveer 68.5 m (±0.5); `distanceM(x, y, x, y) == 0`.
  - `bewaartHooguit30`: 35× `add` levert een array van 30, met als eerste de 6e toegevoegde (`at == 6`).
  - `kapotteJsonBegintLeeg`: `add("onzin", m)` geeft een array met 1 element; `summary("onzin", null).count == 0`.
  - `leegLatenZonderSnelheid`: `measurement(..., null, null, ...)` heeft geen `speed` en geen `acc`.
  - `gemiddeldAlleenAankomsten`: aankomsten met late 180 en 100, plus een vertrek; geeft `count == 2` en `avgLate == 140`.
  - `negatiefIsErvoor`: aankomsten met late −40 en −20 geven `avgLate == -30`.
  - `perSoort`: één `"car"` met late 50 en één `""` met late 150; `summary(json, "car")` geeft count 1 en avg 50; `summary(json, null)` geeft count 2.
- [ ] **Step 2:** Draai `.\gradlew.bat testDebugUnitTest --tests nl.detussenpartij.tick.ArrivalStatsTest`. Verwacht: FAIL (klasse bestaat niet).
- [ ] **Step 3:** Schrijf `ArrivalStats` volgens de Interfaces hierboven: `final class`, private constructor, commentaar in het Nederlands zoals `GeoPlan`.
- [ ] **Step 4:** Draai de tests opnieuw. Verwacht: PASS.
- [ ] **Step 5:** Commit `ArrivalStats.java` en `ArrivalStatsTest.java`: "Android: rekenkunde voor metingen van locatiemeldingen".

### Task 2: Vastleggen bij elke melding en tonen in "Tick op deze telefoon"

**Files:**
- Modify: `ArrivalStats.java` (helper `fromFix`), `ArrivalStatsTest.java`
- Modify: `GeofenceReceiver.java` (onReceive: triggering location doorgeven; handle: meting per getoonde melding)
- Modify: `Prefs.java` (`arrivals` / `addArrival`)
- Modify: `MainActivity.java` (regel onder `locStatus`)
- Modify: `res/values/strings.xml`, `res/values-nl/strings.xml`
- Modify: `android/app/build.gradle` (versionCode 17, versionName `1.7.0`)
- Modify: `docs/places.md`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `static JSONObject fromFix(long now, boolean exit, String mode, double centerLat, double centerLng, double radius, double usedRadius, Double fixLat, Double fixLng, Double speed, Double accuracy, Long fixTime)`: geeft `null` als `fixLat`/`fixLng` null zijn, anders `measurement(...)` met `dist = distanceM(...)` en `age = now − fixTime` (0 als `fixTime` null is). De coördinaten gaan alleen de berekening in en worden niet bewaard.
  - `Prefs.arrivals(Context): String` (standaard `"[]"`), en `Prefs.addArrival(Context, JSONObject)`: `synchronized`, via `ArrivalStats.add`, sleutel `"arrivals"`. `wipeAccountData` laat deze sleutel staan.

- [ ] **Step 1: Falende tests:**
  - `zonderLocatieGeenMeting`: `fromFix(..., null, null, ...)` geeft null.
  - `fixGeeftAfstandMaarGeenCoordinaten`: een fix 68.5 m van het midden geeft `dist` ongeveer 68.5, en het resultaat heeft geen sleutel met `lat` of `lng` in de naam.
- [ ] **Step 2:** Draai de tests. Verwacht: FAIL.
- [ ] **Step 3:** Schrijf `fromFix`. Draai de tests. Verwacht: PASS.
- [ ] **Step 4:** Pas `GeofenceReceiver` aan. In `onReceive` lees je `event.getTriggeringLocation()` (mag null zijn) en geef je hem mee aan `handle(app, requestIds, exit, fix)`. In `handle` roep je na elke getoonde melding (`shown == true`) `ArrivalStats.fromFix(System.currentTimeMillis(), exit, "", loc.lat, loc.lng, loc.radius, loc.radius, ...)` aan. Zijn er waarden null, dan ga je door. Bij een niet-null resultaat volgt `Prefs.addArrival`. Een fout in het meten mag de melding en de PATCH nooit tegenhouden: zet het meten in een eigen try/catch met `Log.w`.
- [ ] **Step 5:** Voeg strings toe (EN/NL):
  - `loc_stats_inside`: "Arrival notifications came %2$d m inside the circle on average (last %1$d)." / "Aankomstmeldingen kwamen gemiddeld %2$d m binnen de cirkel (laatste %1$d)."
  - `loc_stats_before`: "Arrival notifications came %2$d m before the circle on average (last %1$d)." / "Aankomstmeldingen kwamen gemiddeld %2$d m vóór de cirkel (laatste %1$d)."
- [ ] **Step 6:** Zet in `MainActivity` een `TextView locStats` direct onder `locStatus`, bijgewerkt in `onResume` vanuit `ArrivalStats.summary(Prefs.arrivals(this), null)`. Is `count == 0`: verborgen (`GONE`). Is `avgLate ≥ 0`: `loc_stats_inside` met `Math.round(avgLate)`. Anders `loc_stats_before` met de absolute waarde.
- [ ] **Step 7:** Zet `versionCode 17` en `versionName '1.7.0'`. Voeg in `docs/places.md` onder "Good to know" toe: "The Android app shows under **Tick on this phone** how far inside the circle recent arrival notifications came. It keeps only distances, never where you were."
- [ ] **Step 8:** Draai `.\gradlew.bat testDebugUnitTest assembleDebug`. Verwacht: BUILD SUCCESSFUL.
- [ ] **Step 9:** Installeer de debugbuild met `adb install -r` en open "Tick op deze telefoon". Zonder metingen verschijnt er geen regel. Simuleer met een mock-locatie of een test-geofence, of wacht op een echte aankomst. Controleer daarna met `adb shell run-as <package> cat shared_prefs/tick.xml` dat er een meting zonder coördinaten staat. Let op: de geïnstalleerde app is de release-build (`nl.detussenpartij.tick`). Een debugbuild met een ander applicationId staat ernaast. Kies het juiste package voor `run-as`.
- [ ] **Step 10:** Commit (Java, strings, build.gradle, docs/places.md): "Android 1.7.0: metingen van locatiemeldingen".
- [ ] **Step 11: Uitrollen** volgens `SETUP.md`/`docs/android.md` (release-APK en GitHub Release, zoals eerdere versies). Doe dit pas na akkoord van Dio.

## Deel 3: wegvegen = later opnieuw

(Vóór deel 2 gebouwd, omdat het niet van de rittest afhangt.)

### Task 3: Wegvegen zet de herinnering weer klaar

**Files:**
- Create: `RearmDecision.java` + `RearmDecisionTest.java`
- Modify: `Notify.java` (`setDeleteIntent`), `ActionReceiver.java` (`ACTION_DISMISSED`), `Prefs.java` (`locRearm`), `Sync.java` (opnieuw proberen), `docs/places.md`, `build.gradle` (1.8.0, versionCode 18)

**Interfaces:**
- Produces:
  - `Prefs.locRearm(Context): JSONObject` (taak-id → plek-key, wacht op PATCH false) en `Prefs.setLocRearm`.
  - `RearmDecision.Result decide(JSONArray tasks, String id, String key, JSONObject pending)` met `REARM`, `AF` (afgevinkt, of pending), `GEEN_TAAK`, `ANDERE_PLEK`.

- [ ] **Step 1: Falende tests** `RearmDecisionTest`: `openTaakZelfdePlekWordtKlaargezet` (REARM), `afgevinktNiet` (AF bij `done` en bij id in pending), `wegGeenActie` (GEEN_TAAK), `plekVeranderdNiet` (ANDERE_PLEK als de key verschilt).
- [ ] **Step 2:** Draai de tests (FAIL), schrijf `RearmDecision` (zelfde stijl als `NotifyDecision`), en draai opnieuw (PASS).
- [ ] **Step 3:** `Notify.build` krijgt `setDeleteIntent`: een broadcast naar `ActionReceiver` met de actie `BuildConfig.APPLICATION_ID + ".DISMISSED"`, `EXTRA_ID` en de extra `"key"` (de `GeoPlan.key` van de plek). `Notify.location` krijgt daarvoor de key als extra parameter. Een eigen request-code is nodig, zodat hij de "Afvinken"-intent niet overschrijft: bijvoorbeeld `code ^ 0x5EED`.
- [ ] **Step 4:** `ActionReceiver` verwerkt `ACTION_DISMISSED` met `goAsync`. Neem de cache, en bij `REARM`:
  1. `Prefs.dropLocFired(id → key)`;
  2. zet het id in `locRearm`;
  3. PATCH `{"location_notified":false}`; lukt dat, haal het id uit `locRearm`;
  4. werk de cache bij (`location_notified` op false voor die taak) en roep `Geo.applyFromCache(app, false)` aan.
- [ ] **Step 5:** `Sync.refresh` probeert `locRearm` opnieuw, vóór `retryLocationNotified`: de PATCH false voor elke taak die nog open is met dezelfde key. Lukt het, of is de taak weg of veranderd, dan haal je het id eruit. Een meldingsactie die al in `locFired` staat met dezelfde key heeft voorrang: de taak is intussen opnieuw afgegaan, dus dan het id weghalen zonder PATCH.
- [ ] **Step 6:** Pas `docs/places.md` aan: "You get one notification per place" wordt "Swipe a place notification away and it comes back the next time you arrive (or leave); tap **Done** to finish the task."
- [ ] **Step 7:** Draai tests en `assembleDebug`. Test op de telefoon: laat een melding afgaan, veeg hem weg, en controleer dat `location_notified` op de server false is (de taak in de web-app) en dat de geofence weer staat (log "Geofences: n").
- [ ] **Step 8:** Commit "Android 1.8.0: weggeveegde locatiemelding komt terug", en rol uit na akkoord.

## Deel 2: onderweg de cirkel vergroten

### Task 4: Proef op de weg (spike, wordt weer weggegooid)

- [ ] **Step 1:** In een losse branch `spike/activity`: vraag `ACTIVITY_RECOGNITION`, abonneer op ENTER en EXIT van `IN_VEHICLE` en `ON_BICYCLE`, en laat een receiver elke overgang plus het resultaat van `getCurrentLocation` (alleen nauwkeurigheid en leeftijd) loggen en als stille melding tonen.
- [ ] **Step 2:** Dio maakt een autorit en een fietstocht. Controleer of de overgangen binnenkomen terwijl de app dicht is, hoe lang na vertrek, en of er een locatie bij komt.
- [ ] **Step 3:** Schrijf de uitkomst in de spec onder "Eerste stap van het plan". Werkt het niet, dan stop je hier en bespreek je het met Dio.

### Task 5: `RoadPlan`, de marge en de onderwegstralen

**Files:** Create `RoadPlan.java` + `RoadPlanTest.java`

**Interfaces:**
- Produces:
  - `static final double CAR_START = 1000, CAR_MIN = 200, CAR_MAX = 3000, BIKE_START = 300, BIKE_MIN = 50, BIKE_MAX = 1000`
  - `static double margin(String arrivalsJson, String mode)`: bekijkt de laatste 10 aankomsten van die soort met `acc` < 100. Per meting: `(used − radius) + late`. Neemt de mediaan, binnen de grenzen. Zonder metingen de startwaarde.
  - `static float roadRadius(double radius, double margin, Double distanceToCenter)`: null afstand geeft `radius`. Bij d ≤ r: `r`. Anders `max(r, min(r + margin, d − 50))`.
  - `static String modeFor(int activityType)`: `IN_VEHICLE` → `"car"`, `ON_BICYCLE` → `"bike"`, anders `""`. Gebruik de constanten van `DetectedActivity`; die zijn ints en dus testbaar.
- [ ] **Steps:** tests eerst, met de randen uit de spec:
  - marge zonder metingen = startwaarde;
  - mediaan van drie: gebruikte marges 1000 met late −200, 0 en 300 geven 1000;
  - begrenzing naar 3000 en 200;
  - metingen met `acc` ≥ 100 tellen niet;
  - `roadRadius(200, 1000, 800.0) == 750`;
  - `roadRadius(200, 1000, 150.0) == 200`;
  - `roadRadius(200, 1000, 230.0) == 200`;
  - `roadRadius(200, 1000, null) == 200`.

  Daarna implementeren, laten slagen en committen.

### Task 6: Overgangen ontvangen en cirkels zetten

**Files:** Create `ActivityReceiver.java`, `Road.java`. Modify `Prefs.java` (`roadMode`, `roadModeAt`, `roadRadii`), `Geo.java`/`GeoPlan.java` (straal per taak overschrijfbaar en vlag "vergroot" in de request-id), `GeofenceReceiver.java` (tekst "Bijna bij", meting met `mode` en `used`), `BootReceiver.java`, `MainActivity.setUp`, `AndroidManifest.xml` (`ACTIVITY_RECOGNITION`, receiver), strings.

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `Road.subscribe(Context)` / `Road.unsubscribe(Context)`: Activity Transition API, PendingIntent naar `ActivityReceiver`.
  - `Road.enter(Context, String mode)`: haalt de huidige locatie op (`getCurrentLocation`, `PRIORITY_HIGH_ACCURACY`, time-out 20 s; anders de laatst bekende als die jonger is dan 2 min). Bewaart `roadRadii` (taak-id → straal via `RoadPlan.roadRadius`) en roept `Geo.applyFromCache(c, false)` aan.
  - `Road.exit(Context)`: wist de stand en `roadRadii`, en roept `Geo.applyFromCache` aan.
  - `GeoPlan.select(tasks, fired, max, Map<String, Float> roadRadii)`: overschrijft de straal voor enter-plekken die in de map staan. De request-id krijgt dan het achtervoegsel `#r`. `fenceKey` en `taskId` moeten daarmee blijven werken; pas `GeoPlanTest` aan.
- [ ] **Steps:**
  1. Tests eerst in `GeoPlanTest`: `onderwegStraalOverschrijftAlleenEnter`, `requestIdMetOnderwegBlijftLeesbaar` (`taskId` en `fenceKey` geven hetzelfde als zonder `#r`), en `signatureVerandertMetStraal`.
  2. Daarna de Android-kant. Een stand ouder dan 3 uur telt als geen; controleer dat in `Road.isActive(now)`, met een test.
  3. In `GeofenceReceiver`: is de request-id gemarkeerd met `#r`, dan de tekst `loc_almost` ("📍 Almost at %s" / "📍 Bijna bij %s"), en de meting met `mode` uit `Prefs.roadMode` en `used` = de onderwegstraal.
  4. Opnieuw abonneren in `BootReceiver` en in `MainActivity.setUp`, maar alleen als de instelling aan staat en de toestemming er is.
  5. Commit.

### Task 7: Knop "Op tijd melden onderweg" met uitleg

**Files:** Modify `MainActivity.java`, `Prefs.java` (`roadOn`), strings, `docs/places.md`, `docs/android.md` (als daar toestemmingen staan), `ARCHITECTURE.md`, `build.gradle` (1.9.0, versionCode 19).

- [ ] **Steps:**
  1. Een knop en de vaste uitleg eronder, plus de dialoog en de statusregels, **letterlijk** de concepttekst uit de spec (sectie "Aanzetten en uitleg"), NL en EN.
  2. Aanzetten: eerst de dialoog, dan `requestPermissions(ACTIVITY_RECOGNITION)`, dan `roadOn = true` en `Road.subscribe`. Geweigerd en niet meer te vragen: open de app-instellingen met een Toast, zoals `openAppSettings`.
  3. Uitzetten: `roadOn = false`, `Road.unsubscribe`, `Road.exit`.
  4. Status met de marges uit `RoadPlan.margin` (afgerond op 50 m).
  5. In "Tick op deze telefoon" krijgt de metingenregel uit Task 2 per soort een extra zin ("In de auto: …", "Op de fiets: …"), zodra er metingen van die soort zijn.
  6. Docs: `places.md` sectie "On the road", en `ARCHITECTURE.md` over activity transitions en onderwegstralen.
  7. Tests en `assembleDebug`. Test op de telefoon: aanzetten, de dialoog, de systeemvraag en de status. Daarna een echte rit en fietstocht.
  8. Commit, en rol uit na akkoord.
