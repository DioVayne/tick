# Zelf een account aanmaken — ontwerp

Datum: 2026-11-05. Besproken met Dio.

## Waarom

Tick komt in Google Play. Wie de app daar installeert, komt op `app.ticktodo.nl`, een Tick die Dio host. Daar kan nu
niemand binnen zonder dat Dio een uitnodigingslink maakt. Dat schaalt niet. Mensen moeten zelf een account kunnen
aanmaken, zo laagdrempelig mogelijk.

Tick is gebouwd voor een huishouden of klein team: iedereen op één Tick kan elkaars naam zien en eruit kiezen om mee te
delen (`GET /api/shares/people`), en de beheerder is een zichtbare rol. Op een openbare Tick met vreemden mag dat niet:
daar heeft iedereen een eigen, los account en weet je niet wie er nog meer is.

Voor een eigen Tick (self-host) verandert er niets, tenzij de beheerder het zelf aanzet.

## Doelen

1. Een nieuwe instelling `OPEN_SIGNUP`. Standaard uit. Aan = "openbare Tick": zelf aanmelden kan, en accounts zien
   elkaar niet.
2. **Welkomstscherm**: de inlogpagina (`/login`) toont het Tick-logo en, als `OPEN_SIGNUP` aan staat, naast inloggen
   ook "Account aanmaken".
3. **Aanmeldpagina** `/signup`: naam, e-mailadres, wachtwoord. Daarna ben je ingelogd en zit je in je eigen, lege
   Tick (met de standaardlijsten die een nieuw account nu ook krijgt).
4. **E-mailadres bevestigen**: na aanmelden krijg je een mail met een bevestigingslink. Tick kun je meteen gebruiken;
   alleen **delen** (versturen én ontvangen) wacht tot je adres bevestigd is. Een balk in de app zegt dat, met een
   knop "Mail opnieuw sturen".
5. **Delen zonder lijst van accounts**: op een openbare Tick deel je een taak of lijst door een volledig e-mailadres te
   typen. Geen keuzelijst met alle accounts, geen zoeken op naam.
6. **Uitnodigen per mail**: deel je met een adres zonder (bevestigd) account, dan krijgt dat adres een mail: "*Naam*
   wil een taak/lijst met je delen in Tick", korte uitleg wat Tick is, een knop "Account aanmaken" en (als ingesteld)
   een link naar Google Play. Maakt die persoon een account met dat adres en bevestigt het, dan staat de uitnodiging
   klaar in Tick, zoals elke andere uitnodiging.
7. **Geen zichtbare beheerder** voor gebruikers op een openbare Tick. Dio blijft achter de schermen beheerder.
8. Misbruik wordt afgeremd (zie "Misbruik").

## Niet-doelen

- **Inloggen met Google.** Dio wil dat later (laagdrempeliger), niet nu. Wel zo bouwen dat het later kan: een
  aanmelding is "een account met een e-mailadres", niet gebonden aan een wachtwoord-formulier.
- Geen "ik ben geen robot"-controle (Turnstile) nu. Komt pas bij echt misbruik.
- Niets veranderen aan een Tick met `OPEN_SIGNUP` uit: geen aanmeldknop, de keuzelijst bij delen blijft, de beheerder
  blijft zichtbaar, geen bevestigingsmails.
- Geen betaalde abonnementen, geen limiet op aantal accounts (behalve de rem per dag, zie "Misbruik").
- Geen tweede mailmodule: alles gaat via het bestaande `src/mail.ts` (gebouwd voor "wachtwoord kwijt").

## Anti-doelen (dan is het mislukt, ook al werkt het)

- Een gebruiker kan ontdekken wie er nog meer een account heeft (via een lijst, zoeken op naam, of een ander antwoord
  bij delen met een bestaand versus onbekend adres).
- Iemand maakt een account met andermans e-mailadres en krijgt zo diens gedeelde taken.
- Tick wordt een spamkanon: met één account (of veel nep-accounts) kun je willekeurige adressen volmailen.
- Uitnodigingsmails maken het gratis Resend-tegoed op, zodat herstel- en bevestigingsmails niet meer aankomen.
- Een eigen Tick (zonder `OPEN_SIGNUP`) gaat anders werken of krijgt knoppen die niets doen.
- Gebruikers zien een "beheerder", of teksten als "vraag het je beheerder", terwijl ze die niet kennen.

