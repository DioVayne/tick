# Meerdere accounts op één Tick

Status: concept, wacht op akkoord van Dio.

## Waarom

Tick is nu voor één persoon: één wachtwoord, alle taken van iedereen die inlogt. Een tweede persoon wil Tick ook gebruiken, met een eigen account, en later komen er misschien meer mensen bij. Delen tussen losse installaties is te ingewikkeld. Daarom komen er meerdere accounts op Dio's Tick.

Dit project legt ook de basis voor het volgende project, taken delen per taak (gedeeld of als kopie, met een acceptatiemelding). Dat project bouwen we hier niet, maar het ontwerp mag het niet in de weg zitten. Accounts hebben daarom een vaste id, een naam en een e-mailadres.

## Wat het wordt

Eén Tick, gehost door Dio, met meerdere accounts. Iedereen heeft een eigen, privé Tick. Dio is beheerder: hij nodigt mensen uit, maakt resetlinks en kan een account verwijderen.

### Doelen
1. Iedereen ziet en wijzigt alleen zijn eigen taken, lijsten, plekken, sleutels, telefoons, meldingen en instellingen. Dat geldt voor de PWA, de API, de Android-app, de inbox-API, export en import, en de cron.
2. Een uitnodigingslink van de beheerder (eenmalig, 7 dagen geldig, te delen via WhatsApp) leidt naar een pagina waar iemand naam, e-mailadres en wachtwoord kiest. Daarna is die persoon meteen ingelogd.
3. Inloggen gaat met e-mailadres en wachtwoord.
4. Wachtwoord vergeten: de beheerder maakt een resetlink (eenmalig, 1 uur geldig). Op een toestel waar je nog bent ingelogd, kun je je wachtwoord ook zelf wijzigen (dat kan nu al).
5. Een bestaande installatie wordt bij de update vanzelf één account, de beheerder, met alle huidige taken, plekken, sleutels, telefoons, meldingen en instellingen. Er gaat niets verloren.
6. De Android-app (TWA, project 1) werkt per account: na het inloggen koppelt de app zich aan het account waarmee je inlogde.

### Geen doelen
- Taken delen (volgend project).
- Inloggen of herstellen via e-mail; Tick verstuurt geen e-mail.
- Passkeys (eventueel later, als los project).
- Zelf aanmelden zonder uitnodiging.
- Beheerders die andermans taken kunnen inzien. In de app kan dat niet. In de database kan de beheerder het technisch wel; dat is zo bij zelf hosten.
- Meerdere beheerders beheren via de app. Er is precies één beheerder, en die rol is niet over te dragen in de app.

### Anti-doelen (dan is het mislukt, ook als het technisch werkt)
- Iemand ziet, of krijgt een melding van, een taak van een ander. Dat kan via een id raden, een gedeelde browser, een push-abonnement, de cron of een import.
- Dio verliest bij de update taken, plekken, sleutels, gekoppelde telefoons of automations (n8n of andere inbox-koppelingen).
- Wie Tick alleen gebruikt (andere zelfhosters), moet na de update iets ingewikkelds doen om weer binnen te komen.

## Hoe het werkt

### 1. Datamodel (nieuwe migraties vanaf `0008`)
- **`users`**: `id` (TEXT, uuid), `name`, `email` (UNIQUE COLLATE NOCASE, mag NULL zijn; zie 3), `password_hash`, `role` (`admin` | `member`), `session_version` (INTEGER), `created_at`.
- **`user_id`** (NOT NULL, verwijst naar `users.id`) komt op `tasks`, `places`, `push_subscriptions`, `api_keys` en `pair_codes`. `devices` hangt al aan `api_keys` en volgt die. De rij `env-api` (het oude `API_TOKEN`) hoort bij de beheerder.
- **`places`**: de naam is uniek per gebruiker, niet meer voor de hele installatie (`UNIQUE(user_id, name)`). SQLite kan een constraint niet aanpassen, dus deze tabel wordt opnieuw opgebouwd in de migratie.
- **`user_settings`** (`user_id`, `key`, `value`, PK `(user_id, key)`) voor wat per persoon is: `timezone`, `reminder_time`, `week_start` en `fallback_webhook`. De tabel `settings` houdt alleen wat voor de hele installatie geldt: `default_locale` en de schakelaars en tijdstempels voor `API_TOKEN` en `INBOX_TOKEN`. `password_hash` en `session_version` verhuizen naar `users`.
- **`account_links`** (`id`, `hash` UNIQUE, `kind` `invite` | `reset`, `user_id` (bij `reset`), `created_by`, `expires_at`, `used_at`). Alleen de hash van de link wordt bewaard, net als bij koppelcodes.
- **De migratie** maakt één `admin` aan: naam "Tick" (aan te passen in de app), `email` NULL, `password_hash` uit `settings` (of NULL; zie 3), `session_version` uit `settings`. Daarna krijgen alle bestaande rijen in `tasks`, `places`, `push_subscriptions`, `api_keys` en `pair_codes` die `user_id`. De bestaande instellingen gaan naar `user_settings` van de beheerder; `default_locale` blijft in `settings`.

