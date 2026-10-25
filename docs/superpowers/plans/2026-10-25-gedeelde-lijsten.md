# Gedeelde lijsten: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een lijst delen met andere accounts, zodat elke taak in die lijst zonder uitnodiging per taak van alle leden is, met afgevinkte taken die blijven staan, "ik neem het mee" en meldingen die je zelf aanzet.

**Architecture:** Een gedeelde lijst krijgt een eigen id (`shared_lists`) en per persoon een lidmaatschap met de eigen naam van de lijst (`list_members`). Elke hoofdtaak in de lijst is van de eigenaar van de lijst (`tasks.user_id`), draagt `tasks.shared_list`, en heeft voor elk ander geaccepteerd lid een automatische, geaccepteerde `task_shares`-rij (modus `shared`). Daardoor werken toegang (`src/access.ts`), lijst en volgorde per persoon, herinneringen en plaatsmeldingen zonder wijziging; nieuw is alleen het bijhouden van die rijen bij aanmaken, verslepen, accepteren en vertrekken (`src/sharedlists.ts`). De PWA leest het deelstatus van een lijst uit `GET /api/lists` en krijgt `public/sharedlist.js`.

**Tech Stack:** Cloudflare Worker (Hono), D1, vitest met `@cloudflare/vitest-plugin`, PWA in vanilla JS zonder build.

**Spec:** `docs/superpowers/specs/2026-10-25-gedeelde-lijsten-design.md`

## Global Constraints

- Een schemawijziging is alleen `migrations/0017_gedeelde_lijsten.sql`; bestaande migraties niet aanpassen.
- Elke zichtbare tekst via `public/i18n.js` met `en` én `nl` (`test/i18n.test.ts`). Serverfouten: `HttpError(status, key, vars)`, nooit een zin. Nieuwe UI-sleutels onder het voorvoegsel `slist.`.
- Geen inline scripts of stijlen (CSP). Nieuwe module `public/sharedlist.js` in `SHELL` van `public/sw.js`, en `CACHE` ophogen (`tick-shell-v45` → `tick-shell-v46`).
- Tijden in UTC.
- Een id zonder toegang gedraagt zich als een id dat niet bestaat (404).
- Gedrag van losse gedeelde taken (buiten een gedeelde lijst) en kopiegroepen blijft zoals het is; de bestaande tests in `test/delen*.test.ts` en `test/kopie-*.test.ts` blijven slagen zonder aanpassing.
- Alleen modus `shared` wordt gebouwd; het schema staat `copy` al toe, de API weigert het (400 `err.list_mode`).
- Vaste teksten uit de spec (nl / en): "Ik neem het mee" / "I'll bring it"; "{name} neemt mee" / "{name} brings it"; "Jij neemt mee" / "You bring it"; "Afgevinkt" / "Ticked off"; "Opruimen" / "Clear".
- Klaar per taak: `npm run typecheck` en `npm test` slagen. Commitberichten in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Niet uitrollen, niet pushen. Docs: `ARCHITECTURE.md` per servertaak bijwerken; de user guide (`docs/sharing.md`, `docs/tasks-and-lists.md`) in Task 6.

## Review Focus

1. Een openstaande lijstuitnodiging lekt niets: vóór accepteren ziet de ontvanger geen taken van de lijst (`GET /api/tasks`, `/api/lists`, zoeken, `GET /api/tasks/:id`-achtige routes via `PATCH`). → test in Task 1.
2. Wie vertrekt of eruit gehaald wordt, heeft daarna geen toegang meer tot de taken (ook niet per id), krijgt geen herinneringen meer, en zijn taken op naam komen vrij. → tests in Task 1 en Task 3.
3. De outbox stuurt een offline aangemaakte taak in een gedeelde lijst opnieuw (zelfde client-id): dat geeft 200 en geen dubbele deelrijen. → test in Task 2.
4. Een taak met subtaken uit de lijst slepen door een lid: de subtaken verhuizen mee naar het lid (`user_id`), en een subtaak die het lid daarna toevoegt is ook van het lid. → test in Task 2.
5. Een herinnering op een taak in een gedeelde lijst gaat naar elk geaccepteerd lid precies één keer, en niet naar een lid met een openstaande uitnodiging. → test in Task 3.

---

### Task 1: Schema, lijst delen, accepteren, vertrekken