## Besluiten (van Dio)

- Welkomstscherm met logo, account aanmaken met naam/e-mail/wachtwoord. Google-inloggen later.
- Delen met iemand zonder account → die persoon krijgt een mail met uitleg over Tick, waar te downloaden, en dat
  iemand iets wil delen.
- E-mailadres bevestigen: ja.
- Alleen bedoeld voor `app.ticktodo.nl`. Een eigen Tick blijft dicht tenzij de beheerder `OPEN_SIGNUP` aanzet.
- **Na aanmelden meteen in de app** (Dio koos optie a). Daarmee accepteert Dio één klein lek: wie zich aanmeldt met
  een adres dat al een account heeft, krijgt te zien dat het adres in gebruik is. De IP-rem en de daggrens beperken
  hoeveel adressen iemand zo kan uitproberen. Dit is de enige plek waar zo'n lek mag; bij delen niet.
- **Onbevestigde accounts verdwijnen na 30 dagen**, met taken en al (Dio: akkoord). De app waarschuwt vooraf.
- Testadressen voor de echte test op app.ticktodo.nl: `ik+test1@koprust.nl` en `ik+test2@koprust.nl`. Die accounts
  mogen na de test weer weg.

## Mijn keuzes (Dio kan ze nog omdraaien)

- **Meteen gebruiken, delen wacht op bevestiging.** Laagdrempeliger dan eerst bevestigen. Dio zei "goed idee" op de
  vraag "eerst bevestigen, of meteen gebruiken en alleen delen wacht?"; ik lees dat als het laatste.
- **Openbare Tick = `OPEN_SIGNUP` aan.** Eén instelling voor zowel "zelf aanmelden" als "accounts zien elkaar niet".
  Zelf aanmelden zonder privacy is nooit gewenst; privacy zonder aanmelden kan later een aparte instelling worden.
- **Bevestigen werkt alleen op een openbare Tick.** Bestaande accounts en accounts via een uitnodigingslink van de
  beheerder gelden als bevestigd (de beheerder kent die mensen).
- **Wachtwoord herstellen bevestigt ook je adres**: wie een herstelmail opent, heeft het adres in handen. Zo kan
  iemand van wie het adres "gekaapt" is door een nep-aanmelding, via "Wachtwoord vergeten?" het account overnemen.
- **Uitnodigingsmails mogen hooguit de helft van de daggrens** (`MAIL_DAILY_LIMIT`) gebruiken, zodat herstel- en
  bevestigingsmails voorgaan.
- **Mensen met wie je al deelt** mag je wel als knopje zien in de deeldialoog (je kent ze al: er is een geaccepteerde
  gedeelde taak of lijst tussen jullie). Niemand anders.
- **Play-link** via een nieuwe optionele instelling `PLAY_STORE_URL`. Leeg = de mail noemt alleen de webversie.

## Hoe het werkt

### Instellingen

- **Var** `OPEN_SIGNUP` (`"true"` = aan; al het andere = uit). In `wrangler.example.jsonc` als uitgecommentarieerde
  regel met uitleg, standaard uit. In het `Env`-type in `src/index.ts`. In SETUP.md een kort optioneel stuk
  "Openbare Tick (zelf aanmelden)" dat zegt: dit wil je alleen voor een Tick voor onbekenden, en het werkt pas goed
  met mail ingesteld (Resend).
- **Var** `PLAY_STORE_URL` (optioneel), idem in het voorbeeld, `Env` en SETUP.md.
- Eén functie, bijv. `openSignup(env)`, beslist "openbare Tick". Alles hieronder gebruikt die.
- **Zonder mail** (`mailEnabled(env)` onwaar) maar met `OPEN_SIGNUP` aan: aanmelden werkt, maar bevestigen kan niet,
  dus delen kan dan niet. De app zegt dat netjes ("Delen is op deze Tick niet beschikbaar"). SETUP.md raadt mail aan.
- Lokale config van app.ticktodo.nl (`C:\dev\ticktodo-app\wrangler.jsonc`, niet in git): `OPEN_SIGNUP: "true"` en
  `PLAY_STORE_URL` (zodra de Play-link bekend is).

### Database (nieuwe migratie, `0020_…`)

- `users.email_verified_at TEXT` (NULL = niet bevestigd). Bestaande accounts krijgen bij de migratie `created_at` (dus
  bevestigd).
