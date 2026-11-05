# Wachtwoord kwijt via e-mail — bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een gewoon account kan via `/forgot` een eenmalige herstellink per e-mail (Resend) krijgen. Het versturen is algemeen opgezet, zodat er later ook andere mails bij kunnen.

**Architecture:** `src/mail.ts` is het enige wat met Resend praat. Het bevat ook de aan/uit-check, de opmaak en de grenzen (tabel `mail_log`). `src/forgot.ts` levert de openbare pagina en route. Die zoekt het account op de achtergrond op (`waitUntil`) en hergebruikt `createLink(…'reset'…)` en de bestaande pagina `/reset/:code`.

**Tech Stack:** Cloudflare Workers + Hono + D1, vitest met `@cloudflare/vitest-plugin`, geen nieuwe npm-pakketten.

**Spec:** `docs/superpowers/specs/2026-11-05-wachtwoord-kwijt-design.md`

## Global Constraints

- Werk alleen in `C:\dev\tick-wachtwoord` (branch `wachtwoord-kwijt`). Maak geen commits in `K:\Google Drive\Git\tick`.
- Elke zichtbare tekst gaat via `public/i18n.js`, met een `en`- én een `nl`-waarde. Serverfouten zijn `HttpError(status, key)`.
- Geen inline scripts of styles (CSP). Het script voor `/forgot` komt in `public/forgot.js` en staat in `loginAssets`.
- Een schemawijziging komt in een nieuwe migratie: `migrations/0019_mail_log.sql`.
- Instellingen staan in `Env`: `RESEND_API_KEY?` (secret), `MAIL_FROM?`, `MAIL_DAILY_LIMIT?` (standaard 50, minimaal 1). In `wrangler.example.jsonc` komen ze als uitgecommentarieerde regels met uitleg.
- Mailen staat aan als `RESEND_API_KEY` en `MAIL_FROM` allebei niet leeg zijn. Staat het uit, dan is er geen link, geeft `/forgot` een 404 en verandert er niets.
- Grenzen: per IP `LOGIN_LIMITER` met sleutel `forgot:<ip>`. Per account en per soort hooguit 1 mail per 5 minuten en 5 per 24 uur. Voor heel Tick `MAIL_DAILY_LIMIT` per UTC-dag, voor alle soorten samen behalve `cap_notice`.
- Beheerders (`role = 'admin'`) krijgen nooit een herstelmail.
- Het antwoord van `POST /forgot` is voor elk geldig adres gelijk: `200 {"ok":true}`. Al het werk gebeurt op de achtergrond.
- De sleutel komt nooit in een log of antwoord terecht.
- `npm run typecheck` en `npm test` moeten slagen.

## Review Focus

1. **Hoofdletters of spaties in het adres** (`" Sanne@Example.test "`): het account moet toch gevonden worden. `cleanEmail` trimt en de kolom is NOCASE. Test in Taak 2.
2. **Twee aanvragen tegelijk voor hetzelfde account**: er mag maar één mail uitgaan. Dat lukt door een rij te reserveren vóór het versturen. Test in Taak 1.
3. **Resend geeft een fout (bijv. 422 of 500)**: het antwoord blijft `200`, er komt niets in het log behalve de status, en de mail telt niet mee. Test in Taak 1.
4. **Een verwijderd account met rijen in `mail_log`**: `deleteUserStmts` wist die rijen ook, anders loopt een foreign key vast. Test in Taak 1.
5. **Een aanvraag precies op de daggrens**: mail nummer 50 gaat nog uit, nummer 51 niet. Bij 51 gaat er één melding naar de beheerder, en bij 52 niet opnieuw. Test in Taak 2.

---

### Task 1: Mailmodule, tabel en instellingen

**Files:**
- Create: `migrations/0019_mail_log.sql`, `src/mail.ts`, `test/mail.test.ts`
- Modify: `src/index.ts` (`Env`), `wrangler.example.jsonc` (vars-commentaar), `src/users.ts` (`deleteUserStmts`)

