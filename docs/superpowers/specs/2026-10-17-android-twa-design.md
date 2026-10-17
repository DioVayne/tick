# Android-app als echte app (TWA)

Status: concept, wacht op akkoord van Dio.

## Waarom

Op Android gebruikt Dio Tick nu als PWA in Firefox, plus een losse native hulp-app (`android/`) voor widget, snel toevoegen, delen en locatiemeldingen. Wat stoort:

- het voelt log en traag, omdat eerst de browser moet opstarten;
- meldingen komen binnen als "Firefox" in plaats van "Tick";
- bij het opstarten zie je even dat het een browser is;
- twee iconen voor één ding, en de hulp-app vraagt om een sleutel die je moet kopiëren en plakken.

Binnenkort gaat een tweede persoon Tick ook gebruiken, ook op Android. Die moet kunnen installeren en inloggen zonder sleutels te kopiëren. Die komt op Dio's Tick met een eigen account. Dat kan pas na het project "Meerdere accounts", dat na dit project komt. Tot die tijd gebruikt alleen Dio deze app op zijn eigen Tick. Dit project zorgt dat de app daar straks klaar voor is: inloggen en koppelen zonder sleutel, één APK voor iedereen op dezelfde Tick.

## Wat het wordt

De bestaande Android-app wordt **de** Tick-app. Tikken op het icoon opent de PWA schermvullend als Trusted Web Activity (TWA): Chrome draait de pagina, maar zonder adresbalk en zonder browsergevoel. Widget, snel toevoegen, delen naar Tick en locatiemeldingen blijven in dezelfde app. De losse PWA-installatie in Firefox is daarna niet meer nodig.

### Doelen
1. Eén app-icoon "Tick" dat de PWA schermvullend opent, zonder adresbalk.
2. Web-pushmeldingen (herinneringen, met Klaar/Snooze) komen binnen als "Tick", via meldingsdelegatie van de TWA.
3. Eerste start zonder sleutel: inlogscherm → inloggen → de app koppelt zichzelf op de achtergrond → één keer toestemming voor meldingen, en desgewenst locatie.
4. Tikken op een taak in de widget, op een locatiemelding of op een herinnering opent die taak in de app, niet in een losse browser.
5. Na deze ene herinstallatie (zie 1b) blijft de app bij elke volgende update gekoppeld, met widget en geofences.
6. Wie Tick zelf host, kan de app voor zijn eigen adres bouwen; SETUP.md legt uit hoe.

### Geen doelen
- Een eigen native interface (Kotlin/Compose). Als de TWA nog traag voelt, kijken we later opnieuw.
- Play Store-publicatie. De APK wordt zelf gedeeld (sideloaden).
- Firebase/FCM of een andere eigen push-dienst.
- Werken zonder een TWA-browser. Firefox kan geen TWA; Chrome (meestal voorgeïnstalleerd) mag onder water draaien, ook als Firefox de standaardbrowser blijft. Dio: "voor nu prima".
- Meerdere accounts, taken delen, iOS.

### Anti-doelen (dan is het mislukt, ook als het technisch werkt)
- Je ziet bij normaal gebruik een adresbalk of browser-UI.
- Je krijgt meldingen dubbel (via Firefox én via de app) zonder dat de app je helpt dat op te lossen.
- Een installatie verliest bij een gewone update zijn koppeling, widget of geofences. (De eenmalige herinstallatie bij de overstap naar de eigen sleutel is bewust geaccepteerd.)
- De gebruiker moet een sleutel zien, kopiëren of plakken in de normale route.

## Hoe het werkt

### 1. TWA-starter (Android)
- Nieuwe afhankelijkheid: Android Browser Helper (`com.google.androidbrowserhelper:androidbrowserhelper`, trekt `androidx.browser` mee). Versie: de huidige stabiele.
- Een nieuwe launcher-activity (op basis van `LauncherActivity` uit Browser Helper) met `MAIN/LAUNCHER`. Start-URL: `tickBase + "/?app=android"`. Splash: het Tick-icoon op de themakleur.
- Het manifest krijgt de `asset_statements` voor `tickBase` (zoals Browser Helper voorschrijft) en de `DelegationService` voor meldingsdelegatie.
- `MainActivity` verliest `MAIN/LAUNCHER` en wordt het native instellingenscherm van de app (zie 4).
- Geen TWA-browser beschikbaar of verificatie mislukt: Browser Helper valt terug op een Custom Tab (met adresbalk). Dat is acceptabel; de app moet niet crashen.
- `versionCode` 4, `versionName` 1.3.

