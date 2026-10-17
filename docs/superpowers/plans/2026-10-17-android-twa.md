# Android-app als TWA: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De bestaande Android-app opent de PWA schermvullend als Trusted Web Activity en koppelt zichzelf na het inloggen, zonder sleutel te plakken.

**Architecture:** De Worker serveert `/.well-known/assetlinks.json` en een eenmalige koppelcode (`/api/pair`). De PWA herkent dat hij in de app draait (`?app=android`), geeft de code via een `intent://pair`-link aan de app en zet web push aan. De Android-app start via Android Browser Helper (`LauncherActivity`), wisselt de code in voor een `full`-sleutel en opent widget- en meldingstikken in de TWA.

**Tech Stack:** Cloudflare Worker (Hono, D1, vitest met `@cloudflare/vitest-plugin`), PWA zonder build-stap, Android (Java 17, AGP 8.13, minSdk 31) met `com.google.androidbrowserhelper:androidbrowserhelper`.

**Spec:** `docs/superpowers/specs/2026-10-17-android-twa-design.md`

## Global Constraints

- Werk op branch `android-twa`. Lokaal committen; niet pushen, deployen of mergen zonder akkoord van Dio.
- Regels uit `CLAUDE.md` gelden: een nieuwe instelling komt in `wrangler.example.jsonc` (veilige standaard en comment), in Dio's `wrangler.jsonc` en in het `Env`-type in `src/index.ts`. Alle zichtbare tekst via `public/i18n.js` (`en` en `nl`, dezelfde sleutels); serverfouten via `HttpError(status, key)`.
- Migraties: alleen nieuwe bestanden. Dit plan voegt `migrations/0007_pair_codes.sql` toe.
- PWA: geen build-stap, geen inline scripts of stijlen. Een nieuwe module komt in `SHELL` in `public/sw.js`, en `CACHE` gaat van `tick-shell-v7` naar `tick-shell-v8`.
- Comments en commitberichten in het Nederlands, zoals de bestaande code. Elk commitbericht eindigt met `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Koppelcode: willekeurig, eenmalig, **2 minuten** geldig, alleen de hash opgeslagen. De terugvalknop verschijnt na **3 seconden**.
- Android: `versionCode 4`, `versionName '1.3'`. De start-URL is `tickBase + "/?app=android"`, plus `&pair=1` zolang er geen sleutel is.
- Android-teksten in `res/values/strings.xml` (en) en `res/values-nl/strings.xml`.
- Verifiëren: `npm run typecheck` en `npm test` groen. Voor Android in `android/`: `./gradlew testDebugUnitTest assembleDebug` geeft BUILD SUCCESSFUL. Voor PWA-wijzigingen ook in de browser met `npm run dev` (preview_start).
- De keystore en de wachtwoorden maakt Dio zelf. Claude typt of verzint geen wachtwoorden voor de echte ondertekeningssleutel.

## Review Focus

1. **Open redirect via `next`:** `//evil.example`, `/\evil.example`, `https://evil.example` en `javascript:` moeten allemaal naar `/` leiden (test in Task 2).
2. **`pair=1` overleeft de omweg via de login:** een niet-ingelogde `GET /?app=android&pair=1` stuurt door naar `/login?next=%2F%3Fapp%3Dandroid%26pair%3D1` (test in Task 2).
3. **Koppelcode misbruiken:** een tweede inwisseling, een verlopen code, een verzonnen code of een code zonder sessie aanmaken lukt nooit, en redeem heeft een rate limit (tests in Task 3).
4. **Sleutel alleen wissen bij 401:** een netwerkfout, time-out of 500 laat de sleutel staan; alleen HTTP 401 met een ingestelde sleutel wist hem (test in Task 6, `Api.shouldForget`).
5. **Melding aantikken terwijl de app al open staat op een andere taak:** het bestaande venster krijgt focus en toont de aangetikte taak, geen tweede venster (test in Task 4).