- `account_links.kind` krijgt ook `'verify'`. De CHECK in SQLite kun je niet aanpassen; de migratie bouwt de tabel
  opnieuw op (nieuw bestand, bestaande migraties niet wijzigen).
- Nieuwe tabel `email_invites`: een uitnodiging aan een adres zonder bevestigd account. Velden: `id`, `email` (NOCASE),
  `from_user`, wat er gedeeld wordt (taak-id + modus, of lijstnaam + modus, zoals het verzoek aan `/api/shares` of het
  delen van een lijst), `created_at`, `expires_at` (30 dagen). Bij het verwijderen van de deler of de taak gaat de
  uitnodiging mee weg (`deleteUserStmts`, en bij taak/lijst verwijderen). Voor een lijst staat er `list_id`, geen
  lijstnaam: de lijst wordt bij de eerste deelactie **altijd** een gedeelde lijst (`src/sharedlists.ts`), ook bij een
  onbekend adres, anders ziet de deler het verschil. Een lijstnaam zou bovendien verouderen bij hernoemen.
- `mail_log` krijgt een kolom `recipient_hash` (SHA-256 van het kleingeschreven adres), om "hooguit één
  uitnodigingsmail per adres per dag" te tellen, ook na intrekken of omzetten van de uitnodiging.

### Aanmelden

- `GET /signup` (openbaar, vóór de auth-middleware, zoals `/forgot`): formulier naam, e-mail, wachtwoord, in de stijl
  van `public/login.css`; script in een nieuw bestand (bijv. `public/signup.js`) in `loginAssets`. Onder het formulier
  een zin met link naar `/privacy`. `OPEN_SIGNUP` uit → `404`.
- `POST /signup`:
  1. Uit → `404`.
  2. Rem per IP: `LOGIN_LIMITER` met sleutel `signup:<ip>`.
  3. Daggrens voor heel Tick op aanmeldingen (nieuwe optionele var `SIGNUP_DAILY_LIMIT`, standaard bijv. 100). Bij de
     grens: `429` met een vriendelijke melding, en één pushmelding per dag aan de beheerder (zelfde patroon als
     `claimCapNotice`).
  4. Controle zoals bij een uitnodigingslink nu (naam, `cleanEmail`, `MIN_PASSWORD`).
  5. **Adres al in gebruik** (ook als dat account onbevestigd is): `409` met een melding "Er is al een account met
     dit adres" en links naar inloggen en "Wachtwoord vergeten?" (als mail aan staat). Dit lek is Dio's keuze (zie
     Besluiten).
  6. Nieuw adres: account maken (`role = 'member'`, `email_verified_at` leeg), inloggen (sessiecookie zoals bij
     `/login`), doorsturen naar de app, en de bevestigingsmail op de achtergrond sturen.
- Account maken hergebruikt wat de uitnodigingslink nu doet (zelfde standaardlijsten, zelfde velden).

### Bevestigen

- Bevestigingsmail via `sendMail` + `mailLayout`, soort `verify` in `mail_log` (dus binnen `reserveMail`-grenzen). Link
  `/verify/<code>` (via `createLink(db, 'verify', …)`, 7 dagen geldig, eenmalig).
- `GET /verify/:code`: geldig → `email_verified_at` zetten, openstaande `email_invites` voor dat adres omzetten in
  gewone uitnodigingen (zie hieronder), en een pagina "Je e-mailadres is bevestigd" met een knop naar de app. Ongeldig
  of verlopen → melding met uitleg dat je in de app een nieuwe mail kunt aanvragen.
- In de app (alleen openbare Tick, niet bevestigd): een balk bovenaan met "Bevestig je e-mailadres om te kunnen delen"
  en "Mail opnieuw sturen" (`POST /api/account/verify`, met de grenzen van `reserveMail`).
- **E-mailadres wijzigen** in Instellingen › Account op een openbare Tick: het nieuwe adres is niet bevestigd tot je
  de nieuwe mail bevestigt. Bestaat het nieuwe adres al: zelfde foutmelding als bij een ongeldig adres mag niet
  (verraadt bestaan); de builder kiest een antwoord dat niets verraadt (bijv. altijd "bevestig via de mail" en de
  wijziging pas doorvoeren bij bevestigen).
