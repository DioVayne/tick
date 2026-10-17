# Instellingenpagina voor Tick — ontwerp

Status: concept, wacht op akkoord van Dio.

## Waarom
Tick wordt een publieke repo die anderen zelf draaien. Zo iemand installeert één keer (met SETUP.md of met Claude) en wil daarna **alles in de app zelf regelen**, zonder terminal, `wrangler.jsonc`, secrets of een nieuwe deploy. Richtlijn van Dio: zo laagdrempelig mogelijk, tenzij het iets breekt.

Nu staat bijna alles in de config: taal (`LOCALE`), tijdzone (`TIMEZONE`), sleutels (`API_TOKEN`, `INBOX_TOKEN`), fallback (`FALLBACK_WEBHOOK`), wachtwoord (`LOGIN_PASSWORD`); "overal uitloggen" kan alleen met een SQL-commando, export en TickTick-import alleen met scripts.

## Doelen
- Eén instellingenpagina in de PWA, bruikbaar op mobiel en desktop, met losse blokken.
- Een niet-technische gebruiker hoeft na de installatie nooit meer naar de config.
- Technische dingen (sleutels, webhook) staan apart in een ingeklapt blok **Geavanceerd**.
- Bestaande installaties blijven werken zonder iets te doen (Dio's productie, zijn Android-app, zijn automations).

## Niet-doelen
- Geen meerdere gebruikers of rollen.
- Secrets die alleen bij de installatie horen blijven config: `SESSION_SECRET`, `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`, `ADMIN_CONTACT`, `ANDROID_PACKAGE`, `DEV_AUTH_BYPASS`.
- Geen QR-code of camera-scan om Android te koppelen (kan later).
- De widget-instellingen in de Android-app (lettergrootte/regelafstand van de widget) blijven in de Android-app.

## Anti-doelen (mislukt, ook als het technisch werkt)
- Iemand sluit zichzelf buiten (wachtwoord vergeten, sleutel ingetrokken) zonder herstelroute.
- Een bestaande secret houdt ineens op met werken na de update.
- Een gelekte Android- of inbox-sleutel kan het wachtwoord wijzigen, sleutels maken of de webhook omleiden.
- De pagina is een muur van technische termen.

## Beslist met Dio
- **Vorm A**: één lange pagina in de middenkolom (waar nu de takenlijst staat), op mobiel één kolom. Blokken visueel duidelijk gescheiden (kader, icoon, titel, regels met scheidingslijn). Mockup: `.superpowers/brainstorm/…/page-a-v2.html`.
- **Ingang**: ⚙ Instellingen onderaan de zijbalk en in de lade op mobiel.
- **Onderdelen**: Weergave, Taal en tijd, Meldingen, Apparaten, Account, Gegevens, Geavanceerd (sleutels + fallback-webhook).
- **Taal**: automatisch volgens de browser (en/nl), of vast te kiezen.
- **Weergave**: thema, lettergrootte, ruimte tussen taken.
- **Apparaten** laat per browser en per Android-telefoon zien of meldingen werken en, voor Android, of "locatie altijd toestaan" aan staat.
- **Backup**: downloaden én terugzetten.

## Per apparaat of voor heel Tick
📱 = in de browser (`localStorage`), 🏠 = in D1 (`settings`). *Keuze van Claude.*

| Instelling | Waar | Waarom |
|---|---|---|
| Thema, lettergrootte, ruimte | 📱 | Verschilt per scherm; thema werkt nu al zo |
| Taal | 📱 | "Automatisch volgens de browser" is per apparaat |
| Meldingen aan/uit | 📱 | Een push-abonnement hoort bij een browser |
| Tijdzone, reminder-tijd, eerste dag van de week | 🏠 | De server rekent er 's nachts mee (cron, inbox) |
| Fallback-webhook, sleutels, wachtwoord, sessieversie | 🏠 | Server-side |

**Voorrang voor 🏠-instellingen**: waarde in D1 → waarde in de config (`TIMEZONE` enz.) → ingebouwde standaard. De config blijft dus de startwaarde; wat je in de app kiest gaat voor. Bestaande installaties merken niets tot ze iets wijzigen.

## Onderdelen in detail

### 🎨 Weergave 📱
- Thema: Automatisch | Licht | Donker (bestaande sleutel `tick.theme`).
- Lettergrootte: Klein | Normaal | Groot | Extra groot.
- Ruimte tussen taken: Compact | Normaal | Ruim.
- Een voorbeeldtaak in het blok verandert direct mee.
- `theme.js` (staat al in `<head>`, ook op de loginpagina) zet alle drie vóór de eerste weergave op `<html>` (data-attributen), zodat er niets flitst.
- *Aan de bouwer*: hoe de schaal technisch werkt (font-sizes naar `rem` omzetten, een CSS-variabele, of `zoom`). Eis: tekst wordt echt groter op elk scherm, de layout breekt niet bij Extra groot op 360px breed, en de knoppen blijven aanklikbaar.

### 🌍 Taal en tijd
- **Taal 📱**: Automatisch | English | Nederlands. Automatisch = de eerste van `navigator.languages` die `en` of `nl` is, anders de standaardtaal (zie Geavanceerd).
  - De server moet dezelfde taal gebruiken voor de shell (`/`), `/config.js`, de manifest, foutmeldingen en de loginpagina. Daarom bewaart de PWA de keuze ook in een cookie `tick_lang` (`en`|`nl`; geen cookie = automatisch). Server-volgorde: cookie → `Accept-Language` → standaardtaal (zie Geavanceerd). *Keuze van Claude.*
  - Pushmeldingen worden 's nachts door de server gemaakt en kennen geen browser. Daarom krijgt `push_subscriptions` een kolom `locale`; de PWA stuurt de huidige taal mee bij aanmelden en bij elke taalwissel. Elke melding gaat in de taal van dat abonnement. De fallback-webhook gebruikt de standaardtaal.
  - Offline wisselen moet werken voor alles wat de JS tekent. De shell is op de server vertaald; de bouwer zorgt dat de vaste teksten van de shell na een wissel ook kloppen (bijvoorbeeld door `data-i18n` te laten staan en client-side opnieuw toe te passen, of door na de wissel `/` en `/config.js` opnieuw op te halen en te herladen). *Aan de bouwer, met deze eis.*
- **Tijdzone 🏠**: lijst van IANA-zones (`Intl.supportedValuesOf('timeZone')`), met een knop "Gebruik die van dit apparaat". Een ongeldige zone weigert de server met een 400.
  - **Kloktijd blijft staan (besluit Dio):** wie 9:00 instelt bedoelt 9:00 in zijn eigen beleving, ongeacht de tijdzone. Bij een wissel rekent de server in één batch alle open taken om: `remind_at` (toekomstig of nog niet gemeld), `repeat_start` en `repeat_at` krijgen dezelfde wandkloktijd en datum in de nieuwe zone. Afgeronde taken en `done_at`/`created_at` blijven ongemoeid. Een tijd die in de nieuwe zone niet bestaat (zomertijdgat) schuift naar het eerstvolgende geldige moment, zoals `zonedToUtc` nu al doet. `repeat_prev` (undo) wordt bij de omzetting gewist. Getest met o.a. Amsterdam → Londen en een wekelijkse taak rond middernacht.
  - Een ander apparaat met een oude `/config.js` rekent tot de volgende start in de oude zone; de server blijft leidend (die rekent de ritmes bij afvinken).
- **Reminder zonder tijd 🏠**: tijd (standaard 09:00). Geldt overal waar nu 09:00 vastligt: `src/time.ts` (kale datum), `src/repeat.ts` (`todayNineIso`), `public/store.js` (start van een ritme zonder reminder), `POST /api/inbox`, en de snelle datumkeuzes in de PWA als die een vaste tijd gebruiken.
- **Week begint op 🏠**: Maandag | Zondag. Volgorde van de dagknoppen in de ritmekiezer en overal waar de PWA zelf een week opbouwt. (De native datumkiezer van de browser volgt de browser en valt erbuiten.)
- Na een wijziging past de PWA de waarde direct toe; andere apparaten krijgen hem bij de volgende start via `/config.js`.

### 🔔 Meldingen 📱
- Schakelaar "Meldingen op dit apparaat" (vervangt de knop 🔔 in de zijbalk; dezelfde logica als `public/push.js`).
- Knop "Stuur testmelding".
- De iOS-hint (alleen vanaf het beginscherm) blijft, nu in dit blok.

### 📱 Apparaten
- **Deze browser**: toestemming (`Notification.permission`), wel/geen abonnement, iOS-beginscherm-hint. Groen vinkje of waarschuwing met één zin hoe je het oplost.
- **Andere browsers met meldingen**: uit `push_subscriptions` (naam afgeleid uit de user-agent, aangemeld op, met Verwijderen). *Keuze van Claude.*
- **Android-telefoons**: per gekoppelde telefoon: naam (model), laatst gezien, meldingen aan/uit, locatie (altijd / alleen tijdens gebruik / uit), app-versie. Bij een probleem een waarschuwing met uitleg ("Open Instellingen → Apps → Tick → Locatie → Altijd toestaan").
  - De Android-app stuurt die status naar `POST /api/device` na een geslaagde sync, maar alleen als hij veranderd is of de vorige melding meer dan 6 uur oud is. De status hoort bij de sleutel waarmee de app inlogt (ook de oude `API_TOKEN`).
  - Pas zichtbaar na een update van de Android-app; tot dan toont de rij alleen "laatst gezien" (uit `last_used_at` van de sleutel) en de tekst "update de app voor meer".
- **+ Android-telefoon koppelen**: vraagt een naam ("Telefoon van Dio"), maakt een sleutel met volledige toegang en toont hem één keer met een Kopieer-knop en drie korte stappen ("Open de Tick-app → plak de sleutel → Opslaan"). Het woord "token" komt niet voor.

### 👤 Account 🏠
- **Wachtwoord wijzigen**: huidig wachtwoord + nieuw wachtwoord (twee keer, minstens 8 tekens). Opslag als PBKDF2-SHA-256 met salt in `settings` (`password_hash`; 100.000 iteraties, het maximum in Workers). Gaat door `LOGIN_LIMITER`. Na een wijziging worden alle andere sessies uitgelogd; dit apparaat krijgt een verse cookie.
  - `passwordOk`: bestaat `password_hash`, dan geldt alleen die; anders `LOGIN_PASSWORD` (fail closed als geen van beide bestaat).
  - **Noodroute** (in SETUP.md en als regel onder het formulier): `npx wrangler d1 execute tick --remote --command "DELETE FROM settings WHERE key='password_hash'"`; daarna geldt `LOGIN_PASSWORD` weer.
- **Uitloggen op alle andere apparaten**: verhoogt `session_version`; dit apparaat krijgt een verse cookie en blijft ingelogd. Uitleg erbij: sleutels van telefoons en automations blijven werken (die trek je in bij Geavanceerd). *Keuze van Claude: "andere" in plaats van "alle", zodat je niet meteen buiten staat.*
- **Uitloggen** (hier): de bestaande knop uit de zijbalk.

### 💾 Gegevens 🏠
- **Backup downloaden**: `GET /api/export` → `tick-backup-JJJJ-MM-DD.json` met `{ app: "tick", version: 1, exported_at, tasks, places }`. `tasks` en `places` zijn de ruwe rijen (alle kolommen, ook de afgeronde taken). Geen instellingen, wachtwoord, sleutels of webhook-URL. *Keuze van Claude: instellingen terugzetten zou ongemerkt de tijdzone kunnen verzetten.*
- **Backup terugzetten**: kies een bestand → de app toont wat erin zit ("1.204 taken, 6 plekken, van 12 oktober") → bevestigen → `POST /api/import/backup`. **Samenvoegen op id**: taken en plekken uit de backup overschrijven die met hetzelfde id, verwijderde komen terug, alles wat na de backup is gemaakt blijft staan. Niets wordt gewist. *Keuze van Claude: veiliger dan "alles vervangen".* Een plek met een naam die al bij een ander id hoort: de bestaande blijft, de backup-plek wordt overgeslagen en geteld. Antwoord `{ tasks, places, skipped }`. Ongeldig bestand of andere `app`/`version` → 400 met een duidelijke melding.
- **Importeer uit TickTick (.csv)**: zelfde logica als `scripts/import-ticktick.mjs` (ids `tt<taskId>`). **Opnieuw importeren slaat bestaande ids over** (`INSERT OR IGNORE`), zodat wijzigingen en subtaken die je sindsdien in Tick maakte blijven staan; het antwoord telt nieuw en overgeslagen. *Keuze van Claude; het script blijft zoals het is.* De CSV-parser wordt een gedeelde module in `public/` (zoals `i18n.js`) die het script én de Worker gebruiken; de PWA uploadt het bestand, de Worker leest het in. Antwoord met aantallen.
- Grote bestanden: in porties naar D1 (batch-limieten), zodat een backup van duizenden taken lukt.

### 🛠 Geavanceerd (standaard ingeklapt)
**Sleutels**
- Tabel `api_keys` (nieuwe migratie): id, naam, soort (`full` | `inbox`), `hash` (SHA-256 van de sleutel; sleutels zijn 32 willekeurige bytes, dus een snelle hash volstaat), `hint` (laatste 4 tekens, om te herkennen), `created_at`, `last_used_at`.
- Sleutelformaat `tick_` + base64url. Eén keer getoond bij aanmaken, met Kopieer-knop; daarna alleen naam, soort, hint, aangemaakt, laatst gebruikt.
- `last_used_at` wordt hoogstens eens per uur bijgewerkt (minder schrijfacties).
- **Intrekken** = rij verwijderen (met bevestiging), werkt meteen.
- **Oude secrets**: staat `API_TOKEN` of `INBOX_TOKEN` in de config, dan verschijnt een rij "uit de installatie" met de knop **Uitschakelen** / **Inschakelen** (`settings`: `env_api_token_off`, `env_inbox_token_off`). Een secret kan de app niet wissen; de rij legt uit dat `npx wrangler secret delete …` hem helemaal weghaalt.
- `authorize()`: eerst `api_keys` (hash vergelijken), dan de oude secrets als ze niet uitgeschakeld zijn. Soort `full` gedraagt zich als nu `token`, `inbox` als nu `inbox`.

**Standaardtaal 🏠**: English | Nederlands. Gebruikt voor de fallback-webhook, voor abonnementen zonder `locale` en als terugval van "Automatisch". Voorrang D1 (`default_locale`) → `LOCALE` → `en`. *Keuze van Claude: zo hoeft ook dit niet meer via de config.*

**Fallback-webhook**: URL-veld (alleen `https://`), knop Test (stuurt een voorbeeldmelding), leeg = uit. Voorrang: D1 → `FALLBACK_WEBHOOK`. Staat er alleen een secret, dan toont het veld "ingesteld in de installatie" en kun je hem in de app overschrijven of uitzetten.

## Beveiliging
- Alle instellingen-, sleutel-, account-, export- en import-routes vereisen een **sessie** (of de lokale dev-bypass). Een Bearer-sleutel van soort `full` krijgt een 403. Uitzondering: `POST /api/device` (alleen Bearer `full`, de telefoon meldt zichzelf). *Keuze van Claude.*
- Een sleutel staat nergens leesbaar opgeslagen; alleen de hash.
- Wachtwoord wijzigen vraagt het huidige wachtwoord en gaat door de rate limiter.
- CSP blijft strikt: geen inline code; downloads via `Blob` + `URL.createObjectURL`.

## Architectuur (richting, details aan de bouwer)
- **Server**: nieuwe routes onder `/api/settings`, `/api/keys`, `/api/account`, `/api/devices`, `/api/export`, `/api/import/*`. Een helper leest de 🏠-instellingen één keer per request (en per cron-run) uit `settings` met de config als terugval; `setTimeZone` krijgt die waarde in plaats van alleen `env.TIMEZONE`.
- **`/config.js`** levert de 🏠-waarden mee (tijdzone, reminder-tijd, week, standaardtaal) en de taal volgens de servervolgorde.
- **PWA**: een nieuwe module voor de pagina (niet `settings.js`, die naam is al de config-lader), in `SHELL` van `sw.js` met een nieuwe `CACHE`-versie. De pagina is een eigen weergave in de middenkolom met `history.pushState`, zodat de terugknop van Android werkt. De zijbalk verliest Meldingen, Thema en Uitloggen en krijgt ⚙ Instellingen.
- **Offline**: de pagina opent offline. 📱-instellingen werken gewoon; 🏠-onderdelen tonen de laatst bekende waarde, uitgeschakeld, met "Alleen online te wijzigen".
- **Migratie** `0006_…sql`: `api_keys`, apparaatstatus (eigen tabel of kolommen, aan de bouwer), `push_subscriptions.locale`.
- **Android**: status melden na sync (zie Apparaten); geen andere wijzigingen. Snel toevoegen in de Android-app houdt zijn eigen 09:00; dat komt in de documentatie.
- **Teksten**: alles via `public/i18n.js` in `en` en `nl`; serverfouten als `HttpError(status, key, vars)`.

## Documentatie
- `ARCHITECTURE.md`: instellingen (voorrang D1 → config → standaard), nieuwe tabellen, routes, taal per apparaat, sleutels.
- `SETUP.md`: na de installatie gaat alles in de app; config-waarden zijn startwaarden; `API_TOKEN`/`INBOX_TOKEN` zijn optioneel geworden (een telefoon koppel je in de app); noodroute wachtwoord.
- `wrangler.example.jsonc`: commentaar dat `LOCALE`/`TIMEZONE` startwaarden zijn.

## Klaar is
- De pagina werkt in de PWA op mobiel en desktop, ook offline voor de 📱-delen.
- Tests voor alle nieuwe routes, de voorrangsregel, sleutels (inclusief oude secrets en uitschakelen), wachtwoord + noodroute, sessies, export/terugzetten, TickTick-import, taalkeuze op de server, en de `SHELL`-lijst.
- Elke tekst in `public/i18n.js` in `en` en `nl`.
- `npm run typecheck` en `npm test` groen; gecontroleerd in de browser-preview (`npm run dev`).
- `ARCHITECTURE.md` en `SETUP.md` bijgewerkt; alles gecommit op de eigen branch. Niet deployen, pushen of mergen zonder Dio's akkoord.

## Aan de bouwer
Technische vorm van lettergrootte en ruimte; hoe de shell na een taalwissel klopt; opslag van de apparaatstatus; indeling van de nieuwe modules en routes; precieze teksten (binnen de toon: kort, geen jargon buiten Geavanceerd).