---

### Task 1: Digital Asset Links

**Files:**
- Create: `src/assetlinks.ts`
- Modify: `src/index.ts` (het `Env`-type, en de route vóór de auth-middleware, naast `/login`)
- Modify: `wrangler.example.jsonc` (onder `ANDROID_PACKAGE`), `vitest.config.ts` (bindings: `ANDROID_CERT_SHA256: ''`), Dio's `wrangler.jsonc` (lege waarde; de echte vingerafdruk volgt in Task 7)
- Modify: `ARCHITECTURE.md` (config-alinea en API-tabel)
- Test: `test/assetlinks.test.ts`

**Interfaces:**
- Produces: `assetLinks(pkg: string | undefined, certs: string | undefined): object[]` en de route `GET /.well-known/assetlinks.json`. In `Env`: `ANDROID_CERT_SHA256?: string`.

- [ ] **Step 1: Schrijf de falende tests**

```ts
import { assetLinks } from '../src/assetlinks';
const FP = 'AB:'.repeat(31) + 'CD';
it('geeft de verklaring voor package en vingerafdrukken', () => {
  expect(assetLinks('com.example.tick', ` ${FP.toLowerCase()} , ${FP}`)).toEqual([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'com.example.tick', sha256_cert_fingerprints: [FP] },
  }]);
});
it('zonder package of zonder geldige vingerafdruk een lege lijst', () => {
  expect(assetLinks('', FP)).toEqual([]);
  expect(assetLinks('com.example.tick', '')).toEqual([]);
  expect(assetLinks('com.example.tick', 'geen-vingerafdruk')).toEqual([]);
});
it('de route werkt zonder inlog en geeft JSON', async () => {
  const res = await call('/.well-known/assetlinks.json', { auth: null });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toEqual([]); // de testbindings hebben geen package
});
```

- [ ] **Step 2:** `npx vitest run test/assetlinks.test.ts`. **Verwacht:** FAIL (module bestaat niet).
- [ ] **Step 3: Implementeer** `assetLinks` in `src/assetlinks.ts`. Vingerafdrukken: splitsen op komma, `trim`, hoofdletters, ontdubbelen. Alleen geldig als `/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/`; een ongeldige waarde slaat hij over met één `console.error`. De route: `app.get('/.well-known/assetlinks.json', (c) => c.json(assetLinks(c.env.ANDROID_PACKAGE, c.env.ANDROID_CERT_SHA256)))`, vóór de auth-middleware.
- [ ] **Step 4:** Zet de config erbij. In `wrangler.example.jsonc` komt onder `ANDROID_PACKAGE`: `// "ANDROID_CERT_SHA256": "AA:BB:…"  // SHA-256 van je ondertekeningssleutel (komma's tussen meerdere); nodig om de app zonder adresbalk te openen`. Werk ook `ARCHITECTURE.md` bij.
- [ ] **Step 5:** `npm run typecheck` en `npm test`. **Verwacht:** groen.
- [ ] **Step 6: Commit:** "Android: assetlinks.json uit ANDROID_PACKAGE en ANDROID_CERT_SHA256"

---

### Task 2: Na inloggen terug naar waar je was (`next`)

**Files:**
- Create: `public/next.js`
- Modify: `src/index.ts` (de redirect in de auth-middleware, nu `c.redirect('/login')`)
- Modify: `src/login.ts` (`<script type="module" src="/login.js">`; `'/next.js'` in `loginAssets`)
- Modify: `public/login.js` (wordt een module, `import { safeNext } from './next.js'`, en na succes `location.href = safeNext(new URLSearchParams(location.search).get('next'))`)
- Modify: `ARCHITECTURE.md` (de login-rij)
- Test: `test/auth.test.ts` (redirect), `test/next.test.ts` (nieuw, `safeNext`)