**Files:**
- Create: `migrations/0017_gedeelde_lijsten.sql`, `src/sharedlists.ts`
- Modify: `src/index.ts` (route `app.route('/api/shared-lists', sharedListsApi)`, `TaskRow` + `shared_list`, `done_by`, `claimed_by`; `GET /api/lists` krijgt `shared`), `ARCHITECTURE.md` (tabel `shared_lists`, `list_members`, de nieuwe routes)
- Test: `test/gedeelde-lijsten.test.ts`, `test/migratie-gedeelde-lijsten.test.ts` (naar het voorbeeld van `test/migratie-lijst-ids.test.ts`)

**Interfaces:**
- Produces (in `src/sharedlists.ts`):
  - `export const sharedListsApi: Hono<AppEnv>`
  - `export type ListRef = { id: string; owner_id: string; owner_name: string; name: string; role: 'owner' | 'member' }` (`name` = de naam bij deze gebruiker)
  - `export function listOf(db: D1Database, userId: string, name: string): Promise<ListRef | null>`: het geaccepteerde lidmaatschap met deze naam.
  - `export function listById(db: D1Database, userId: string, listId: string): Promise<ListRef | null>`
  - `export async function attachStmts(db: D1Database, task: TaskRow, list: ListRef, actorId: string, actorPosition: number): Promise<D1PreparedStatement[]>`: maakt een eigen hoofdtaak deel van de lijst.
  - `export function detachStmts(db: D1Database, task: TaskRow, actorId: string, list: string, position: number): D1PreparedStatement[]`: maakt hem een persoonlijke taak van `actorId` in `list`.
  - `export function leaveListStmts(db: D1Database, listId: string, userId: string): D1PreparedStatement[]`
  - `export async function listSharing(db: D1Database, userId: string): Promise<Map<string, ListShare>>` (sleutel: de naam bij `userId`)
  - `export type ListShare = { id: string; mine: boolean; owner: { id: string; name: string }; members: { user_id: string; name: string; status: 'pending' | 'accepted' }[]; notify_done: boolean }` (`members` zonder de eigenaar; `pending` alleen voor de eigenaar)

Schema `0017_gedeelde_lijsten.sql` (met een kopregel in de stijl van de andere migraties):
```sql
CREATE TABLE shared_lists (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  mode       TEXT NOT NULL DEFAULT 'shared' CHECK (mode IN ('shared','copy')),
  created_at TEXT NOT NULL
);
CREATE TABLE list_members (
  list_id      TEXT NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL CHECK (role IN ('owner','member')),
  status       TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  name         TEXT NOT NULL,
  notify_done  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  PRIMARY KEY (list_id, user_id)
);
CREATE UNIQUE INDEX idx_members_name ON list_members (user_id, name) WHERE status = 'accepted';
CREATE INDEX idx_members_user ON list_members (user_id, status);
ALTER TABLE tasks ADD COLUMN shared_list TEXT;
ALTER TABLE tasks ADD COLUMN done_by TEXT;
ALTER TABLE tasks ADD COLUMN claimed_by TEXT;
CREATE INDEX idx_tasks_shared_list ON tasks (shared_list) WHERE shared_list IS NOT NULL;
CREATE TABLE task_watch (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);
```

