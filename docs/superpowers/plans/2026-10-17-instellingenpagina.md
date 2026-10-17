# Instellingenpagina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een instellingenpagina in de Tick-PWA waarmee een zelfhoster na de installatie alles in de app regelt (weergave, taal, tijd, meldingen, apparaten, account, gegevens, sleutels, webhook), zonder config of nieuwe deploy.

**Architecture:** Installatie-instellingen (🏠) komen in de bestaande D1-tabel `settings` met de config als terugval; een middleware laadt ze één keer per request (en per cron-run) en zet tijdzone, standaardtijd en taal. Apparaat-instellingen (📱) staan in `localStorage` (plus cookie `tick_lang` voor de taal). Nieuwe server-routes staan in eigen bestanden onder `src/`, gemount in `src/index.ts`; de pagina is één nieuwe module `public/settingsview.js` in de middenkolom.

**Tech Stack:** Cloudflare Workers + Hono 4, D1, vanilla-JS PWA zonder build-stap (ES modules, strikte CSP), Vitest 4.1 met `@cloudflare/vitest-plugin`, Android (Java, JUnit).

**Spec:** `docs/superpowers/specs/2026-10-17-instellingenpagina-design.md`

## Global Constraints
- Elke zichtbare tekst via `public/i18n.js`, met `en` én `nl` (`test/i18n.test.ts`). Serverfouten: `throw new HttpError(status, key, vars)`, nooit een zin.
- Nieuwe migratie `migrations/0006_instellingen.sql`; bestaande migraties niet aanpassen.
- Geen inline scripts of stijlen (CSP). Nieuwe PWA-module → in `SHELL` van `public/sw.js`, `CACHE` naar `'tick-shell-v7'`.
- Tijden in UTC opslaan; rekenen in de ingestelde tijdzone (`setTimeZone` in `public/repeat.js`).
- Een nieuwe config-waarde gaat in `wrangler.example.jsonc` (met commentaar) én in `Env` (`src/index.ts`). (Dit plan voegt geen nieuwe toe; alleen commentaar.)
- Commits en code-comments in het Nederlands; commitbericht eindigt met `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Vitest blijft op `~4.1.0`. In deze worktree staat geen `wrangler.jsonc`; de tests gebruiken `wrangler.example.jsonc`.
- Voorrang 🏠: waarde in D1 → config (`TIMEZONE`, `LOCALE`, `FALLBACK_WEBHOOK`) → ingebouwd (`UTC`, `en`, geen).
- Settings-sleutels in D1 (exact): `timezone`, `reminder_time` (`HH:MM`), `week_start` (`mon`|`sun`), `default_locale` (`en`|`nl`), `fallback_webhook` (afwezig = config, `''` = uit, anders `https://…`), `password_hash`, `env_api_token_off` / `env_inbox_token_off` (`'1'`), `env_api_token_used` / `env_inbox_token_used` (ISO), bestaand `session_version`.
- Alle routes onder `/api/settings`, `/api/keys`, `/api/account`, `/api/devices`, `/api/export`, `/api/import/*` alleen met sessie (of dev-bypass); een Bearer-sleutel krijgt 403. `POST /api/device` alleen met Bearer van soort `full`.
- Niet deployen, pushen of mergen.

## Review Focus
- **Oude `API_TOKEN` uitschakelen terwijl een telefoon hem nog gebruikt**: de telefoon moet daarna 401 krijgen, en de UI waarschuwt vooraf als die sleutel de laatste 7 dagen gebruikt is. → test in Task 4, waarschuwing in Task 10.
- **Tijdzone wisselen met lastige taken**: afgeronde taak, taak zonder reminder, reminder in het zomertijdgat, wekelijkse taak om 23:30. Kloktijd blijft, niets anders verschuift. → tests in Task 3.
- **Backup terugzetten mag nooit subtaken wissen** (`ON DELETE CASCADE`: dus geen `INSERT OR REPLACE`), en een subtaak waarvan de ouder ontbreekt wordt een gewone taak. → tests in Task 7.
- **Rare taalkoppen en cookies**: `Accept-Language: nl-BE,nl;q=0.9`, `de-DE`, `*`, cookie `tick_lang=xx`: de eerste wordt nl, de rest valt terug op de standaardtaal. → tests in Task 2.
- **Wachtwoord in de app, secret weg**: met `password_hash` en een lege `LOGIN_PASSWORD` kun je inloggen; na het wissen van `password_hash` geldt `LOGIN_PASSWORD` weer; zonder beide: niemand. → tests in Task 5.

---

### Task 1: Migratie, installatie-instellingen en standaardtijd

**Files:**
- Create: `migrations/0006_instellingen.sql`, `src/prefs.ts`, `test/prefs.test.ts`
- Modify: `src/index.ts` (middleware, `/config.js`, inbox-route, `Variables`-type, cron), `src/time.ts`, `src/repeat.ts`, `public/repeat.js`, `public/store.js:81`, `public/settings.js`, `test/shell.test.ts`

