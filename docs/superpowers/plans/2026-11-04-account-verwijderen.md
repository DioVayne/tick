# Eigen account verwijderen — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iemand kan zijn eigen Tick-account verwijderen in Instellingen › Account, en een openbare pagina `/delete-account` legt uit hoe dat gaat (voor Google Play).

**Architecture:** Eén gedeelde wisfunctie `deleteAccount` in `src/users.ts`, gebruikt door de beheerdersroute en een nieuwe `POST /api/account/delete`. De openbare pagina en de bevestiging op `/login?deleted=1` zijn server-side HTML in `src/login.ts`. In de PWA een knop met wachtwoordvenster in `public/settingsview.js`; daarna dezelfde browser-opruiming als bij uitloggen, maar met push alleen lokaal afmelden.

**Tech Stack:** Cloudflare Worker + Hono, D1, R2, vitest met `@cloudflare/vitest-pool-workers`, vanilla-JS PWA zonder build.

**Spec:** `docs/superpowers/specs/2026-11-04-account-verwijderen-design.md`

## Global Constraints

- npm alleen vanaf een kopie in `C:\dev` (nooit vanaf `K:\Google Drive\…`); bronwijzigingen in de repo op K:.
- Elke zichtbare tekst via `public/i18n.js`, met `en` én `nl` (je-vorm, gewone taal). Server-fouten: `HttpError(status, key, vars)`.
- Geen inline scripts of stijlen (CSP). Een nieuw module-bestand in `public/` → in `SHELL` van `public/sw.js` en `CACHE` ophogen (dit plan voegt er geen toe).
- Geen migratie nodig.
- Bewaartermijn-zin (letterlijk): nl "Je gegevens worden direct uit Tick verwijderd. Reservekopieën worden na hooguit 30 dagen automatisch gewist." / en "Your data is removed from Tick right away. Backups are erased automatically within 30 days."
- Gedeelde-taken-zin: nl "Gedeelde lijsten gaan over naar een ander lid. Taken die je los hebt gedeeld, verdwijnen ook bij de ander; kopieën blijven." / en "Shared lists pass to another member. Tasks you shared on their own disappear for the others too; copies stay."
- `npm run typecheck` en `npm test` slagen; UI gecontroleerd met `npm run dev`.

## Review Focus

1. **Fout wachtwoord of beheerder:** er wordt niets gewist (geen enkele rij), en de app springt niet naar /login (403/409, geen 401). → test in Task 1.
2. **Telefoonsleutel / API-token roept de route aan:** geweigerd (403), niets gewist. → test in Task 1.
3. **Na verwijderen dezelfde cookie nog gebruiken:** 401, en het antwoord van de delete-route verlengt de sessie niet (zet de gewiste cookie, geen nieuwe). → test in Task 1.
4. **Eigen Tick met voorbeeldadres of leeg `ADMIN_CONTACT`:** de openbare pagina toont geen adres maar "neem contact op met wie deze Tick beheert". → test in Task 2.
5. **Push na verwijderen:** de browser vraagt de server niet meer om af te melden (zou 401 → /login zonder `?deleted=1` geven). → handmatig in Task 3 (netwerk-tab), plus code-review.

---

### Task 1: Server — gedeelde wisfunctie en `POST /api/account/delete`

**Files:**
- Modify: `src/users.ts` (nieuwe export), `src/users-api.ts:31-38`, `src/account.ts`, `public/i18n.js` (`err.last_admin` in en + nl)
- Test: `test/account-verwijderen.test.ts` (nieuw)

**Interfaces:**
- Produces: `export async function deleteAccount(env: Env, id: string): Promise<void>` in `src/users.ts` — batch `[...transferListsStmts(env.DB, id), ...deleteUserStmts(env.DB, id)]`, daarna `await env.FILES?.delete(backgroundKey(id))`.
- Produces: `POST /api/account/delete`, body `{ password: string }` → `200 { ok: true }` met `Set-Cookie: clearCookie`; fouten `400 err.invalid_json`, `403 err.wrong_password`, `409 err.last_admin`, `429 err.too_many_attempts`; 403 voor niet-sessie (via bestaande `sessionOnly`).
- Teksten: `err.last_admin` en "You're the administrator of this Tick, so you can't delete your own account." / nl "Je bent de beheerder van deze Tick en kunt je eigen account daarom niet verwijderen."