Routes in `sharedListsApi`:
- `POST /` `{ name, to | to_user, mode? }`: de eigenaar deelt zijn lijst `name`. Bestaat hij nog niet als gedeelde lijst: rij in `shared_lists`, eigen lidmaatschap (`role owner`, `accepted`, `name`), en alle niet-verwijderde hoofdtaken van de aanvrager met `list = name` krijgen `shared_list` (open én afgevinkt). Dan een `pending`-lidmaatschap voor de ontvanger (`name` = die van de eigenaar) en een push met Accept/Decline (`notifyInvite` als voorbeeld; payload met `listInviteId` en `url: '/?listInvite=<id>'`, titel `slist.push_invite` `{name} deelt de lijst “{list}” met je`). Fouten: Inbox 400 `err.inbox_share`; een naam die de aanvrager niet heeft 404 `err.list_unknown`; de lijst is gedeeld en de aanvrager is geen eigenaar 403 `err.shared_list_owner_only`; de ontvanger is al lid of uitgenodigd 409 `err.list_member_exists`; jezelf 400 `err.share_self`; onbekende ontvanger 404/409 zoals `findRecipient` (verplaats die naar een export in `src/shares.ts`); `mode` anders dan `shared` 400 `err.list_mode`. Antwoord 201 `{ id, list_id, status: 'pending' }`.
- `GET /incoming`: `[{ id: list_id, name, from: { name }, open }]` voor je openstaande uitnodigingen (`open`: aantal open hoofdtaken).
- `POST /:id/accept`: zet je lidmaatschap op `accepted` met een unieke naam (bestaande naam bij jou: `"{name} ({owner})"`, en dan `" 2"`, `" 3"`…; "bestaand" = elke naam die `GET /api/lists` jou zou tonen), en maakt voor elke niet-verwijderde hoofdtaak van de lijst een deelrij (`mode shared`, `status accepted`, `list` = jouw naam, posities onder je huidige `topMin`, in de volgorde van de eigenaar; `ON CONFLICT (task_id, to_user) DO NOTHING`, zodat een taak die al per taak met jou gedeeld was zijn rij houdt). Taken die bij het eerste delen al per taak met anderen gedeeld waren, houden die deelnemers. Antwoord `{ ok: true, name }`. Niet van jou of niet `pending`: 404.
- `POST /:id/decline`: verwijdert je `pending`-lidmaatschap. 404 zoals hierboven.
- `DELETE /:id/members/:userId`: vertrekken (`userId` = jezelf, niet de eigenaar: 400 `err.shared_list_owner_leave`) of iemand eruit halen / een uitnodiging intrekken (alleen de eigenaar). Draait `leaveListStmts`. Een geaccepteerd lid dat eruit gehaald wordt, krijgt push `slist.push_removed` `{name} heeft je uit “{list}” gehaald`. Anders 404.
- `PATCH /:id/me` `{ notify_done: boolean }`: je eigen meldingskeuze (Task 3 gebruikt hem). Geen boolean: 400 `err.must_be_bool`.

`leaveListStmts` wist: de deelrijen van die gebruiker op taken met `shared_list = listId` (ook in de prullenbak), zijn `reminder_sent`-rijen op die taken en hun subtaken, zijn `task_watch`-rijen op die taken, `claimed_by = NULL` waar hij het was, en zijn lidmaatschap.

`GET /api/lists`: elk item krijgt `shared: ListShare | null`; een geaccepteerd lidmaatschap zonder taken staat er ook (met `open: 0`).

- [ ] **Step 1: Schrijf `test/migratie-gedeelde-lijsten.test.ts`**: na de migraties bestaan `shared_lists`, `list_members`, `task_watch` en de kolommen `tasks.shared_list`, `done_by`, `claimed_by`; een tweede accepted lidmaatschap met dezelfde `(user_id, name)` faalt.
- [ ] **Step 2: Schrijf `test/gedeelde-lijsten.test.ts`** (helpers zoals in `test/delen.test.ts`) met:
  - `delen maakt bestaande taken deel van de lijst`: A heeft "Vakantie" met twee taken (één afgevinkt), deelt met B → 201; in de DB hebben beide taken `shared_list`; `GET /api/lists` bij A toont `shared: { mine: true, members: [{ name: B, status: 'pending' }] }`.
  - `een openstaande uitnodiging lekt niets` (Review Focus 1): B ziet vóór accepteren geen taak uit "Vakantie" in `GET /api/tasks`, `?q=`, `/api/lists`, en `PATCH` op een taak-id geeft 404; `GET /api/shared-lists/incoming` toont `{ name: 'Vakantie', from: { name: A }, open: 1 }`.
  - `accepteren toont de lijst met alle taken`: na accept heeft B "Vakantie" in `/api/lists` met `open: 1` en `shared.mine: false`; `GET /api/tasks` bij B bevat de open taak met `list: 'Vakantie'`.
  - `bestaande naam krijgt de naam van de eigenaar erbij`: B heeft al een eigen "Vakantie" → accept antwoordt `name: 'Vakantie (A-naam)'`; B's eigen taak blijft in "Vakantie".
  - `weigeren` → lidmaatschap weg, `incoming` leeg.
  - `foutgevallen`: Inbox 400, onbekende lijst 404, lid deelt verder 403, dubbel 409, jezelf 400, `mode: 'copy'` 400.
  - `vertrekken laat de taken bij de eigenaar` (Review Focus 2): A had vóór het delen al taken in de lijst (taken toevoegen ná het delen komt in Task 2), B accepteert en vertrekt → B ziet de lijst en taken niet meer, `PATCH` door B op de taak-id 404; A ziet alles nog; de eigenaar kan niet vertrekken (400).
  - `eruit halen` door A → B weg, B krijgt een push (fake sender zoals in `test/delen-meldingen.test.ts`; maak de sender in de route injecteerbaar zoals `notifyShareDone`); een lid kan een ander lid niet eruit halen (404).