**Interfaces:**
- Produces:
  - `type Prefs = { timeZone: string; reminderTime: string; weekStart: 'mon' | 'sun'; defaultLocale: 'en' | 'nl'; fallbackWebhook: string | null; fallbackFromEnv: boolean; passwordHash: string | null; envApiTokenOff: boolean; envInboxTokenOff: boolean }` in `src/prefs.ts`
  - `loadPrefs(env: Env): Promise<Prefs>` (één `SELECT key, value FROM settings`)
  - `setSetting(db: D1Database, key: string, value: string | null): Promise<void>` (`null` = rij verwijderen)
  - `type AppEnv = { Bindings: Env; Variables: { prefs: Prefs; lang: 'en' | 'nl'; auth: Auth } }` geëxporteerd uit `src/index.ts`; `new Hono<AppEnv>()`
  - `public/repeat.js`: `setDefaultTime(hhmm: string | null | undefined): void` (ongeldig → `'09:00'`), `getDefaultTime(): { h: number; mi: number }`, `weekdayOrder(weekStart: 'mon' | 'sun'): number[]` (`mon` → `[0..6]`, `sun` → `[6,0,1,2,3,4,5]`)
  - `src/repeat.ts`: `todayNineIso` hernoemd naar `todayDefaultIso(nowMs?)`
  - `/config.js` levert `{ locale, defaultLocale, timeZone, reminderTime, weekStart, androidPackage }`

- [ ] **Step 1: Schrijf de migratie** `0006_instellingen.sql`:
```sql
-- Sleutels die in de app worden gemaakt. Alleen de SHA-256 van de sleutel staat hier; hint = laatste 4 tekens.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('full','inbox')),
  hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
);
-- Status die een Android-telefoon zelf meldt, per sleutel (key_id 'env-api' = de oude API_TOKEN).
CREATE TABLE devices (
  key_id TEXT PRIMARY KEY, name TEXT NOT NULL, notifications INTEGER NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('always','foreground','off')), app_version TEXT, seen_at TEXT NOT NULL
);
-- Taal per push-abonnement: de server maakt meldingen 's nachts en kent de browser dan niet.
ALTER TABLE push_subscriptions ADD COLUMN locale TEXT;
```

- [ ] **Step 2: Schrijf falende tests** in `test/prefs.test.ts`:
```ts
it('zonder rijen gelden de config-waarden', async () => {
  expect(await loadPrefs(env)).toMatchObject({ timeZone: 'Europe/Amsterdam', reminderTime: '09:00', weekStart: 'mon', defaultLocale: 'en', fallbackWebhook: null, fallbackFromEnv: false });
});
it('een rij in settings gaat voor de config', async () => {
  await setSetting(env.DB, 'timezone', 'Europe/London');
  await setSetting(env.DB, 'reminder_time', '07:30');
  expect(await loadPrefs(env)).toMatchObject({ timeZone: 'Europe/London', reminderTime: '07:30' });
  await setSetting(env.DB, 'timezone', null); await setSetting(env.DB, 'reminder_time', null);
});
it('een kale inbox-datum krijgt de ingestelde reminder-tijd', async () => {
  await setSetting(env.DB, 'reminder_time', '07:30');
  const res = await call('/api/inbox', { method: 'POST', auth: INBOX, json: { title: 'x', due: '2030-03-04' } });
  expect((await json<Task>(res)).remind_at).toBe('2030-03-04T06:30:00.000Z');
  await setSetting(env.DB, 'reminder_time', null);
});
it('weekdayOrder', () => {
  expect(weekdayOrder('mon')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(weekdayOrder('sun')).toEqual([6, 0, 1, 2, 3, 4, 5]);
});
```
En in `test/shell.test.ts` de `/config.js`-test uitbreiden: bevat `"reminderTime":"09:00"`, `"weekStart":"mon"`, `"defaultLocale":"en"`.

- [ ] **Step 3: Run** `npx vitest run test/prefs.test.ts test/shell.test.ts` — Expected: FAIL (module/kolommen bestaan niet).

- [ ] **Step 4: Implementeer.** `loadPrefs` valideert wat het leest (ongeldige zone → config, ongeldige tijd → `'09:00'`). Eerste middleware in `src/index.ts` (vóór `/login`): `c.set('prefs', await loadPrefs(c.env))`, `setTimeZone(prefs.timeZone)`, `setDefaultTime(prefs.reminderTime)`; dezelfde drie in `scheduled`. Vervang elke vaste 09:00: `src/time.ts` (kale datum → `getDefaultTime()`), `src/repeat.ts`, inbox-route (de `T09:00:00`-regel weg; `localToUtcIso` doet het), `public/store.js:81`. `public/settings.js` roept `setDefaultTime(CONFIG.reminderTime)`.

