# Wachtwoord kwijt via e-mail — ontwerp

Datum: 2026-11-05. Besproken met Dio.

## Waarom

Mensen die Tick via Google Play gebruiken, zitten op `app.ticktodo.nl`, een Tick die Dio host. Ben je daar je
wachtwoord kwijt, dan kun je nu alleen Dio mailen. Dio moet dan een resetlink maken en die zelf doorsturen. Dat schaalt
niet en is omslachtig voor beide kanten. Tick moet de herstellink daarom zelf kunnen mailen. Dio heeft een gratis
Resend-account, en het domein `ticktodo.nl` is daar al geverifieerd (2026-11-05).

Voor een eigen Tick (op iemands eigen Cloudflare) werkt het nu al goed genoeg: de beheerder maakt een resetlink voor
een ander account, en een beheerder die zijn eigen wachtwoord kwijt is, valt terug op `LOGIN_PASSWORD` (SETUP.md).
Dat blijft zo.

## Doelen

1. Op de inlogpagina een link **"Wachtwoord vergeten?"**, maar alleen als mailen is ingesteld.
2. Een openbare pagina (`/forgot`) waar je je e-mailadres invult en een herstellink aanvraagt.
3. Tick mailt via Resend een eenmalige link naar de bestaande resetpagina `/reset/:code`. Die link is 1 uur geldig.
   Na het kiezen van een nieuw wachtwoord ben je ingelogd en zijn andere sessies uitgelogd (bestaand gedrag).
4. Misbruik wordt afgeremd (zie "Misbruik").
5. Als de daggrens bereikt is, krijgt de beheerder één pushmelding per dag.
6. De openbare pagina `/delete-account` verwijst bij "Kun je niet meer inloggen?" naar `/forgot`, als mailen aan staat.

## Niet-doelen

- Niets veranderen voor een Tick zonder Resend-sleutel: geen link, geen nieuwe pagina, alles werkt zoals nu.
- Geen andere mails (welkomstmail, e-mailadres bevestigen, meldingen per mail) in dit project. Die komen wel (zie
  "Aanvullingen van Dio"), dus het versturen is algemeen opgezet, maar we bouwen ze nu niet.
- Geen "ik ben geen robot"-controle (Turnstile). Komt alleen als er later echt misbruik is.
- Geen andere mailproviders dan Resend.

## Anti-doelen (dan is het mislukt, ook al werkt het)

- Het antwoord of de wachttijd verraadt of een e-mailadres een account heeft.
- Iemand kan andermans inbox volspammen met herstelmails.
- Iemand maakt het gratis Resend-tegoed op, zodat echte gebruikers hun mail niet meer krijgen.
- De Resend-sleutel komt in git, in een log of in de browser terecht.
- Een eigen Tick zonder Resend krijgt een link die niets doet.

## Besluiten (van Dio)

- Alleen bedoeld voor `app.ticktodo.nl` (Play-gebruikers). Een eigen Tick blijft zoals hij is.
- Afzender op `ticktodo.nl` (geverifieerd in Resend, regio eu-west-1).
- Gratis Resend-abonnement (100 mails per dag). **Daggrens voor heel Tick: 50 herstelmails**, instelbaar.
- Bij het bereiken van de grens: **één pushmelding aan de beheerder per dag**. Geen eerdere waarschuwing (bijv. bij
  40).
- **Geen herstelmail voor beheerders** (`role = 'admin'`). Zij hebben de noodroute via `LOGIN_PASSWORD` (SETUP.md);
  een gemaild wachtwoord zou die route ook voorgoed uitzetten (`passwordOk` in `src/auth.ts` valt alleen terug op
  `LOGIN_PASSWORD` zolang er geen hash is). Vult iemand een beheerdersadres in, dan volgt hetzelfde antwoord en gaat
  er geen mail uit. De docs zeggen dat dit alleen voor gewone accounts werkt.

## Aanvullingen van Dio (bij goedkeuring, 2026-11-05)