### 1b. Eigen ondertekeningssleutel (besluit Dio)
- De app krijgt een eigen release-sleutel in plaats van de debug-sleutel van deze computer, zodat bouwen niet aan één machine vastzit.
- `android/app/build.gradle` krijgt een release-`signingConfig` die het pad van de keystore, de alias en de wachtwoorden leest uit `android/tick.properties` (niet in git), op dezelfde manier als `tickBase`. Ontbreekt die, dan bouwt `assembleRelease` niet en geeft het een duidelijke melding. `assembleDebug` blijft werken zoals nu.
- De keystore staat buiten git (in `.gitignore`: `*.jks`, `*.keystore`). Dio bewaart een backup van de keystore en de wachtwoorden, bijvoorbeeld in zijn wachtwoordbeheerder. Kwijt betekent: iedereen moet de app opnieuw installeren.
- Gevolg, bewust geaccepteerd: deze ene keer gaat de update niet over de oude app heen. Dio verwijdert de oude hulp-app en installeert de nieuwe. Koppelen gaat vanzelf (route 3); widget en locatie stelt hij één keer opnieuw in. Doel 5 geldt vanaf deze versie voor alle volgende updates.
- `ANDROID_CERT_SHA256` krijgt de vingerafdruk van deze release-sleutel. Voor testen mag de debug-vingerafdruk erbij, met een komma ertussen.
- SETUP.md legt uit hoe je een eigen keystore maakt (`keytool -genkeypair …`), wat je in `tick.properties` zet en hoe je de vingerafdruk ophaalt.

### 2. Digital Asset Links (Worker)
- Nieuwe instelling `ANDROID_CERT_SHA256`: een of meer SHA-256-vingerafdrukken van het ondertekeningscertificaat, gescheiden door komma's. In `wrangler.example.jsonc` (leeg, met uitleg), `wrangler.jsonc` van Dio, het `Env`-type in `src/index.ts` en `vitest.config.ts`.
- `GET /.well-known/assetlinks.json` zonder login, `Content-Type: application/json`. Met `ANDROID_PACKAGE` en minstens één vingerafdruk: de standaard-`delegate_permission/common.handle_all_urls`-verklaring voor dat package en die vingerafdrukken. Anders: `[]`.

### 3. Automatisch koppelen na inloggen
De TWA deelt de cookie met Chrome, de native kant heeft een Bearer-sleutel nodig. Koppelen gaat met een eenmalige code, zodat de echte sleutel nooit in een URL of intent staat:

1. De native app start de TWA met `/?app=android&pair=1` zolang hij geen sleutel heeft (anders `/?app=android`).
2. Niet ingelogd: de server stuurt door naar `/login?next=/?app=android%26pair=1`. Na inloggen gaat `login.js` naar `next`. Alleen relatieve paden op dezelfde host (begint met `/`, niet met `//`); anders `/`. Dat voorkomt een open redirect.
3. Ingelogd met `pair=1`: de PWA vraagt `POST /api/pair` (alleen met sessie) en krijgt `{code}`. Code: willekeurig, eenmalig, 2 minuten geldig, alleen de hash opgeslagen.
4. De PWA opent `intent://pair?code=<code>#Intent;scheme=tick;package=<ANDROID_PACKAGE>;end` en haalt `pair=1` uit de adresbalk (`history.replaceState`).
5. De native app (een activity voor `tick://pair`) roept `POST /api/pair/redeem {code, name}` aan, zonder login. De server maakt een `full`-sleutel met die naam (standaard het toestelmodel, bijvoorbeeld "Pixel 9"), verbruikt de code en geeft `{key}` terug. Een ongeldige, verlopen of al gebruikte code geeft 400. Rate limit zoals bij inloggen.
6. De app slaat de sleutel op (`Prefs.setToken`), synct, meldt de apparaatstatus en keert terug naar de TWA. Daarna vraagt hij één keer om meldingen (Android 13+) en biedt hij locatie aan via het instellingenscherm.
7. **Web push in de app (mijn keuze):** draait de PWA in de app (`?app=android` onthouden) en is er voor deze browser nog geen push-abonnement, dan roept hij na het koppelen zelf `enablePush` aan. Door de meldingsdelegatie valt de webtoestemming samen met de Android-meldingstoestemming. De gebruiker ziet dus één vraag, niet twee, en hoeft de schakelaar in Instellingen › Meldingen niet zelf om te zetten.
8. **Terugval met één tik (mijn keuze):** Chrome kan het openen van een app blokkeren als dat niet uit een tik komt. Is de koppeling na 3 seconden niet gelukt (de PWA ziet geen bevestiging), dan toont de PWA een knop "Koppel deze telefoon" die hetzelfde intent opent. De sleutel blijft onzichtbaar.

**Ongeldige sleutel (mijn keuze):** geeft de API een 401 op de sleutel van de app (ingetrokken in Instellingen › Apparaten, of het oude `API_TOKEN` uitgezet), dan vergeet de app de sleutel en koppelt hij bij de volgende start opnieuw, met `pair=1`. Widget en geofences tonen tot dan "niet gekoppeld".

Opslag: een nieuwe migratie `0007_pair_codes.sql` met tabel `pair_codes (hash PRIMARY KEY, expires_at)`. Verlopen codes ruimt de cron op, of ze worden bij elk gebruik opgeruimd. Dat laat ik aan de bouwer.