- [ ] **Step 5: Run** `npm test` en `npm run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** `Instellingen: migratie 0006, instellingen uit D1 met config als terugval, instelbare reminder-tijd`

---

### Task 2: Taal per apparaat op de server

**Files:**
- Modify: `public/i18n.js`, `src/index.ts` (alle `c.env.LOCALE` → `c.get('lang')`; shell houdt `data-i18n`), `src/login.ts`, `test/shell.test.ts`, `test/i18n.test.ts`
- Create: `test/taal.test.ts`

**Interfaces:**
- Consumes: `Prefs.defaultLocale` (Task 1)
- Produces:
  - `pickLocale(tags: readonly string[]): 'en' | 'nl' | null` in `public/i18n.js` (eerste tag waarvan het primaire deel `en` of `nl` is)
  - `parseAcceptLanguage(header: string | null | undefined): string[]` in `public/i18n.js` (gesorteerd op `q`, `q=0` weg, `*` weg)
  - `requestLocale(req: Request, defaultLocale: 'en' | 'nl'): 'en' | 'nl'` in `src/prefs.ts`: cookie `tick_lang` (`en`|`nl`, anders genegeerd) → `pickLocale(parseAcceptLanguage(...))` → `defaultLocale`
  - Middleware zet `c.set('lang', requestLocale(...))`; `onError` gebruikt `c.get('lang') ?? normLocale(c.env.LOCALE)`

- [ ] **Step 1: Falende tests** `test/taal.test.ts`:
```ts
it.each([
  ['nl-BE,nl;q=0.9,en;q=0.5', 'nl'], ['de-DE,de;q=0.9', 'en'], ['*', 'en'], ['fr;q=1, nl;q=0.8', 'nl'], ['nl;q=0, en', 'en'],
])('Accept-Language %s → %s', async (header, lang) => {
  const res = await call('/login', { auth: null, headers: { 'accept-language': header } });
  expect(await res.text()).toContain(`<html lang="${lang}">`);
});
it('cookie tick_lang gaat voor Accept-Language; een onbekende waarde telt niet', async () => {
  const page = (cookie: string) => call('/login', { auth: null, headers: { cookie, 'accept-language': 'nl' } }).then((r) => r.text());
  expect(await page('tick_lang=en')).toContain('<html lang="en">');
  expect(await page('tick_lang=xx')).toContain('<html lang="nl">');
});
it('foutmeldingen volgen de taal van de request', async () => {
  const res = await call('/api/tasks', { method: 'POST', json: {}, headers: { 'accept-language': 'nl' } });
  expect((await json<{ error: string }>(res)).error).toBe(STRINGS.nl['err.required'].replace('{field}', 'title'));
});
it('/config.js geeft de taal van de request en de standaardtaal', async () => {
  const text = await (await call('/config.js', { headers: { cookie: 'tick_lang=nl' } })).text();
  expect(text).toContain('"locale":"nl"'); expect(text).toContain('"defaultLocale":"en"');
});
```
`test/shell.test.ts`: de shell-test verwacht nu dat `data-i18n` **blijft staan** (voor client-side opnieuw toepassen) en dat de tekst vertaald is. Plus unit-tests voor `pickLocale`/`parseAcceptLanguage` in `test/i18n.test.ts`.

- [ ] **Step 2: Run** `npx vitest run test/taal.test.ts test/shell.test.ts test/i18n.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer** volgens Interfaces. Shell en manifest gebruiken `c.get('lang')`; Nominatim `accept-language` ook. De shell-rewriter laat `data-i18n`/`data-i18n-attr` staan. Let op: de manifest wordt met `crossorigin="use-credentials"` opgehaald, dus de cookie komt mee.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Taal per apparaat: cookie tick_lang, Accept-Language en standaardtaal op de server`

---

### Task 3: Instellingen-API en tijdzonewissel met vaste kloktijd

**Files:**
- Create: `src/settings-api.ts`, `test/instellingen-api.test.ts`
- Modify: `src/index.ts` (auth op context, `sessionOnly`, mount), `src/time.ts`, `public/i18n.js`, `test/helpers.ts`

**Interfaces:**
- Consumes: `Prefs`, `setSetting`, `AppEnv` (Task 1)
- Produces:
  - Auth-middleware doet `c.set('auth', auth)`; `sessionOnly: MiddlewareHandler<AppEnv>` (403 `'Forbidden'` tenzij `auth.kind` `session` of `dev`) in `src/index.ts`, geëxporteerd voor de andere route-bestanden
  - `shiftWallClock(iso: string, fromTz: string, toTz: string): string` in `src/time.ts` (zet de globale zone tijdelijk om en terug; gat → wat `zonedToUtc` geeft)
  - `GET /api/settings` → `{ timeZone, reminderTime, weekStart, defaultLocale, fallbackWebhook: string | null, fallbackFromEnv: boolean }`
  - `PATCH /api/settings` met een deel van `{ timeZone, reminderTime, weekStart, defaultLocale, fallbackWebhook: string | null }` → zelfde vorm als GET. Fouten: `err.invalid_timezone`, `err.invalid_time`, `err.invalid_week_start`, `err.invalid_locale`, `err.invalid_webhook` (alleen `https://`, max 2000 tekens). `fallbackWebhook: null` wist de rij (terug naar config), `''` = uit.
  - `POST /api/settings/webhook-test` → `{ ok: boolean }` (stuurt `{ title: 'Tick', body: t('push.test_body'), url: '/' }` naar de effectieve webhook; zonder webhook 400 `err.no_webhook`)
  - `test/helpers.ts`: `session(): Promise<string>` (logt in met `randomIp()`, geeft `tick_session=…`)

- [ ] **Step 1: Falende tests** `test/instellingen-api.test.ts` (reset in `afterEach`: `DELETE FROM settings WHERE key IN ('timezone','reminder_time','week_start','default_locale','fallback_webhook')`):
```ts
it('vereist een sessie: een Bearer-sleutel krijgt 403', async () => {
  expect((await call('/api/settings')).status).toBe(403);
});
it('PATCH bewaart en GET geeft terug', async () => {
  const cookie = await session();
  const res = await call('/api/settings', { method: 'PATCH', auth: null, headers: { cookie }, json: { reminderTime: '08:15', weekStart: 'sun' } });
  expect(await json(res)).toMatchObject({ reminderTime: '08:15', weekStart: 'sun', timeZone: 'Europe/Amsterdam' });
});
it.each([[{ timeZone: 'Mars/Olympus' }], [{ reminderTime: '25:00' }], [{ weekStart: 'tue' }], [{ defaultLocale: 'de' }], [{ fallbackWebhook: 'http://x' }]])
  ('weigert %o met 400', async (body) => { /* PATCH met sessie → 400 */ });
it('tijdzonewissel houdt de kloktijd vast', async () => {
  // Amsterdam → London. Open taak 10:00 Amsterdam (08:00Z in okt 2030? kies 2030-01-07T09:00:00Z = 10:00 CET)
  // wordt 10:00 London = 2030-01-07T10:00:00Z; repeat_start en repeat_at idem; wekelijkse taak di 23:30 CET blijft di 23:30.
  // Afgeronde taak en taak zonder reminder: ongewijzigd. Reminder 2030-03-31 02:30 lokaal (gat) → geldig moment, geen fout.
});
```
Schrijf de laatste test uit met echte taken via `createTask` en een directe `UPDATE` voor de afgeronde taak; controleer met `zonedParts` in de nieuwe zone dat `h/mi/wd` gelijk bleven.