- Een geslaagd wachtwoordherstel via de mail zet ook `email_verified_at`. Herkenbaar aan de link: `/forgot` maakt
  hem met `created_by = user_id` (`src/forgot.ts`); een resetlink die de beheerder maakt, heeft de beheerder als
  `created_by` en bevestigt niets.

### Onbevestigde accounts opruimen

- Een account op een openbare Tick dat 30 dagen na `created_at` nog niet bevestigd is, wordt verwijderd door de
  bestaande cron, met dezelfde code als "account verwijderen" (taken, bijlagen, sessies, enz.).
- De balk in de app noemt de datum: "Bevestig je e-mailadres vóór *datum*, anders wordt dit account verwijderd."
  Geen extra herinneringsmail (spaart mailtegoed).
- Een beheerder wordt nooit opgeruimd. Op een Tick zonder `OPEN_SIGNUP` gebeurt niets.
- Zonder mail ingesteld kan niemand bevestigen; dan ruimt Tick niets op (anders verdwijnt iedereen).

### Delen op een openbare Tick

- `GET /api/shares/people` geeft alleen mensen met wie je al een geaccepteerde gedeelde taak of lijst hebt (in beide
  richtingen). Op een Tick zonder `OPEN_SIGNUP` blijft het zoals nu.
- Ontvanger opgeven (`recipientOf` / `findRecipient` in `src/shares.ts`, en hetzelfde voor lijsten in
  `src/sharedlists.ts`): alleen een geldig e-mailadres of een id uit die beperkte lijst. Een naam → `400` met een
  melding "Typ het e-mailadres".
