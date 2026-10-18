# Taken delen en prullenbak: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Taken delen tussen accounts (gedeeld of kopie, met acceptatie) en een prullenbak voor alles wat je verwijdert.

**Architecture:** Eén migratie `0010_delen.sql` (kolom `tasks.deleted_at`, tabellen `task_shares` en `reminder_sent`). Een toegangslaag in `src/access.ts` vervangt `getTask(db, userId, id)` en geeft de taak plus jouw deelrij terug; schrijfacties op subtaken filteren op het `user_id` van de taak (de eigenaar). Deelroutes in `src/shares.ts`, prullenbakroutes bij de taakroutes in `src/index.ts`. De PWA krijgt `public/share.js` (dialoog, deelnemers, uitnodigingsbalk) en `public/trash.js` (prullenbakweergave).

**Tech Stack:** Cloudflare Worker (Hono), D1, vitest met `@cloudflare/vitest-plugin`, PWA in vanilla JS zonder build.

**Spec:** `docs/superpowers/specs/2026-10-18-taken-delen-design.md`

## Global Constraints

- Een schemawijziging is alleen `migrations/0010_delen.sql`; bestaande migraties niet aanpassen.
- Elke zichtbare tekst via `public/i18n.js` met `en` én `nl` (`test/i18n.test.ts`). Serverfouten: `HttpError(status, key, vars)`, nooit een zin.
- Geen inline scripts of stijlen (CSP). Nieuwe modules in `SHELL` van `public/sw.js`, en `CACHE` ophogen (`tick-shell-v11` → `tick-shell-v12`).
- Tijden in UTC.
- Een id zonder toegang gedraagt zich als een id dat niet bestaat (404, of 400 `err.parent_missing`).
- Prullenbak: 30 dagen (`TRASH_DAYS = 30`).
- Klaar per taak: `npm run typecheck` en `npm test` slagen. Commitberichten in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Niet uitrollen, niet pushen.

## Review Focus

1. Een `pending` uitnodiging lekt nergens (lijsten, zoeken, widget, `PATCH`, herinneringen): de ontvanger ziet niets voor ze accepteert. → test in Task 2.
2. Een ontvanger die een subtaak toevoegt, afvinkt of de herhaling laat doorschuiven, raakt de subtaken van de eigenaar (filters op `user_id` die nog de aanvrager gebruiken). → test in Task 2 ("herhalende gedeelde taak afvinken door ontvanger zet subtaken van de eigenaar weer open").
3. Slepen door de ontvanger (`position`) en `rebalanceIfNeeded` op een gemengde volgorde (eigen taken plus deelnames). → test in Task 2.
4. Een taak in de prullenbak duikt op via `findDone`, `/done`, `snooze`, `/api/lists` of de inbox-API. → test in Task 1.
5. Oude clients (outbox) die `DELETE` sturen op een taak die al in de prullenbak ligt: moet 404 geven, niet 500. → test in Task 1.

---

### Task 1: Migratie en prullenbak (server)

**Files:**
- Create: `migrations/0010_delen.sql`
- Modify: `src/index.ts` (taakroutes, lijstroutes, cron in `scheduled`), `src/data.ts` (export/import), `src/push.ts` (`runReminders`: `AND deleted_at IS NULL`), `src/index.ts` `TaskRow` (+`deleted_at: string | null`)
- Test: `test/prullenbak.test.ts`; aanpassen waar nodig: `test/api.test.ts:110`, `test/backup.test.ts:27`, `test/migratie.test.ts`

**Interfaces:**
- Produces: kolom `tasks.deleted_at`; tabellen `task_shares` en `reminder_sent` (exact schema hieronder); `export async function purgeTrash(db: D1Database, now: number): Promise<number>` in `src/index.ts` (of een klein `src/trash.ts`), aangeroepen in `scheduled`; constante `TRASH_DAYS = 30`.