1. **Twee Ticks.** Er komt een tweede Tick op `app.ticktodo.nl` (Worker `ticktodo-app`, de Play-versie), waar mensen
   straks zelf een account aanmaken. Dio's eigen Tick (`tick.detussenpartij.nl`) blijft bestaan. Beide draaien
   dezelfde code. Het versturen van mail moet daarom **algemeen bruikbaar** zijn voor latere mails, zoals "bevestig je
   e-mailadres" bij aanmelden. Afzender op `app.ticktodo.nl`: een adres op `ticktodo.nl`.
2. **De Resend-sleutel komt op beide Ticks** (`RESEND_API_KEY` als secret op Worker `tick` én op `ticktodo-app`),
   elk met een eigen `MAIL_FROM` op `ticktodo.nl`. De stappen voor Dio dekken dus beide Workers.
3. **Werken buiten de K:-map.** Bouwen gebeurt in een eigen worktree (`C:\dev\tick-wachtwoord`, branch
   `wachtwoord-kwijt`). HEAD in `K:\Google Drive\Git\tick` blijft op afgemaakt werk staan, want een Stop-hook zet die
   HEAD na elke beurt live.

Gevolg voor het ontwerp van `src/mail.ts` (mijn invulling van punt 1):

- `sendMail(env, { to, subject, text, html })` is het enige wat met Resend praat; het weet niets van wachtwoorden.
- Een kleine opmaakhulp, bijv. `mailLayout(lang, { heading, intro, button: { label, url }, outro })`, die de tekst- en
  HTML-versie maakt. De herstelmail gebruikt die; een bevestigingsmail later ook.
- `mail_log.kind` is vrij tekst ('reset', later bijv. 'verify'). De daggrens geldt voor **alle** soorten mail samen
  (behalve `cap_notice`), want het Resend-tegoed is gedeeld. De grens per account geldt per soort.
- `mailEnabled(env)` en de daggrens zitten in `src/mail.ts`, zodat elke latere mail ze ook gebruikt.
- De pushmelding bij de daggrens zegt dus "mails", niet "herstelmails".

## Hoe het werkt

### Instellingen

- **Geheim** `RESEND_API_KEY` (via `npx wrangler secret put RESEND_API_KEY`, nooit in `wrangler.jsonc`). Optioneel in
  `Env`.
- **Var** `MAIL_FROM`, bijv. `"Tick <noreply@ticktodo.nl>"`. Optioneel in `Env`. In `wrangler.example.jsonc` als
  uitgecommentarieerde regel met uitleg, net als `MAX_UPLOAD_MB`.
- **Var** `MAIL_DAILY_LIMIT` (optioneel, standaard `50`, minimaal 1). Ook als commentaar in het voorbeeld.
- Mailen staat **aan** als zowel `RESEND_API_KEY` als `MAIL_FROM` gevuld zijn. Eén functie, bijv.
  `mailEnabled(env)`, beslist dit, en alles (link, pagina, route, `/delete-account`) gebruikt die.
- SETUP.md krijgt een kort optioneel stuk "Wachtwoord kwijt per e-mail (optioneel)": Resend-account, domein
  verifiëren, sleutel als secret, `MAIL_FROM` invullen.

### Mail versturen

- Nieuwe module `src/mail.ts` met `sendMail(env, { to, subject, text, html })`, die `POST
  https://api.resend.com/emails` aanroept met `Authorization: Bearer <RESEND_API_KEY>`. Geen npm-pakket nodig, gewoon
  `fetch`. Mislukt het (geen 2xx of netwerkfout), dan wordt dat gelogd (zonder sleutel en zonder het e-mailadres
  volledig te loggen) en gaat de route gewoon door.
- De mail heeft een tekstversie én een eenvoudige HTML-versie (alleen inline-opmaak, geen plaatjes): kop "Tick", één
  zin uitleg, een knop "Nieuw wachtwoord kiezen", de link nog eens uitgeschreven, en "Heb je dit niet aangevraagd? Dan
  kun je deze mail negeren. De link werkt een uur." Alle teksten via `public/i18n.js` (en + nl). Onderwerp bijv.
  "Je Tick-wachtwoord herstellen".
- **Taal van de mail** (mijn keuze): de taal van het verzoek (`c.get('lang')`, dus de taal van de pagina die de
  persoon zag). Tick bewaart geen taal per account.
- **Adres van de link** (mijn keuze): de origin van het verzoek (`new URL(c.req.url).origin`) + `/reset/<code>`.