**Interfaces — Produces:**
- `mailEnabled(env: Env): boolean`
- `dailyLimit(env: Env): number` — `MAIL_DAILY_LIMIT` als geheel getal ≥ 1, anders 50.
- `sendMail(env: Env, m: { to: string; subject: string; text: string; html: string }): Promise<boolean>` — POST `https://api.resend.com/emails` met `{ from: env.MAIL_FROM, to: [m.to], subject, text, html }` en `Authorization: Bearer <RESEND_API_KEY>`. Bij 2xx `true`. Bij een andere status of een netwerkfout `console.error('mail: resend <status>')` (zonder adres of sleutel) en `false`.
- `mailLayout(lang: Locale, p: { heading: string; intro: string; button: { label: string; url: string }; outro: string }): { text: string; html: string }` — HTML met alleen inline-opmaak en ge-escapete tekst; de URL komt in de tekstversie voluit.
- `reserveMail(db: D1Database, env: Env, kind: string, userId: string, now?: number): Promise<{ id: string } | 'account_limit' | 'daily_limit'>` — telt en voegt de rij in één `db.batch` toe (INSERT … SELECT … WHERE de grenzen niet bereikt zijn), zodat twee gelijktijdige aanvragen niet allebei slagen. Gaat eerst `'account_limit'` na, dan `'daily_limit'`. Ruimt rijen ouder dan 2 dagen op.
- `releaseMail(db: D1Database, id: string): Promise<void>` — wist de gereserveerde rij (na een mislukte verzending).
- `claimCapNotice(db: D1Database, now?: number): Promise<boolean>` — `true` alleen bij de eerste aanroep op een UTC-dag (voegt de rij `cap_notice` toe).

Migratie `0019_mail_log.sql`:
```sql
CREATE TABLE mail_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  sent_at TEXT NOT NULL
);
CREATE INDEX mail_log_kind_sent ON mail_log (kind, sent_at);
CREATE INDEX mail_log_user_sent ON mail_log (user_id, sent_at);
```

- [ ] **Step 1: Write the failing tests** in `test/mail.test.ts`:
  - `mailEnabled`: `false` zonder sleutel of zonder `MAIL_FROM`, en `true` met beide.
  - `dailyLimit`: `undefined` geeft 50, `'10'` geeft 10, `'0'` en `'x'` geven 50.
  - `sendMail` met een `fetch`-spy (status 200): de URL is `https://api.resend.com/emails`, de header is `Bearer test-resend`, de body heeft `to: ['a@example.test']`, en het resultaat is `true`. Met status 422 is het resultaat `false`, en de `console.error`-spy heeft geen aanroep die `test-resend` of `a@example.test` bevat.
  - `mailLayout('nl', { …, button: { label: 'Klik', url: 'https://tick.test/reset/abc' } })`: `text` bevat de URL, `html` bevat `href="https://tick.test/reset/abc"`, en `<script>` in `intro` wordt ge-escaped.
  - `reserveMail`: de eerste keer lukt het, een tweede keer binnen 5 minuten geeft `'account_limit'`, en op `now + 6 min` lukt het weer. De zesde binnen 24 uur geeft `'account_limit'`.
  - Daggrens: met `MAIL_DAILY_LIMIT: '2'` en drie verschillende accounts geeft de derde `'daily_limit'`. Rijen van de vorige UTC-dag tellen niet mee.
  - `Promise.all` van twee `reserveMail` voor hetzelfde account: precies één `{ id }`.
  - `releaseMail` maakt de plek weer vrij.
  - `claimCapNotice`: `true`, dan `false` op dezelfde dag, en `true` de volgende dag.
  - Een account met `mail_log`-rijen verwijderen (`DELETE /api/users/:id` als beheerder) geeft 2xx.
- [ ] **Step 2:** Run `npx vitest run test/mail.test.ts`. Verwacht: FAIL (module bestaat niet).
- [ ] **Step 3:** Maak de migratie, `src/mail.ts`, de `Env`-velden (met JSDoc in het Nederlands, zoals de andere) en de voorbeeldconfig. Voeg `db.prepare('DELETE FROM mail_log WHERE user_id = ?').bind(id)` toe aan `deleteUserStmts`, vóór `DELETE FROM users`.
- [ ] **Step 4:** Run `npx vitest run test/mail.test.ts` en `npm run typecheck`. Verwacht: PASS.
- [ ] **Step 5:** Commit: `Mail: Resend-module, mail_log en instellingen`.

### Task 2: Pagina en route `/forgot`, link op de inlogpagina, melding bij de daggrens