Schema `0010_delen.sql`:
```sql
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_tasks_deleted ON tasks (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TABLE task_shares (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_user TEXT NOT NULL REFERENCES users(id),
  to_user TEXT NOT NULL REFERENCES users(id),
  mode TEXT NOT NULL CHECK (mode IN ('shared','copy')),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  list TEXT,
  position REAL,
  created_at TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE (task_id, to_user)
);
CREATE INDEX idx_shares_to ON task_shares (to_user, status);
CREATE TABLE reminder_sent (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  remind_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
```

- [ ] **Step 1: Schrijf `test/prullenbak.test.ts`** met:
  - `verwijderen zet de taak en subtaken in de prullenbak`: na `DELETE` ontbreken ze in `GET /api/tasks`, `?done=1`, `?q=`, `/api/lists`-telling; `GET /api/tasks?deleted=1` bevat de ouder met `deleted_at` (string) en niet los de subtaak.
  - `terugzetten zet ouder en subtaken terug`: `POST /api/tasks/:id/restore` → 200, beide weer in `GET /api/tasks`.
  - `een subtaak terugzetten zet de ouder ook terug` (subtaak los verwijderd, daarna ouder verwijderd, dan subtaak terugzetten → ouder en subtaak open).
  - `terugzetten met een verlopen herinnering telt als gemeld` (`notified` = 1 in de DB).
  - `op een taak in de prullenbak geven PATCH, done, snooze en een tweede DELETE een 404`; `parent_id` naar een verwijderde taak geeft 400.
  - `purge wist echt`: `DELETE /api/tasks/:id?purge=1` op een verwijderde taak → 200 en de rij is weg uit de DB; op een niet-verwijderde taak → 404.
  - `prullenbak legen wist alleen eigen verwijderde taken`: `POST /api/trash/empty` → `{ deleted: n }`.
  - `purgeTrash wist na 30 dagen`: zet `deleted_at` handmatig op 31 dagen terug, `purgeTrash(env.DB, Date.now())` → rij weg; een rij van 29 dagen blijft.
  - `lijst verwijderen met tasks: 'delete' zet in de prullenbak` (antwoord blijft `{ deleted }`).
  - `geen herinnering voor een verwijderde taak` (`runReminders` laat `notified` op 0 staan… en verstuurt niets: na 20 min verlopen + verwijderd blijft `notified` 0).
  - `export laat verwijderde taken weg; import zet een verwijderde taak terug` (`deleted_at` NULL na import).
- [ ] **Step 2:** `npx vitest run test/prullenbak.test.ts` → FAIL.
- [ ] **Step 3: Implementeer.** Schrijf de migratie. Elke `SELECT` op `tasks` in `src/` (taakroutes, lijsten, cron, export, `newPosition`, `rebalanceIfNeeded`, `checkParent`) krijgt `deleted_at IS NULL`, behalve de prullenbakroutes. `DELETE /api/tasks/:id` zonder `purge`: `UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`. `?purge=1`: alleen als `deleted_at IS NOT NULL`, wist subtaken, `task_shares`, `reminder_sent` en de taak in één batch. `GET /api/tasks?deleted=1&limit=&offset=` (standaard 100, max 500): `deleted_at IS NOT NULL` en niet (subtaak waarvan de ouder hetzelfde `deleted_at` heeft), `ORDER BY deleted_at DESC`. `POST /api/tasks/:id/restore`, `POST /api/trash/empty`. In `scheduled` na `runReminders`: `purgeTrash`. `data.ts`: export `AND deleted_at IS NULL`; de import-upsert zet `deleted_at = NULL`.
- [ ] **Step 4:** `npx vitest run` → alles PASS (pas `api.test.ts`/`backup.test.ts` aan als ze uitgaan van echt wissen; `migratie.test.ts` controleert dat `0010` op bestaande data werkt). `npm run typecheck` PASS.
- [ ] **Step 5: Commit** `Prullenbak: verwijderen gaat naar de prullenbak, terugzetten, legen, na 30 dagen wissen`.

### Task 2: Delen (server)

