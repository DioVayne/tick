# Eigen account verwijderen — ontwerp

Datum: 2026-11-04. Besproken met Dio.

## Waarom

Google Play eist bij apps met accounts dat je je account kunt verwijderen, in de app zelf én via een webpagina die
zonder inloggen werkt. De Play-variant van de Android-app wijst standaard naar `app.ticktodo.nl` (een door Dio
gehoste Tick, mogelijk betaald). De gratis GitHub-variant wijst naar een eigen Tick op iemands eigen Cloudflare. De
functie zit daarom in Tick zelf en werkt op elke installatie hetzelfde. Er is geen aparte Play-versie.

## Doelen

1. In **Instellingen › Account** een knop **Account verwijderen**. Na bevestiging met je wachtwoord wordt al je data
   gewist, precies zoals nu bij `DELETE /api/users/:id` door de beheerder.
2. De **laatste beheerder** kan zichzelf niet verwijderen. Er volgt dan een duidelijke melding.
3. Na het verwijderen ben je **uitgelogd** en kom je op de **inlogpagina met een bevestiging**.
4. Een **openbare pagina** `/delete-account` (zonder inloggen) die uitlegt hoe je je account verwijdert. Dat is de
   link voor Google Play: `https://app.ticktodo.nl/delete-account`.

## Niet-doelen

- **Wachtwoord kwijt / zelf herstellen.** Vraagt e-mail versturen (Dio heeft een Resend-account). Dat wordt een
  apart project, ná dit project, met een eigen ontwerp.
- Geen wachttijd of "ongedaan maken"-periode. Verwijderen is direct en definitief.
- Geen verwijderverzoek via een formulier op de openbare pagina. Wie niet kan inloggen, mailt het contactadres.
- Het wissen zelf verandert niet. Beheerder en gebruiker gebruiken dezelfde wisregels.

## Anti-doelen (dan is het mislukt, ook al werkt het)

- Iemand verwijdert per ongeluk zijn account (één klik, geen wachtwoord).
- Na het verwijderen blijft er iets achter dat nog toegang geeft (cookie, sleutel, push-abonnement in deze browser,
  lokale kopie van taken in de browser).
- Een installatie zit zonder beheerder.
- Twee verschillende wisroutes die uit elkaar gaan lopen.

## Besluiten (van Dio)

- **Los gedeelde taken** (gedeeld via "gedeeld", niet via een gedeelde lijst) verdwijnen ook bij de ontvangers. Dat
  is het huidige gedrag bij verwijderen door de beheerder. Een taak die als **kopie** werd gedeeld, blijft bij de
  ontvanger (die is van de ontvanger). **Gedeelde lijsten** gaan over naar een ander lid (`transferListsStmts`); een
  lijst zonder geaccepteerde leden verdwijnt. Dit staat in één zin in het bevestigingsvenster en op de openbare
  pagina.
- **Contactadres** op de openbare pagina voor wie niet meer kan inloggen. Op `app.ticktodo.nl` wordt dat
  `dio@ticktodo.nl`.
- De openbare pagina staat op **elke** Tick, niet alleen op `app.ticktodo.nl`.

## Hoe het werkt

### Server

- **Eén wisfunctie** in `src/users.ts` (bijv. `deleteAccount(env, id)`): draait de batch
  `transferListsStmts` + `deleteUserStmts` en verwijdert daarna de achtergrondfoto uit R2 (`backgroundKey`). De
  beheerdersroute `DELETE /api/users/:id` gaat deze functie ook gebruiken. Bijlagen in R2 ruimt de bestaande
  cron-taak `sweepAttachments` op (bijlagen waarvan de taak niet meer bestaat), net als nu.
- **Nieuwe route** `POST /api/account/delete` in `src/account.ts` (achter `sessionOnly`, dus alleen met een
  sessiecookie, niet met een API-sleutel of telefoonsleutel). Body: `{ password }`.
  1. Rem: `LOGIN_LIMITER`, net als bij wachtwoord wijzigen (`429 err.too_many_attempts`).
  2. Wachtwoord fout → `403 err.wrong_password` (403, geen 401: de app stuurt bij 401 naar /login).
  3. Beheerder en geen andere beheerder → `409 err.last_admin`. In de praktijk is er nu precies één beheerder, dus de
     beheerder kan zichzelf nooit verwijderen. De controle telt wel echt (`role = 'admin'`), zodat het klopt als er
     later meer beheerders komen.
  4. Wissen via de gedeelde functie, daarna `Set-Cookie: clearCookie` in het antwoord, en `{ ok: true }`.
- Oude sessies, sleutels en apparaten werken daarna niet meer, omdat de gebruiker niet meer bestaat (de bestaande
  auth geeft dan 401).
- **Openbare pagina** `GET /delete-account`, vóór de auth-middleware, net als `/login`. Server-side HTML in
  `src/login.ts` (naast `loginPage`/`linkPage`), met `login.css` en `theme.js`, in de taal van het verzoek
  (`c.get('lang')`), zonder inline scripts of stijlen (CSP). Inhoud, in gewone taal:
  - titel: "Je Tick-account verwijderen";
  - de stappen: inloggen → Instellingen › Account → Account verwijderen → wachtwoord invullen → bevestigen;
  - wat er wordt gewist: taken, subtaken, plaatsen, bijlagen, achtergrondfoto, instellingen, sleutels, gekoppelde
    apparaten en meldingen, deelrijen; niet terug te halen;
  - **bewaartermijn** (besluit Dio): "Je gegevens worden direct uit Tick verwijderd. Reservekopieën worden na
    hooguit 30 dagen automatisch gewist." (D1 Time Travel bewaart tot 30 dagen; bijlagen in R2 gaan binnen een uur
    weg via `sweepAttachments`.) Dezelfde zin staat in het bevestigingsvenster en in `docs/settings.md`, en Dio vult
    hem in bij Play Console;
  - de zin over gedeelde taken en lijsten (zie Besluiten);
  - tip: eerst een back-up downloaden (Instellingen › Data);
  - kun je niet inloggen? Mail het contactadres, dan krijg je een herstellink of wordt je account voor je
    verwijderd;
  - een link naar `/login`.