- [ ] **Step 3: Run** `npx vitest run test/gedeelde-lijsten.test.ts test/migratie-gedeelde-lijsten.test.ts` → FAIL (tabellen en routes ontbreken).
- [ ] **Step 4: Schrijf de migratie, `src/sharedlists.ts` en de wijzigingen in `src/index.ts`**, foutsleutels en push-teksten in `public/i18n.js` (en + nl).
- [ ] **Step 5: Run** dezelfde tests, dan `npm run typecheck` en `npm test` → PASS.
- [ ] **Step 6: Werk `ARCHITECTURE.md` bij** (datamodel en API-tabel).
- [ ] **Step 7: Commit** `Gedeelde lijsten: schema, delen, accepteren en vertrekken`.

### Task 2: Taken in een gedeelde lijst

**Files:**
- Modify: `src/index.ts` (`createTask`, `PATCH /api/tasks/:id` voor `list`, `present`/`extras`, `GET /api/tasks?shared_done=1`, `plainDone`, `restore`, lijstroutes `rename` en `delete`, nieuwe `POST /api/lists/clear-done`), `src/shares.ts` (`POST /api/shares`), `src/sharedlists.ts`, `ARCHITECTURE.md`
- Test: `test/gedeelde-lijsten-taken.test.ts`

**Interfaces:**
- Consumes: `listOf`, `attachStmts`, `detachStmts` uit Task 1.
- Produces: elk taakobject in de API krijgt `shared_list: string | null`, `done_by: { id: string; name: string } | null`, `claimed_by: { id: string; name: string } | null` (namen uit één `SELECT id, name FROM users` in `extras`, alleen als een rij `done_by` of `claimed_by` heeft; een verwijderd account geeft `null`) en `watch: boolean` (gevuld in Task 3; tot dan `false`). `plainDone(db, t, done, actorId: string)` zet `done_by = actorId` op de taak en de meegaande subtaken, en `NULL` bij heropenen; `setDone` en `rollRepeat` geven `actorId` door.

Regels:
- **Aanmaken** (`POST /api/tasks`, ook via `/api/inbox` en `/mcp`): hoofdtaak met een `list` waarvoor `listOf` een lijst geeft → eerst als eigen taak invoegen, dan `attachStmts` in één batch. De taak is daarna van de eigenaar van de lijst; de maker heeft hem bovenaan in zijn eigen volgorde.
- **Verslepen** (`PATCH` met `list` op een hoofdtaak): oud = `t.shared_list`, nieuw = `listOf(userId, list)`.
  - oud en nieuw gelijk: niets aan het lidmaatschap.
  - oud zonder nieuw: `detachStmts` naar de aanvrager (eigenaar of lid; de positie is die in zijn eigen volgorde).
  - oud en een andere nieuwe: eerst los, dan vast.
  - zonder oud, met nieuw: alleen een eigen taak zonder `shared`-deelrijen; anders 400 `err.shared_task_to_list`.