**Files:**
- Create: `src/access.ts`, `src/shares.ts`
- Modify: `src/index.ts` (alle taakroutes, lijsten, `asBool`, `app.route('/api/shares', sharesApi)`), `src/users.ts` (`deleteUserStmts`), `src/data.ts` (export alleen eigen taken: blijft `user_id = ?`)
- Test: `test/delen.test.ts`; `test/helpers.ts` (`Task` krijgt `share`)

**Interfaces:**
- Consumes: schema uit Task 1.
- Produces:
  - `src/access.ts`: `type Access = TaskRow & { share_id: string | null; share_list: string | null; share_position: number | null }`; `getAccess(db: D1Database, userId: string, id: string, opts?: { deleted?: boolean }): Promise<Access | null>` (eigenaar of `accepted` op `COALESCE(parent_id, id)`; standaard alleen `deleted_at IS NULL`, met `deleted: true` alleen verwijderde); `visibleTasksSql(where: string): string` voor de lijst-queries (LEFT JOIN `task_shares s ON s.task_id = COALESCE(t.parent_id, t.id) AND s.to_user = ?1 AND s.status = 'accepted'`, `WHERE (t.user_id = ?1 OR s.id IS NOT NULL)`); `overlay(rows: Access[], userId: string): TaskRow[]` (zet `list`/`position` uit de deelrij, subtaken de lijst van hun ouder bij jou, sorteert op positie).
  - `src/shares.ts`: `export const sharesApi: Hono<AppEnv>` met de routes uit spec §3–5; `shareInfo(db, taskIds: string[]): Promise<Map<string, ShareInfo>>` met `type ShareInfo = { owner: { id: string; name: string }; members: { share_id: string; user_id: string; name: string; status: 'pending' | 'accepted' }[] }`; `asBool` zet `share: info ? { ...info, mine: info.owner.id === userId } : null` op hoofdtaken, `null` op subtaken.
  - Nieuwe i18n-foutsleutels (in Task 2 al toevoegen, en + nl): `err.share_owner_only`, `err.share_subtask`, `err.share_is_shared`, `err.share_user_unknown`, `err.share_user_ambiguous`, `err.share_self`, `err.share_exists`, `err.share_gone`, `err.share_mode`; pushteksten `share.push_shared` ("{name} shares a task with you" / "{name} deelt een taak met je"), `share.push_copy` ("{name} sent you a copy of a task" / "{name} stuurt je een kopie van een taak"), `push.accept`, `push.decline`.

