# Zelf aanmelden (openbare Tick) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Met `OPEN_SIGNUP` aan kan iedereen zelf een Tick-account maken, accounts zien elkaar niet, en delen gaat via e-mailadres met een uitnodigingsmail aan adressen zonder (bevestigd) account.

**Architecture:** Een nieuwe module `src/signup.ts` (aanmelden, bevestigen, `openSignup`) en `src/invites.ts` (uitnodigingen aan e-mailadressen) naast de bestaande deel-code. Op een Tick zonder `OPEN_SIGNUP` blijft elk pad zoals het is; elke nieuwe tak hangt aan `openSignup(env)`. Mail gaat via het bestaande `src/mail.ts` (Resend, `mail_log`).

**Tech Stack:** Cloudflare Worker + D1, Hono, TypeScript; PWA in `public/` zonder build; vitest met de Workers-pool.

**Spec:** `docs/superpowers/specs/2026-11-05-zelf-aanmelden-design.md`

## Global Constraints

- Lees `CLAUDE.md`. Elke zichtbare tekst via `public/i18n.js`, met `en` én `nl`; serverfouten als `HttpError(status, key, vars)`.
- Schemawijziging = nieuw bestand `migrations/0020_zelf_aanmelden.sql`; bestaande migraties niet aanraken.
- Geen inline scripts/styles (CSP). Nieuwe app-module → in `SHELL` van `public/sw.js` en `CACHE` ophogen. Loginpagina's (`/signup`, `/verify`) horen niet in `SHELL`; hun script komt in `loginAssets` (`src/login.ts`).
- Nieuwe instelling → `wrangler.example.jsonc` (uitgecommentarieerd, veilige standaard), `Env` in `src/index.ts`, `SETUP.md`.
- `OPEN_SIGNUP` aan ⇔ `env.OPEN_SIGNUP === 'true'`. Uit = exact het huidige gedrag (bestaande tests blijven groen zonder aanpassing).
- Waarden uit de spec: onbevestigd account weg na **30 dagen**; uitnodiging aan een adres **30 dagen** geldig; bevestigingslink **7 dagen**; uitnodigingsmails samen hooguit **de helft** van `MAIL_DAILY_LIMIT`; per ontvangend adres hooguit **1 uitnodigingsmail per 24 uur**; per deler **5 uitnodigingsmails per 24 uur**; `SIGNUP_DAILY_LIMIT` standaard **100**.
- Het enige toegestane lek over het bestaan van een adres is `409 err.email_taken` bij aanmelden en bij e-mail wijzigen (Dio's keuze). Delen geeft voor elk geldig adres hetzelfde antwoord.
- Commits in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm run typecheck` en `npm test` draaien vanuit `C:\git\tick\zelf-aanmelden-af5114` (niet vanaf K:).

## Review Focus

1. **Hoofdletters en spaties in adressen**: `" Ik@X.nl "` bij aanmelden, delen en uitnodigingen omzetten moet hetzelfde account vinden als `ik@x.nl` (`cleanEmail` + `COLLATE NOCASE`). Test in Task 3 en Task 5.
2. **Je eigen adres typen** bij delen geeft `400 err.share_self`, geen uitnodigingsmail aan jezelf. Test in Task 5.
3. **Twee keer hetzelfde onbekende adres** uitnodigen voor dezelfde taak geeft `409 err.share_exists`, net als bij een bestaand account. Test in Task 5.
4. **Bevestigingslink twee keer openen**, of openen terwijl je uitgelogd bent: de eerste keer bevestigt (ook uitgelogd), de tweede keer toont een nette "ongeldig of al gebruikt"-pagina, geen 500. Test in Task 4.
5. **Uitnodiging voor een taak die intussen verwijderd is** (of een deler die zijn account verwijderde): omzetten bij bevestigen slaat die over zonder fout. Test in Task 6.

---

### Task 1: Instellingen, migratie en testhulp

**Files:**
- Create: `migrations/0020_zelf_aanmelden.sql`, `src/signup.ts`, `test/migratie-aanmelden.test.ts`
- Modify: `src/index.ts` (`Env`), `wrangler.example.jsonc`, `SETUP.md`, `src/links.ts` (`LinkKind`, invite-account bevestigd), `test/helpers.ts`

**Interfaces:**
- Produces: `openSignup(env: Env): boolean` en `signupDailyLimit(env: Env): number` in `src/signup.ts`; `LinkKind = 'invite' | 'reset' | 'verify'`; `Env` velden `OPEN_SIGNUP?`, `PLAY_STORE_URL?`, `SIGNUP_DAILY_LIMIT?` (alle `string`); testhulp `callWith(e: Env, path: string, o?: { method?: string; json?: unknown; cookie?: string; ip?: string; lang?: string }): Promise<Response>` in `test/helpers.ts` (worker.fetch met eigen env, wacht op `waitOnExecutionContext`, zoals `req` in `test/forgot.test.ts`) en `openEnv: Env` = `{ ...env, OPEN_SIGNUP: 'true', RESEND_API_KEY: 'test-resend', MAIL_FROM: 'Tick <noreply@ticktodo.nl>' }`.
- Schema (exact):
  - `ALTER TABLE users ADD COLUMN email_verified_at TEXT;` daarna `UPDATE users SET email_verified_at = created_at;`
  - `account_links` opnieuw opbouwen met `CHECK (kind IN ('invite','reset','verify'))` (nieuwe tabel, rijen kopiëren, oude droppen, hernoemen).
  - `CREATE TABLE email_invites (id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, from_user TEXT NOT NULL REFERENCES users(id), task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, list_id TEXT REFERENCES shared_lists(id) ON DELETE CASCADE, mode TEXT NOT NULL CHECK (mode IN ('shared','copy')), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, CHECK ((task_id IS NULL) <> (list_id IS NULL)));` met `UNIQUE (email, task_id)`, `UNIQUE (email, list_id)` en een index op `email`.
  - `ALTER TABLE mail_log ADD COLUMN recipient_hash TEXT;` + index `(kind, recipient_hash, sent_at)`.

- [ ] **Step 1: Write the failing test** `test/migratie-aanmelden.test.ts`, in de stijl van `test/migratie-tickmanager.test.ts`:
  - `bestaande accounts gelden als bevestigd`: migraties `< '0020'`, user invoegen, alles toepassen → `email_verified_at` = `created_at`.
  - `account_links accepteert verify en houdt bestaande links`: een `invite`-rij vóór 0020 blijft bestaan; insert met `kind='verify'` lukt; `kind='x'` gooit.
  - `email_invites eist precies één van task_id/list_id`: beide NULL gooit.
- [ ] **Step 2: Run** `npx vitest run test/migratie-aanmelden.test.ts` → FAIL (kolom/tabel bestaat niet).
- [ ] **Step 3: Implement** de migratie, `src/signup.ts` (`openSignup`, `signupDailyLimit`: geheel getal ≥ 1 uit `SIGNUP_DAILY_LIMIT`, anders 100), `Env`-velden, de drie regels in `wrangler.example.jsonc` (uitgecommentarieerd, met uitleg; `OPEN_SIGNUP` alleen voor een Tick voor onbekenden, werkt pas goed met mail), `LinkKind` + TTL voor `verify` (7 dagen) in `src/links.ts`, en in `POST /invite/:code` `email_verified_at` = nu bij het INSERT. `test/helpers.ts`: `callWith`, `openEnv`; `createUser` zet `email_verified_at` = nu en krijgt optie `verified?: boolean` (standaard `true`).
- [ ] **Step 4: Run** `npx vitest run test/migratie-aanmelden.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: SETUP.md**: kort optioneel stuk "Openbare Tick (zelf aanmelden)" met de drie instellingen en het advies om eerst mail (Resend) in te stellen.
- [ ] **Step 6: Run** `npm test` → alles groen. **Commit** `Aanmelden: instellingen, migratie 0020 en testhulp`.

### Task 2: Mailgrenzen per soort en per ontvanger

**Files:**
- Modify: `src/mail.ts`, `test/mail.test.ts`

**Interfaces:**
- Produces: `reserveMail(db, env, kind, userId, now = Date.now(), o: MailLimits = {})` met `type MailLimits = { gapMs?: number; perDay?: number; dailyShare?: number; recipient?: string }`. Standaard (zonder `o`) exact het huidige gedrag (5 min, 5 per dag, volle daggrens). `dailyShare` (0–1): deze soort mag alleen reserveren zolang het totaal van vandaag (alle soorten behalve `cap_notice`) `< floor(dailyLimit * dailyShare)`. `recipient`: e-mailadres; opgeslagen als `recipient_hash` = hex SHA-256 van het kleingeschreven, getrimde adres; dan ook hooguit 1 rij per `(kind, recipient_hash)` per 24 uur. Uitkomst blijft `{ id } | 'account_limit' | 'daily_limit'` (een volle ontvanger telt als `'account_limit'`).
- Produces: `recipientHash(email: string): Promise<string>`.

- [ ] **Step 1: Write the failing tests** in `test/mail.test.ts`:
  - `gapMs 0 en perDay 5`: 5 reserveringen achter elkaar voor `invite_mail` lukken, de 6e geeft `'account_limit'`.
  - `dailyShare 0.5 met MAIL_DAILY_LIMIT 4`: 2 lukken (verschillende delers), de 3e geeft `'daily_limit'`; een `reset` daarna lukt nog.
  - `recipient`: twee delers naar `X@Ex.test` en `x@ex.test ` → de tweede `'account_limit'`.
- [ ] **Step 2: Run** `npx vitest run test/mail.test.ts` → FAIL.
- [ ] **Step 3: Implement** in de bestaande ene `INSERT … SELECT … WHERE` (zodat parallelle aanvragen niet langs de grens glippen).
- [ ] **Step 4: Run** `npx vitest run test/mail.test.ts test/forgot.test.ts` → PASS.
- [ ] **Step 5: Commit** `Mail: grenzen per soort en per ontvanger`.

### Task 3: Welkomstscherm en aanmelden

**Files:**
- Create: `public/signup.js`, `test/aanmelden.test.ts`
- Modify: `src/signup.ts`, `src/login.ts` (`loginPage`, nieuwe `signupPage`, `loginAssets`), `src/index.ts` (route mounten vóór de auth-middleware, `/login` geeft `openSignup` door), `public/login.css`, `public/i18n.js`

**Interfaces:**
- Consumes: `openSignup`, `signupDailyLimit`, `callWith`, `openEnv` (Task 1).
- Produces: `signupPages: Hono<AppEnv>` in `src/signup.ts` met `GET /signup`, `POST /signup`; `sendVerifyMail(env: Env, userId: string, origin: string, lang: Locale): Promise<void>` (hier als lege stub die Task 4 vult, zodat `POST /signup` hem al aanroept via `inBackground`). `loginPage(locale, emptyEmailHint, deleted, forgot, signup = false)`: met `signup` het logo (`/icon.svg`, zit al in de statische assets) boven het formulier en een link "Account aanmaken" naar `/signup`.
- `POST /signup` body `{ name, email, password }`, volgorde: uit → 404; `LOGIN_LIMITER` met `signup:<ip>` → `429 err.too_many_attempts`; `cleanName`/`cleanEmail`/wachtwoord ≥ `MIN_PASSWORD` (zoals `POST /invite/:code`, hergebruik `checkPassword` door hem te exporteren uit `src/links.ts`); aantal aanmeldingen vandaag (UTC, `users` met `role='member'` en `created_at` ≥ dagstart) ≥ `signupDailyLimit` → `429 err.signup_full` + eenmaal per dag push aan `ADMIN_ID` (`mail_log`-rij met `kind = 'signup_cap'` als vlag, zelfde patroon als `claimCapNotice`, en `signup_cap` telt niet mee in de maildaggrens: sluit die soort uit zoals `cap_notice`); bestaand adres → `409 err.email_taken`; anders INSERT (`role='member'`, `email_verified_at` NULL), sessiecookie (`sessionCookie`), verify-mail op de achtergrond, `201 { ok: true }`.
- i18n-sleutels (en+nl): `login.signup`, `signup.title`, `signup.submit`, `signup.privacy` (met link naar `/privacy`), `signup.have_account`, `err.signup_full`, `mail.signup_cap_title`, `mail.signup_cap_body`.

- [ ] **Step 1: Write the failing tests** `test/aanmelden.test.ts`:
  - `uit: geen knop en geen pagina`: met `env` bevat `/login` geen `href="/signup"`; `GET/POST /signup` → 404.
  - `aan: welkomstscherm`: `/login` met `openEnv` bevat `href="/signup"` en `/icon.svg`.
  - `aanmelden maakt een onbevestigd lid en logt in`: `POST /signup` met `{ name: 'An', email: ' An@Ex.test ', password: 'lang-genoeg-1' }` → 201, `set-cookie` met `tick_session=`, rij in `users` met `email = 'An@Ex.test'`, `role = 'member'`, `email_verified_at` NULL; `GET /api/account` met dat cookie → 200.
  - `bestaand adres → 409 err.email_taken en geen tweede account` (ook met andere hoofdletters).
  - `te kort wachtwoord → 400 err.password_short`; `ongeldig adres → 400 err.invalid_email`.
  - `daggrens`: met `SIGNUP_DAILY_LIMIT: '1'` en al een aanmelding vandaag → `429 err.signup_full`.
  - `rem per IP`: `untilRateLimited` op `POST /signup` vanaf één IP → 429.
- [ ] **Step 2: Run** `npx vitest run test/aanmelden.test.ts` → FAIL.
- [ ] **Step 3: Implement** zoals hierboven. `public/signup.js` volgt `public/accountlink.js` (POST JSON, foutmelding in `#err`, bij succes `location.href = '/'`). Na de 409 toont de pagina links naar `/login` en (alleen als mail aan staat) `/forgot`.
- [ ] **Step 4: Run** `npx vitest run test/aanmelden.test.ts test/i18n.test.ts test/inloggen.test.ts` → PASS.
- [ ] **Step 5: Commit** `Aanmelden: welkomstscherm en /signup`.

### Task 4: E-mailadres bevestigen

**Files:**
- Create: `test/bevestigen.test.ts`
- Modify: `src/signup.ts`, `src/login.ts` (`verifyPage`), `src/links.ts` (`consumeLink` geeft ook `created_by`; reset via mail bevestigt), `src/account.ts` (e-mail wijzigen), `src/index.ts` (`/config.js`), `public/i18n.js`, het app-scherm voor de balk (zie Step 3), `public/sw.js` als er een module bijkomt

**Interfaces:**
- Consumes: `reserveMail`, `sendMail`, `mailLayout`, `createLink(db, 'verify', userId, userId)`.
- Produces: `sendVerifyMail(env, userId, origin, lang)` (echt nu: alleen als `mailEnabled`, gebruiker bestaat en onbevestigd is; `reserveMail(db, env, 'verify', userId)` met standaardgrenzen; link `${origin}/verify/${code}`; bij mislukken `releaseMail`); `markVerified(env: Env, userId: string): Promise<void>` (zet `email_verified_at` als die NULL is; Task 6 breidt hem uit); `GET /verify/:code` (achter `LOGIN_LIMITER` `link:<ip>`, zoals `/reset`), werkt zonder inlog; `POST /api/account/verify` → `200 { ok: true }` (mail op de achtergrond; uit of al bevestigd → `400 err.already_verified`); `consumeLink` retourneert `{ user_id, created_by }`.
- `/config.js` krijgt `openSignup: boolean`, `emailVerified: boolean`, `verifyBy: string | null` (ISO: `created_at` + 30 dagen, alleen als openbaar en onbevestigd en mail aan).
- E-mail wijzigen (`PATCH /api/account`) op een openbare Tick: bij een ander adres `email_verified_at = NULL` en `sendVerifyMail` op de achtergrond. Een bezet adres blijft `409 err.email_taken` (zelfde bit als bij aanmelden, door Dio geaccepteerd).
- `POST /reset/:code`: als `created_by = user_id` (link uit `/forgot`), ook `markVerified`.
- i18n (en+nl): `mail.verify_subject`, `mail.verify_heading`, `mail.verify_intro`, `mail.verify_button`, `mail.verify_outro`, `verify.done_title`, `verify.done_body`, `verify.open_app`, `verify.invalid`, `verify.banner` (`{date}`), `verify.resend`, `verify.sent`, `err.already_verified`.

- [ ] **Step 1: Write the failing tests** `test/bevestigen.test.ts` (Resend nabootsen zoals in `test/forgot.test.ts`):
  - `aanmelden stuurt één bevestigingsmail met /verify/-link`.
  - `link openen zonder cookie bevestigt`: `GET /verify/<code>` → 200, pagina bevat `verify.done_title`; `email_verified_at` gevuld.
  - `tweede keer openen → 200 met verify.invalid, geen 500`; onzincode idem.
  - `opnieuw sturen`: `POST /api/account/verify` → 200 en een mail; direct nog eens → 200 maar geen tweede mail (5-minutengrens); bevestigd → 400 `err.already_verified`.
  - `/config.js` op een openbare Tick: onbevestigd lid heeft `verifyBy` = created_at + 30 dagen; bevestigd → `null`; Tick zonder `OPEN_SIGNUP` → `openSignup: false`.
  - `herstel via /forgot bevestigt; resetlink van de beheerder niet`.
  - `e-mail wijzigen maakt onbevestigd en stuurt een mail`; zonder `OPEN_SIGNUP` blijft `email_verified_at` staan.
- [ ] **Step 2: Run** `npx vitest run test/bevestigen.test.ts` → FAIL.
- [ ] **Step 3: Implement**. De balk: zoek in `public/app.js` hoe bestaande meldingen bovenaan getoond worden en volg dat; toon hem als `CONFIG.openSignup && !CONFIG.emailVerified`, met `verify.banner` (datum uit `verifyBy`, of zonder datum als die `null` is) en een knop `verify.resend`. Nieuwe module → `SHELL` + `CACHE` ophogen.
- [ ] **Step 4: Run** `npx vitest run test/bevestigen.test.ts test/forgot.test.ts test/links.test.ts test/account.test.ts test/offline.test.ts test/i18n.test.ts` → PASS.
- [ ] **Step 5: Commit** `Aanmelden: e-mailadres bevestigen`.

### Task 5: Delen op een openbare Tick (geen lijst, alleen e-mail)

**Files:**
- Create: `src/invites.ts`, `test/delen-openbaar.test.ts`
- Modify: `src/shares.ts` (`recipientOf`, `GET /people`, `POST /`, `DELETE /:id`), `src/sharedlists.ts` (`POST /`, `DELETE /:id/members/:userId`, `listSharing`), `src/access.ts` (`shareInfo`), `src/users.ts` (`deleteUserStmts` wist `email_invites` van de deler), `public/i18n.js`

**Interfaces:**
- Produces in `src/invites.ts`:
  - `type Target = { kind: 'task'; taskId: string; mode: 'shared' | 'copy' } | { kind: 'list'; listId: string }`.
  - `resolveOpenRecipient(env: Env, me: User, b: Record<string, unknown>): Promise<{ userId: string } | { email: string }>`: alleen op een openbare Tick. Afzender onbevestigd → `403 err.verify_first` (of `403 err.share_unavailable` als mail uit staat). `to_user` alleen als die in `knownPeople`. Anders `cleanEmail(b.to)`; geen geldig adres → `400 err.share_email_needed`. Eigen adres → `400 err.share_self`. Bevestigd account met dat adres → `{ userId }`; geen of onbevestigd account → `{ email }`.
  - `knownPeople(db, userId): Promise<{ id: string; name: string }[]>`: accounts met wie een **geaccepteerde** `task_shares`-rij (`mode='shared'`, beide richtingen) of een gedeelde lijst waarin jullie allebei `accepted` zijn.
  - `addEmailInvite(db, fromUser: string, email: string, target: Target): Promise<{ id: string }>`: INSERT in `email_invites` (expires +30 dagen); conflict → `409 err.share_exists` (taak) of `409 err.list_member_exists` (lijst).
  - `emailInviteRows(db, ownerId: string): Promise<{ id: string; email: string; task_id: string | null; list_id: string | null }[]>` (niet verlopen).
- Gedrag als `openSignup(env)`:
  - `GET /api/shares/people` → `knownPeople`.
  - `POST /api/shares`: alle bestaande controles blijven; daarna ontvanger via `resolveOpenRecipient`. `{ userId }` → bestaande INSERT + push; `{ email }` → `addEmailInvite`. Antwoord in beide gevallen `201 { ok: true, status: 'pending' }`.
  - `POST /api/shared-lists` (de route in `sharedlists.ts`): de lijst wordt bij de eerste keer **altijd** een gedeelde lijst (ook bij `{ email }`); antwoord `201 { id, list_id, status: 'pending' }` zoals nu.
  - Weergave: in `shareInfo` en `listSharing` ziet de **eigenaar** elke openstaande uitnodiging met `name` = het e-mailadres (`u.email` voor accounts), en daarnaast de `email_invites` als leden `{ share_id: <invite id>, user_id: 'mail:<invite id>', name: <email>, status: 'pending' }`. Niet-eigenaren zien op een openbare Tick geen openstaande uitnodigingen. Beide functies krijgen de vlag als extra parameter `open: boolean` (standaard `false`).
  - Intrekken: `DELETE /api/shares/:id` en `DELETE /api/shared-lists/:id/members/:userId` met `mail:<id>` wissen de `email_invites`-rij als jij de deler bent (anders 404 zoals nu). Frontend hoeft hiervoor niets te wijzigen.
- i18n (en+nl): `err.verify_first`, `err.share_unavailable`, `err.share_email_needed`.

- [ ] **Step 1: Write the failing tests** `test/delen-openbaar.test.ts` (met `callWith(openEnv, …)` en `createUser`):
  - `people toont alleen wie je al kent`: A, B, C; A en B delen een geaccepteerde taak → A ziet alleen B.
  - `delen op naam → 400 err.share_email_needed`.
  - `onbevestigde afzender → 403 err.verify_first`.
  - `zelfde antwoord voor bekend en onbekend adres`: body en status van `POST /api/shares` naar B's adres en naar `nobody@ex.test` zijn gelijk (`{ ok: true, status: 'pending' }`, 201).
  - `onbekend adres → rij in email_invites, geen task_shares-rij`; `onbevestigd account → ook email_invites`.
  - `eigen adres in hoofdletters → 400 err.share_self` (Review Focus 2).
  - `zelfde onbekende adres twee keer → 409 err.share_exists` (Review Focus 3).
  - `lijst delen met onbekend adres maakt de lijst gedeeld` (`shared_lists`-rij bestaat).
  - `eigenaar ziet openstaande uitnodigingen als e-mailadres` (`GET /api/tasks` → `share.members[].name` = adres, ook voor B's account); `B ziet na accepteren de naam van A`.
  - `intrekken met mail:<id>` wist de rij; een ander account krijgt 404.
  - `zonder OPEN_SIGNUP`: delen op naam werkt nog en `people` toont iedereen (bestaand gedrag).
- [ ] **Step 2: Run** `npx vitest run test/delen-openbaar.test.ts` → FAIL.
- [ ] **Step 3: Implement** zoals hierboven.
- [ ] **Step 4: Run** `npx vitest run test/delen-openbaar.test.ts test/delen.test.ts test/gedeelde-lijsten.test.ts test/isolatie.test.ts` → PASS, daarna `npm run typecheck`.
- [ ] **Step 5: Commit** `Delen op een openbare Tick: alleen via e-mailadres`.

### Task 6: Uitnodigingsmail en omzetten bij bevestigen

**Files:**
- Create: `test/uitnodigingsmail.test.ts`
- Modify: `src/invites.ts`, `src/signup.ts` (`markVerified`), `src/shares.ts` / `src/sharedlists.ts` (aanroep mail na `addEmailInvite`), `public/i18n.js`

**Interfaces:**
- Produces: `sendInviteMail(env, fromUser: { id: string; name: string }, email: string, what: { kind: 'task' | 'list'; title: string }, origin: string, lang: Locale): Promise<void>` — `reserveMail(db, env, 'invite_mail', fromUser.id, now, { gapMs: 0, perDay: 5, dailyShare: 0.5, recipient: email })`; bij een volle daggrens geen beheerdermelding extra (die komt al uit `forgot`). Inhoud via `mailLayout`: kop `mail.invite_heading` (`{name}`, `{title}`), intro `mail.invite_intro` (één zin wat Tick is), knop `mail.invite_button` → `${origin}/signup`, outro `mail.invite_outro` (+ als `PLAY_STORE_URL` gevuld: zin `mail.invite_play` met die link; `mailLayout` krijgt daarvoor een optioneel `extra?: { label: string; url: string }` dat als tweede link in tekst en HTML komt). Onderwerp `mail.invite_subject` (`{name}`). Geen e-mailadres in een URL. Aangeroepen met `inBackground` na `addEmailInvite`.
- Produces: `claimEmailInvites(env: Env, userId: string): Promise<void>` — voor alle niet-verlopen `email_invites` met `email` = het adres van de gebruiker: taak → `task_shares`-rij `pending` (zelfde kolommen als `POST /api/shares`, `from_user` = deler), lijst → `list_members`-rij `pending` met `name` = de lijstnaam van de eigenaar (`list_members` van de owner). `ON CONFLICT DO NOTHING`; verwijderde taken (`deleted_at` gezet) en de eigen taken overslaan; daarna alle rijen voor dat adres wissen. `markVerified` roept hem aan.
- Verlopen `email_invites` wissen gebeurt in Task 7.
- i18n (en+nl): `mail.invite_subject`, `mail.invite_heading`, `mail.invite_intro`, `mail.invite_button`, `mail.invite_play`, `mail.invite_outro`.

- [ ] **Step 1: Write the failing tests** `test/uitnodigingsmail.test.ts`:
  - `onbekend adres krijgt één mail met /signup-link en de naam van de deler`; met `PLAY_STORE_URL` staat die link erin, zonder niet.
  - `bevestigd account krijgt geen mail` (alleen de gewone uitnodiging).
  - `per adres één mail per dag`: twee delers naar hetzelfde adres → één mail, maar wel twee `email_invites`.
  - `aanmelden + bevestigen met dat adres zet de uitnodigingen om`: na `GET /verify/<code>` staat er een `task_shares`-rij `pending` voor de nieuwe gebruiker en een `list_members`-rij `pending`; `email_invites` voor dat adres is leeg; `GET /api/shares/incoming` toont de taak.
  - `uitnodiging voor een intussen verwijderde taak wordt overgeslagen zonder fout` (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run test/uitnodigingsmail.test.ts` → FAIL.
- [ ] **Step 3: Implement** zoals hierboven.
- [ ] **Step 4: Run** `npx vitest run test/uitnodigingsmail.test.ts test/bevestigen.test.ts test/delen-openbaar.test.ts test/mail.test.ts test/i18n.test.ts` → PASS.
- [ ] **Step 5: Commit** `Delen: uitnodigingsmail aan adressen zonder account`.

### Task 7: Opruimen (onbevestigde accounts en verlopen uitnodigingen)

**Files:**
- Create: `test/opruimen-onbevestigd.test.ts`
- Modify: `src/signup.ts`, `src/index.ts` (`cronSteps`, in het uur-blok)

**Interfaces:**
- Produces: `purgeUnverified(env: Env, now: number): Promise<number>` — alleen als `openSignup(env) && mailEnabled(env)`; verwijdert elk account met `role = 'member'`, `email_verified_at IS NULL` en `created_at < now − 30 dagen` via `deleteAccount(env, id)` (`src/users-api.ts`); geeft het aantal terug. Wist ook altijd `email_invites` met `expires_at < now`.
- Cron-stap `['onbevestigd', () => purgeUnverified(env, Date.now())]` in het uur-blok, vóór `bijlagen`.

- [ ] **Step 1: Write the failing tests**:
  - onbevestigd lid van 31 dagen weg; van 29 dagen blijft; bevestigd lid van 31 dagen blijft; beheerder blijft.
  - zonder mail of zonder `OPEN_SIGNUP`: niets weg.
  - verlopen `email_invites`-rij weg, geldige blijft.
  - `cronSteps(env, …)` op een heel uur bevat de stap `onbevestigd`.
- [ ] **Step 2: Run** `npx vitest run test/opruimen-onbevestigd.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run test/opruimen-onbevestigd.test.ts test/account-verwijderen.test.ts` → PASS.
- [ ] **Step 5: Commit** `Aanmelden: onbevestigde accounts na 30 dagen opruimen`.

### Task 8: Deelvensters in de app en geen zichtbare beheerder

**Files:**
- Modify: `public/share.js`, `public/sharedlist.js`, `public/i18n.js`, `public/sw.js` (`CACHE` ophogen), eventueel `public/settingsview.js`

**Interfaces:**
- Consumes: `CONFIG.openSignup`, `CONFIG.emailVerified` (Task 4); serverfouten uit Task 5.
- Gedrag als `CONFIG.openSignup`: het invoerveld is `type="email"`, `autocomplete="email"`, placeholder `share.to_placeholder_email`; de toast na versturen noemt het getypte adres (`share.sent`); is je adres niet bevestigd, dan toont de dialoog boven het formulier `err.verify_first` als hint (niet pas na versturen). Zonder `openSignup` niets anders.
- Geen zichtbare beheerder: controleer dat een lid op een openbare Tick nergens `beheerder`/`admin` ziet (zoek in `public/` naar het gebruik van `err.admin_only`, `err.last_admin`, `set.pw_rescue` en naar `isAdmin`-afhankelijke teksten). Verwachting: alles zit al achter `CONFIG.isAdmin`; vind je iets, verberg het voor leden als `CONFIG.openSignup`.
- i18n (en+nl): `share.to_placeholder_email`.

- [ ] **Step 1: Implement** de dialogen en de controle.
- [ ] **Step 2: Run** `npm run typecheck && npx vitest run test/offline.test.ts test/i18n.test.ts test/shell.test.ts` → PASS.
- [ ] **Step 3: Browsercheck** met `npm run dev` en een lokale `OPEN_SIGNUP: "true"` (+ nep-mail niet nodig): welkomstscherm, aanmelden, balk "bevestig je adres", deelvenster met e-mailveld, een openstaande uitnodiging als adres; en met `OPEN_SIGNUP` uit: inlogscherm en deelvenster zoals voorheen. Screenshots bewaren in de scratchpad.
- [ ] **Step 4: Commit** `Delen: e-mailveld op een openbare Tick`.

### Task 9: Docs en privacy

**Files:**
- Create: `docs/signup.md` (gebruikershandleiding, Engels)
- Modify: `docs/README.md` (rij in de index), `docs/sharing.md`, `ARCHITECTURE.md`, `src/login.ts` (`privacyPage`), `public/i18n.js`, `test/privacy.test.ts`

**Interfaces:**
- `privacyPage(..., open = false)`: als openbaar, extra alinea's (en+nl) dat een uitnodiging een mail naar het opgegeven adres stuurt, dat dat adres 30 dagen bewaard wordt als er geen account bij komt, en dat onbevestigde accounts na 30 dagen verdwijnen. De route geeft `openSignup(c.env)` door.

- [ ] **Step 1: Write the failing test** in `test/privacy.test.ts`: met `openEnv` staat de nieuwe tekst op `/privacy`, met `env` niet.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** + docs: `docs/signup.md` (aanmaken, bevestigen, 30 dagen, delen via e-mail), `docs/sharing.md` (openbare Tick: alleen e-mailadres, uitnodigingsmail, "uitgenodigd"), `ARCHITECTURE.md` (openbare Tick, `email_invites`, `email_verified_at`, cron-stap).
- [ ] **Step 4: Run** `npm run typecheck && npm test` → alles groen.
- [ ] **Step 5: Commit** `Docs: zelf aanmelden en delen op een openbare Tick`.

### Task 10: Mergen en live zetten

- [ ] **Step 1:** Laatste review van de hele branch (superpowers:requesting-code-review), bevindingen verwerken, `npm run typecheck && npm test` groen.
- [ ] **Step 2:** In `K:\Google Drive\Git\tick`: `git merge --ff-only claude/zelf-aanmelden-af5114` op `main` (eerst rebasen op `main` als die verder is), `git push`.
- [ ] **Step 3:** In `C:\dev\ticktodo-app\wrangler.jsonc`: `"OPEN_SIGNUP": "true"` (en `PLAY_STORE_URL` als Dio de link heeft). De Stop-hook rolt uit; anders zelf `npm run db:migrate` en `npm run deploy` in beide C:\dev-mappen. Controleer met `npx wrangler deployments list` (ook in `C:\dev\ticktodo-app`).
- [ ] **Step 4:** Echte test op app.ticktodo.nl: aanmelden met `ik+test1@koprust.nl`; Dio klikt de bevestigingsmail aan; vanuit test1 een taak delen met `ik+test2@koprust.nl` (Dio ziet de uitnodigingsmail); test2 aanmelden en bevestigen → uitnodiging staat klaar. Daarna beide testaccounts verwijderen (Instellingen › Account › verwijderen).