### 4. Native instellingen binnen de app
- `SettingsActivity` (widget-instellingen, ook het configuratiescherm van de widget) blijft bestaan; samenvoegen of linken kiest de bouwer.
- `MainActivity` wordt "Tick op deze telefoon": locatie-toestemming (de bestaande stappen), meldingstoestemming, widget-instellingen en de koppelstatus. Het sleutelveld verdwijnt uit beeld en verhuist naar een ingeklapt blok "Geavanceerd: sleutel handmatig invullen" als noodroute.
- Bereikbaar via een `tick://settings`-intent. In de PWA toont Instellingen › Apparaten, alleen als de pagina in de app draait (`?app=android` onthouden in `sessionStorage`), een knop "Telefooninstellingen" die dat intent opent. De lange-druk-snelkoppeling krijgt naast "Nieuwe taak" ook "Telefooninstellingen".

### 5. Taken openen in de app
- `WidgetClickActivity` en de tikken op locatiemeldingen openen de TWA op `/?app=android&task=<id>` in plaats van `ACTION_VIEW` in de standaardbrowser.
- `public/sw.js` `notificationclick` (zonder actie) opent of focust `/?task=<id>` als de payload een `taskId` heeft. Dat werkt ook voor de gewone PWA en desktop. Navigeren in een bestaand venster mag via `client.navigate` of een `postMessage` waarop `app.js` de taak opent; dat kiest de bouwer.

### 6. Dubbele meldingen voorkomen
- In de app aangekomen: als er voor dit toestel een andere browser in de push-abonnementen staat (zelfde telefoon, Firefox), kan de app dat niet zeker weten. Daarom toont de PWA in de app één keer een hint: "Krijg je meldingen dubbel? Zet ze uit in Firefox, of verwijder die browser hieronder." met een link naar Instellingen › Apparaten.
- Instellingen › Apparaten heeft bij "andere browsers" al een knop **Verwijderen** (`public/settingsview.js`); de hint linkt daarheen.

### 7. Bestaande installaties
- Door de nieuwe ondertekeningssleutel (1b) installeert Dio deze versie eenmalig opnieuw. Vanaf dan houdt elke update `Prefs` (de sleutel), en start de app de TWA zonder `pair=1`.
- De `tick://sync`-link (`wakeAndroidApp` in `public/places.js`) blijft zoals hij is.
- Het icoon verandert van "open hulp-app" naar "open Tick". Wie de Firefox-PWA nog heeft, verwijdert die zelf; SETUP.md noemt dat.

### 8. Teksten en documentatie
- Alle nieuwe teksten in de PWA via `public/i18n.js` (en + nl), op Android via `strings.xml` en `values-nl`. Serverfouten via `HttpError(status, key)`.
- SETUP.md: de vingerafdruk ophalen (`./gradlew signingReport` of `keytool`) en `ANDROID_CERT_SHA256` zetten; de APK delen met huisgenoten (zelfde ondertekening, dus zelfde vingerafdruk); de oude Firefox-PWA verwijderen.
- ARCHITECTURE.md: de rij "Android", de nieuwe routes `/.well-known/assetlinks.json`, `/api/pair`, `/api/pair/redeem` en `?next=` bij login.
- Een nieuwe module in de PWA komt in `SHELL` in `public/sw.js`, met `CACHE` omhoog.

## Testen en controleren
- Worker (vitest): assetlinks met en zonder config; pair-code alleen met sessie (Bearer of geen login → 401/403); redeem eenmalig, verloopt na 2 minuten, maakt een `full`-sleutel met naam, rate limit; `next` weigert `//evil`, `https://…` en paden buiten de host.
- PWA: `notificationclick` met `taskId` opent `/?task=<id>` (bestaande testopzet waar mogelijk); `npm run typecheck` en `npm test`; in de browser controleren met `npm run dev`.
- Android (JUnit, gewone Java): het uit elkaar halen van `tick://pair?code=…` en het bouwen van de start-URL's als losse, testbare functies. Daarnaast `gradlew testDebugUnitTest assembleDebug`.
- Op de telefoon (door Dio; Claude kan geen fysiek toestel bedienen): geen adresbalk na installatie, melding komt binnen als "Tick", widget-tik opent de taak, koppelen gaat vanzelf na inloggen, en een tweede build (versie +1) installeert over de eerste heen met behoud van de koppeling.

## Aan de bouwer
- Hoe de launcher precies wordt ingericht (subklasse van `LauncherActivity` of alleen manifest-metadata), splash-details en de versie van Browser Helper.
- Opruimen van verlopen pair-codes.
- `client.navigate` of `postMessage` in de service worker.
- De vorm van de hint over dubbele meldingen, zolang hij één keer verschijnt en wegklikbaar is.

## Buiten dit project (eigen ontwerp later)
- **Meerdere accounts** op één Tick met uitnodigingslinks; de bestaande data wordt Dio's account.
- **Taken delen** per taak, gedeeld of als kopie, met acceptatiemelding.
