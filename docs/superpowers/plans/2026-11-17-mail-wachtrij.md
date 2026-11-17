# Mail-wachtrij, Telegram-meldingen en maildienst-schakelaar — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Doel:** geen mail van Tick verdwijnt meer stil: elke mail gaat via een wachtrij in D1, de eigenaar krijgt een Telegram-bericht zodra het knelt, de vaste daggrenzen gaan eruit en de maildienst is om te schakelen van Resend naar Cloudflare Email Service.

**Aanpak:** `sendMail` wordt een keten van maildiensten (`MAIL_PROVIDERS`). Alle mailsoorten zetten een rij in `mail_queue` met alleen een verwijzing (soort, account, uitnodiging/melding); de mail zelf (adres, link, tekst) wordt pas gemaakt bij het versturen. Direct na het in de rij zetten volgt één poging op de achtergrond; de cron (elke minuut) probeert de rest opnieuw.

**Techniek:** Cloudflare Worker (Hono, TypeScript), D1, vitest met `cloudflare:test`, Telegram Bot API via `fetch`.

**Spec:** de besluiten hieronder (uit het gesprek met Dio op 2026-11-17).

## Besluiten (spec)

1. Elke mail (bevestigen, wachtwoord vergeten, uitnodiging, melding aan beheerder) gaat via de wachtrij. Een mail die niet weg kan, blijft staan tot hij wel weg kan. Alleen een blijvende fout (adres bestaat niet, account weg) haalt hem uit de rij, en dan krijgt de eigenaar een bericht.
2. Herstelmails die lang wachtten gaan gewoon weg, met een verse link (link maken bij het versturen).
3. Weg: de daggrens voor alle mail samen (`MAIL_DAILY_LIMIT`, 50), de verdeling per soort (`dailyShare`) en de aanmeldgrens (`SIGNUP_DAILY_LIMIT`, 100, `err.signup_full`). **Blijven:** grenzen per account, per ontvangend adres en per IP-adres (`LOGIN_LIMITER`).
4. Telegram aan de eigenaar (`TELEGRAM_BOT_TOKEN` secret, `TELEGRAM_CHAT_ID` var) bij: een fout van de maildienst (hooguit 1 per uur, met het aantal wachtende mails), een mail die definitief niet kan, het aantal verstuurde mails vandaag bereikt `MAIL_WARN_AT` (standaard 70, 1× per dag), elke 100 aanmeldingen op een dag. Zonder Telegram-instellingen: een pushmelding aan de beheerder (zoals nu).
5. Gebruikerstekst, alleen als er mails wachten (een wachtende rij met minstens één mislukte poging):
   - nl: "Door onverwacht grote interesse in Tick kan het even duren voordat de mail aankomt."
   - en: "Because of unexpectedly high interest in Tick, it may take a while for the email to arrive."
6. `MAIL_PROVIDERS`: `resend` (standaard), `cloudflare`, of een lijst met komma (`cloudflare,resend`): de volgende dienst vangt de vorige op. Cloudflare via de `send_email`-binding `EMAIL`. Nu blijft app.ticktodo.nl op `resend`.

## Algemene regels

- Elke zichtbare tekst in `public/i18n.js`, `en` én `nl`; Telegram-teksten ook (taal: `defaultLocale` van de installatie).
- Nieuwe migratie `migrations/0031_mail_wachtrij.sql`; bestaande migraties niet aanraken.
- Geen e-mailadres, sleutel of token in logs, in `mail_queue` of in Telegram-berichten.
- Nieuwe instelling → `wrangler.example.jsonc` (met uitleg), `Env` in `src/index.ts`, `SETUP.md`.
- Draaien alleen in de kopie `C:\dev\tick`: `npm run typecheck` en `npm test` moeten slagen.
- Nooit half werk op HEAD (de Stop-hook zet HEAD live).

## Review Focus

1. **Twee keer verstuurd:** de directe poging en de cron pakken dezelfde rij tegelijk → er mag maar één mail uit. Test in Task 3.
2. **Account weg of adres gewijzigd terwijl de mail wacht:** account weg → rij weg zonder fout; ander adres → mail naar het nieuwe adres (gemaakt bij versturen). Test in Task 3.
3. **Uren 429 van de maildienst:** geen stortvloed aan Telegram-berichten (hooguit 1 per uur) en geen eindeloze pogingen per minuut (wachttijd groeit tot 60 minuten). Test in Task 3 en 5.
4. **Grote wachtrij na viral gaan:** de cron verstuurt hooguit 50 per minuut, oudste eerst, zodat één run niet vastloopt en Resend niet per seconde overspoeld wordt. Test in Task 3.
5. **Zelf hosten zonder Telegram en zonder Cloudflare-binding:** alles werkt als nu met alleen Resend; `MAIL_PROVIDERS=cloudflare` zonder binding → mail staat uit (`mailEnabled` false), geen crash. Test in Task 2 en 5.