### Pagina en route

- `GET /forgot` (openbaar, vóór de auth-middleware, zoals `/delete-account`): een formulier met één e-mailveld en de
  knop "Stuur herstellink", in de stijl van de inlogpagina (`public/login.css`). Script in een nieuw bestand
  `public/forgot.js` (geen inline script vanwege de CSP); dat bestand komt in `loginAssets`. Staat mailen uit, dan
  `404`.
- `POST /forgot` met JSON `{ email }`:
  1. Mailen uit → `404`.
  2. Rem per IP: `LOGIN_LIMITER` met sleutel `forgot:<ip>` → bij overschrijding `429 err.too_many_attempts`. (Dit
     verraadt niets over het adres.)
  3. E-mailadres ongeldig (`cleanEmail`) → `400` met de bestaande foutsleutel.
  4. Daarna **altijd** `200 { ok: true }`, ongeacht of het adres bestaat. Het opzoeken en versturen gebeurt **op de
     achtergrond** (`executionCtx.waitUntil`, het bestaande `inBackground`), zodat de antwoordtijd niets verraadt.
- Op de achtergrond:
  1. Account zoeken op e-mail (`users.email`, NOCASE), alleen `role = 'member'`. Geen account of een beheerder →
     stoppen.
  2. Grens per account: is er voor dit account in de laatste 5 minuten al een herstelmail verstuurd, of in de laatste
     24 uur al 5 → stoppen.
  3. Daggrens voor heel Tick: zijn er vandaag (UTC-dag) al `MAIL_DAILY_LIMIT` mails verstuurd → stoppen, en de
     beheerder een melding sturen als dat vandaag nog niet gebeurd is (zie hieronder).
  4. `createLink(db, 'reset', <user id>, <user id>)` (bestaande functie in `src/links.ts`; `created_by` is het account
     zelf, mijn keuze) en de mail versturen.
  5. De verzending vastleggen (alleen als Resend 2xx gaf, mijn keuze: een mislukte mail telt niet mee voor de
     grenzen).
- Het formulier toont na verzenden altijd dezelfde tekst: "Als dit adres bij Tick bekend is, staat er nu een mail in
  je inbox. Kijk ook in je spam." Plus een link terug naar inloggen.

### Bijhouden van verzonden mails

Nieuwe migratie `0019_mail_log.sql` met een tabel `mail_log`:
`id TEXT PRIMARY KEY, kind TEXT NOT NULL ('reset' of 'cap_notice'), user_id TEXT (NULL bij cap_notice), sent_at TEXT
NOT NULL` en een index op `(kind, sent_at)` en `(user_id, sent_at)`. Rijen ouder dan 2 dagen ruimt de bestaande
minuut-cron op (of de route zelf vóór het tellen, mijn keuze: de route, net als `createLink` dat doet). `cap_notice`
legt vast dat de beheerder vandaag al gewaarschuwd is. Bij het verwijderen van een account worden de rijen van dat
account meegewist (`deleteUserStmts`).

### Melding aan de beheerder

Via de bestaande `notifyUser(env, ADMIN_ID, …)` (push, met de webhook als terugval). Tekst (en + nl), bijv.: "Tick
heeft vandaag de grens van 50 mails bereikt. Tot morgen gaan er geen mails meer uit." Hooguit één keer
per UTC-dag.

### Inlogpagina en `/delete-account`

- `loginPage` krijgt een extra parameter `forgot: boolean`. Is die waar, dan staat onder het formulier een link
  "Wachtwoord vergeten?" naar `/forgot`.
- `deleteAccountPage`: als mailen aan staat, zegt het stuk "Kun je niet meer inloggen?" eerst dat je via
  "Wachtwoord vergeten?" (`/forgot`) een nieuw wachtwoord kunt kiezen en dan zelf je account kunt verwijderen. Het
  contactadres blijft daarna staan. Nieuwe i18n-sleutel(s) naast `del.no_login*`.

## Misbruik