### 2. Wie ben je: authenticatie
- **De sessiecookie** bevat voortaan de gebruiker: `exp.userId.version.hmac`. `version` is de `session_version` van die gebruiker. Oude cookies (zonder gebruiker) zijn ongeldig, dus na de update logt iedereen één keer opnieuw in (mijn keuze: eenvoudig en veilig).
- **`Auth`** krijgt overal een `userId`: sessie, sleutel (`api_keys.user_id`), inbox-sleutel, `API_TOKEN` en `INBOX_TOKEN` (die horen bij de beheerder), en `DEV_AUTH_BYPASS` (de beheerder).
- **"Op andere toestellen uitloggen" en een wachtwoordwijziging** verhogen alleen de `session_version` van jezelf.
- **Elke route** die gegevens leest of schrijft, filtert op `auth.userId`. Een id van een ander account gedraagt zich als een id die niet bestaat (404), bij lezen, wijzigen, verwijderen, subtaken (`parent_id`), snoozen en herhalen.

### 3. Inloggen
- Het inlogscherm vraagt e-mailadres en wachtwoord. Er is één neutrale foutmelding voor een onbekend adres of een fout wachtwoord. De rate limit per IP blijft.
- **Overgang voor een bestaande installatie (mijn keuze):** zolang de beheerder geen e-mailadres heeft, mag het e-mailveld leeg blijven. Een leeg e-mailadres plus het juiste wachtwoord logt dan in als de beheerder. Instellingen › Account vraagt de beheerder een e-mailadres in te vullen. Zodra dat er is, is het e-mailveld verplicht. Wie alleen is, merkt dus bijna niets.
- **`LOGIN_PASSWORD`** (config) blijft de terugval voor de beheerder zolang die geen `password_hash` heeft. De noodroute ("wachtwoord kwijt, ik kan bij de database") wordt: `UPDATE users SET password_hash = NULL WHERE role = 'admin'`, en dan inloggen met `LOGIN_PASSWORD`. SETUP.md en de rescue-tekst in de app noemen dat.

### 4. Uitnodigen, resetten, verwijderen (alleen de beheerder)
- **Instellingen › Accounts**, alleen zichtbaar voor de beheerder: een lijst met naam, e-mailadres, aangemaakt en laatst gezien.
  - **"+ Iemand uitnodigen"** maakt een uitnodigingslink (`/invite/<code>`, eenmalig, 7 dagen). Die wordt één keer getoond, met Kopiëren en (waar het kan) Delen via `navigator.share`.
  - **Per account een resetlink** (`/reset/<code>`, eenmalig, 1 uur), getoond op dezelfde manier.
  - **Verwijderen** met een bevestiging die de naam noemt. Dat wist alle gegevens van die persoon: taken, plekken, sleutels, telefoons, push-abonnementen, instellingen en links. De beheerder kan zichzelf niet verwijderen.
- **`/invite/<code>`** (zonder login) toont een formulier met naam, e-mailadres en wachtwoord (minimaal 8 tekens, net als nu). Daarna volgen een nieuw `member`-account en een sessiecookie, en gaat het door naar `/`. Een e-mailadres dat al bestaat geeft een duidelijke fout. Een ongeldige, verlopen of gebruikte link geeft een vriendelijke pagina: "Deze link werkt niet meer, vraag een nieuwe".
- **`/reset/<code>`** (zonder login) toont het formulier "nieuw wachtwoord". Daarna wordt de `session_version` verhoogd (alle oude sessies van die persoon vervallen), volgt er een sessiecookie, en gaat het door naar `/`.
- Beide routes hebben een rate limit, net als inloggen. Elke link werkt één keer: verbruiken gebeurt in één statement, net als bij koppelcodes.
- Teksten via `public/i18n.js` (en + nl). Pagina's zonder inline scripts (CSP), net als het inlogscherm.