---

### Task 1: Tabel `mail_queue`

**Bestanden:**
- Maak: `migrations/0031_mail_wachtrij.sql`
- Test: `test/migratie-mailwachtrij.test.ts` (zelfde opzet als `test/migratie-melden.test.ts`)

**Levert:** tabel
```sql
CREATE TABLE mail_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- 'verify' | 'reset' | 'invite' | 'report'
  user_id TEXT,                  -- account waar de mail over gaat (verify/reset: ontvanger; invite: deler; report: melder)
  ref TEXT,                      -- invite: email_invites.id; report: reports.id; anders NULL
  lang TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_try_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status TEXT               -- '429', '500', 'network' …; nooit een adres
);
CREATE INDEX mail_queue_next ON mail_queue (next_try_at);
```

- [ ] Test schrijven: na de migraties bestaat `mail_queue` met deze kolommen en de index.
- [ ] Test faalt; migratie schrijven; test slaagt.
- [ ] Commit `Mail: tabel voor de wachtrij`.

### Task 2: Maildiensten en de schakelaar

**Bestanden:**
- Wijzig: `src/mail.ts`, `src/index.ts` (`Env`), `wrangler.example.jsonc`
- Test: `test/mail.test.ts`

**Levert:**
- `type SendResult = { ok: true; via: 'resend' | 'cloudflare' } | { ok: false; retry: boolean; status: string }`
- `mailProviders(env: Env): ('resend' | 'cloudflare')[]` — uit `MAIL_PROVIDERS` (komma, spaties weg, onbekend weg, dubbel weg; leeg → `['resend']`), daarna alleen diensten die ingesteld zijn: resend = `RESEND_API_KEY` + `MAIL_FROM`; cloudflare = `env.EMAIL` + `MAIL_FROM`.
- `mailEnabled(env)` = `mailProviders(env).length > 0`.
- `sendMail(env, m: Mail): Promise<SendResult>` — probeert de diensten op volgorde; de eerste `ok` wint. Resend: 2xx → ok; 429 en 5xx en netwerkfout → `retry: true`; andere 4xx → `retry: false`. Cloudflare: `await env.EMAIL.send({ from, to, subject, text, html })`; een gegooide fout → `retry: true` behalve als de foutmelding op een ongeldig adres wijst (`retry: false`). Faalt alles: het resultaat van de laatste, maar `retry: true` zodra één dienst `retry: true` gaf.
- `Env`: `MAIL_PROVIDERS?: string; EMAIL?: { send(m: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ messageId: string }> }`.
- `wrangler.example.jsonc`: `// "MAIL_PROVIDERS": "resend",` met uitleg, en een uitgecommentarieerd blok `"send_email": [{ "name": "EMAIL", "remote": true }]` met "vereist Workers Paid en een verzenddomein in Email Service".

Tests (in `describe('sendMail')`, bestaande tests aanpassen aan `SendResult`):
- [ ] `mailProviders`: `'cloudflare,resend'` met binding en sleutel → `['cloudflare','resend']`; `'cloudflare'` zonder binding → `[]` en `mailEnabled` false; leeg → `['resend']`.
- [ ] Resend 429 → `{ ok: false, retry: true, status: '429' }`; 422 → `retry: false`.
- [ ] Cloudflare eerst, `EMAIL.send` gooit → Resend wordt geprobeerd en geeft `{ ok: true, via: 'resend' }`.
- [ ] Geen adres of sleutel in `console.error` (bestaande test blijft).
- [ ] Tests falen → bouwen → slagen. Typecheck: alle aanroepers van `sendMail` gebruiken nu `.ok` (wordt in Task 3 vervangen door de wachtrij; voor nu `(await sendMail(...)).ok`).
- [ ] Commit `Mail: keten van maildiensten (Resend, Cloudflare)`.

### Task 3: De wachtrij