| Risico | Wat ertegen helpt |
|---|---|
| Inbox van iemand volspammen | Per account hooguit 1 mail per 5 minuten en 5 per 24 uur. Adressen zonder account krijgen nooit mail. |
| Veel aanvragen vanaf één netwerk | `LOGIN_LIMITER` per IP (5 per minuut). |
| Gratis tegoed opmaken vanaf veel netwerken | Daggrens voor heel Tick (`MAIL_DAILY_LIMIT`, standaard 50), plus melding aan de beheerder. |
| Uitproberen of een adres bestaat | Altijd hetzelfde antwoord, werk op de achtergrond. |
| Link raden | Bestaand: lange willekeurige code, alleen de hash in de database, 1 uur geldig, eenmalig, IP-rem op `/reset`. |

## Tests

In de stijl van de bestaande tests (vitest met de Workers-pool):

- Zonder `RESEND_API_KEY`/`MAIL_FROM`: geen link op de inlogpagina, `/forgot` geeft 404.
- Met instellingen (fetch naar Resend nagebootst): bekend adres → één aanroep naar Resend met een geldige
  `/reset/`-link; de link werkt op `POST /reset/:code`.
- Onbekend adres → hetzelfde antwoord, geen aanroep naar Resend. Idem voor het adres van een beheerder.
- Grens per account (tweede aanvraag binnen 5 minuten: geen mail) en daggrens (bij de grens: geen mail, één melding
  aan de beheerder, ook bij een volgende aanvraag niet nog een).
- i18n: en en nl hebben dezelfde sleutels (bestaande test).
- `/delete-account` verwijst naar `/forgot` alleen als mailen aan staat.
- `public/forgot.js` staat in `SHELL` als dat nodig is (`test/offline.test.ts`) — mijn inschatting: de loginpagina's
  zitten niet in de service worker, dan hoeft het niet; de builder controleert dat.

## Docs

- `docs/` (gebruikershandleiding, Engels): bij inloggen/accounts uitleg over "Forgot password?" en dat het alleen
  verschijnt als de beheerder mail heeft ingesteld. `docs/sharing.md` (stuk over resetlinks) krijgt een verwijzing.
- `SETUP.md`: het optionele stuk over Resend en de drie instellingen.
- `ARCHITECTURE.md`: `src/mail.ts`, de tabel `mail_log` en het achtergrondwerk.

## Live zetten (beide Ticks)

1. De code gaat naar `main` en live op Dio's eigen Tick (`tick`). Zonder sleutel staat mailen daar nog uit, dus er
   verandert dan niets zichtbaars.
2. Dio maakt in Resend een API-sleutel met alleen verzendrecht ("Sending access") voor `ticktodo.nl`.
3. Dio zet die zelf als secret op beide Workers (`npx wrangler secret put RESEND_API_KEY --name tick` en
   `--name ticktodo-app`, de sleutel plakken). Claude typt of ziet de sleutel niet.
4. Claude zet `MAIL_FROM` in de lokale `wrangler.jsonc` van beide Ticks (bijv. `Tick <noreply@ticktodo.nl>`), draait
   per Tick `npm run db:migrate` en `npm run deploy`, en controleert met `npx wrangler deployments list`. De
   `ticktodo-app`-Tick krijgt de code via `main`, net als de privacypagina; als die Tick nog niet live staat, gebeurt
   dit daar zodra hij live gaat.
5. Eén echte test op Dio's eigen Tick: een herstellink aanvragen voor een gewoon (niet-beheerder) testaccount.

## Keuzes na de ontwerpcontrole (mijn keuzes)

- `/forgot` en `public/forgot.js` horen niet in `SHELL`: `public/sw.js` vangt alleen navigatie naar `/` af. Geen
  `CACHE`-bump nodig.
- Gelijktijdige aanvragen: vóór het versturen een `mail_log`-rij reserveren en die weer wissen als Resend faalt. Zo
  glippen parallelle aanvragen niet langs de grens per account, en telt een mislukte mail toch niet mee.
- De daggrens telt alle soorten mail samen behalve `cap_notice` (zie "Aanvullingen van Dio": het Resend-tegoed is gedeeld).
- Eerdere ongebruikte resetlinks blijven geldig tot ze verlopen (zoals `createLink` nu werkt).

## Aan de builder overgelaten

Exacte teksten (binnen de lijn hierboven), de vormgeving van de HTML-mail, de naam en vorm van hulpfuncties, en of het
tellen in één SQL-query gaat.