- **`detachStmts`**: taak en subtaken krijgen `user_id = actorId`, de hoofdtaak `list`, `position`, `shared_list = NULL`, `claimed_by = NULL`; alle deelrijen, `task_watch`-rijen en `reminder_sent`-rijen van anderen op de taak en subtaken gaan weg. Geen melding.
- **`attachStmts`**: taak en subtaken krijgen `user_id` = eigenaar van de lijst en `list` = de naam bij de eigenaar; de hoofdtaak `shared_list`; elk ander geaccepteerd lid krijgt een deelrij (de aanvrager met `actorPosition`, de rest bovenaan via `topMin`).
- **Per taak delen** (`POST /api/shares`) met `mode: 'shared'` op een taak in een gedeelde lijst: 400 `err.share_in_shared_list`. Een kopie mag.
- **Hernoemen**: van of naar een gedeelde lijst met een `to` die al bestaat bij jou: 400 `err.list_shared_merge`. Anders verhuist `list_members.name` mee (en bij de eigenaar `tasks.list`, wat de bestaande UPDATE al doet).
- **Verwijderen** (`POST /api/lists/delete`): een lid 400 `err.shared_list_leave`. De eigenaar met `tasks: 'inbox'`: elke hoofdtaak `detachStmts` naar de eigenaar in Inbox, daarna `shared_lists`-rij weg (lidmaatschappen via de cascade). Met `tasks: 'delete'`: zoals nu naar de prullenbak (deelrijen blijven, zodat leden ze in hun prullenbak zien), daarna de `shared_lists`-rij weg.
- **Terugzetten** (`POST /api/tasks/:id/restore`) van een taak waarvan `shared_list` naar een niet-bestaande lijst wijst: alleen de eigenaar (anders 403 `err.shared_list_owner_only`); hij komt terug in Inbox met `shared_list = NULL`, `claimed_by = NULL` en zonder deelrijen. Een taak uit een bestaande gedeelde lijst zet ieder lid terug, zoals nu.
- **`POST /api/lists/clear-done`** `{ name }`: alle afgevinkte, niet-verwijderde hoofdtaken die jij in lijst `name` ziet naar de prullenbak (`trashStmts`, dus bij een gedeelde lijst voor iedereen). Antwoord `{ deleted }`.
- **`GET /api/tasks?shared_done=1`**: afgevinkte, niet-verwijderde hoofdtaken met `shared_list IS NOT NULL` die je ziet, `ORDER BY done_at DESC LIMIT 500`, gepresenteerd met jouw lijstnaam.

- [ ] **Step 1: Schrijf `test/gedeelde-lijsten-taken.test.ts`** (A deelt "Weekend" met B en C, beide accepteren) met:
  - `een taak van een lid is meteen van iedereen`: B maakt "Barbecue" in "Weekend" → A en C zien hem in `GET /api/tasks` zonder uitnodiging; in de DB `user_id` = A en twee deelrijen (B, C).
  - `opnieuw versturen met hetzelfde id dupliceert niets` (Review Focus 3): B post dezelfde body met hetzelfde `id` nog eens → 200, nog steeds twee deelrijen.
  - `afvinken onthoudt wie`: C vinkt af → bij A `done_by: { id: C, name: C-naam }`; heropenen → `done_by: null`; `?shared_done=1` bij B bevat de afgevinkte taak met `list: 'Weekend'`.
  - `eruit slepen maakt hem persoonlijk` (Review Focus 4): taak met een subtaak; B sleept hem naar B's "Thuis" → A en C zien taak en subtaak niet meer (404 op id), B wel, met beide `user_id` = B; een nieuwe subtaak van B daarna heeft `user_id` = B.
  - `erin slepen deelt hem`: A's persoonlijke taak naar "Weekend" → B en C zien hem; een per taak gedeelde taak erin slepen → 400.
  - `per taak delen in een gedeelde lijst`: `mode: 'shared'` 400, `mode: 'copy'` 201.
  - `hernoemen en samenvoegen`: B hernoemt "Weekend" → "Ardennen": B's taken staan in "Ardennen", A's lijst heet nog "Weekend"; samenvoegen met een bestaande naam 400.
  - `de eigenaar verwijdert de lijst naar de prullenbak`: B ziet de taak in `?deleted=1`; B terugzetten 403; A terugzetten → in A's Inbox, B ziet hem niet meer.
  - `de eigenaar houdt de taken` (`tasks: 'inbox'`): A heeft ze in Inbox, B niet meer; een lid dat de lijst verwijdert krijgt 400.
  - `opruimen`: twee afgevinkte taken → `clear-done` door C → `{ deleted: 2 }`, ze staan bij A in de prullenbak.
- [ ] **Step 2: Run** `npx vitest run test/gedeelde-lijsten-taken.test.ts` → FAIL.
- [ ] **Step 3: Implementeer de regels hierboven** in de genoemde bestanden; foutsleutels in `public/i18n.js`.
- [ ] **Step 4: Run** de test, dan `npm run typecheck` en `npm test` → PASS.
- [ ] **Step 5: Werk `ARCHITECTURE.md` bij** (taakvelden, lijstroutes, verslepen).
- [ ] **Step 6: Commit** `Gedeelde lijsten: taken toevoegen, verslepen, afvinken en opruimen`.

### Task 3: Ik neem het mee, en meldingen