**Files:**
- Create: `src/forgot.ts`, `public/forgot.js`, `test/forgot.test.ts`
- Modify: `src/index.ts` (mounten naast `linkPages`, `loginPage`-aanroep), `src/login.ts` (`loginPage(…, forgot = false)`, nieuwe `forgotPage`, `loginAssets`), `public/i18n.js`, `public/login.css` (alleen als de link opmaak nodig heeft)

**Interfaces:**
- Consumes: alles uit Taak 1; `createLink(db, 'reset', createdBy, userId)` uit `src/links.ts`; `cleanEmail` uit `src/account.ts`; `notifyUser`, `inBackground` uit `src/push.ts`; `ADMIN_ID` uit `src/users.ts`.
- Produces: `forgotPages: Hono<AppEnv>` (GET en POST `/forgot`); `forgotPage(locale: string | undefined): string`; `loginPage(locale, emptyEmailHint = false, deleted = false, forgot = false)`; `sendResetMail(env: Env, email: string, origin: string, lang: Locale): Promise<void>` (het achtergrondwerk, los te testen).

Gedrag van `sendResetMail`: lid opzoeken (`role = 'member'`). Geen lid → stoppen. Dan `reserveMail(…'reset'…)`. Bij `'account_limit'` → stoppen. Bij `'daily_limit'` → `claimCapNotice` en, als die `true` geeft, `notifyUser(env, ADMIN_ID, …)` met de sleutels `mail.cap_title`/`mail.cap_body` (met `{limit}`), daarna stoppen. Anders `createLink(db, 'reset', user.id, user.id)`, een mail via `mailLayout` naar `${origin}/reset/${code}`, en bij `false` `releaseMail`.

i18n (en + nl), nieuwe sleutels: `login.forgot`, `forgot.title`, `forgot.intro`, `forgot.submit`, `forgot.sent` ("Als dit adres bij Tick bekend is, staat er nu een mail in je inbox. Kijk ook in je spam."), `forgot.back`, `mail.reset_subject`, `mail.reset_heading`, `mail.reset_intro`, `mail.reset_button`, `mail.reset_outro` ("Heb je dit niet aangevraagd? Dan kun je deze mail negeren. De link werkt een uur."), `mail.cap_title`, `mail.cap_body`.

`public/forgot.js`: verstuurt `{ email }` als JSON naar `/forgot`. Bij `ok` vervangt het het formulier door de tekst `forgot.sent` (uit `data-sent` op `<body>`, in de taal van de pagina). Anders toont het `error` uit het antwoord in `#err`, net als `login.js`.

- [ ] **Step 1: Write the failing tests** in `test/forgot.test.ts`. Gebruik `worker.fetch(req, mailEnv, ctx)` met `createExecutionContext`/`waitOnExecutionContext` uit `cloudflare:test`, waarbij `mailEnv = { ...env, RESEND_API_KEY: 'test-resend', MAIL_FROM: 'Tick <noreply@ticktodo.nl>' }`. Zet een `fetch`-spy op Resend (status 200).
  - Zonder mail-env: `/login` bevat geen `href="/forgot"`, en `GET /forgot` en `POST /forgot` geven 404.
  - Met mail-env: `/login` bevat `href="/forgot"`, en `GET /forgot` geeft 200 met `translate('nl','forgot.title')` bij `accept-language: nl`.
  - Een bekend lid, ingevuld als `" " + email.toUpperCase() + " "`: `200 {ok:true}`, precies één Resend-aanroep, en het `text`-veld bevat `https://tick.test/reset/`. Die link werkt: `POST` naar dat pad met `{ password: 'nieuw12345' }` geeft 200.
  - Een onbekend adres en het adres van de beheerder: `200 {ok:true}` en geen Resend-aanroep.
  - `email: 'geen-adres'` geeft 400.
  - Een tweede aanvraag voor hetzelfde lid binnen 5 minuten: 200, maar geen tweede Resend-aanroep.
  - Daggrens met `MAIL_DAILY_LIMIT: '1'` en twee leden: de tweede krijgt geen mail, en `notifyUser` gaat één keer naar de beheerder. Controleer via een fallback-webhook of via de `mail_log`-rij `cap_notice`. Bij een derde aanvraag gaat er geen tweede melding uit.
  - Resend geeft 500: het antwoord is 200, en direct daarna lukt een nieuwe aanvraag wel (de plek is vrijgegeven).
  - Rem per IP: `untilRateLimited` op `POST /forgot` vanaf één IP eindigt in 429.
  - De mail volgt de taal van het verzoek: bij `accept-language: nl` bevat het onderwerp `translate('nl','mail.reset_subject')`.