- **Contactadres:** het bestaande `ADMIN_CONTACT` (staat al in de config, nu als `mailto:…` voor push en
  OpenStreetMap). De pagina toont het zonder `mailto:` als klikbare `mailto:`-link. Leeg of niet in `mailto:`-vorm →
  de zin "neem contact op met wie deze Tick beheert" zonder adres. Er komt geen nieuwe instelling. Op
  `app.ticktodo.nl` zet Dio `ADMIN_CONTACT` op `mailto:dio@ticktodo.nl`. *Mijn keuze:* een adres op `example.com`
  (de standaardwaarde uit `wrangler.example.jsonc`) telt als "niet ingevuld", zodat een eigen Tick nooit
  `you@example.com` als contact toont.

### App (PWA)

- In het blok **Account** (`paintAccount` in `public/settingsview.js`) een laatste rij **Account verwijderen** met een
  rode knop. Uitgeschakeld als je offline bent.
- **Bevestigingsvenster** (bestaande `ask`/`modal` uit `public/dialog.js`): uitleg wat er gebeurt (inclusief de zin
  over gedeelde taken en lijsten), een wachtwoordveld, en de knoppen "Account verwijderen" (danger) en
  "Annuleren".
- Voor de beheerder (`CONFIG.isAdmin`): de knop staat er wel, maar de server weigert met `err.last_admin`; de app toont
  die melding. *Mijn keuze:* de knop niet verbergen, zodat de beheerder ziet waarom het niet kan.
- **Na succes:** dezelfde opruiming als bij uitloggen (`logout()`): push afmelden in deze browser, lokale kopie en
  outbox wissen (`clearAll`), instellingen-cache en config-cache wissen. Daarna naar `/login?deleted=1`. De
  `fetch('/logout')`-stap hoeft niet (de server wist het cookie al). Let op: `disablePush` roept
  `DELETE /api/push/subscribe` aan, en dat geeft na het verwijderen 401, waarna `api.js` al naar `/login` springt
  (zonder `?deleted=1`, misschien vóór `clearAll`). Na het verwijderen daarom alleen in de browser afmelden
  (`subscription.unsubscribe()`, geen serveraanroep; de server wist de abonnementen al). *Mijn keuze:* de
  browser-opruiming uit `logout()` in een eigen functie zetten die beide gebruiken, met die afmelding als verschil.
- **Inlogpagina:** `/login?deleted=1` toont bovenaan een bevestiging "Je account is verwijderd." Server-side
  gerenderd in `loginPage` (geen inline script nodig).
- **Android-app:** die opent de PWA, dus de knop werkt daar ook. Na het verwijderen is de API-sleutel van de telefoon
  weg; de widget geeft dan een fout tot de app opnieuw verbonden wordt. Geen wijziging in `android/`.

### Teksten

Alle zichtbare teksten in `public/i18n.js`, met `en` en `nl`. Nieuwe sleutels o.a. `err.last_admin`, de teksten van de
knop, het venster, de bevestiging op de inlogpagina en de openbare pagina.

### Docs

- `docs/settings.md`, blok **Account**: de nieuwe knop, wat er gebeurt, en dat de beheerder het niet kan.
- *Mijn keuze:* een eigen pagina `docs/delete-account.md` is niet nodig; de uitleg staat in `settings.md` en op de
  openbare pagina zelf.
- `ARCHITECTURE.md`: de route `POST /api/account/delete`, de openbare route `/delete-account`, de gedeelde
  wisfunctie, en dat `ADMIN_CONTACT` ook op die pagina staat.
- `SETUP.md` / `wrangler.example.jsonc`: bij `ADMIN_CONTACT` vermelden dat het adres ook op de openbare pagina staat.

### Tests

- Server: zelf verwijderen wist alles (zelfde controles als de bestaande beheerderstest), gedeelde lijst gaat over,
  fout wachtwoord → 403 en niets gewist, beheerder als enige → 409 en niets gewist, sleutel/API-token in plaats van
  sessie → geweigerd, cookie gewist in het antwoord, oude sessie geeft daarna 401.
- `/delete-account` zonder inloggen → 200, in beide talen, met het contactadres; zonder `mailto:` → zin zonder adres.
- `/login?deleted=1` toont de bevestiging.
- `test/i18n.test.ts` dekt de nieuwe sleutels al.

## Wat aan de bouwer is

- Precieze teksten (kort, gewone taal, je-vorm in het Nederlands).
- Indeling en stijl van de openbare pagina binnen `login.css`, en of de pagina `noindex` krijgt (*mijn keuze:* niet;
  Google mag hem vinden).
- Of de bestaande beheerderstest wordt omgezet naar de gedeelde functie of ernaast blijft.

## Na dit project

- Dio zet `ADMIN_CONTACT` op `mailto:dio@ticktodo.nl` voor `app.ticktodo.nl` en vult de link in Play Console in.
- Apart project: "wachtwoord kwijt" met e-mail via Resend.