- [ ] **Step 1: Schrijf de falende tests** in `test/account-verwijderen.test.ts` (helpers: `call`, `callAs`, `createUser`, `session`, `json`, `ADMIN_ID`):
  - `'zelf verwijderen wist alles, zet de cookie leeg en de oude sessie en sleutel werken niet meer'`: zelfde opbouw als de beheerderstest in `test/accounts.test.ts:45-73` (taak, plaats, sleutel + device, push, pair, settings, link), dan `POST /api/account/delete` met `{ password: b.password }` → 200; `res.headers.getSetCookie()` bevat precies één `tick_session=`-regel en die heeft `Max-Age=0`; alle tabellen uit die test 0 rijen; `GET /api/account` met de oude cookie → 401; Bearer-sleutel → 401.
  - `'een gedeelde lijst gaat over naar een ander lid'`: maak met de bestaande helpers uit `test/gedeelde-lijsten.test.ts` een lijst van B met geaccepteerd lid C; B verwijdert zichzelf; `shared_lists.owner_id` is C en de taak in de lijst heeft `user_id` C.
  - `'fout wachtwoord → 403 en er is niets gewist'`: 403, `error` is de tekst van `err.wrong_password`; `users`-rij en taak bestaan nog.
  - `'de enige beheerder kan zichzelf niet verwijderen → 409'`: `session()` + `{ password: 'test-wachtwoord' }` → 409; beheerder bestaat nog.
  - `'een Bearer-sleutel mag niet verwijderen → 403'`: met een `full`-sleutel van B → 403; B bestaat nog.
  - `'zonder wachtwoord → 400'`.
  - Pas `test/accounts.test.ts` niet aan; de beheerderstest blijft groen als bewijs dat de route de gedeelde functie goed gebruikt.

- [ ] **Step 2: Draai en zie ze falen**
  Run (in de C:\dev-kopie): `npx vitest run test/account-verwijderen.test.ts`
  Expected: FAIL (404 op `/api/account/delete`).

- [ ] **Step 3: Implementeer** `deleteAccount` in `src/users.ts`, laat `usersApi.delete('/:id')` het gebruiken, en voeg `accountApi.post('/delete')` toe in `src/account.ts`: `LOGIN_LIMITER` (zoals `/password`), body-check, `passwordOk` → anders 403, als `user.role === 'admin'` en `SELECT COUNT(*) FROM users WHERE role = 'admin'` ≤ 1 → 409, dan `deleteAccount`, `c.header('Set-Cookie', clearCookie)`, `{ ok: true }`. Let op import-cycli: `users.ts` mag `sharedlists.ts` en `background.ts` importeren als dat geen cyclus geeft; anders zet `deleteAccount` in `src/users-api.ts` en exporteer hem daar.