**Bestanden:**
- Maak: `src/mailqueue.ts`
- Wijzig: `src/signup.ts` (`sendVerifyMail`), `src/forgot.ts` (`sendResetMail`), `src/invites.ts` (`sendInviteMail`), `src/reports.ts` (`sendReportMail`), `src/index.ts` (`cronSteps`)
- Test: `test/mailwachtrij.test.ts`; bestaande mailtests aanpassen

**Gebruikt:** `sendMail` / `SendResult` (Task 2), `mail_queue` (Task 1).

**Levert:**
- `type QueueKind = 'verify' | 'reset' | 'invite' | 'report'`
- `enqueueMail(env: Env, q: { kind: QueueKind; userId: string | null; ref: string | null; lang: Locale; origin: string }, now = Date.now()): Promise<string>` — rij met `next_try_at = now`, geeft id.
- `deliverQueued(env: Env, now = Date.now(), opts: { id?: string; max?: number } = {}): Promise<{ sent: number; waiting: number }>` — pakt rijen met `next_try_at <= now` (oudste eerst, `max` standaard 50, of alleen `id`). **Claim per rij** met `UPDATE mail_queue SET next_try_at = <now + 5 min> WHERE id = ? AND next_try_at <= ? RETURNING …`; geen rij terug → een ander is ermee bezig, overslaan. Dan `buildQueued(env, row)`:
  - `null` (account/uitnodiging/melding weg, adres al bevestigd) → rij weg;
  - mails → elk via `sendMail`; alle `ok` → rij weg; `retry: true` → `attempts + 1`, `last_status`, `next_try_at = now + min(60, 5 × 2^(attempts−1))` minuten; `retry: false` → rij weg + `tellOwner(env, 'mail_dropped', …)` (Task 5; tot dan een `console.error` zonder adres).
- `buildQueued(env, row): Promise<Mail[] | null>` — per soort de bestaande opbouw uit `sendVerifyMail` / `sendResetMail` / `sendInviteMail` / `sendReportMail` (link of join-code maken gebeurt **hier**, dus bij versturen). De `send…Mail`-functies worden: grenzen controleren (`reserveMail`, ongewijzigd behalve wat Task 4 weghaalt), `enqueueMail`, dan `deliverQueued(env, now, { id })`. Geen `releaseMail` meer na een mislukte poging: de mail gaat later alsnog.
  - `sendReportMail` gaat naar meerdere beheerdersadressen: één rij per adres is niet mogelijk zonder adres op te slaan, dus `buildQueued` voor `report` geeft één mail per adres terug (daarom `Mail[]`; voor de andere soorten één). Bekend risico: lukt adres 1 wel en adres 2 niet, dan krijgt adres 1 hem bij de volgende poging nog eens; acceptabel (alleen beheerders).
- `cronSteps`: elke minuut `['mailwachtrij', () => deliverQueued(env, Date.now())]`, ook als mail uit staat niets doen (`mailEnabled`).
- `mailBacklog(db: D1Database): Promise<boolean>` — `EXISTS (SELECT 1 FROM mail_queue WHERE attempts > 0)`.

Tests (`fetch` nabootsen zoals in `test/mail.test.ts`):
- [ ] Gewone aanmelding: bevestigingsmail gaat direct weg en de rij is weg.
- [ ] Resend geeft 429 → rij blijft, `attempts` 1, `next_try_at` 5 min later; cron daarna met 200 → verstuurd, rij weg, link in de mail werkt (`/verify/<code>`).
- [ ] Herstelmail 3 uur in de rij → bij versturen een verse link die nog 1 uur geldig is.
- [ ] **Review 1:** twee keer `deliverQueued` tegelijk (`Promise.all`) op één rij → precies één `fetch`.
- [ ] **Review 2:** account verwijderd terwijl de mail wacht → geen `fetch`, rij weg. Adres gewijzigd → mail naar het nieuwe adres.
- [ ] **Review 3:** na 6 mislukte pogingen is de wachttijd 60 minuten (niet meer).
- [ ] **Review 4:** 60 rijen klaar → één cron-run verstuurt er 50, oudste eerst.
- [ ] 422 → rij weg, geen nieuwe poging.
- [ ] Bestaande tests (`forgot`, `aanmelden`, `bevestigen`, `uitnodigingsmail`, `melden`, `grenzen-na-verwijderen`) aanpassen waar ze `releaseMail` na een fout verwachten.
- [ ] `npm run typecheck`, `npm test` slagen. Commit `Mail: wachtrij, niets verdwijnt meer`.