**Interfaces:**
- Produces: `safeNext(raw: string | null): string` in `public/next.js`: een relatief pad op dezelfde host, anders `'/'`.

- [ ] **Step 1: Schrijf de falende tests**

```ts
// test/next.test.ts
import { safeNext } from '../public/next.js';
it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil'])('%s wordt /', (v) =>
  expect(safeNext(v)).toBe('/'));
it('een eigen pad met query blijft', () => expect(safeNext('/?app=android&pair=1')).toBe('/?app=android&pair=1'));

// test/auth.test.ts
it('stuurt een pagina zonder inlog door naar /login met next', async () => {
  const res = await call('/?app=android&pair=1', { auth: null, headers: { accept: 'text/html' } });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/login?next=%2F%3Fapp%3Dandroid%26pair%3D1');
});
it('zonder pad of query gewoon /login', async () => {
  const res = await call('/', { auth: null, headers: { accept: 'text/html' } });
  expect(res.headers.get('location')).toBe('/login');
});
```

- [ ] **Step 2:** `npx vitest run test/next.test.ts test/auth.test.ts`. **Verwacht:** FAIL.
- [ ] **Step 3: Implementeer.** `safeNext` accepteert alleen waarden die met `/` beginnen en niet met `//` of `/\`; de rest wordt `'/'`. In de middleware: `const target = new URL(c.req.url); const back = target.pathname + target.search;` en dan `c.redirect(back === '/' ? '/login' : '/login?next=' + encodeURIComponent(back))`. Pas daarna `src/login.ts` en `public/login.js` aan.
- [ ] **Step 4:** `npm run typecheck` en `npm test` zijn groen. Controleer in de browser (`npm run dev`, zonder `DEV_AUTH_BYPASS`, dus inloggen met het lokale wachtwoord uit `.dev.vars`): `/?task=x` → login → na inloggen staat `?task=x` in de adresbalk. Geen consolefouten.
- [ ] **Step 5: Commit:** "Login: na inloggen terug naar de opgevraagde pagina (alleen eigen paden)"

---

### Task 3: Koppelcodes (`/api/pair`)

**Files:**
- Create: `migrations/0007_pair_codes.sql`, `src/pair.ts`
- Modify: `src/keys.ts` (haal `createKey` uit `POST /`), `src/index.ts` (mount `pairApi` na de auth-middleware; `app.post('/api/pair/redeem', redeem)` vóór de auth-middleware)
- Modify: `public/i18n.js` (nieuwe foutsleutel `err.invalid_pair_code`, en + nl), `ARCHITECTURE.md` (datamodel `pair_codes`, API-tabel)
- Test: `test/koppelen.test.ts`

**Interfaces:**
- Produces:
  - `createKey(db: D1Database, name: string, kind: 'full' | 'inbox'): Promise<{ id: string; name: string; kind: string; hint: string; created_at: string; key: string }>` in `src/keys.ts`
  - `POST /api/pair` (alleen sessie) → 201 `{ id: string, code: string, expires_at: string }`
  - `GET /api/pair/:id` (alleen sessie) → `{ used: boolean }`; een onbekend id geeft 404
  - `POST /api/pair/redeem` (zonder login) met body `{ code: string, name?: string }` → 201 `{ key: string }`, of 400 `err.invalid_pair_code`; 429 bij te veel pogingen

Schema: `CREATE TABLE pair_codes (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT);`

- [ ] **Step 1: Schrijf de falende tests**

```ts
const pair = async (cookie: string) => json<{ id: string; code: string; expires_at: string }>(
  await call('/api/pair', { method: 'POST', auth: null, headers: { cookie } }));
const redeem = (code: string, name?: string) =>
  call('/api/pair/redeem', { method: 'POST', auth: null, json: { code, name }, headers: { 'cf-connecting-ip': randomIp() } });