- [ ] **Step 2:** Run `npx vitest run test/forgot.test.ts`. Verwacht: FAIL.
- [ ] **Step 3:** Bouw `src/forgot.ts`, `forgotPage`, de `loginPage`-parameter (in `src/index.ts`: `mailEnabled(c.env)`), `public/forgot.js`, de i18n-sleutels en `loginAssets`. Mount `forgotPages` vóór de auth-middleware, naast `linkPages`.
- [ ] **Step 4:** Run `npx vitest run test/forgot.test.ts test/i18n.test.ts test/offline.test.ts test/links.test.ts` en `npm run typecheck`. Verwacht: PASS.
- [ ] **Step 5:** Commit: `Wachtwoord kwijt: pagina en route /forgot met herstelmail`.

### Task 3: `/delete-account` verwijst naar `/forgot`

**Files:**
- Modify: `src/login.ts` (`deleteAccountPage(locale, contact, forgot = false)`), `src/index.ts` (aanroep met `mailEnabled(c.env)`), `public/i18n.js` (`del.no_login_forgot`), de bestaande test voor `/delete-account` (`test/account-verwijderen.test.ts`)

- [ ] **Step 1: Failing test:** `deleteAccountPage('nl', null, true)` bevat `href="/forgot"` en `translate('nl','del.no_login_forgot')`. Met `false` staat er geen `/forgot` in. De bestaande zinnen over het contactadres blijven in beide gevallen.
- [ ] **Step 2:** Run de test. Verwacht: FAIL.
- [ ] **Step 3:** Zet de `del.no_login_forgot`-alinea vóór de bestaande `noLogin`-alinea, alleen als `forgot` waar is. Tekst (nl): "Wachtwoord vergeten? Kies via <a href="/forgot">Wachtwoord vergeten</a> een nieuw wachtwoord en verwijder je account daarna zelf."
- [ ] **Step 4:** Run de test en de i18n-test. Verwacht: PASS.
- [ ] **Step 5:** Commit: `Account verwijderen: openbare pagina verwijst naar Wachtwoord vergeten`.

### Task 4: Docs

**Files:** `SETUP.md`, `docs/sharing.md` (stuk over accounts en resetlinks), `docs/settings.md` als daar inloggen staat, `ARCHITECTURE.md`, `docs/README.md` (alleen als er een nieuwe pagina komt; mijn keuze: geen nieuwe pagina)

- [ ] **Step 1:** In `SETUP.md` komt een optioneel stuk "Password reset by email (optional)": een Resend-account, een domein verifiëren, `npx wrangler secret put RESEND_API_KEY`, en `MAIL_FROM`/`MAIL_DAILY_LIMIT` in `wrangler.jsonc`. Erbij: beheerders gebruiken nog steeds `LOGIN_PASSWORD`, en een gratis Resend-account kan 100 mails per dag versturen.
- [ ] **Step 2:** In `docs/sharing.md` komt bij "Forgot a password?": als de beheerder e-mail heeft ingesteld, staat er "Forgot password?" op de inlogpagina (alleen voor gewone accounts).
- [ ] **Step 3:** In `ARCHITECTURE.md` komen `src/mail.ts`, `src/forgot.ts`, `mail_log` en het achtergrondwerk.
- [ ] **Step 4:** Commit: `Docs: wachtwoord kwijt per e-mail`.

### Afronden (geen eigen taak, wel verplicht)

- `npm run typecheck` en `npm test` in `C:\dev\tick-wachtwoord`: alles groen.
- Controle in de browser met `npm run dev` en een `.dev.vars` met een nep-sleutel. Bekijk de inlogpagina met de link, `/forgot` in nl en en, de melding na verzenden, en `/delete-account`. De verzending naar Resend mislukt dan lokaal, en dat mag.
- Review van de hele branch. Daarna samenvoegen in `main` (in K: alleen een fast-forward of merge van afgemaakt werk), pushen, en live zetten volgens "Live zetten" in het ontwerp.