### 5. Instellingen per persoon
- Taal blijft per toestel (zoals nu). Tijdzone, herinneringstijd, begin van de week en de terugval-webhook zijn per persoon (`user_settings`), met dezelfde terugval als nu: instelling → config → standaard.
- **Terugval uit de config alleen voor de beheerder (mijn keuze):** `FALLBACK_WEBHOOK` uit de config is een persoonlijke bestemming. Die geldt alleen voor de beheerder, anders gaan herinneringen van anderen (met de titel van de taak) naar Dio's webhook. Een member zonder eigen instelling heeft geen terugval-webhook. Instellingen toont een member ook niets over de webhook uit de config. Neutrale standaarden (`TIMEZONE`, herinneringstijd) gelden wel voor iedereen.
- Het verschuiven van open taken bij een tijdzonewissel geldt alleen de taken van die persoon.
- **Tijdzone in de Worker:** nu zet `setTimeZone` een globale waarde per request. Met meerdere gebruikers met verschillende zones mag de ene request de zone van een andere niet zien. De bouwer zorgt dat rekenwerk met tijden in de Worker de zone van de huidige gebruiker gebruikt, zonder te leunen op een globale waarde over een `await` heen. Bijvoorbeeld door de zone mee te geven, of door geen `await` toe te laten tussen zetten en gebruiken. Een test bewijst het: twee gebruikers met verschillende zones maken tegelijk een taak met een tijd zonder zone, en elk krijgt de juiste UTC-tijd.
- `/config.js` geeft ook `userId`, `userName` en `isAdmin` mee (en de instellingen van die persoon).

### 6. Meldingen en de cron
- De cron loopt per gebruiker: de herinneringen van die persoon gaan alleen naar zijn eigen push-abonnementen, met zijn eigen zone voor herhalingen en zijn eigen terugval-webhook.
- **Push-abonnementen:** de endpoint blijft uniek per browser. Meldt een browser zich aan terwijl iemand anders is ingelogd, dan gaat het abonnement over naar die persoon. Bij uitloggen meldt de PWA de browser eerst af (`DELETE /api/push/subscribe`), zodat een gedeelde browser geen meldingen van de vorige persoon meer krijgt.

### 7. Sleutels, telefoons en koppelen
- Sleutels, telefoons en koppelcodes zijn per persoon. Een koppelcode die je maakt, geeft bij inwisselen een sleutel van jou.
- **Android, opnieuw koppelen na inloggen (mijn keuze):** logt iemand in binnen de app (de PWA weet dat via `tick.app`), dan koppelt de PWA na het inloggen altijd opnieuw, ook als de app al een sleutel heeft. Zo hoort de app altijd bij wie er net inlogde. Bij het inwisselen stuurt de app zijn oude sleutel mee (`old_key`, optioneel). De server trekt die oude sleutel in als hij geldig is, zodat er geen losse sleutels blijven liggen, en geeft naast `key` ook `user_id` terug.
- **Android, cache wissen (mijn keuze):** de app wist alles wat bij een persoon hoort (`cache`, `pending`, `pendingRemind`, `locFired`, `locSynced` en `geoSig`) zodra de sleutel verandert. Dat geldt na elk geslaagd inwisselen waarbij de `user_id` anders is dan de vorige, en na een 401 waarop de app de sleutel vergeet. Wachtende wijzigingen van A gaan dus nooit naar het account van B. De geofences worden opnieuw gezet. De app bewaart de `user_id` van zijn sleutel daarvoor in `Prefs`. Na de update heeft een bestaande sleutel nog geen `user_id`; dat telt als "zelfde persoon".
- De inbox-API zet taken bij de eigenaar van de inbox-sleutel. `INBOX_TOKEN` hoort bij de beheerder, dus Dio's n8n-koppeling blijft werken.

### 8. Export en import
- Export bevat alleen je eigen taken en plekken.
- **Backup terugzetten** voegt samen op id, maar alleen binnen je eigen account. Een id uit het bestand dat bij een ander account hoort, wordt overgeslagen en geteld als "overgeslagen"; het overschrijft nooit.
- **TickTick-import:** ids worden `tt<taskId>` voor de beheerder (zoals nu, zodat opnieuw importeren blijft werken) en `tt<eerste 8 tekens van userId>-<taskId>` voor anderen, zodat twee mensen dezelfde TickTick-backup kunnen importeren.