- [ ] **Step 1: Schrijf `test/delen.test.ts`** (A = admin via `call`, B en C via `createUser`):
  - `uitnodigen op e-mail en op naam`: `POST /api/shares {task_id, to: b.email, mode:'shared'}` → 201 `{id, status:'pending'}`; op naam (hoofdletterongevoelig) idem; onbekend → 404 `err.share_user_unknown` (vergelijk met de Engelse tekst uit `STRINGS.en`); twee accounts met dezelfde naam → 409; jezelf → 400; tweede keer → 409; subtaak → 400; B nodigt uit op A's taak (na accepteren) → 403; mode `x` → 400.
  - `pending lekt niets`: B ziet de taak niet in `/api/tasks`, `?q=`, `?done=1`, `/api/lists`, en krijgt 404 op PATCH/DELETE/done/snooze; `GET /api/shares/incoming` toont `{mode:'shared', task:{title}, from:{name}}`.
  - `accepteren gedeeld`: na `/accept` staat hij bij B in `Inbox`; A's `list` ongewijzigd; B's `PATCH {list:'Boodschappen', position: -5}` raakt A niet en A's `PATCH {list:'Thuis'}` raakt B niet; B's `PATCH {title}` en `{done:true}` zie je bij A; `share` bij A: `{mine:true, members:[{name, status:'accepted'}]}`, bij B `mine:false, owner.id = ADMIN_ID`.
  - `subtaak van ontvanger hoort bij de eigenaar`: B maakt subtaak met `parent_id` = gedeelde taak → 201; DB-`user_id` = `ADMIN_ID`; A ziet hem.
  - `herhalende gedeelde taak afvinken door ontvanger`: taak met `repeat: 'FREQ=DAILY'` en een afgevinkte subtaak; B `POST /done` → hoofdtaak schuift door en de subtaak staat weer open.
  - `parent-regels`: B kan zijn eigen taak niet onder A's gedeelde taak hangen (400); een gedeelde hoofdtaak kan geen subtaak worden (400 `err.share_is_shared`).
  - `slepen door ontvanger`: B maakt 3 eigen taken, sleept de gedeelde taak ertussen (`position` tussen twee buren); volgorde in B's `GET` klopt en A's `position` is ongewijzigd.
  - `kopie`: `/accept` maakt bij B een taak met ander id, zelfde titel en subtaken (open), `source:'share'`, in `Inbox`; de deelrij is weg; B's wijziging raakt A niet; origineel in de prullenbak vóór accepteren → 410 en de rij is weg.
  - `weigeren` verwijdert de rij; `/accept` op andermans uitnodiging → 404.
  - `stoppen`: B `DELETE /api/shares/:id` → taak weg bij B, blijft bij A; A haalt C eraf → C 404. Derde account ziet nooit iets.
  - `prullenbak gedeeld`: B verwijdert → bij A en B in `?deleted=1`; A zet terug → bij beiden terug; B `?purge=1` → verdwijnt bij B, blijft bij A in de prullenbak; A `?purge=1` → rij en deelrijen weg.
  - `lijsten`: `/api/lists` van B telt de gedeelde taak in B's lijst; `rename` en `delete {tasks:'inbox'}` door B werken op zijn deelrij; `delete {tasks:'delete'}` door B zet de taak bij beiden in de prullenbak.
  - `account verwijderen ruimt task_shares op` (beide richtingen; A's taak die met verwijderde B gedeeld was blijft bij A).
- [ ] **Step 2:** `npx vitest run test/delen.test.ts` → FAIL.
- [ ] **Step 3: Implementeer `src/access.ts`** en vervang in `src/index.ts` elke `getTask` door `getAccess`; alle `AND user_id = ?` in `setDone`, `rollRepeat`, `PATCH`, `snooze`, subtaakverhuizing en `newPosition` (subtaak) gebruiken `t.user_id`. `PATCH` door een ontvanger (`share_id` gezet en hoofdtaak): `list`/`position` → `UPDATE task_shares SET list/position WHERE id = share_id`; een `rebalanceIfNeeded`-variant voor jouw volgorde (eigen hoofdtaken plus `accepted` deelrijen; herverdeel beide). `createTask` met een gedeelde ouder: `user_id` = `parent.user_id`. `checkParent`: ouder via `getAccess`, en ouder-eigenaar moet gelijk zijn aan de eigenaar van de taak (bij aanmaken: de eigenaar wordt die van de ouder); taak met `task_shares`-rijen kan geen subtaak worden.
- [ ] **Step 4: Implementeer `src/shares.ts`** volgens spec §3–5: naam/e-mail opzoeken (`SELECT id FROM users WHERE email = ? COLLATE NOCASE` en anders `WHERE lower(trim(name)) = lower(?)`), push via `sendToAll(env, toUser, locale => ({ title: translate(locale, key, {name}), body: task.title, url: '/?share=' + id, shareId: id, actions: [{action:'accept', title: translate(locale,'push.accept')}, {action:'decline', title: translate(locale,'push.decline')}] }), defaultLocale)`; geen abonnement → `postWebhook` naar de fallback van de ontvanger. `Payload` in `push.ts` krijgt `shareId?: string` en `action` wordt `'done' | 'snooze' | 'accept' | 'decline'`. Kopie accepteren: één `db.batch` met nieuwe uuid's, posities: hoofdtaak bovenaan bij B (`newPosition`), subtaken met hun oude `position`.
- [ ] **Step 5:** `GET /api/tasks` (alle varianten) via `visibleTasksSql` + `overlay` + `shareInfo`; `/api/lists` telt via dezelfde join met `COALESCE(s.list, t.list)`. `deleteUserStmts`: `DELETE FROM reminder_sent WHERE user_id = ?`, `DELETE FROM task_shares WHERE to_user = ? OR from_user = ? OR task_id IN (SELECT id FROM tasks WHERE user_id = ?)` vóór het wissen van tasks.
- [ ] **Step 6:** `npx vitest run` en `npm run typecheck` → PASS.
- [ ] **Step 7: Commit** `Delen: taken delen tussen accounts (gedeeld of kopie), uitnodigen, accepteren en stoppen`.

### Task 3: Herinneringen naar iedereen op de taak

**Files:**
- Modify: `src/push.ts` (`runReminders`)
- Test: `test/delen-meldingen.test.ts`

**Interfaces:**
- Consumes: `reminder_sent` (Task 1), `task_shares` (Task 2), `sendToAll`, `postWebhook`.

- [ ] **Step 1: Test** (mock `globalThis.fetch` met `vi.spyOn`, zoals nodig voor push; maak push-abonnementen met een geldige vorm direct in de DB, of mock `sendToAll` via een geïnjecteerde sender: geef `runReminders` een optionele derde parameter `send = sendToAll` zodat de test per gebruiker `{ok,total}` kan teruggeven):
  - `stuurt naar eigenaar en deelnemer`: sender wordt aangeroepen met `ADMIN_ID` en B; daarna `notified = 1` en twee `reminder_sent`-rijen met de huidige `remind_at`.
  - `bezorgd bij A, niet bij B (binnen 15 min)`: volgende run stuurt alleen naar B; `notified` blijft 0.
  - `na 15 minuten zonder bezorging bij B`: `notified = 1`, B's fallback-webhook (via `user_settings` `fallback_webhook`) is aangeroepen.
  - `snoozen maakt hem weer meldbaar voor iedereen` (nieuwe `remind_at` ≠ rij).
  - `taak niet gedeeld: gedrag als voorheen` (bestaande `test/reminders.test.ts` blijft groen).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementeer:** per verlopen taak de ontvangers = eigenaar + `accepted` deelnemers; sla wie een `reminder_sent`-rij met dezelfde `remind_at` heeft over; per persoon versturen (eigen prefs, eigen fallback zoals nu); bij bezorgd of `overdue` een `INSERT … ON CONFLICT(task_id,user_id) DO UPDATE SET remind_at = excluded.remind_at`; `notified = 1` als iedereen een rij met de huidige `remind_at` heeft.
- [ ] **Step 4:** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `Delen: herinneringen naar iedereen op een gedeelde taak, bezorging per persoon`.

### Task 4: Prullenbak in de app

**Files:**
- Create: `public/trash.js`
- Modify: `public/index.html` (zijbalkknop `#btn-trash` onder `#btn-done`), `public/sidebar.js`, `public/store.js` (`state.showTrash`, `state.trash`, `loadTrash()`, `restore(id)`, `purge(id)`, `emptyTrash()`), `public/render.js`, `public/detail.js` (bevestigingstekst), `public/app.js`, `public/i18n.js`, `public/style.css`, `public/sw.js`
- Test: `test/offline.test.ts` (SHELL-lijst), `test/i18n.test.ts` (draait vanzelf)

**Interfaces:**
- Consumes: `GET /api/tasks?deleted=1`, `POST /api/tasks/:id/restore`, `DELETE /api/tasks/:id?purge=1`, `POST /api/trash/empty`.
- Produces: i18n-sleutels `ui.trash`, `trash.hint`, `trash.restore`, `trash.purge`, `trash.empty`, `trash.empty_confirm`, `trash.nothing`, `trash.offline`, `detail.delete_confirm` (nieuwe tekst "Move to trash?" / "Naar de prullenbak?"), `detail.delete_confirm_shared`.

- [ ] **Step 1:** Voeg `/trash.js` toe aan `SHELL`, `CACHE` → `tick-shell-v12`; `npx vitest run test/offline.test.ts` faalt tot het bestand bestaat.
- [ ] **Step 2: Implementeer** de weergave zoals "Afgerond": alleen online (anders `trash.offline`), lijst nieuwste eerst met per taak "Terugzetten" en "Definitief verwijderen" (bevestiging via `dialog.js`), bovenaan de uitleg en "Prullenbak legen". Na terugzetten `load()`. Geen slepen, geen detailpaneel bewerken in de prullenbak.
- [ ] **Step 3:** `npm test` en `npm run typecheck` → PASS.
- [ ] **Step 4: Commit** `Prullenbak in de app: weergave, terugzetten, definitief verwijderen, legen`.

### Task 5: Delen in de app

**Files:**
- Create: `public/share.js`
- Modify: `public/detail.js` (knop "Delen" en deelnemerslijst bij een hoofdtaak), `public/render.js` (icoontje bij `t.share`), `public/store.js` (`state.invites`, ophalen `GET /api/shares/incoming` in `load()`, fouten genegeerd; acties `invite`, `acceptInvite`, `declineInvite`, `removeShare`), `public/app.js` (`?share=<id>` scrolt naar de balk), `public/sw.js` (acties `accept`/`decline` met `shareId`), `public/i18n.js`, `public/style.css`, `public/sw.js` `SHELL` (+`/share.js`, `CACHE` blijft `v12` als Task 4 op dezelfde branch nog niet uitgerold is, anders `v13`)
- Test: `test/offline.test.ts`

**Interfaces:**
- Consumes: `/api/shares` routes (Task 2), `Task.share` (Task 2).
- Produces: i18n-sleutels `share.button`, `share.title`, `share.to_label`, `share.to_placeholder`, `share.mode_shared`, `share.mode_shared_hint` ("One task: done is done for everyone"), `share.mode_copy`, `share.mode_copy_hint` ("They get their own copy"), `share.send`, `share.sent`, `share.members`, `share.pending`, `share.accepted`, `share.remove`, `share.leave`, `share.leave_confirm`, `share.remove_confirm`, `share.with` ("Shared with {names}"), `share.invite_shared` ("{name} shares “{title}” with you"), `share.invite_copy`, `share.accept`, `share.decline`, `share.online_only`.

- [ ] **Step 1:** `/share.js` in `SHELL`; offline-test faalt tot het bestand bestaat.
- [ ] **Step 2: Implementeer** de dialoog (veld met `<datalist>` van eerdere deelgenoten uit `share.members` van je eigen taken, twee radioknoppen met uitleg, versturen → `toast(share.sent)`), de deelnemerslijst met acties (eigenaar: verwijderen per persoon; ontvanger: alleen "Stoppen met delen" bij zichzelf), het icoontje in de lijst (`title` = `share.with`), en de uitnodigingsbalk bovenaan de takenlijst (Accepteren → `load()`; Weigeren → weg). Alleen online; offline `share.online_only`.
- [ ] **Step 3:** Service worker: bij `event.action === 'accept'|'decline'` en `shareId` → `POST /api/shares/<id>/<action>`; een klik zonder actie opent `url`.
- [ ] **Step 4:** `npm test` en `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Delen in de app: deeldialoog, deelnemers, uitnodigingen en meldingsknoppen`.

### Task 6: Documentatie en controle in de browser

**Files:**
- Modify: `ARCHITECTURE.md` (datamodel, API-tabel, toegangsregel, cron, prullenbak, offline), `README.md` als daar een functielijst staat

- [ ] **Step 1:** Werk `ARCHITECTURE.md` bij volgens spec §11.
- [ ] **Step 2:** `npm run db:migrate:local`, `npm run dev`, en in de browser met twee accounts (admin met `DEV_AUTH_BYPASS` of login, plus een lid via een uitnodigingslink): delen (gedeeld en kopie), uitnodiging accepteren via de balk, afvinken bij de een en zien bij de ander na herladen, lijst verplaatsen bij de ontvanger, verwijderen → prullenbak bij beiden, terugzetten, stoppen met delen. Controleer de console op fouten en maak screenshots.
- [ ] **Step 3:** `npm run typecheck` en `npm test` → PASS.
- [ ] **Step 4: Commit** `Docs: taken delen en prullenbak`.