it('alleen met een sessie: Bearer of niets geeft 401/403', async () => {
  expect((await call('/api/pair', { method: 'POST' })).status).toBe(403);
  expect((await call('/api/pair', { method: 'POST', auth: null })).status).toBe(401);
});
it('inwisselen geeft een werkende full-sleutel met de naam, en de code is daarna op', async () => {
  const cookie = await session();
  const { id, code } = await pair(cookie);
  const res = await redeem(code, 'Pixel 9');
  expect(res.status).toBe(201);
  const { key } = await json<{ key: string }>(res);
  expect((await call('/api/tasks', { auth: `Bearer ${key}` })).status).toBe(200);
  const keys = await json<{ keys: { name: string; kind: string }[] }>(await call('/api/keys', { auth: null, headers: { cookie } }));
  expect(keys.keys).toContainEqual(expect.objectContaining({ name: 'Pixel 9', kind: 'full' }));
  expect(await json(await call(`/api/pair/${id}`, { auth: null, headers: { cookie } }))).toEqual({ used: true });
  expect((await redeem(code)).status).toBe(400);
});
it('een verlopen of verzonnen code werkt niet', async () => {
  const { id, code } = await pair(await session());
  await env.DB.prepare('UPDATE pair_codes SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', id).run();
  expect((await redeem(code)).status).toBe(400);
  expect((await redeem('verzonnen')).status).toBe(400);
});
it('zonder naam heet de sleutel "Android"', async () => { /* redeem(code) → keys bevat name 'Android' */ });
it('de database bewaart alleen de hash van de code', async () => { /* SELECT hash FROM pair_codes: niet gelijk aan code */ });
it('te veel inwisselpogingen vanaf één IP geeft 429', async () => { /* 6× redeem('x') met hetzelfde cf-connecting-ip → de laatste 429 */ });
```

- [ ] **Step 2:** `npx vitest run test/koppelen.test.ts`. **Verwacht:** FAIL.
- [ ] **Step 3: Implementeer.**
  - Haal eerst `createKey` uit `keysApi.post('/')`. `test/sleutels.test.ts` moet groen blijven.
  - In `src/pair.ts`: de code is `newKey()` zonder het voorvoegsel `tick_`, opgeslagen met `hashKey`. `expires_at` is nu plus 2 minuten. `POST /` ruimt eerst verlopen en gebruikte rijen op: `DELETE FROM pair_codes WHERE expires_at < ? OR used_at IS NOT NULL`.
  - `redeem` gebruikt `LOGIN_LIMITER` met sleutel `'pair:' + ip`. De naam wordt getrimd, met maximaal 60 tekens en standaard `'Android'`.
  - Verbruiken in één statement: `UPDATE pair_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?`. Alleen bij `changes === 1` maakt hij de sleutel.
  - Een gebruikte rij blijft staan tot de volgende `POST /`, zodat `GET /:id` nog `used: true` kan melden.
- [ ] **Step 4:** `npm run typecheck`, `npm test` en `npm run db:migrate:local`. **Verwacht:** groen, en 0007 wordt toegepast.
- [ ] **Step 5: Commit:** "Koppelen: eenmalige koppelcode die de app inwisselt voor een full-sleutel"

---

### Task 4: De PWA in de app

**Files:**
- Create: `public/androidapp.js`, `public/swclick.js`
- Modify: `public/app.js` (start: `initAndroidApp(params)` aanroepen vóór de bestaande `history.replaceState`; het `?task=`-openen ook op een bericht van de service worker)
- Modify: `public/sw.js` (`notificationclick` zonder actie; `/androidapp.js` en `/swclick.js` in `SHELL`; `CACHE = 'tick-shell-v8'`)
- Modify: `public/settingsview.js` (Apparaten: knop "Telefooninstellingen" als `isInApp()`)
- Modify: `public/i18n.js` (`app.pair_button`, `app.pair_failed`, `app.duplicate_hint`, `app.duplicate_open`, `set.phone_settings`, en + nl)
- Modify: `ARCHITECTURE.md` (de rij "Android" en een korte alinea "In de app (TWA)")
- Test: `test/androidapp.test.ts` (nieuw), `test/offline.test.ts` (SHELL)

**Interfaces:**
- Consumes: `POST /api/pair` en `GET /api/pair/:id` (Task 3); `enablePush(reg)` en `pushState(reg)` uit `public/push.js`; `androidPackage` uit `/config.js` (`public/settings.js`).
- Produces (in `public/androidapp.js`):
  - `initAndroidApp(params: URLSearchParams): void`: onthoudt `?app=android` in `sessionStorage` (`tick.app`), haalt `app` en `pair` uit de adresbalk en start bij `pair=1` het koppelen.
  - `isInApp(): boolean`
  - `pairIntent(pkg: string, code: string): string`: geeft `intent://pair?code=<code>#Intent;scheme=tick;package=<pkg>;end` met `encodeURIComponent(code)`.
  - `openPhoneSettings(): void`: opent `intent://settings#Intent;scheme=tick;package=<pkg>;end`.