### Task 4: Vaste daggrenzen eruit

**Bestanden:**
- Wijzig: `src/mail.ts` (weg: `DEFAULT_DAILY_LIMIT`, `dailyLimit`, `dailyShare`, de daggrens-voorwaarde in `reserveMail`, `'daily_limit'` als uitkomst, `claimCapNotice`-melding voor mail), `src/signup.ts` (weg: `signupDailyLimit`, `DEFAULT_SIGNUP_LIMIT`, `notifySignupCap`, `err.signup_full`; `reserveSignup` wordt `recordSignup(db, now): Promise<number>` = rij `signup` schrijven en het aantal van vandaag teruggeven), `src/forgot.ts`, `src/index.ts` (`Env`: `MAIL_DAILY_LIMIT`, `SIGNUP_DAILY_LIMIT` weg), `public/i18n.js` (weg: `err.signup_full`, `mail.cap_title`, `mail.cap_body`, `mail.signup_cap_title`, `mail.signup_cap_body`), `wrangler.example.jsonc`, `SETUP.md`, `ARCHITECTURE.md`
- Test: `test/mail.test.ts`, `test/aanmelden.test.ts`, `test/forgot.test.ts`

**Levert:** `reserveMail(db, env, kind, userId, now?, o?): Promise<{ id: string } | 'account_limit'>`; `recordSignup(db, now?): Promise<number>`.

- [ ] Tests: 120 aanmeldingen op één dag (verschillende IP-sleutels) → allemaal 201. 60 herstelmails voor 60 accounts → allemaal in de rij/verstuurd. Grens per account (5 per dag, 5 minuten) en per adres (bevestigen 3, uitnodigen 1) gelden nog.
- [ ] Oude tests over de daggrens en de aanmeldgrens weghalen; `i18n.test.ts` en `i18n-sleutels.test.ts` slagen.
- [ ] Docs: in `SETUP.md` en `wrangler.example.jsonc` de twee instellingen weg; in `ARCHITECTURE.md` de mailalinea's (rond regels 58–120 en 198) bijwerken: wachtrij, grenzen alleen per account/adres/IP.
- [ ] Commit `Mail en aanmelden: geen vaste daggrenzen meer`.

### Task 5: Berichten aan de eigenaar (Telegram)

**Bestanden:**
- Maak: `src/telegram.ts`
- Wijzig: `src/mailqueue.ts`, `src/signup.ts`, `src/index.ts` (`Env`), `public/i18n.js`, `wrangler.example.jsonc`, `SETUP.md`
- Test: `test/telegram.test.ts`

**Levert:**
- `tellOwner(env: Env, key: 'mail_failing' | 'mail_dropped' | 'mail_warn' | 'signups', vars: Record<string, string>, throttle: 'hour' | 'day' | 'once', now = Date.now()): Promise<void>` — throttle via een vlagrij in `mail_log` (soort `tg:<key>` of `tg:<key>:<n>` voor `once`), met dezelfde INSERT … WHERE NOT EXISTS als `claimCapNotice`. Tekst: `translate(defaultLocale, 'owner.<key>', vars)`. Met `TELEGRAM_BOT_TOKEN` en `TELEGRAM_CHAT_ID`: `POST https://api.telegram.org/bot<token>/sendMessage` met `{ chat_id, text }`; een fout alleen loggen (zonder token). Anders: `notifyUser(env, ADMIN_ID, …)` zoals nu.
- Aanroepen:
  - `deliverQueued`: na een `retry: true` → `mail_failing` (`hour`), vars `{ status, waiting }`; na `retry: false` → `mail_dropped` (`hour`), vars `{ kind }`.
  - na een geslaagde mail: aantal verstuurde mails vandaag (`mail_log`, soorten zonder vlag) = `MAIL_WARN_AT` (standaard 70) → `mail_warn` (`day`), vars `{ count }`.
  - `recordSignup` geeft een veelvoud van 100 → `signups` (`once`, sleutel met het aantal), vars `{ count }`.
- `Env`: `TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; MAIL_WARN_AT?: string`.
- i18n (en + nl), bijvoorbeeld nl `owner.mail_failing`: "Tick: mail lukt niet (maildienst gaf {status}). {waiting} mail(s) wachten. Upgrade bij Resend of zet Cloudflare aan; de wachtrij gaat daarna vanzelf verder."; `owner.mail_warn`: "Tick: vandaag al {count} mails verstuurd. Het gratis plan van Resend stopt bij 100 per dag."; `owner.mail_dropped`: "Tick: een mail ({kind}) kon definitief niet worden afgeleverd."; `owner.signups`: "Tick: vandaag al {count} nieuwe accounts."