**Files:**
- Modify: `src/index.ts` (`PATCH` velden `claimed` en `watch`; controle bij `done` in `PATCH` en in `POST /api/tasks/:id/done` en `/reopen`; `copyDone` en `placeShared`), `src/sharedlists.ts`, `src/push.ts` alleen als de herinneringstest dat nodig maakt, `ARCHITECTURE.md`
- Test: `test/gedeelde-lijsten-meldingen.test.ts`

**Interfaces:**
- Consumes: `ListRef`, `leaveListStmts` (Task 1), `done_by` (Task 2).
- Produces:
  - `export async function assertMayTick(db: D1Database, t: TaskRow, userId: string): Promise<void>`: gooit 403 `err.claimed` `{ name }` als de hoofdtaak (de taak zelf, of de ouder van een subtaak) `claimed_by` heeft en dat niet `userId` is. Geldt voor afvinken en heropenen.
  - `export function notifyListDone(env: Env, task: TaskRow, actorId: string, actorName: string, defaultLocale: 'en' | 'nl', send: Sender = sendToAll): Promise<void>`: push `share.push_done` naar geaccepteerde leden (eigenaar inbegrepen) met `notify_done = 1` of een `task_watch`-rij op de taak, nooit naar `actorId`.

Regels:
- `PATCH { claimed: true }`: alleen op een open hoofdtaak in een gedeelde lijst (anders 400 `err.claim_shared_list`). `UPDATE … SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL`; geen wijziging en `claimed_by` is een ander → 409 `err.claimed` `{ name }`. `claimed: false`: alleen als `claimed_by` = jij (een ander: 409 `err.claimed`; niemand: niets). Op naam zetten of loslaten geeft geen push. Afvinken laat `claimed_by` staan.
- `PATCH { watch: boolean }`: alleen op een hoofdtaak in een gedeelde lijst (anders 400 `err.watch_shared_list`); `INSERT OR IGNORE` of `DELETE` in `task_watch`. `present` vult `watch` voor de aanvrager.
- `copyDone`: bij `t.shared_list` `notifyListDone` in plaats van `notifyShareDone`. `placeShared`: bij `t.shared_list` niets.
- `PATCH /api/shared-lists/:id/me { notify_done }` zet `list_members.notify_done`; `ListShare.notify_done` toont je eigen keuze.

- [ ] **Step 1: Schrijf `test/gedeelde-lijsten-meldingen.test.ts`** (fake sender zoals in `test/delen-meldingen.test.ts`) met:
  - `op naam zetten en loslaten`: B neemt "Barbecue" → `claimed_by: { name: B }` bij iedereen; C neemt hem → 409; C laat hem los → 409; B laat los → `null`; C neemt hem → ok.
  - `alleen wie hem meeneemt vinkt af`: B heeft hem → C vinkt af via `PATCH`, `/done` en een subtaak afvinken → 403 alle drie; B vinkt af → ok, `done_by` = B; C heropent → 403.
  - `vertrekken laat taken vrij` (Review Focus 2): B heeft een taak op naam en vertrekt → `claimed_by: null`.
  - `geen meldingen standaard`: C vinkt een taak af → geen push naar A of B (ook niet de oude `share.push_done` van gedeelde taken), en een plek erbij → geen `share.push_location`.
  - `melding op lijstniveau`: A zet `notify_done` aan → C vinkt af → push naar A, niet naar B en niet naar C zelf.
  - `melding op taakniveau`: B zet `watch: true` op één taak → alleen bij die taak een push naar B; `watch` op een taak buiten een gedeelde lijst → 400.
  - `herinnering naar elk lid één keer` (Review Focus 5): taak met verlopen `remind_at` in de lijst, D heeft een openstaande uitnodiging → `runReminders` stuurt naar A, B en C, niet naar D; nog een ronde stuurt niets.
- [ ] **Step 2: Run** `npx vitest run test/gedeelde-lijsten-meldingen.test.ts` → FAIL.
- [ ] **Step 3: Implementeer** de regels; foutsleutels in `public/i18n.js`.
- [ ] **Step 4: Run** de test, dan `npm run typecheck` en `npm test` → PASS.
- [ ] **Step 5: Werk `ARCHITECTURE.md` bij** (op naam, meldingen bij gedeelde lijsten naast die van gedeelde taken).
- [ ] **Step 6: Commit** `Gedeelde lijsten: ik neem het mee en meldingen bij afvinken`.

### Task 4: Account verwijderen