- Produces (sw → pagina): `postMessage({ type: 'open-task', id })`.

Gedrag:
- Koppelen: `POST /api/pair`, dan `location.href = pairIntent(...)`. Daarna peilt hij elke seconde `GET /api/pair/:id`. Is hij na 3 seconden nog niet `used`, dan toont hij een balk met de knop `app.pair_button` die hetzelfde intent opent; hij blijft peilen tot `used` of tot de code verloopt (2 minuten, daarna `app.pair_failed`). Is `used` binnen, dan verdwijnt de balk.
- Is de code gebruikt en is er nog geen abonnement (`pushState`), dan volgt `enablePush(reg)`. Fouten slikt hij stil in; de schakelaar in Instellingen blijft de terugvalroute.
- Dubbele meldingen: als `isInApp()` en `GET /api/devices` meer dan één browser met "Android" in `user_agent` laat zien, toont hij één keer `app.duplicate_hint` met een knop `app.duplicate_open` naar Instellingen › Apparaten. "Getoond" onthoudt hij in `localStorage` (`tick.dupHint`, in try/catch).
- Zonder `androidPackage` doet `initAndroidApp` niets met koppelen of intents.

- [ ] **Step 1: Schrijf de falende tests**

```ts
import { pairIntent } from '../public/androidapp.js';
it('bouwt het intent met gecodeerde code', () =>
  expect(pairIntent('com.example.tick', 'a+b/c')).toBe('intent://pair?code=a%2Bb%2Fc#Intent;scheme=tick;package=com.example.tick;end'));
```
In `test/offline.test.ts` komen `/androidapp.js` en `/swclick.js` in de verwachte SHELL-lijst.

Voor de service worker: `sw.js` is een klassiek script. Zet de keuze uit `notificationclick` in een nieuw klassiek script `public/swclick.js`, dat `self.tickClickTarget = (data, wins) => …` definieert. `sw.js` laadt het met `importScripts('/swclick.js')`. De test laadt het bestand met `fs.readFileSync` en voert het uit met `new Function('self', src)(fake)`. Daarna is `clickTarget = fake.tickClickTarget`:
```ts
expect(clickTarget({ taskId: 't1' }, [])).toEqual({ open: '/?task=t1' });
expect(clickTarget({ taskId: 't1' }, [win])).toEqual({ focus: win, message: { type: 'open-task', id: 't1' } });
expect(clickTarget({}, [])).toEqual({ open: '/' });
```