Tests:
- [ ] Met token en chat-id: één `fetch` naar `api.telegram.org` met de juiste `chat_id`; de token staat niet in logs.
- [ ] **Review 3:** tien keer 429 binnen een uur → één Telegram-bericht.
- [ ] De 70e mail van de dag → één `mail_warn`; de 71e niet.
- [ ] De 100e aanmelding → één `signups`; de 101e niet.
- [ ] **Review 5:** zonder Telegram-instellingen → pushmelding aan de beheerder, geen `fetch` naar Telegram.
- [ ] Commit `Berichten aan de eigenaar via Telegram`.

### Task 6: De wachttekst voor gebruikers

**Bestanden:**
- Wijzig: `src/index.ts` (CONFIG rond regel 679: `mailDelayed: await mailBacklog(c.env.DB)` als `openSignup`), `public/settings.js` (type), `public/verifybar.js`, `src/account.ts` (`POST /api/account/verify` → `{ ok: true, delayed }`), `src/forgot.ts` (`{ ok: true, delayed }`), `public/forgot.js`, `src/login.ts` (forgotPage: `data-delayed` met de tekst), `public/i18n.js`
- Test: `test/bevestigen.test.ts`, `test/forgot.test.ts`

**Levert:** i18n-sleutel `mail.delayed` met precies de teksten uit Besluit 5.

- [ ] Tests: met een wachtende rij (`attempts > 0`) geeft `/api/account/verify` `delayed: true` en zit `mailDelayed: true` in de config; zonder wachtrij `false`. `/forgot` idem.
- [ ] Client: de bevestigingsbalk zet de tekst onder de bestaande zin als `CONFIG.mailDelayed`; na "opnieuw sturen" met `delayed` de toast `verify.sent` + `mail.delayed`; `forgot.js` toont de tekst onder de vaste melding als `delayed`. `npm run dev`: balk en herstelpagina in de browser bekijken (met een rij handmatig in de lokale D1).
- [ ] Commit `Melding als mail langer onderweg is`.

### Task 7: Documentatie, privacy en uitrol

**Bestanden:**
- Wijzig: `docs/privacy.md` en de privacypagina in `src/login.ts` (`mailOn`): de genoemde dienst volgt `mailProviders` (Resend en/of Cloudflare); `ARCHITECTURE.md` (wachtrij, schakelaar, Telegram); `SETUP.md` (`MAIL_PROVIDERS`, `MAIL_WARN_AT`, `TELEGRAM_*`, en hoe je Cloudflare Email Service aanzet).
- Test: `test/privacy.test.ts` — met `MAIL_PROVIDERS=cloudflare` + binding noemt de pagina Cloudflare als mailbezorger, niet Resend.

- [ ] Test, bouwen, `npm run typecheck`, `npm test`.
- [ ] Commit en push op `main`.
- [ ] `npm run db:migrate` en uitrol op beide Ticks (persoonlijk en app.ticktodo.nl); `npx wrangler deployments list`.
- [ ] Dio zet de Telegram-token zelf: `npx wrangler secret put TELEGRAM_BOT_TOKEN` in `C:\dev\ticktodo-app`; chat-id als var in diezelfde `wrangler.jsonc`. Daarna één testbericht laten komen (tijdelijk `MAIL_WARN_AT` op 1, of een testaanroep).
- [ ] Website: nu niets (de mail gaat nog via Resend). **Play:** geen release en niets in Play Console (alleen server en web-app).

---

## Later: omschakelen naar Cloudflare (geen taak nu)

1. Dio: Workers Paid aan op het account Ticktodo.nl.
2. Dio: Compute › Email Service › Email Sending › Onboard Domain › ticktodo.nl.
3. Claude: in `C:\dev\ticktodo-app\wrangler.jsonc` `"send_email": [{ "name": "EMAIL", "remote": true }]` en `"MAIL_PROVIDERS": "cloudflare,resend"`; uitrollen; een herstelmail naar Dio's eigen account laten komen.
4. Claude: de websitetekst over Resend (privacy-alinea en het zelf-hosten-blok in `site/public/index.html` en `en/index.html`) bijwerken via `cms-sync`, met een voorstel voor beide talen.
