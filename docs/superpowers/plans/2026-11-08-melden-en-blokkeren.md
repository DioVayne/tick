# Melden en blokkeren — bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Op een openbare Tick (`OPEN_SIGNUP`) kunnen gebruikers gedeelde inhoud en personen melden en blokkeren; de beheerder krijgt een mail en handelt meldingen af op een eigen beheerpagina (afwijzen, inhoud verwijderen, schorsen).

**Architecture:** Drie nieuwe servermodules: `src/blocks.ts` (blokkades + `/api/blocks`), `src/reports.ts` (`POST /api/reports`, mail aan de beheerder) en `src/admin.ts` (server-gerenderde pagina's `/admin/reports…`, schorsen). Eén nieuwe app-module `public/report.js` (meldvenster); bestaande UI krijgt meldknoppen. Hergebruik van `leaveShareStmts`, `leaveListStmts`, `dissolveStmts`, `bumpSessionVersionStmt`, `reserveMail`/`sendMail`/`mailLayout`, `addEmailInvite`.

**Tech Stack:** TypeScript, Hono op Cloudflare Workers, D1, R2, Vitest met `@cloudflare/vitest-pool-workers`, PWA zonder build.

**Spec:** `docs/superpowers/specs/2026-11-08-melden-en-blokkeren-design.md`

## Global Constraints

- Alles alleen als `openSignup(env)` waar is; anders `404` op de nieuwe routes en geen knoppen in de app (`CONFIG.openSignup`).
- Elke zichtbare tekst via `public/i18n.js`, met `en` en `nl`; serverfouten als `HttpError(status, key, vars)`.
- Nieuwe migratie `migrations/0022_melden_en_blokkeren.sql`; bestaande migraties niet aanpassen.
- Nieuwe app-module in `SHELL` van `public/sw.js`, `CACHE` ophogen. Geen inline scripts of stijlen (CSP), ook niet op de beheerpagina.
- Redenen: `spam` | `inappropriate` | `illegal` | `other`; toelichting hoogstens 500 tekens.
- Hoogstens 10 meldingen per melder per 24 uur; daarboven `{ ok: true }` zonder rij en zonder mail.
- Geen bestand, bijlage-URL of e-mailadres in de mail aan de beheerder; alleen namen, reden, toelichting, titel, link `<origin>/admin/reports/<id>`.
- Delen met een geblokkeerd of geschorst account: een `email_invites`-rij zonder mail en zonder push (antwoord gelijk aan een onbekend adres).
- `npm run typecheck` en `npm test` groen na elke taak.

## Review Focus

1. **Melden en dan blokkeren vanaf een uitnodiging van iemand die je nog niet kent**: dat moet kunnen. De afzender van een openstaande uitnodiging telt als "gekend". Test in Task 3.
2. **Een tweede keer melden of blokkeren van dezelfde inhoud of persoon**: geen 500. Blokkade is idempotent; een tweede melding nadat het delen al opgezegd is, geeft `404` (geen toegang meer). Test in Task 2/3.
3. **Bijlage gemeld en daarna door de eigenaar verwijderd**: de beheerpagina toont "bestaat niet meer" met de bewaarde naam. De bestandsroute geeft `404`. Test in Task 4.
4. **Een geschorst account met nog een geldige sessiecookie of API-sleutel**: meteen `401`, ook bij statische bestanden van de app. Test in Task 4.
5. **Verzoek met een andere Origin naar een beheeractie** (CSRF): `403`, er verandert niets. Test in Task 4.

---

### Task 1: Migratie en `added_by`

**Files:**
- Create: `migrations/0022_melden_en_blokkeren.sql`
- Modify: `src/users.ts` (type `User` + `deleteUserStmts`), `src/sharedlists.ts` (`attachStmts`), `src/index.ts` (taak-JSON: `added_by`)
- Test: `test/migratie-melden.test.ts`

**Interfaces:**
- Produces: tabellen `blocks (user_id, blocked_id, created_at, PK(user_id, blocked_id))`, `reports (id, reporter_id, reported_id, reason, note, task_id, list_id, attachment_id, title, attachment_name, status DEFAULT 'open', created_at, handled_at)` zonder foreign keys op task/list/attachment. Indexen `reports(status, created_at)` en `reports(reporter_id, created_at)`. Kolommen `users.suspended_at TEXT` en `tasks.added_by TEXT`. `User.suspended_at: string | null`. De taak-JSON van `/api/tasks` krijgt `added_by: string | null`.

- [ ] Test: na migratie bestaan de tabellen en kolommen. `attachStmts` zet `added_by` op `actorId` voor de hoofdtaak. Een taak aangemaakt in een gedeelde lijst door een lid heeft `added_by = lid`. `deleteUserStmts` wist `blocks` en `reports` waar het account melder, gemelde, blokkeerder of geblokkeerde is.
- [ ] Draaien en zien falen: `npx vitest run test/migratie-melden.test.ts`.
- [ ] Migratie en code schrijven. `attachStmts`: `added_by = COALESCE(added_by, ?actorId)` niet gebruiken; altijd `actorId` (wie hem in de lijst zette).
- [ ] Draaien en zien slagen, plus `npm run typecheck`.
- [ ] Commit.

### Task 2: Blokkeren

**Files:**
- Create: `src/blocks.ts`, `test/blokkeren.test.ts`
- Modify: `src/invites.ts` (`resolveOpenRecipient`, `knownPeople`, `afterEmailInvite`, `claimInvites`), `src/shares.ts`, `src/sharedlists.ts` (POST `/`), `src/index.ts` (route `/api/blocks`)

**Interfaces:**
- Produces:
  - `blockedBetween(db: D1Database, a: string, b: string): Promise<boolean>` (beide richtingen)
  - `blockStmts(db: D1Database, me: string, other: string): D1PreparedStatement[]`: insert in `blocks` (ON CONFLICT DO NOTHING), alle `task_shares` tussen het paar (beide richtingen; ook op taken van de een met de ander als ontvanger) via dezelfde logica als `leaveShareStmts`, lidmaatschap waarbij de een eigenaar en de ander lid is via `leaveListStmts`, `email_invites` van de een aan het adres van de ander.
  - `blocksApi` (Hono): `GET /` → `[{ id, name }]`; `POST /` body `{ user_id }` → alleen als `user_id` in `knownPeople`, of afzender van een openstaande uitnodiging (taak of lijst) aan mij, of eigenaar van een taak of lijst die met mij gedeeld is; anders `404`; `DELETE /:userId`.
  - `resolveOpenRecipient` geeft `{ email, silent: true }` als het bevestigde account mij geblokkeerd heeft, ik het geblokkeerd heb, of het geschorst is. `afterEmailInvite` stuurt dan niets.
- Consumes: `users.suspended_at` en `blocks` uit Task 1.

- [ ] Tests (openEnv, Resend nagebootst):
  - Na blokkeren zijn de gedeelde taken in beide richtingen weg bij beide, en de lijst waar de een eigenaar en de ander lid is ook. De lijst van een derde met beiden als lid blijft.
  - Daarna deelt de geblokkeerde met het adres van de blokkeerder: hetzelfde antwoord als bij een onbekend adres, een rij in `email_invites`, geen `task_shares`, geen Resend-aanroep, geen inkomende uitnodiging. Een tweede keer geeft `409`. Hetzelfde voor een lijst, en in omgekeerde richting.
  - `knownPeople` noemt elkaar niet meer. `GET /api/blocks` toont de naam; `DELETE` haalt hem weg.
  - `POST /api/blocks` voor een onbekende id → `404`. Twee keer blokkeren → `200`.
  - Zonder `OPEN_SIGNUP` → `404`.
- [ ] Zien falen, bouwen, zien slagen, typecheck.
- [ ] Commit.

### Task 3: Melden (API en mail)

**Files:**
- Create: `src/reports.ts`, `test/melden.test.ts`
- Modify: `src/attachments.ts` (meta krijgt `user_id`), `src/index.ts` (route `/api/reports`), `src/mail.ts` (niets nieuws nodig, alleen gebruiken)

**Interfaces:**
- Produces: `reportsApi` met `POST /` body `{ share_id? | list_id? | task_id? | attachment_id?, reason, note?, block? }` → altijd `{ ok: true }` (201) na geslaagde controle. Volgorde:
  1. Een openstaande taakuitnodiging (`share_id`, aan mij) → gemelde = `from_user`; actie: uitnodiging weigeren.
  2. `list_id` met mijn lidmaatschap `pending` → gemelde = eigenaar; actie: weigeren. Met `accepted` en ik ben geen eigenaar → actie: `leaveListStmts`.
  3. `task_id` (hoofdtaak) die met mij gedeeld is (deelrij, niet in een lijst) → gemelde = eigenaar; actie: `leaveShareStmts`. In een gedeelde lijst → gemelde = `added_by ?? eigenaar lijst`; mag ik niet zelf zijn; actie: lid → vertrekken uit de lijst, eigenaar → de gemelde uit de lijst halen.
  4. `attachment_id` in een taak waar ik toegang toe heb, `user_id` niet ik, en de taak is gedeeld → gemelde = uploader; actie zoals de spec (ontvanger vertrekt; eigenaar haalt uploader uit taak of lijst). De bijlage blijft.
  - Geen toegang → `404`. Eigen inhoud → `400 err.report_own`. Ongeldige reden → `400 err.report_reason`.
  - Cap: `SELECT COUNT(*) FROM reports WHERE reporter_id = ? AND created_at > now-24u` ≥ 10 → wel de actie, geen rij, geen mail.
  - `block: true` → `blockStmts` in dezelfde batch.
  - Mail op de achtergrond (`inBackground`): aan e-mailadressen van `role='admin'`, anders `contactEmail(ADMIN_CONTACT)`; `reserveMail(db, env, 'report', reporterId)`; taal `install.defaultLocale`.
- Consumes: `blockStmts` (Task 2), `leaveShareStmts`, `leaveListStmts`.

- [ ] Tests per rij van de tabel in de spec: rij in `reports` met de juiste `reported_id`, `title`; het delen voor de melder is weg; de bijlage bestaat nog (`attachments` en R2). Eén Resend-aanroep naar het beheerdersadres; de body bevat de titel en `/admin/reports/`, geen `/api/attachments/` en geen e-mailadres van melder of gemelde.
- [ ] Tests: geen toegang → `404`; eigen taak of bijlage → `400`; elfde melding binnen 24 uur → `201` zonder rij en zonder mail; `block: true` → rij in `blocks`; een tweede melding van dezelfde (al verlaten) taak → `404`; zonder `OPEN_SIGNUP` → `404`.
- [ ] Zien falen, bouwen, zien slagen, typecheck.
- [ ] Commit.

### Task 4: Schorsen en de beheerpagina

**Files:**
- Create: `src/admin.ts`, `public/admin.css`, `public/admin.js` (alleen de bevestiging voor de zware knoppen), `test/beheer-meldingen.test.ts`
- Modify: `src/index.ts` (middleware weigert geschorst; `/login` geeft `err.account_suspended` bij juist wachtwoord; routes `/admin`), `src/login.ts` (helpers voor paginaopmaak hergebruiken indien aanwezig)

**Interfaces:**
- Produces:
  - `suspendStmts(db, userId): D1PreparedStatement[]`: `suspended_at`, `bumpSessionVersionStmt`, alle `task_shares` van/naar/op zijn taken, `leaveListStmts` voor lidmaatschappen bij anderen, `dissolveStmts` voor zijn eigen gedeelde lijsten, zijn `email_invites`.
  - `removeContentStmts(env, report)`: taak (met subtaken) of bijlage definitief weg, plus alle `attachments`-rijen met dezelfde `r2_key`. Daarna de R2-objecten wissen (`FILES.delete`).
  - Routes (sessie + `role='admin'`, anders `403`; niet ingelogd → redirect `/login?next=`): `GET /admin/reports`, `GET /admin/reports/:id`, `GET /admin/reports/:id/files/:attachmentId` (zelfde headers als de gewone bijlage-route), `POST /admin/reports/:id/{dismiss,remove,suspend,unsuspend}` (Origin moet gelijk zijn aan de eigen origin, anders `403`; daarna redirect 303 naar de meldingpagina).
  - Een beheerder schorsen → `400 err.suspend_admin`.

- [ ] Tests: gewone gebruiker → `403`, API-sleutel → `403`, niet ingelogd → 302 naar `/login`. De pagina toont titel, reden, namen en e-mailadressen. De bestandsroute geeft alleen bijlagen van de gemelde taak (een andere → `404`). Na verwijderen door de eigenaar toont de pagina "bestaat niet meer" en geeft de bestandsroute `404`.
- [ ] Tests: `remove` wist de taak definitief (ook geen prullenbak) en ook de bijlage-rij in een geaccepteerde kopie met dezelfde `r2_key`; de tekst van de kopie blijft. `suspend`: de oude cookie geeft `401`, de API-sleutel geeft `401`, inloggen met het juiste wachtwoord → `403 err.account_suspended`, met een fout wachtwoord → `401 err.login_failed`, al het delen is weg. `unsuspend` laat weer inloggen. Een andere Origin → `403`, niets veranderd.
- [ ] Zien falen, bouwen, zien slagen, typecheck.
- [ ] Commit.

### Task 5: De app (meldvenster, knoppen, geblokkeerde mensen)

**Files:**
- Create: `public/report.js`
- Modify: `public/share.js` (uitnodiging: "Melden"; eigenaarsrij in de deelbox: "Melden"), `public/sharedlist.js` (lijstuitnodiging: "Melden"), `public/listmenu.js` (lid: "Lijst melden"), `public/detail.js` (taak in een gedeelde lijst van een ander: "Melden"), `public/attachments.js` (bijlage van een ander: meldknop), `public/settingsview.js` (Account › Geblokkeerde mensen), `public/i18n.js`, `public/sw.js` (`SHELL` + `CACHE`), `public/style.css` (of de stylesheet waar dialogen staan)
- Test: `test/i18n.test.ts` en `test/offline.test.ts` (bestaand) moeten slagen.

**Interfaces:**
- Produces: `openReportDialog(target: { share_id?: string, list_id?: string, task_id?: string, attachment_id?: string }, title: string, personName: string): Promise<void>`. Toont reden (4 radio's), toelichting (`maxlength=500`), vinkje "Blokkeer ook {name}" (aan), knoppen Annuleren/Melden. Na `201`: toast `report.thanks`, `load()`.
- Consumes: `POST /api/reports`, `GET/DELETE /api/blocks`.

- [ ] i18n-sleutels (en + nl) voor alles hierboven, plus `err.report_own`, `err.report_reason`, `err.account_suspended`, `err.suspend_admin`, en de teksten van de beheerpagina en de mail.
- [ ] `npm test` (i18n, offline) en `npm run typecheck` groen.
- [ ] Browsercheck met `npm run dev` (zie Task 6).
- [ ] Commit.

### Task 6: Docs, privacy, browsercheck

**Files:**
- Create: `docs/reporting.md`
- Modify: `docs/README.md` (rij), `docs/sharing.md` en `docs/signup.md` (verwijzing), `ARCHITECTURE.md`, `src/login.ts` (`privacyPage`: meldingen en blokkades), `test/privacy.test.ts` indien die de tekst controleert.

- [ ] Docs schrijven (Engels, voor gebruikers).
- [ ] Privacytekst (en + nl) en test.
- [ ] Browsercheck lokaal met twee accounts op een openbare dev-config: delen → melden met blokkeren → taak weg, beheerpagina opent, bijlage zichtbaar, schorsen → andere sessie uitgelogd. Schermafbeelding.
- [ ] `npm run typecheck` en `npm test` groen. Commit.

### Task 7: Review, mergen en live zetten

- [ ] Review van de hele branch (superpowers:requesting-code-review).
- [ ] Mergen naar `main` in `K:\Google Drive\Git\tick`, pushen.
- [ ] Live zetten: `echo '{}' | node "K:/Google Drive/Git/tick/.claude/hooks/tick-deploy-live.cjs"` vanuit `C:\dev` (bij fout 7403 meteen nog eens), controleren met `npx wrangler deployments list` in `C:\dev\ticktodo-app`.
- [ ] Dio vragen om de echte test met de testaccounts (melding komt aan, link werkt).