**Files:**
- Modify: `src/users.ts` (`deleteUserStmts`), `src/users-api.ts:34`, `src/sharedlists.ts`, `ARCHITECTURE.md` (regel bij `DELETE /api/users/:id`)
- Test: uitbreiden in `test/gedeelde-lijsten.test.ts` (eigen `describe`)

**Interfaces:**
- Produces: `export async function transferListsStmts(db: D1Database, userId: string): Promise<D1PreparedStatement[]>` in `src/sharedlists.ts`; `users-api.ts` draait `[...await transferListsStmts(db, id), ...deleteUserStmts(db, id)]` als één batch.

Regels: voor elke lijst van `userId` het geaccepteerde lid met de vroegste `responded_at` (gelijk: kleinste `user_id`). Diens deelrij-positie en -pin gaan naar `tasks.position`/`pinned`, taken en subtaken krijgen zijn `user_id` en zijn lijstnaam, zijn deelrijen op die taken verdwijnen, `from_user` van de andere deelrijen wordt hij, `shared_lists.owner_id` en zijn `role` worden eigenaar. Zonder geaccepteerde leden: de `shared_lists`-rij weg (de taken gaan mee met het account, zoals nu). Daarnaast in `deleteUserStmts`: `list_members` en `task_watch` van de gebruiker weg en `claimed_by = NULL` waar hij het was, vóór `DELETE FROM users`.

- [ ] **Step 1: Schrijf de tests**: `de lijst gaat naar het langste lid` (A deelt met B, daarna C; A wordt verwijderd → B is eigenaar, ziet alle taken in zijn eigen naam en volgorde, C ziet ze nog, `GET /api/lists` bij C toont `owner.name` = B); `zonder leden verdwijnt alles`; `een lid verwijderen laat de lijst staan en zijn taken op naam vrij`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementeer** `transferListsStmts` en de aanpassingen.
- [ ] **Step 4: Run** de tests, `npm run typecheck`, `npm test` → PASS.
- [ ] **Step 5: Commit** `Gedeelde lijsten: account van de eigenaar verwijderen`.

### Task 5: Store en lijstgegevens in de app

**Files:**
- Modify: `public/store.js`, `public/lists.js` (`mergeLists` neemt `shared` van de server mee, zoals `id`; `applyListOp` ook op `state.sharedDone`)
- Test: `test/store.test.ts` (uitbreiden), `test/lists.test.ts` (uitbreiden)

**Interfaces:**
- Consumes: de API uit Task 1–3.
- Produces (in `public/store.js`):
  - `state.sharedDone: any[]` (geladen met `soft(request('GET', '/api/tasks?shared_done=1'))` in `loadOnce`, bewaard in `kv` onder `sharedDone`, geladen in `init`), `state.listInvites: any[]` (uit `GET /api/shared-lists/incoming`).
  - `export const sharedOf = (name) => …`: de `shared` van die lijst uit `lists()`, of `null`.
  - `export function doneInList(name): any[]`: afgevinkte hoofdtaken in lijst `name` uit `state.sharedDone`, `state.done` en `state.open` (lokaal afgevinkt, niet in `justDone`), zonder dubbele ids, nieuwste `done_at` eerst.
  - `export const claim = (id, on) => update(id, { claimed: on })`, `export const watchTask = (id, on) => update(id, { watch: on })`: via de outbox; `applyLocal` zet `claimed_by` op `{ id: CONFIG.userId, name: CONFIG.userName }` of `null`, en `watch`. Lokaal afvinken in een gedeelde lijst zet `done_by` op dezelfde manier.
  - Alleen online (zoals `trashAction`), elk gevolgd door `load()`: `shareList(name, { to } | { to_user })`, `answerListInvite(id, accept: boolean)`, `leaveList(id)`, `removeListMember(id, userId)`, `setListNotify(id, on)`, `clearDone(name)`.
  - `toggleDone(t)` doet niets als `t.claimed_by` (of dat van de ouder) een ander is.

- [ ] **Step 1: Schrijf de tests**: `mergeLists bewaart shared`; `doneInList combineert zonder dubbelen en sorteert op done_at`; `claim zet claimed_by lokaal en staat in de outbox`; `toggleDone op andermans taak op naam doet niets`; `een lijst hernoemen past ook sharedDone aan`.
- [ ] **Step 2: Run** `npx vitest run test/store.test.ts test/lists.test.ts` → FAIL.
- [ ] **Step 3: Implementeer** in `public/store.js` en `public/lists.js`.
- [ ] **Step 4: Run** de tests, `npm run typecheck`, `npm test` → PASS.
- [ ] **Step 5: Commit** `Gedeelde lijsten: gegevens in de app`.