### 9. De PWA
- **Lokale opslag:** de IndexedDB-cache met taken en de outbox hoort bij één gebruiker. Ziet de PWA bij het opstarten (`/config.js`) een andere `userId` dan in de cache, dan wist hij de cache en de outbox eerst. Uitloggen wist ze ook.
- **Instellingen › Account:** naam, e-mailadres en wachtwoord wijzigen, en "op andere toestellen uitloggen". Voor de beheerder ook het blok **Accounts** (zie 4).
- **Instellingen › Apparaten** toont alleen je eigen browsers en telefoons.

### 10. Documentatie
- ARCHITECTURE.md: het datamodel, de auth met `userId`, de nieuwe routes (`/invite/:code`, `/reset/:code`, `/api/users…`), de cron per gebruiker en de regel "elke query filtert op `user_id`".
- SETUP.md en de skill `setup-tick`: de beheerder, uitnodigen, de noodroute.

## Testen en controleren
- **Isolatie (de belangrijkste tests):** twee gebruikers A en B.
  - B krijgt een 404 op elke taak-, lijst-, plek-, sleutel-, telefoon- en koppelcode-route met een id van A: lezen, wijzigen, verwijderen, subtaak met `parent_id` van A, snoozen.
  - `GET /api/tasks`, `/api/lists`, `/api/places`, `/api/keys`, `/api/devices` en export tonen niets van A.
  - Een plek "Thuis" kan bij allebei bestaan.
  - Een backup van A, teruggezet door B, overschrijft niets van A.
  - De cron stuurt de herinnering van A niet naar het abonnement van B.
  - De inbox-sleutel van B zet de taak bij B.
- **Links:** een uitnodiging werkt één keer en verloopt na 7 dagen. Een reset werkt één keer, verloopt na 1 uur en laat oude sessies vervallen. Alleen de beheerder mag ze maken (een member krijgt 403). Er is een rate limit.
- **Migratie:** een database in de oude vorm (met taken, plekken, sleutels, telefoons, abonnementen en instellingen) wordt na de migraties één beheerder die alles bezit. Inloggen met een leeg e-mailadres plus het wachtwoord werkt, en `API_TOKEN`, `INBOX_TOKEN` en een bestaande sleutel werken nog.
- **Tijdzones per gebruiker:** zie 5.
- **Android:** een pure beslisfunctie "cache wissen?" (oude `user_id`, nieuwe `user_id`, reden: inwisselen of 401), met een unit-test. Server: redeem met `old_key` trekt die sleutel in en geeft `user_id` terug. PWA: na een login in de app start het koppelen, ook met een bestaande sleutel.
- **Webhook:** een herinnering van een member zonder eigen webhook gaat nooit naar `FALLBACK_WEBHOOK` uit de config.
- `npm run typecheck`, `npm test`, `./gradlew testDebugUnitTest assembleDebug`; en in de browser met `npm run dev`: uitnodigen, aanmelden, uitloggen, inloggen als de ander, een gedeelde browser zonder resten van de vorige persoon.

## Aan de bouwer
- De exacte vorm van de cookie, hashing van links (zoals bij koppelcodes) en de API-routes onder `/api/users`.
- Hoe de tijdzone per request wordt doorgegeven (zie 5), zolang de test slaagt.
- De volgorde en opdeling van de migraties, zolang een bestaande database zonder verlies overgaat.
- De opmaak van de pagina's `/invite` en `/reset` (in de stijl van het inlogscherm).
- Hoe `user_id NOT NULL` aan bestaande tabellen komt in SQLite (vaste beheerder-id als standaard of de tabel opnieuw opbouwen), een kolom `last_seen`, en wat de PWA doet met een IndexedDB-cache van vóór de update zonder `userId` (wissen mag).
- `default_locale` en de schakelaars voor `API_TOKEN` en `INBOX_TOKEN` zijn alleen voor de beheerder.

## Buiten dit project
- **Taken delen** (volgend project): per taak iemand toevoegen via naam of e-mailadres, gedeeld of als kopie, met een acceptatiemelding.
- **Het koppelscherm op Android dat blijft hangen** (bekend probleem uit project 1): een losse reparatie.
- Passkeys.