- [ ] **Step 2:** `npx vitest run test/androidapp.test.ts test/offline.test.ts`. **Verwacht:** FAIL.
- [ ] **Step 3: Implementeer** `public/androidapp.js`, de aanroep in `app.js`, de nieuwe `notificationclick` in `sw.js`, de knop in `settingsview.js` en de teksten. Op het bericht `open-task` doet `app.js` hetzelfde als bij `?task=`: de taak selecteren en tonen, mobiel met `pushState`.
- [ ] **Step 4:** `npm run typecheck` en `npm test` zijn groen. Controleer in de browser (`npm run dev`):
  - `/?app=android` geeft geen consolefouten en de adresbalk wordt `/`;
  - met `androidPackage` leeg: `/?app=android&pair=1` doet geen `POST /api/pair` (zie `read_network_requests`);
  - Instellingen › Apparaten toont "Telefooninstellingen" alleen na `?app=android`.
- [ ] **Step 5: Commit:** "PWA in de app: koppelen via intent, push aan, taak openen vanuit een melding"

---

### Task 5: TWA-starter en eigen ondertekening

**Files:**
- Modify: `android/app/build.gradle`:
  - dependency `com.google.androidbrowserhelper:androidbrowserhelper` (de nieuwste stabiele uit Google Maven);
  - `versionCode 4` en `versionName '1.3'`;
  - `manifestPlaceholders = [tickHost: <host uit tickBase>, tickBase: tickBase]`;
  - `resValue 'string', 'asset_statements', '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"web","site":"<tickBase>"}}]'`;
  - een release-`signingConfig` uit `tick.properties`: `tickKeystore`, `tickKeystorePassword`, `tickKeyAlias`, `tickKeyPassword`.
- Modify: `android/.gitignore` (`*.jks`, `*.keystore`)
- Create: `android/app/src/main/java/nl/detussenpartij/tick/StartUrl.java`, `TickLauncherActivity.java`
- Modify: `AndroidManifest.xml`:
  - `TickLauncherActivity` krijgt `MAIN/LAUNCHER`, met meta-data `android.support.customtabs.trusted.DEFAULT_URL` = `${tickBase}/?app=android` en de splash-gegevens;
  - `<meta-data android:name="asset_statements" android:resource="@string/asset_statements"/>` in `<application>`;
  - `DelegationService` met de intent-filter `android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE` en het meldingsicoon `ic_notify_place` of een nieuw `ic_notify`;
  - `MainActivity` verliest `MAIN/LAUNCHER` (dat volgt in Task 6).
- Modify: `SETUP.md` (keystore maken met `keytool -genkeypair -v -keystore tick-release.jks -alias tick -keyalg RSA -keysize 2048 -validity 10000`, de vier regels in `tick.properties`, `assembleRelease`, vingerafdruk ophalen met `keytool -list -v -keystore … -alias tick` → "SHA256", en `ANDROID_CERT_SHA256` zetten; daarnaast: de APK delen met anderen op dezelfde Tick werkt omdat hij met dezelfde sleutel is ondertekend; verwijder een oude PWA-installatie in Firefox of zet de meldingen daar uit; zonder Chrome (of een andere TWA-browser) opent de app met adresbalk), `.claude/skills/setup-tick/SKILL.md` (zelfde stappen)
- Test: `android/app/src/test/java/nl/detussenpartij/tick/StartUrlTest.java`

**Interfaces:**
- Produces:
  - `StartUrl.launch(String base, boolean needsPair): String` geeft `base + "/?app=android"`, plus `"&pair=1"` als `needsPair`.
  - `StartUrl.task(String base, String taskId, boolean needsPair): String` geeft `base + "/?app=android&task=" + <URL-gecodeerd id>`, plus `"&pair=1"`.
  - `TickLauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity` en overschrijft `getLaunchingUrl()`. Heeft het startende intent een `data`-Uri (zie Task 6), dan gebruikt hij die; anders `StartUrl.launch(Api.BASE, Prefs.token(this).isEmpty())`. In het eerste geval voegt hij `&pair=1` toe als er geen sleutel is.

- [ ] **Step 1: Schrijf de falende test**