- [ ] **Step 4: Draai de tests**
  Run: `npx vitest run test/account-verwijderen.test.ts test/accounts.test.ts test/i18n.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — `Account verwijderen: route POST /api/account/delete met gedeelde wisfunctie`

### Task 2: Openbare pagina `/delete-account` en bevestiging op de inlogpagina

**Files:**
- Modify: `src/login.ts`, `src/index.ts` (route vóór de auth-middleware, naast `/login`), `public/login.css` (alleen wat de pagina nodig heeft), `public/i18n.js`
- Test: `test/account-verwijderen.test.ts` (uitbreiden)

**Interfaces:**
- Produces: `export function contactEmail(adminContact: string | undefined): string | null` in `src/login.ts` — `'mailto:dio@ticktodo.nl'` → `'dio@ticktodo.nl'`; `''`, `undefined`, zonder `mailto:`, of domein `example.com` (hoofdletters maken niet uit) → `null`.
- Produces: `export function deleteAccountPage(locale: string | undefined, contact: string | null): string` in `src/login.ts`.
- Changes: `loginPage(locale, emptyEmailHint = false, deleted = false)`; `/login` geeft `deleted = c.req.query('deleted') === '1'`. Bij `deleted` een `<p class="ok" role="status">` met `login.deleted` boven het formulier.
- Teksten (sleutels `del.*` en `login.deleted`, en + nl): titel "Je Tick-account verwijderen"; stappen (inloggen → Instellingen › Account → Account verwijderen → wachtwoord → bevestigen); wat er gewist wordt; de gedeelde-taken-zin; de bewaartermijn-zin; tip back-up (Instellingen › Data); "Kun je niet inloggen? Mail {email}, dan krijg je een herstellink of verwijderen we je account voor je." en de variant zonder adres "…neem dan contact op met wie deze Tick beheert."; link "Naar inloggen". `login.deleted`: "Je account is verwijderd." / "Your account has been deleted."
- E-mailadres in HTML escapen (het komt uit config, maar toch).

- [ ] **Step 1: Schrijf de falende tests**
  - `'contactEmail: mailto wordt een adres; leeg, zonder mailto of example.com wordt null'` met de vijf gevallen hierboven.
  - `'/delete-account werkt zonder inloggen, in beide talen, met het contactadres'`: `call('/delete-account', { auth: null, headers: { 'accept-language': 'nl' } })` → 200, `text/html`, bevat de nl-titel en de nl-bewaartermijn-zin. De testconfig heeft `ADMIN_CONTACT: 'mailto:test@example.com'` (`vitest.config.ts:36`), dat telt als niet ingevuld, dus verwacht hier de zin **zonder** adres en geen `mailto:`. Met `accept-language: en` de en-titel.
  - `'deleteAccountPage met een adres toont een mailto-link'`: `deleteAccountPage('nl', 'dio@ticktodo.nl')` bevat `href="mailto:dio@ticktodo.nl"`.
  - `'/login?deleted=1 toont de bevestiging, /login zonder niet'`.

- [ ] **Step 2: Draai en zie ze falen** — `npx vitest run test/account-verwijderen.test.ts` → FAIL.

- [ ] **Step 3: Implementeer** `contactEmail`, `deleteAccountPage` (zelfde `<head>` als `loginPage`, `theme.js` + `login.css`, `lang` uit `c.get('lang')`), de route `app.get('/delete-account', …)` in `src/index.ts` vlak na `/login`, en de `deleted`-melding in `loginPage`. Stijl voor lijst/tekst op de pagina in `login.css` (leesbare breedte, `ol` met stappen).

- [ ] **Step 4: Draai de tests** — `npx vitest run test/account-verwijderen.test.ts test/inloggen.test.ts test/i18n.test.ts test/security.test.ts` → PASS.

- [ ] **Step 5: Commit** — `Account verwijderen: openbare pagina /delete-account en bevestiging na verwijderen`

### Task 3: PWA — knop, wachtwoordvenster en opruimen

**Files:**
- Modify: `public/settingsview.js` (`paintAccount`, `logout`), `public/push.js`, `public/i18n.js`, eventueel `public/style.css`

**Interfaces:**
- Consumes: `POST /api/account/delete` (Task 1), `/login?deleted=1` (Task 2).
- Produces: `export async function forgetPush(reg): Promise<void>` in `public/push.js` — `markOff(true)` en `sub?.unsubscribe()`, **zonder** serveraanroep.
- Produces (intern in `settingsview.js`): `async function clearBrowser(): Promise<void>` — `clearAll()`, `storeSet(CACHE_KEY, null)`, `forgetCachedConfig()`; `logout()` gebruikt hem.
- Teksten (`set.delete_account`, `set.delete_account_button`, `set.delete_account_text`, `set.delete_account_password`, `set.delete_account_failed`), en + nl. De venstertekst bevat de gedeelde-taken-zin en de bewaartermijn-zin, plus "Dit kun je niet ongedaan maken."

- [ ] **Step 1: Voeg `forgetPush` toe** in `public/push.js` naast `disablePush`.
- [ ] **Step 2: Haal `clearBrowser` uit `logout()`** in `public/settingsview.js`; `logout()` gedraagt zich daarna precies als nu.
- [ ] **Step 3: Voeg de rij toe** als laatste in `paintAccount`: `row(t('set.delete_account'), btn(t('set.delete_account_button'), deleteAccount, { disabled: off, kind: 'danger' }))` (gebruik de `danger`-stijl die `btn` of de bestaande knoppen al kennen). `deleteAccount()`: `modal()` met de uitlegtekst en een `<input type="password" autocomplete="current-password">` (zoals `askKey` een invoerveld in `modal` zet), knoppen danger "Account verwijderen" en ghost "Annuleren". Bij bevestigen: `request('POST', '/api/account/delete', { password })`; fout → `toast(offlineText(err))` (toont `err.wrong_password` of `err.last_admin` van de server) en het venster mag dicht; gelukt → `forgetPush(S.reg ?? await getReg())` in try/catch, `clearBrowser()`, `location.href = '/login?deleted=1'`.
- [ ] **Step 4: Draai typecheck en tests** in de C:\dev-kopie: `npm run typecheck && npm test` → alles groen.
- [ ] **Step 5: Controleer in de browser** met `npm run dev` (via preview_start): als lid inloggen, Instellingen › Account; fout wachtwoord → melding, je blijft ingelogd; goed wachtwoord → `/login?deleted=1` met de bevestiging; netwerk-tab: geen `DELETE /api/push/subscribe` na de delete. Als beheerder: melding `err.last_admin`. `/delete-account` in nl en en, licht en donker, telefoonbreedte. Screenshot als bewijs.
- [ ] **Step 6: Commit** — `Account verwijderen: knop in Instellingen › Account`

### Task 4: Docs

**Files:**
- Modify: `docs/settings.md` (blok Account), `ARCHITECTURE.md`, `SETUP.md` (rij `ADMIN_CONTACT`), `wrangler.example.jsonc` (commentaar bij `ADMIN_CONTACT`)

- [ ] **Step 1: `docs/settings.md`**: in **Account** de knop, wachtwoord ter bevestiging, wat er gewist wordt, de gedeelde-taken-zin, de bewaartermijn-zin, dat de beheerder het niet kan, en de openbare pagina `/delete-account`. Pas in **Accounts (administrator)** de zin over verwijderen aan als dat nodig is om gelijk te blijven.
- [ ] **Step 2: `ARCHITECTURE.md`**: route `POST /api/account/delete` (sessie, wachtwoord, laatste beheerder → 409, cookie leeg), openbare route `/delete-account`, `deleteAccount` als enige wisroute, `ADMIN_CONTACT` ook op die pagina (example.com telt niet).
- [ ] **Step 3: `SETUP.md` en `wrangler.example.jsonc`**: bij `ADMIN_CONTACT` vermelden dat het adres op de openbare pagina `/delete-account` staat.
- [ ] **Step 4: Eindcontrole** — `npm run typecheck && npm test` in de C:\dev-kopie → groen.
- [ ] **Step 5: Commit** — `Docs: eigen account verwijderen`