- [ ] **Step 2: Run** `npx vitest run test/instellingen-api.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer.** Bij een andere `timeZone`: één `db.batch` met een `UPDATE` per open taak (`done = 0`) voor `remind_at`, `repeat_start`, `repeat_at` (alleen niet-null) en `repeat_prev = NULL`; daarna `setSetting('timezone', …)` en `setTimeZone`. Valideer zones met `new Intl.DateTimeFormat('en', { timeZone })` in try/catch.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Instellingen-API: tijdzone, reminder-tijd, week, standaardtaal en webhook; kloktijd blijft bij zonewissel`

---

### Task 4: Sleutels in de app, oude secrets blijven werken

**Files:**
- Create: `src/keys.ts`, `test/sleutels.test.ts`
- Modify: `src/auth.ts`, `src/index.ts` (mount, auth-aanroep), `public/i18n.js`

**Interfaces:**
- Consumes: `Prefs.envApiTokenOff/envInboxTokenOff`, `sessionOnly`, `setSetting`
- Produces:
  - `Auth` wordt `{ kind: 'dev' } | { kind: 'token'; keyId: string } | { kind: 'inbox'; keyId: string } | { kind: 'session'; renew: boolean }`; env-sleutels hebben `keyId` `'env-api'` / `'env-inbox'`
  - `authorize(req: Request, env: Env, prefs: Prefs): Promise<Auth | null>`: Bearer → eerst `api_keys` op `hash`, dan `API_TOKEN`/`INBOX_TOKEN` als niet uit. Gebruik bijwerken hoogstens eens per uur (`last_used_at`, of `env_*_token_used` in settings).
  - `newKey(): string` (`'tick_' + base64url(32 random bytes)`), `hashKey(key: string): Promise<string>` (SHA-256 hex) in `src/keys.ts`
  - `GET /api/keys` → `{ keys: { id, name, kind, hint, created_at, last_used_at }[], env: { id: 'env-api' | 'env-inbox', kind, off: boolean, last_used_at: string | null }[] }` (env-rij alleen als de secret gezet is)
  - `POST /api/keys` `{ name (1-60), kind: 'full' | 'inbox' }` → 201 `{ id, name, kind, hint, created_at, key }` (`key` alleen hier)
  - `DELETE /api/keys/:id` → `{ ok: true }` (404 onbekend; verwijdert ook de `devices`-rij)
  - `PATCH /api/keys/env-api` en `/env-inbox` `{ off: boolean }` → `{ ok: true }`