### Task 6: Schermen, service worker en handleiding

**Files:**
- Create: `public/sharedlist.js`
- Modify: `public/render.js` (taakrij en het blok Afgevinkt), `public/sidebar.js` (icoon `users` naast de naam van een gedeelde lijst), `public/listmenu.js`, `public/detail.js` (meldingsknop per taak), `public/share.js` (in een gedeelde lijst alleen Kopie aanbieden; `renderInvites` toont ook lijstuitnodigingen), `public/sw.js` (`SHELL` + `CACHE` `tick-shell-v46`; acties bij `listInviteId`), `public/i18n.js`, `public/style.css`, `docs/sharing.md`, `docs/tasks-and-lists.md`, `ARCHITECTURE.md` (modules)
- Test: `test/offline.test.ts` (SHELL-lijst), `test/i18n.test.ts` (draait vanzelf)

**Interfaces:**
- Consumes: alles uit Task 5.
- Produces (in `public/sharedlist.js`): `openListShareDialog(name)` (leden met status en, voor de eigenaar, Verwijderen per lid; uitnodigen met de keuzelijst uit `GET /api/shares/people` zoals `share.js`), `renderListInvites(root)` (balk met Accepteren/Weigeren), `claimControl(task)` (pil "{name} neemt mee" / "Jij neemt mee", of de knop "Ik neem het mee"; tikken op je eigen pil laat los), `doneBlock(name)` (kop "Afgevinkt · {n}", knop "Opruimen" met bevestiging, rijen doorgestreept met "{name} · {tijd}" in het bestaande tijdformaat).

Gedrag (volgt de schets in de spec):
- Taakrij in een gedeelde lijst: `claimControl` in de metaregel bij open taken; het vinkje van een taak op andermans naam is uitgeschakeld met als label `slist.claimed_by` "Op naam van {name}".
- Onder de open taken van een gedeelde lijst (niet in Alle, Afgerond, zoeken of de prullenbak): `doneBlock(state.list)`.
- Lijstmenu, eigenaar: Delen… (dialoog), Meldingen bij afvinken (aan/uit), Hernoemen, Verwijderen… (bevestiging noemt de leden: `slist.delete_confirm` "“{list}” verdwijnt ook bij {names}, met alle taken."). "Taken verplaatsen" niet bij een gedeelde lijst. Lid: Meldingen bij afvinken, Hernoemen, Verlaten… (bevestiging). Gewone lijst: Delen… erbij.
- Detailpaneel van een taak in een gedeelde lijst: knop "Meld me als dit is afgevinkt" (`watchTask`), alleen als `sharedOf(list).notify_done` uit staat.
- Delen, accepteren, vertrekken en opruimen zijn alleen online, zoals delen nu (`share.online_only`).

- [ ] **Step 1: Pas `test/offline.test.ts` aan** voor `sharedlist.js` en run → FAIL tot de module in `SHELL` staat.
- [ ] **Step 2: Bouw `public/sharedlist.js` en de wijzigingen** in de genoemde modules, met alle teksten in `public/i18n.js` (en + nl) en stijlen in `public/style.css`.
- [ ] **Step 3: Run** `npm run typecheck` en `npm test` → PASS.
- [ ] **Step 4: Controleer in de browser** met `npm run dev` (in `C:\dev\tick`, de werkkopie voor de dev-server) met twee accounts: lijst delen, uitnodiging accepteren in de balk, taak toevoegen door het lid, "Ik neem het mee" en het uitgeschakelde vinkje bij de ander, afvinken (naam en tijd in het blok), Opruimen, meldingsknop per taak verdwijnt als lijstmeldingen aan staan, eruit slepen, Verlaten, Verwijderen met de leden in de bevestiging. Ook op mobiele breedte en in het donkere thema.
- [ ] **Step 5: Schrijf de handleiding**: in `docs/sharing.md` een sectie "Sharing a list" (delen, één keer accepteren, ik neem het mee, afgevinkt blijft staan, meldingen, eruit slepen, verlaten, verwijderen); in `docs/tasks-and-lists.md` een verwijzing; `docs/README.md` als de index een nieuwe rij nodig heeft.
- [ ] **Step 6: Commit** `Gedeelde lijsten: schermen en handleiding`.