- Versturen kan alleen met een bevestigd adres (anders `403` met een sleutel die de app als "bevestig eerst je
  e-mailadres" toont).
- Het antwoord is **altijd hetzelfde** ("Uitnodiging verstuurd naar *adres*"), of het adres nu een bevestigd account
  heeft, een onbevestigd account, of geen account. Het werk na de controle hoort daarom niet meetbaar anders lang te
  duren; mailen gebeurt op de achtergrond.
  - Bevestigd account → gewone uitnodiging (bestaand gedrag, met pushmelding).
  - Geen of onbevestigd account → rij in `email_invites` en (binnen de grenzen) een uitnodigingsmail.
  - Eigen adres → zelfde nette fout als nu bij delen met jezelf (dat verraadt niets).
- Zodra een account met dat adres bevestigd wordt, worden zijn `email_invites` gewone uitnodigingen (`task_shares` /
  `list_members` met `status = 'pending'`) via dezelfde code die nu een share aanmaakt, en verdwijnen de rijen.
  Verlopen rijen ruimt de bestaande cron of de route zelf op.
- In het overzicht van wie een taak/lijst gedeeld heeft, ziet de deler op een openbare Tick elke **openstaande**
  uitnodiging als het getypte adres met "uitgenodigd", of er nu een account achter zit of niet (nu toont de code
  daar de accountnaam: `src/access.ts`, `listSharing` in `src/sharedlists.ts`). Na accepteren verschijnt de naam.
  Hij kan elke openstaande uitnodiging intrekken.
- Het antwoord van `POST /api/shares` en het delen van een lijst is op een openbare Tick voor elke ontvanger gelijk
  van vorm (geen `to_user`, geen id dat alleen bij een bestaand account bestaat).
- **Weigeren** door een ontvanger met account haalt de uitnodiging weg bij de deler; een uitnodiging aan een onbekend
  adres blijft 30 dagen staan. Dat kleine verschil accepteer ik (mijn keuze): accepteren verraadt het account toch al,
  en het lek is veel kleiner dan het lek bij aanmelden dat Dio accepteerde.

### Uitnodigingsmail

- Soort `invite_mail` in `mail_log`. Inhoud: "*Naam* wil een taak/lijst met je delen in Tick" (taak- of lijstnaam
  noemen mag, de deler koos die zelf), één zin wat Tick is, knop "Account aanmaken" naar `<origin>/signup`, en als
  `PLAY_STORE_URL` gevuld is: "Op Android: download Tick in Google Play" met die link. Onderaan: "Ken je deze persoon
  niet? Dan kun je deze mail negeren." Teksten en + nl; taal = taal van de deler (Tick bewaart geen taal per adres).
- Geen persoonlijke gegevens in de link (geen e-mailadres in de URL).

### Geen zichtbare beheerder

- Op een openbare Tick ziet een gewoon account geen teksten die naar "de beheerder" verwijzen. De builder zoekt die
  op in `public/i18n.js` (bijv. `err.admin_only`, `set.pw_rescue`) en in de app, en zorgt dat ze voor leden op een
  openbare Tick niet verschijnen of een neutrale variant krijgen.
- Instellingen › Accounts (lijst met alle accounts) blijft alleen voor de beheerder, zoals nu. Dio blijft beheerder.

## Misbruik

| Risico | Wat ertegen helpt |
|---|---|
| Veel nep-accounts | `LOGIN_LIMITER` per IP op `/signup`, daggrens op aanmeldingen voor heel Tick, melding aan de beheerder. |
| Uitproberen of een adres een account heeft | Aanmelden met een bestaand adres en delen met elk adres geven hetzelfde antwoord; mailen op de achtergrond. |
| Andermans adres kapen | Delen pas na bevestigen; uitnodigingen aan een adres alleen naar een bevestigd account; herstelmail bevestigt ook. |
| Spam via uitnodigingsmails | Alleen bevestigde accounts kunnen delen. Per deler hooguit een paar uitnodigingsmails per dag, per ontvangend adres hooguit één per dag (ook van verschillende delers), en alle uitnodigingsmails samen hooguit de helft van `MAIL_DAILY_LIMIT`. Builder kiest de getallen (voorstel: 5 per deler per dag). |
| Gratis Resend-tegoed op | Bestaande daggrens + de halve grens voor uitnodigingen. |

## Tests

In de stijl van de bestaande tests:

- `OPEN_SIGNUP` uit: geen aanmeldknop op `/login`, `/signup` en `/verify` geven 404, `/api/shares/people` toont alle
  accounts zoals nu, delen op naam werkt zoals nu.
- Aan: aanmelden maakt een onbevestigd account en logt in; bestaand adres → 409, geen account, geen login.
- Opruimen: onbevestigd account ouder dan 30 dagen verdwijnt; bevestigd, beheerder, of Tick zonder mail: niet.
- Bevestigen zet `email_verified_at` en zet `email_invites` om; ongeldige link → melding.
- Delen: onbevestigd → 403; naam → 400; bestaand en onbekend adres → identiek antwoord; onbekend adres → rij in
  `email_invites` en één (nagebootste) Resend-aanroep; grenzen per deler, per adres en de halve daggrens.
- `/api/shares/people` op een openbare Tick toont alleen mensen met wie je al deelt.
- Herstel via mail bevestigt het adres.
- i18n en+nl gelijk; `SHELL` en `CACHE` in `public/sw.js` bijgewerkt als er app-modules bijkomen.

## Docs

- `docs/`: een nieuwe pagina over aanmelden en bevestigen (met een rij in `docs/README.md`), en de pagina over delen
  bijgewerkt (op een openbare Tick deel je via e-mailadres; uitnodigingsmail).
- `SETUP.md`: `OPEN_SIGNUP`, `PLAY_STORE_URL`, `SIGNUP_DAILY_LIMIT`.
- `ARCHITECTURE.md`: openbare Tick, `email_invites`, bevestigen.
- `/privacy`: noemen dat een uitnodiging een mail naar het opgegeven adres stuurt, dat dat adres 30 dagen bewaard
  wordt als er geen account bij komt, en dat onbevestigde accounts na 30 dagen verdwijnen.

## Live zetten op app.ticktodo.nl

Resend staat daar al aan (wachtwoord kwijt). Claude zet `OPEN_SIGNUP` (en `PLAY_STORE_URL` als bekend) in
`C:\dev\ticktodo-app\wrangler.jsonc`, draait `npm run db:migrate` en `npm run deploy` (daar en voor Dio's eigen Tick),
controleert met `npx wrangler deployments list`, en test een echte aanmelding met `ik+test1@koprust.nl` en een
uitnodiging aan `ik+test2@koprust.nl`. Dio klikt de bevestigingsmail aan (Claude leest die mailbox niet). Daarna
worden beide testaccounts verwijderd.

## Aan de builder overgelaten

Exacte teksten (binnen de lijn hierboven), vormgeving van de pagina's en mails, namen van functies, hoe het omzetten
van `email_invites` precies de bestaande deel-code hergebruikt, en de exacte grenzen per deler.