- [ ] **Step 1: Falende tests** `test/sleutels.test.ts`:
```ts
it('een nieuwe full-sleutel werkt voor de API, niet voor de inbox; ingetrokken → 401', async () => {
  const cookie = await session();
  const made = await json<{ id: string; key: string; hint: string }>(await call('/api/keys', { method: 'POST', auth: null, headers: { cookie }, json: { name: 'Pixel', kind: 'full' } }));
  expect(made.key).toMatch(/^tick_[A-Za-z0-9_-]{43}$/); expect(made.key.endsWith(made.hint)).toBe(true);
  expect((await call('/api/tasks', { auth: `Bearer ${made.key}` })).status).toBe(200);
  expect((await call('/api/inbox', { method: 'POST', auth: `Bearer ${made.key}`, json: { title: 'x' } })).status).toBe(403);
  await call(`/api/keys/${made.id}`, { method: 'DELETE', auth: null, headers: { cookie } });
  expect((await call('/api/tasks', { auth: `Bearer ${made.key}` })).status).toBe(401);
});
it('een inbox-sleutel mag alleen POST /api/inbox', async () => { /* 201 op inbox, 403 op /api/tasks */ });
it('de lijst toont nooit de sleutel of de hash', async () => { /* JSON bevat geen 'tick_' en geen 'hash' */ });
it('oude API_TOKEN uitschakelen → 401, weer inschakelen → 200', async () => { /* PATCH /api/keys/env-api {off:true}; call('/api/tasks') → 401; {off:false} → 200 */ });
it('een Bearer-sleutel kan geen sleutels beheren', async () => { expect((await call('/api/keys')).status).toBe(403); });
it('naam leeg of te lang → 400; kind onbekend → 400', async () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run test/sleutels.test.ts test/auth.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer** volgens Interfaces; de bestaande controle in de auth-middleware (`inbox` alleen op `POST /api/inbox`, `token` niet op de inbox) blijft op `kind` werken.
- [ ] **Step 4: Run** `npm test` — Expected: PASS (ook alle bestaande tests met `test-token`).
- [ ] **Step 5: Commit** `Sleutels in de app: alleen de hash bewaard, intrekken werkt meteen, oude secrets uit te schakelen`

---

### Task 5: Wachtwoord wijzigen en uitloggen op andere apparaten

**Files:**
- Create: `src/password.ts`, `src/account.ts`, `test/account.test.ts`
- Modify: `src/auth.ts` (`passwordOk`), `src/index.ts` (`/login` gebruikt prefs, mount), `public/i18n.js`

**Interfaces:**
- Consumes: `Prefs.passwordHash`, `sessionOnly`, `setSetting`, `sessionCookie`
- Produces:
  - `hashPassword(pw: string): Promise<string>` → `'pbkdf2$100000$<salt b64>$<hash b64>'` (PBKDF2-SHA-256, 16 bytes salt, 32 bytes hash); `verifyPassword(pw: string, stored: string): Promise<boolean>` in `src/password.ts`
  - `passwordOk(env: Env, prefs: Prefs, password: string): Promise<boolean>`: `password_hash` aanwezig → alleen die; anders `LOGIN_PASSWORD`; geen van beide → false
  - `bumpSessionVersion(db: D1Database): Promise<void>` in `src/auth.ts`
  - `POST /api/account/password` `{ current, next }` → `{ ok: true }` + `Set-Cookie`; via `LOGIN_LIMITER` (429 `err.too_many_attempts`); fout huidig → 401 `err.wrong_password`; `next` korter dan 8 → 400 `err.password_short`
  - `POST /api/account/logout-others` → `{ ok: true }` + `Set-Cookie` (verse cookie met de nieuwe versie)

- [ ] **Step 1: Falende tests** `test/account.test.ts` (`afterEach`: `DELETE FROM settings WHERE key='password_hash'`):
```ts
it('wachtwoord wijzigen: oud werkt niet meer, nieuw wel, andere sessies uitgelogd, deze blijft', async () => {
  const a = await session(); const b = await session();
  const res = await call('/api/account/password', { method: 'POST', auth: null, headers: { cookie: a, 'cf-connecting-ip': randomIp() }, json: { current: 'test-wachtwoord', next: 'nieuw-wachtwoord' } });
  expect(res.status).toBe(200);
  const fresh = res.headers.get('set-cookie')!.split(';')[0];
  expect((await call('/api/tasks', { auth: null, headers: { cookie: fresh } })).status).toBe(200);
  expect((await call('/api/tasks', { auth: null, headers: { cookie: b } })).status).toBe(401);
  expect((await login('test-wachtwoord')).status).toBe(401);
  expect((await login('nieuw-wachtwoord')).status).toBe(200);
});
it('noodroute: password_hash wissen → LOGIN_PASSWORD geldt weer', async () => { /* zet hash, DELETE de rij, login('test-wachtwoord') → 200 */ });
it('met password_hash werkt inloggen ook zonder LOGIN_PASSWORD', async () => { /* passwordOk({ ...env, LOGIN_PASSWORD: '' }, prefsMetHash, 'x') → true */ });
it('fout huidig wachtwoord → 401; te kort → 400', async () => { /* … */ });
it('uitloggen op andere apparaten', async () => { /* a, b; POST logout-others met a → b 401, verse cookie van a 200 */ });
it('verifyPassword weigert een ander wachtwoord en een kapotte hash', async () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run test/account.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer** volgens Interfaces (constant-time vergelijken zoals `safeEqual`).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Account: wachtwoord wijzigen in de app (PBKDF2, noodroute via LOGIN_PASSWORD) en uitloggen op andere apparaten`

---

### Task 6: Apparaten en meldingen in de taal van elk abonnement

**Files:**
- Create: `src/devices.ts`, `test/apparaten.test.ts`
- Modify: `src/push.ts`, `src/index.ts` (push-routes, mount), `test/reminders.test.ts`, `public/i18n.js`

**Interfaces:**
- Consumes: `Auth.keyId` (Task 4), `sessionOnly`, `Prefs.defaultLocale/fallbackWebhook`
- Produces:
  - `POST /api/push/subscribe` neemt optioneel `locale` (`en`|`nl`) mee en bewaart het
  - `sendToAll(env: Env, make: (locale: 'en' | 'nl') => Payload, defaultLocale: 'en' | 'nl'): Promise<{ ok: number; total: number }>`; `runReminders(env: Env, prefs: Prefs)`; fallback gebruikt `prefs.fallbackWebhook` en `defaultLocale`
  - `POST /api/device` (alleen `auth.kind === 'token'`, anders 403) `{ name (1-100), notifications: boolean, location: 'always' | 'foreground' | 'off', app_version?: string }` → `{ ok: true }` (upsert op `keyId`)
  - `GET /api/devices` → `{ browsers: { endpoint, user_agent, created_at, locale }[], phones: { key_id, name, last_used_at, status: { name, notifications, location, app_version, seen_at } | null }[] }`; `phones` = alle `full`-sleutels plus `env-api` als `API_TOKEN` gezet en niet uit

- [ ] **Step 1: Falende tests**:
```ts
it('een telefoon meldt zijn status en die verschijnt bij de apparaten', async () => {
  await call('/api/device', { method: 'POST', json: { name: 'Pixel 8', notifications: true, location: 'foreground', app_version: '1.2' } });
  const d = await json<any>(await call('/api/devices', { auth: null, headers: { cookie: await session() } }));
  expect(d.phones.find((p: any) => p.key_id === 'env-api').status).toMatchObject({ name: 'Pixel 8', location: 'foreground', notifications: true });
});
it('POST /api/device weigert een sessie en een inbox-sleutel (403) en onzin (400)', async () => { /* … */ });
it('een reminder gaat in de taal van het abonnement', async () => { /* in test/reminders.test.ts: twee abonnementen met locale nl en en, fetch gemockt zoals daar al gebeurt; actions[0].title per abonnement 'Klaar'/'Done' (de echte i18n-waarden) */ });
```
- [ ] **Step 2: Run** `npx vitest run test/apparaten.test.ts test/reminders.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer**; `POST /api/push/test` bouwt de payload per abonnement-taal.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Apparaten: Android meldt zijn status, meldingen in de taal van elk abonnement`

---

### Task 7: Backup downloaden en terugzetten

**Files:**
- Create: `src/data.ts`, `test/backup.test.ts`
- Modify: `src/index.ts` (mount; `TaskRow`-kolommen exporteren), `public/i18n.js`

**Interfaces:**
- Consumes: `sessionOnly`, `TaskRow`
- Produces:
  - `GET /api/export` → `{ app: 'tick', version: 1, exported_at, tasks: TaskRow[], places: PlaceRow[] }` met `Content-Disposition: attachment; filename="tick-backup-JJJJ-MM-DD.json"` (datum in de ingestelde zone)
  - `POST /api/import/backup` (body = dat JSON) → `{ tasks: number, places: number, skipped: number }`. 400 `err.backup_invalid` bij verkeerde vorm, andere `app` of `version`
  - `insertBatched(db: D1Database, stmts: D1PreparedStatement[], size = 50): Promise<void>` in `src/data.ts` (hergebruikt in Task 8)

- [ ] **Step 1: Falende tests** `test/backup.test.ts`:
```ts
it('export → wijzigen → terugzetten herstelt; nieuwere taken blijven; subtaken blijven bestaan', async () => {
  // ouder P met subtaak S (beide via createTask); export; P.title wijzigen; S verwijderen; nieuwe taak N; extra subtaak S2 onder P
  // import → P.title terug, S terug, N bestaat nog, S2 bestaat nog (geen cascade-verlies)
});
it('een subtaak waarvan de ouder ontbreekt wordt een gewone taak', async () => { /* parent_id naar onbekend id → na import parent_id null */ });
it('een plek met een bestaande naam onder een ander id wordt overgeslagen en geteld', async () => { /* skipped === 1 */ });
it('weigert een ongeldig bestand', async () => { for (const b of [{}, { app: 'x', version: 1 }, { app: 'tick', version: 2 }, { app: 'tick', version: 1, tasks: [{ id: 1 }] }]) /* 400 */; });
it('de export bevat geen instellingen, sleutels of wachtwoord', async () => { /* keys(body) === app,version,exported_at,tasks,places */ });
it('een backup van 1.200 taken lukt', async () => { /* genereer rijen, import → tasks === 1200 */ });
```
- [ ] **Step 2: Run** `npx vitest run test/backup.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer** met `INSERT INTO tasks (…) VALUES (…) ON CONFLICT(id) DO UPDATE SET col = excluded.col, …` (nooit `INSERT OR REPLACE`: dat wist subtaken via `ON DELETE CASCADE`). Ouders vóór subtaken. Alleen bekende kolommen (whitelist uit `TaskRow`); verplicht: `id`, `title`, `position`, `created_at`, `updated_at` als string/number.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Gegevens: backup downloaden en terugzetten (samenvoegen op id, wist nooit)`

---

### Task 8: TickTick-import vanuit de app

**Files:**
- Create: `public/ticktick.js`, `test/ticktick.test.ts`
- Modify: `scripts/csv.mjs`, `scripts/import-ticktick.mjs`, `src/data.ts`

**Interfaces:**
- Consumes: `insertBatched` (Task 7), `sessionOnly`
- Produces:
  - `public/ticktick.js` (geen imports, gedeeld door Worker en script): `parseCsv(s: string): string[][]` (verhuisd uit `scripts/csv.mjs`), `readTickTickText(text: string): Record<string, string>[]` (BOM weg, kopregel `Folder Name`), `tickTickRows(rows): { tasks: ImportTask[]; skipped: number }` met `ImportTask = { id, title, description, list, parent_id, position, remind_at, done, done_at, created_at }` (de mapping uit `import-ticktick.mjs`)
  - `scripts/import-ticktick.mjs` gebruikt die functies en schrijft dezelfde SQL als nu
  - `POST /api/import/ticktick` (body = CSV-tekst, max 10 MB) → `{ added: number, existing: number, skipped: number }`; `INSERT OR IGNORE` met `source = 'import'`; 400 `err.ticktick_invalid` als de kopregel ontbreekt

- [ ] **Step 1: Falende tests** `test/ticktick.test.ts` met een kleine CSV-fixture als string (kopregels zoals TickTick, één ouder, één subtaak, één afgeronde, één zonder titel):
```ts
it('importeert, en opnieuw importeren laat bestaande taken met rust', async () => {
  const first = await json<any>(await importCsv(CSV));
  expect(first).toEqual({ added: 3, existing: 0, skipped: 1 });
  await call('/api/tasks/ttA1', { method: 'PATCH', json: { title: 'Gewijzigd in Tick' } });
  expect(await json<any>(await importCsv(CSV))).toEqual({ added: 0, existing: 3, skipped: 1 });
  // titel van ttA1 is nog 'Gewijzigd in Tick'
});
it('weigert tekst zonder TickTick-kop', async () => { /* 400 */ });
it('parseCsv: aanhalingstekens, komma\'s en regeleinden in velden', () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run test/ticktick.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer**; check het script met `node scripts/import-ticktick.mjs` op een tijdelijk fixture-bestand in de scratchpad (zelfde aantal regels als vóór de wijziging).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `Gegevens: TickTick-import vanuit de app; parser gedeeld met het script`

---

### Task 9: Weergave en taal in de browser

**Files:**
- Modify: `public/theme.js`, `public/settings.js`, `public/style.css`, `public/repeatpicker.js`, `public/push.js` (locale meesturen), `test/repeatpicker.test.ts`

**Interfaces:**
- Consumes: `CONFIG` (Task 1/2), `pickLocale` (Task 2), `weekdayOrder` (Task 1)
- Produces:
  - `localStorage`-sleutels: `tick.theme` (bestaand), `tick.font` (`s`|`m`|`l`|`xl`), `tick.density` (`compact`|`normal`|`roomy`), `tick.lang` (`en`|`nl`; afwezig = automatisch), `tick.settings-cache` (laatste `GET /api/settings`, JSON)
  - `theme.js` zet vóór de eerste weergave `data-theme`, `data-font`, `data-density` op `<html>` (alleen bekende waarden)
  - `settings.js`: `setLanguage(choice: 'en' | 'nl' | null): void` (bewaart in `localStorage` + cookie `tick_lang=…; Path=/; Max-Age=31536000; SameSite=Lax; Secure`, of wist beide), en bij start: `setLocale(choice ?? pickLocale(navigator.languages) ?? CONFIG.defaultLocale)` en `applyI18n(document)` als `<html lang>` afwijkt (vertaalt `[data-i18n]` en `[data-i18n-attr]`)
  - CSS: alle `font-size` in `style.css` naar `rem` (16px = 1rem); `html[data-font=s|m|l|xl] { font-size: 14px | 16px | 18px | 20px }`; rijhoogte van taken via `--row-pad` met `html[data-density=compact|normal|roomy]`
  - Ritmekiezer toont de dagknoppen in `weekdayOrder(CONFIG.weekStart)`

- [ ] **Step 1: Falende test** in `test/repeatpicker.test.ts`: exporteer uit `repeatpicker.js` de pure functie `chipDays(weekStart: 'mon' | 'sun'): number[]` (= `weekdayOrder(weekStart)`, de volgorde waarin de chips worden gebouwd) en test `chipDays('sun')[0] === 6`. Als `repeatpicker.js` niet zonder DOM te importeren is, zet `chipDays` in `public/repeat.js` en laat de kiezer hem gebruiken.
- [ ] **Step 2: Run** `npx vitest run test/repeatpicker.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer.** `push.js` stuurt `locale: getLocale()` mee bij `subscribe`.
- [ ] **Step 4: Run** `npm test` en `npm run typecheck` — Expected: PASS. Daarna in de browser (`npm run dev`, `DEV_AUTH_BYPASS=1` in `.dev.vars`): zet in de console `localStorage['tick.font']='xl'`, herlaad, controleer op 360px breed dat niets overloopt; idem `tick.lang='nl'` geeft Nederlandse shell zonder herladen-flits van Engels.
- [ ] **Step 5: Commit** `Weergave en taal per apparaat: lettergrootte, ruimte, taalkeuze met cookie, week begint op`

---

### Task 10: De instellingenpagina

**Files:**
- Create: `public/settingsview.js`
- Modify: `public/index.html` (zijbalk: `#btn-push`, `#btn-theme`, `#btn-logout` weg; `#btn-settings` "⚙ Instellingen" erin), `public/app.js` (thema-knop en uitloggen weg, ingang + `popstate`), `public/push.js` (logica herbruikbaar maken), `public/style.css`, `public/sw.js` (`SHELL` + `/settingsview.js`, `CACHE = 'tick-shell-v7'`), `public/i18n.js`, `test/offline.test.ts`, `test/shell.test.ts`

**Interfaces:**
- Consumes: alle routes uit Task 3–8, `setLanguage` (Task 9), `ask` uit `dialog.js`, `el`/`toast`/`status` uit `render.js`, `request` uit `api.js`
- Produces:
  - `openSettings({ push?: boolean }): void` en `closeSettings(): void` in `public/settingsview.js`; de pagina vervangt de inhoud van `#main` (zoekveld, invoer en lijst verborgen), `history.pushState({ settings: true }, '')`; terug/Escape sluit
  - `push.js`: `pushState(reg): Promise<{ supported: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean; iosNeedsHomeScreen: boolean }>`, `enablePush(reg): Promise<void>`, `disablePush(reg): Promise<void>`, `resubscribeLocale(reg): Promise<void>`
- Blokken in deze volgorde, elk een `<section class="set-block">` met icoon en titel: 🎨 Weergave, 🌍 Taal en tijd, 🔔 Meldingen, 📱 Apparaten, 👤 Account, 💾 Gegevens, 🛠 Geavanceerd (`<details>`, dicht). Inhoud precies zoals de spec ("Onderdelen in detail") en mockup `page-a-v2.html`.
- Gedrag dat de bouwer niet mag missen:
  - Weergave toont een voorbeeldtaak die direct meeverandert; wijzigen zet `data-*` op `<html>` en `localStorage`.
  - Taal wisselen: `setLanguage`, `resubscribeLocale`, dan `location.reload()`.
  - Offline (`state.offline` of een `Offline`-fout): 🏠-velden tonen `tick.settings-cache`, uitgeschakeld, met `t('set.online_only')`. 📱-delen werken.
  - Tijdzonelijst uit `Intl.supportedValuesOf('timeZone')`, knop "Van dit apparaat" vult `Intl.DateTimeFormat().resolvedOptions().timeZone` in; na opslaan `setTimeZone` en `load()`.
  - Android koppelen: `ask` om een naam → `POST /api/keys` `{kind:'full'}` → dialoog met de sleutel, Kopieer-knop (`navigator.clipboard.writeText`) en drie stappen; het woord "token" komt in geen enkele `set.*`-tekst voor.
  - Apparaten toont ook de andere browsers met meldingen (naam afgeleid uit `user_agent`, aangemeld op) met Verwijderen (`DELETE /api/push/subscribe`).
  - Geavanceerd bevat: Standaardtaal (`PATCH /api/settings {defaultLocale}`), Sleutels, Fallback-webhook met Test-knop (`POST /api/settings/webhook-test`) en, als alleen de secret bestaat, de tekst "ingesteld in de installatie".
  - Telefoonrij zonder `status`: "laatst gezien …" + `t('set.update_app')`. Locatie ≠ `always` of meldingen uit → waarschuwing met uitleg.
  - Oude sleutel uitschakelen: als `last_used_at` binnen 7 dagen ligt, eerst `ask` met waarschuwing dat dat apparaat dan stopt.
  - Wachtwoordformulier toont onder de knop de noodroute-regel uit SETUP.md.
  - Backup: download via `fetch('/api/export')` → `Blob` → `URL.createObjectURL` → tijdelijke `<a download>`; terugzetten: `<input type=file accept=".json">`, inhoud tonen ("{tasks} taken, {places} plekken, van {date}"), `ask` bevestigen, `POST`, toast met aantallen, `load()`. TickTick: `<input type=file accept=".csv">`, tekst `POST`en, toast met aantallen.

- [ ] **Step 1: Falende tests**: `test/offline.test.ts` verwacht `/settingsview.js` in `SHELL` en `CACHE === 'tick-shell-v7'`; `test/shell.test.ts` verwacht `id="btn-settings"` en geen `btn-theme`/`btn-push`/`btn-logout`; `test/i18n.test.ts` (nieuw geval): geen enkele `set.*`-waarde bevat `token` (hoofdletterongevoelig) in `en` of `nl`.
- [ ] **Step 2: Run** `npx vitest run test/offline.test.ts test/shell.test.ts test/i18n.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementeer** de pagina.
- [ ] **Step 4: Run** `npm test` en `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Controleer in de browser** (`npm run dev` via `preview_start`, mobiel 375px en desktop): elk blok zichtbaar en gescheiden; lettergrootte/ruimte/thema veranderen direct; taal wisselen; tijdzone opslaan; sleutel maken, kopiëren, intrekken; backup downloaden en terugzetten; Geavanceerd klapt open; offline (DevTools offline via `javascript_tool` niet mogelijk → zet de server stil met `preview_stop` en herlaad) toont 🏠 uitgeschakeld. Geen consolefouten (`read_console_messages`). Screenshot voor Dio.
- [ ] **Step 6: Commit** `Instellingenpagina in de PWA; zijbalk met alleen ⚙ Instellingen`

---

### Task 11: Android meldt zijn status

**Files:**
- Create: `android/app/src/main/java/nl/detussenpartij/tick/DeviceStatus.java`, `android/app/src/test/java/nl/detussenpartij/tick/DeviceStatusTest.java`
- Modify: `Sync.java` (na een geslaagde refresh `DeviceStatus.report(c)`), `Prefs.java` (laatste melding: JSON + tijd), `android/app/build.gradle` (`versionName '1.2'`)

**Interfaces:**
- Consumes: `POST /api/device` (Task 6)
- Produces:
  - `static String json(String name, boolean notifications, String location, String appVersion)` en `static boolean shouldSend(String lastJson, long lastAtMs, String json, long nowMs)` (true als anders, of ouder dan 6 uur) in `DeviceStatus` — pure Java, JUnit
  - `static void report(Context c)`: naam `Build.MANUFACTURER + " " + Build.MODEL`; meldingen zoals `MainActivity.notificationsOk()`; locatie `always` (fijn + achtergrond), `foreground` (alleen fijn), `off`; fouten slikken (status is niet kritiek)

- [ ] **Step 1: Falende JUnit-test** `DeviceStatusTest`: zelfde JSON binnen 6 uur → false; zelfde na 6 uur + 1 ms → true; andere JSON → true; `json(...)` escapet aanhalingstekens in de naam.
- [ ] **Step 2: Run** `cd android && ./gradlew testDebugUnitTest --tests '*DeviceStatusTest*'` — Expected: FAIL.
- [ ] **Step 3: Implementeer.**
- [ ] **Step 4: Run** `cd android && ./gradlew testDebugUnitTest` — Expected: PASS (alle bestaande tests ook).
- [ ] **Step 5: Commit** `Android: meldt meldingen- en locatiestatus aan Tick voor de pagina Apparaten`

---

### Task 12: Documentatie en eindcontrole

**Files:**
- Modify: `ARCHITECTURE.md` (Settings-tabel met voorrang D1 → config → standaard en de 📱/🏠-verdeling; datamodel `api_keys`, `devices`, `push_subscriptions.locale`, `settings`-sleutels; API-tabel met alle nieuwe routes; Language: taal per apparaat; Security: sleutels als hash, sessie-only routes, PBKDF2; Layout: zijbalk met ⚙; Offline: `settingsview.js`; Known limitations: Android snel toevoegen houdt 09:00), `SETUP.md` (na de installatie gaat alles in de app; `LOCALE`/`TIMEZONE`/`FALLBACK_WEBHOOK` zijn startwaarden; `API_TOKEN`/`INBOX_TOKEN` optioneel, telefoon koppelen in de app; noodroute wachtwoord met het exacte commando uit de spec; TickTick-import ook in de app), `README.md` (regel over de instellingenpagina), `wrangler.example.jsonc` (commentaar "startwaarde; in de app te wijzigen" bij `LOCALE`, `TIMEZONE`)

- [ ] **Step 1: Werk de documenten bij** zoals hierboven.
- [ ] **Step 2: Run** `npm run typecheck` en `npm test` — Expected: beide groen; noteer aantallen.
- [ ] **Step 3: Commit** `Docs: instellingenpagina in ARCHITECTURE, SETUP en README`
- [ ] **Step 4: Whole-branch review** (superpowers:requesting-code-review), bevindingen verwerken, opnieuw typecheck + test, commit.