```java
@Test public void launchZonderSleutel() { assertEquals("https://t.example/?app=android&pair=1", StartUrl.launch("https://t.example", true)); }
@Test public void launchMetSleutel() { assertEquals("https://t.example/?app=android", StartUrl.launch("https://t.example", false)); }
@Test public void taakWordtGecodeerd() { assertEquals("https://t.example/?app=android&task=a%2Fb", StartUrl.task("https://t.example", "a/b", false)); }
```
- [ ] **Step 2:** `./gradlew testDebugUnitTest`. **Verwacht:** FAIL (klasse bestaat niet).
- [ ] **Step 3: Implementeer** `StartUrl` (gebruik `java.net.URLEncoder` met UTF-8, zodat het in een gewone JUnit-test zonder Android draait), `TickLauncherActivity`, de manifest- en gradle-wijzigingen.
  - Ontbreken de signing-sleutels in `tick.properties`, dan blijft `assembleDebug` werken en faalt `assembleRelease` met: "Set tickKeystore, tickKeystorePassword, tickKeyAlias and tickKeyPassword in android/tick.properties to build a release".
- [ ] **Step 4:** `./gradlew testDebugUnitTest assembleDebug`. **Verwacht:** BUILD SUCCESSFUL. Controleer ook met `./gradlew assembleRelease` zonder signing-sleutels dat de melding hierboven verschijnt.
- [ ] **Step 5: Commit:** "Android: TWA-starter met meldingsdelegatie, start-URL met pair=1, release-ondertekening uit tick.properties"

---

### Task 6: Koppelen, instellingen en taken openen (Android)

**Files:**
- Create: `PairLink.java`, `PairActivity.java`, `Launch.java` in `android/app/src/main/java/nl/detussenpartij/tick/`
- Modify:
  - `Api.java`: `shouldForget` en het wissen bij 401;
  - `MainActivity.java`: wordt "Tick op deze telefoon";
  - `WidgetClickActivity.java` en `Notify.java`: openen via `Launch`;
  - `AndroidManifest.xml`: `PairActivity` voor `tick://pair`, en `MainActivity` voor `tick://settings` (VIEW, DEFAULT, BROWSABLE);
  - `res/values/strings.xml` en `res/values-nl/strings.xml`.
- Test: `PairLinkTest.java`, `ApiTest.java` in `android/app/src/test/java/nl/detussenpartij/tick/`

**Interfaces:**
- Consumes: `POST /api/pair/redeem` (Task 3); `StartUrl` en `TickLauncherActivity` (Task 5).
- Produces:
  - `PairLink.code(String uri): String`: de code uit `tick://pair?code=…`, of `null` bij een ander schema of host, of een lege code. Pure Java met `java.net.URI`.
  - `Api.shouldForget(int httpCode, boolean hasToken): boolean`: alleen `true` bij `401 && hasToken`.
  - `Api.redeem(Context c, String code, String name): String`: roept `/api/pair/redeem` aan zonder `Authorization` en geeft de sleutel terug, of gooit een `IOException`.
  - `Launch.task(Context c, String taskId)`: start `TickLauncherActivity` met `data = Uri.parse(StartUrl.task(Api.BASE, taskId, Prefs.token(c).isEmpty()))` en `FLAG_ACTIVITY_NEW_TASK`.

- [ ] **Step 1: Schrijf de falende tests**

```java
@Test public void leestCode() { assertEquals("abc", PairLink.code("tick://pair?code=abc")); }
@Test public void gecodeerdeCode() { assertEquals("a+b", PairLink.code("tick://pair?code=a%2Bb")); }
@Test public void anderSchemaOfLeeg() { assertNull(PairLink.code("https://pair?code=abc")); assertNull(PairLink.code("tick://sync?code=abc")); assertNull(PairLink.code("tick://pair")); }
@Test public void alleen401MetSleutelWist() {
  assertTrue(Api.shouldForget(401, true));
  assertFalse(Api.shouldForget(401, false));
  assertFalse(Api.shouldForget(500, true));
  assertFalse(Api.shouldForget(403, true));
}
```
- [ ] **Step 2:** `./gradlew testDebugUnitTest`. **Verwacht:** FAIL.
- [ ] **Step 3: Implementeer.**
  - `Api.call` wist bij `shouldForget` de sleutel (`Prefs.setToken(c, "")`) en zet `Prefs.setSyncError` op `R.string.error_no_key`, zodat de widget "niet gekoppeld" toont. Daarna gooit hij de `IOException` zoals nu.
  - `PairActivity` (doorzichtig thema, `noHistory`):
    - leest de code;
    - wisselt hem op een achtergrondthread in met naam `Build.MODEL`;
    - slaat de sleutel op, roept `SyncJob.syncSoon(this, null, null, 0)` aan en meldt de status via `DeviceStatus` (zoals `MainActivity` nu na "opslaan en testen");
    - vraagt daarna op Android 13+ `POST_NOTIFICATIONS` als die nog niet is gegeven, en sluit. De TWA staat er dan weer.
    - Mislukt het, dan volgt een `Toast` met `R.string.pair_failed`. De PWA toont dan zelf de knop.
  - `MainActivity`:
    - titel `R.string.phone_title` ("Tick op deze telefoon");
    - bovenaan de koppelstatus (gekoppeld of niet), met een knop "Open Tick" die `TickLauncherActivity` start;
    - de bestaande blokken voor locatie, meldingen en widget blijven;
    - het sleutelveld en "opslaan en testen" komen in een ingeklapt blok `R.string.advanced_key` ("Geavanceerd: sleutel handmatig invullen").
    - De dynamische snelkoppelingen worden `quick_add` en een nieuwe `phone_settings` naar `MainActivity`.
  - `WidgetClickActivity` (`ACTION_OPEN`) en `Notify` openen via `Launch.task`.
- [ ] **Step 4:** `./gradlew testDebugUnitTest assembleDebug`. **Verwacht:** BUILD SUCCESSFUL.
- [ ] **Step 5: Commit:** "Android: zelf koppelen via tick://pair, telefooninstellingen, taken openen in de app, sleutel vergeten bij 401"

---

### Task 7: Uitrol en test op de telefoon (samen met Dio)

**Files:** Dio's `wrangler.jsonc` en `android/tick.properties` (beide niet in git).

- [ ] **Step 1 (Dio):** Maak de keystore volgens SETUP.md, met eigen wachtwoorden. Zet de vier regels in `android/tick.properties` en bewaar een backup van keystore en wachtwoorden.
- [ ] **Step 2:** `./gradlew assembleRelease` geeft BUILD SUCCESSFUL. Haal de SHA-256 op (`keytool -list -v …`). Zet die in `ANDROID_CERT_SHA256` in Dio's `wrangler.jsonc`, met de debug-vingerafdruk erachter, na een komma.
- [ ] **Step 3 (akkoord van Dio vragen):** `npm run db:migrate` (0007), dan `npm run deploy` en `npx wrangler deployments list`. Controleer dat `https://<tick>/.well-known/assetlinks.json` het package en de vingerafdrukken toont.
- [ ] **Step 4 (Dio, op de telefoon):**
  - verwijder de oude hulp-app en installeer de release-APK;
  - open Tick: inloggen, en de app koppelt vanzelf;
  - geen adresbalk;
  - geef toestemming voor meldingen en stuur een testmelding vanuit Instellingen: die komt binnen als "Tick";
  - tik op een taak in de widget: de taak opent in de app;
  - verwijder de Firefox-PWA of zet de meldingen daarin uit.
- [ ] **Step 5:** Bouw versie 1.3.1 (`versionCode 5`, commit "Android 1.3.1") en installeer die over de vorige heen. Controleer dat de koppeling, widget en geofences blijven. Daarmee is doel 5 uit het ontwerp bewezen.
