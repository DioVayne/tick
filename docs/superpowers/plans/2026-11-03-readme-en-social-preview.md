# Nieuwe README en social preview: bouwplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De README en social preview opnieuw maken rond locatie, delen en de Tickmanager, met nieuwe screenshots in telefoonframes, uitsneden en tegels met ronde hoeken.

**Architecture:** Een lokale Tick (kopie in `C:\dev`) wordt gevuld met demodata en met Playwright gefotografeerd (ruwe schermen). Een HTML-opmaaksjabloon zet die ruwe schermen in een frame, uitsnede of tegel en wordt met Playwright naar transparante PNG's gerenderd. De README gebruikt alleen die kant-en-klare PNG's.

**Tech Stack:** Playwright 1.56 (staat in `C:\dev\tick-docs-scripts`), wrangler dev met lokale D1/R2, Android-emulator `Pixel7_API34` (SDK onder `%LOCALAPPDATA%\Android\Sdk`), GitHub-markdown.

**Spec:** [docs/superpowers/specs/2026-11-03-readme-en-social-preview-design.md](../specs/2026-11-03-readme-en-social-preview-design.md), mockup: [2026-11-03-readme-mockup-v2.html](../specs/2026-11-03-readme-mockup-v2.html)

## Global Constraints
- Niets draaien vanaf Google Drive (`K:\Google Drive\...`): app en scripts draaien in `C:\dev`. Bestanden die in git horen, schrijf en commit je in de repo op Drive.
- README en docs in het Engels; app-taal in screenshots Engels (`locale: 'en-GB'`), tijdzone `Europe/Amsterdam`, vaste klok.
- Alleen demodata (Robin, Sanne, Alex, Mia; adressen in Amsterdam zoals in de huidige seed). Geen echte gegevens.
- Alle README-beelden zijn PNG's op 2× pixeldichtheid met transparante achtergrond; frames, ronde hoeken en schaduw zitten in het beeld.
- Niet in HTML nabouwen wat de app niet echt doet; native Android komt uit de emulator.
- iPhone: alleen webapp, **geen plaatsherinneringen**. Kosten: gratis Cloudflare; bijlagen vragen een betaalmethode (R2).
- Git: direct op `main`; push pas als een onderdeel af is (README met alle beelden in één keer), nooit met kapotte afbeeldingen.
- Geen wijzigingen aan app-code. Een bug die je in een screenshot ziet: melden aan Dio, niet stil repareren.
- Commits in het Nederlands, eindigend op `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Hoofdlettergevoelige paden:** Windows vindt `Feature-Places.png` ook bij `feature-places.png`, GitHub niet. Elk beeldpad in README en docs moet exact bestaan (check in Task 5).
2. **GitHub donker thema:** transparante PNG's met schaduw of halfdoorzichtige randen geven een grijze waas op donker. Bekijk elke rij in licht én donker (Task 8).
3. **Smal scherm (GitHub-app, telefoon):** een tabel met vier tegels per rij mag niet onleesbaar klein worden of horizontaal scrollen. Beelden in de tabel krijgen een `width` en geen vaste hoogte (Task 8 checkt op 390 px breed).
4. **Bestandsgrootte:** een 2×-PNG van een volledig scherm kan zomaar 1 MB zijn. Elk opgemaakt beeld maximaal 400 KB, de hele `docs/screenshots` (zonder `src/raw`) maximaal 6 MB (check in Task 5).
5. **Bijsnijden van de social preview:** Slack, X en LinkedIn snijden de randen af. Logo, naam en belofte binnen het middelste vlak van 1040×520 (van 1280×640) (Task 7).

---

## Bestanden
- `docs/screenshots/src/seed.mjs`: vult de lokale Tick met demodata (overgenomen uit `C:\dev\tick-docs-scripts\seed.mjs`, uitgebreid).
- `docs/screenshots/src/shot.mjs`: maakt één ruw screenshot (overgenomen en uitgebreid).
- `docs/screenshots/src/shots.txt`: de lijst ruwe shots, één per regel, in de argumentvorm van `shot.mjs`.
- `docs/screenshots/src/raw/*.png`: ruwe schermen (web en emulator).
- `docs/screenshots/src/compose.html`: opmaaksjabloon, gestuurd met query-parameters.
- `docs/screenshots/src/compose.mjs`: rendert alle opgemaakte beelden uit `compose.html`.
- `docs/screenshots/src/README.md`: hoe je alles opnieuw maakt (kort, Engels).
- `docs/screenshots/*.png`: de opgemaakte beelden (namen hieronder).
- `docs/social-preview.html`, `docs/social-preview.png`: vernieuwd.
- `README.md`, `docs/sharing.md`: aangepast.
- Weg: `docs/screenshots/demo.gif`, `demo.mp4`, en alle oude PNG's die na Task 5 nergens meer gebruikt worden.

**Namen van opgemaakte beelden** (vast, alle kleine letters):
`hero.png` (drie telefoons in één beeld), `feature-places.png`, `feature-sharing.png`, `feature-tickmanager.png`, `tile-attachments.png`, `tile-group-tasks.png`, `tile-subtasks.png`, `tile-reminders.png`, `tile-repeat.png`, `tile-swipe.png`, `tile-drag.png`, `tile-calendar.png`, `tile-agenda.png`, `tile-driving.png`, `tile-widget.png`, `tile-offline.png`, en voor de handleiding `shared-list.png` en `sharing.png` (zelfde naam als nu, nieuw beeld).

Werkmappen buiten git: `C:\dev\tick-readme` (kopie van de repo om de app te draaien), `C:\dev\tick-docs-state\readme` (lokale D1/R2), `C:\dev\tick-docs-scripts` (Playwright; scripts worden hiernaartoe gekopieerd om te draaien, omdat `import 'playwright'` vanuit de map van het script wordt opgezocht).

---

### Task 1: Lokale Tick met volledige demodata

**Files:**
- Create: `docs/screenshots/src/seed.mjs`, `docs/screenshots/src/README.md`
- Buiten git: `C:\dev\tick-readme`, `C:\dev\tick-docs-state\readme`

**Interfaces:**
- Produces: een draaiende Tick op `http://localhost:8801` met inlogomzeiling (`DEV_AUTH_BYPASS=1` in `.dev.vars`), de demogebruikers uit `C:\dev\tick-docs-seed.sql`, de API-sleutels `tick_demorobin…`, `tick_demosanne…`, `tick_demoalex…` uit de huidige seed, en de scènes die Task 2 nodig heeft.

- [ ] **Step 1:** Push eerst de ontwerpcommit (`50ddf94`) vanuit de repo op Drive (`git push`; geen npm). Kopieer daarna de repo zonder `node_modules` en `.git` naar `C:\dev\tick-readme` (`robocopy … /MIR /XD node_modules .git`), inclusief `wrangler.jsonc` en `.dev.vars`; zet in `.dev.vars` `DEV_AUTH_BYPASS=1`. `npm ci` daar.
- [ ] **Step 2:** Lokale database: `npx wrangler d1 migrations apply DB --local --persist-to C:/dev/tick-docs-state/readme`, dan `npx wrangler d1 execute DB --local --persist-to C:/dev/tick-docs-state/readme --file C:/dev/tick-docs-seed.sql`. Start `npx wrangler dev --port 8801 --persist-to C:/dev/tick-docs-state/readme` op de achtergrond.
  Verwacht: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8801/` geeft `200`.
- [ ] **Step 3:** Kopieer `C:\dev\tick-docs-scripts\seed.mjs` naar `docs/screenshots/src/seed.mjs` en breid het uit, zodat er naast de huidige scènes ook is:
  - **Tickmanager:** minstens 6 open taken in verschillende lijsten zonder herinnering in de toekomst, ouder dan 14 dagen ten opzichte van de vaste klok (2026-10-27). Als de API `created_at` niet laat zetten: na het seeden een `wrangler d1 execute … --command "UPDATE tasks SET created_at=… WHERE title IN (…)"`, als aparte stap in `seed.mjs` via `child_process` of als tweede bestand `seed-old.sql` in `src/`.
  - **Bijlage:** een taak met een foto (een eigen gemaakte, neutrale afbeelding, bijvoorbeeld een kleurstaal of plattegrond, geen foto van een persoon) via de bijlage-API; lokale R2 werkt met `--persist-to`.
  - **Groepstaak:** een taak gedeeld als gekoppelde kopieën met Sanne en Alex, waarvan één de kopie heeft afgevinkt (voortgang zichtbaar).
  - **Kalender/agenda:** genoeg taken met herinneringen verspreid over oktober en november 2026 dat de maand en de agenda gevuld ogen (8 tot 12).
  - **Herhalen:** minstens twee herhalende taken met verschillende regels (één met einddatum).
- [ ] **Step 4:** Kopieer `seed.mjs` naar `C:\dev\tick-docs-scripts` en draai het daar (`node seed.mjs`). Verwacht: `ok` en geen fout. Open `http://localhost:8801/#/manager` in de browser en controleer dat de Tickmanager het juiste aantal oude taken toont.
- [ ] **Step 5:** Schrijf `docs/screenshots/src/README.md` (Engels, kort): welke mappen, de commando's uit Step 1–4, en dat Task 2–4 hierop doorgaan. Commit `seed.mjs`, eventueel `seed-old.sql`, en `README.md` (`Screenshots: demodata voor de nieuwe README`).

### Task 2: Ruwe webscreenshots

**Files:**
- Create: `docs/screenshots/src/shot.mjs`, `docs/screenshots/src/shots.txt`, `docs/screenshots/src/raw/*.png`

**Interfaces:**
- Consumes: Tick op `http://localhost:8801` met demodata (Task 1).
- Produces: ruwe PNG's in `docs/screenshots/src/raw/`, telefoon op 390×844 @2× (780×1688), desktop op 1280×800 @2×. Namen: `m-<scène>-<light|dark>.png` en `d-<scène>-<light|dark>.png`.

- [ ] **Step 1:** Neem `C:\dev\tick-docs-scripts\shot.mjs` over in `docs/screenshots/src/shot.mjs`. Breid het uit met:
  - `geo:<lat>,<lng>`: `ctx.setGeolocation` + `grantPermissions(['geolocation'])` vóór `goto` (voor plaatsen en rijmodus);
  - `swipe:<selector>`: een aanraakveeg naar links tot de veeg-actie zichtbaar is, zonder los te laten (`page.touchscreen` of `dispatchEvent` met touch-events);
  - `drag:<selector>`: lang indrukken en halverwege slepen, screenshot tijdens het slepen;
  - `offline`: `ctx.setOffline(true)` na het laden.
  Rijmodus: als de app snelheid niet uit `setGeolocation` haalt, overschrijf `navigator.geolocation.watchPosition` via `page.addInitScript` met posities met `speed: 12` (m/s), zodat de echte rijmodus aangaat.
- [ ] **Step 2:** Schrijf `shots.txt`: één regel per shot met de argumenten voor `shot.mjs` (naam, `m`/`d`, `light`/`dark`, hash, stappen). Minstens deze scènes, telefoon tenzij anders:
  home (lijst met vastgepinde boodschappen), locatiekiezer (kaart met cirkel, *On arrival*), taak-detail boodschappen, gedeelde lijst *Weekend in the Ardennes* (*I'll take it*, *Sanne is on it*), deeldialoog, Tickmanager (een taak in beeld met de vier keuzes), oranje Tickmanager-knop op home, bijlage in taak, groepstaak met voortgang, subtaken 2/4, herinneringskiezer, herhaalkiezer, veeg, slepen, kalender-maand, agenda, rijmodus, offline-melding, plus `d-home-light` en `d-shared-dark` voor de social preview.
- [ ] **Step 3:** Kopieer `shot.mjs` naar `C:\dev\tick-docs-scripts` en draai elke regel van `shots.txt` (een kleine lus in bash). Verwacht: één PNG per regel in `docs/screenshots/src/raw/`, elk 780×1688 of 2560×1600.
- [ ] **Step 4:** Bekijk elk ruw beeld (Read-tool). Controleer: geen echte gegevens, geen foutmeldingen, geen half geladen kaarttegels, de bedoelde toestand zichtbaar (veeg-actie, sleepstand, rijmodus aan). Opnieuw schieten tot het klopt.
- [ ] **Step 5:** Commit `shot.mjs`, `shots.txt` en `raw/` (`Screenshots: ruwe schermen van de huidige app`).

### Task 3: Widget uit de Android-emulator

**Files:**
- Create: `docs/screenshots/src/raw/a-widget.png` (en eventueel `a-notification.png`)

**Interfaces:**
- Consumes: Tick op `http://localhost:8801` (vanuit de emulator `http://10.0.2.2:8801`), de demosleutel van Robin.
- Produces: `raw/a-widget.png` op de schermresolutie van de emulator, of de beslissing "widget wordt een tekstregel".

- [ ] **Step 1:** Start `Pixel7_API34` (`emulator -avd Pixel7_API34`, op de achtergrond), installeer de laatste `Tick.apk` (uit `C:\dev\tick-apk-1.12.0` of de Releases), koppel aan `http://10.0.2.2:8801` met Robins demosleutel. Lukt koppelen of starten niet binnen ongeveer 30 minuten werk: stop, noteer het in de commit van Task 4 en laat `tile-widget.png` weg (de widget gaat naar de tekstregel in Task 5).
- [ ] **Step 2:** Zet de widget op het startscherm met een lijst met 4 à 5 taken. Neem op met `adb exec-out screencap -p > raw/a-widget.png`. Verwacht: widget met demotaken, geen persoonlijke meldingen of iconen in de statusbalk (zet *demo mode* aan: `adb shell settings put global sysui_demo_allowed 1` en `am broadcast -a com.android.systemui.demo -e command enter`).
- [ ] **Step 3:** Commit `raw/a-widget.png` (`Screenshots: widget uit de emulator`).

### Task 4: Opmaaksjabloon en renderscript

**Files:**
- Create: `docs/screenshots/src/compose.html`, `docs/screenshots/src/compose.mjs`

**Interfaces:**
- Consumes: ruwe PNG's uit `src/raw/`.
- Produces: `compose.html?type=<phone|hero|highlight|tile>&img=<raw-naam>[&img2=…&img3=…]&x=<px>&y=<px>&zoom=<factor>&w=<px>&h=<px>`; `compose.mjs` met een tabel `{ out: 'feature-places.png', query: '…' }[]` die elk beeld rendert met `page.screenshot({ omitBackground: true, … })` op `deviceScaleFactor: 2`, uitgesneden op het element `#stage`.

Maten uit de goedgekeurde mockup (CSS-pixels, gerenderd op 2×):
- `phone`: frame donker `#0d0f14`, hoekstraal 16% van de breedte, rand 3,5%, notch 28% breed; schermhoek 13%.
- `hero`: drie telefoons naast elkaar, 170/200/170 breed, onderkant gelijk, 22 px tussenruimte.
- `highlight`: 600×460 (= 300×230 weergegeven), hoekstraal 22 px, zachte schaduw; uitsnede via `x`, `y`, `zoom` op het ruwe beeld.
- `tile`: 400×240 (= 200×120 weergegeven), hoekstraal 14 px, kleinere schaduw.
- Schaduw met genoeg marge rondom `#stage` dat hij niet wordt afgesneden, en zwak genoeg dat hij op GitHub-donker (`#0d1117`) geen grijze waas geeft.

- [ ] **Step 1:** Schrijf `compose.html` (geen externe bronnen; laadt het ruwe beeld relatief uit `raw/`). Open één variant per type in de browser en vergelijk met de mockup. Verwacht: zelfde verhoudingen als in de mockup.
- [ ] **Step 2:** Schrijf `compose.mjs` met de tabel voor alle beelden uit "Namen van opgemaakte beelden" en de bijbehorende uitsneden. Uitlichten (richting, de bouwer kiest de exacte uitsnede): plaatsen = kaart met cirkel en *On arrival*; delen = *Board games · Sanne is on it* en *I'll take it*; Tickmanager = taak met de vier keuzes. `shared-list.png` en `sharing.png` als `phone`.
- [ ] **Step 3:** Kopieer `compose.mjs` naar `C:\dev\tick-docs-scripts` en draai het met als argument het pad naar `docs/screenshots` (`file://`-URL naar `compose.html`). Verwacht: alle PNG's uit de namenlijst in `docs/screenshots/` met een transparante achtergrond (controleer de alfa van een hoekpixel, bijvoorbeeld met een paar regels Playwright of `sharp` als het er is).
- [ ] **Step 4:** Bekijk elk beeld (Read-tool) op een lichte én donkere achtergrond: plak ze in een kleine testpagina met twee kolommen (`#ffffff` en `#0d1117`) in de scratchpad. Verwacht: scherpe hoeken zonder witte of grijze rand, schaduw niet vies op donker.
- [ ] **Step 5:** Commit `compose.html`, `compose.mjs` en de opgemaakte PNG's (`Screenshots: opgemaakt in telefoonframes, uitsneden en tegels`).

### Task 5: README herschrijven

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: alle PNG's uit Task 4.

- [ ] **Step 1:** Herschrijf het bovenste deel van `README.md` tot en met *A quick tour* / *Also in the box* volgens de opbouw in het ontwerp:
  1. Hero (gecentreerd): `docs/logo.svg`, `<h1>Tick</h1>`, belofte in de richting *Your own free to-do app, for the web and Android. With reminders that know where you are.*
  2. `> [!NOTE]`-blok *What you're getting* met de drie regels uit het ontwerp (Cloudflare gratis + ±15 minuten met Claude Code; Android app + widget, web installeerbaar en offline; iPhone alleen webapp, geen plaatsherinneringen), met een link naar `docs/iphone.md`.
  3. `hero.png` gecentreerd, `width="720"` of kleiner.
  4. Drie featurerijen in een tabel zonder koppen of met `<table>` en twee cellen per rij, beeld en tekst om en om. Plaatsen houdt de Google Keep-link uit de huidige README. Tickmanager linkt naar `docs/tickmanager.md`, delen naar `docs/sharing.md`, plaatsen naar `docs/places.md`.
  5. *Also in the box*: `<table>` met drie rijen van vier tegels; per cel het beeld (`width="200"`), een vette titel van 1 à 3 woorden en één zin, en een link naar de pagina in de handleiding. Eronder één tekstregel met de rest (kleurthema's met eigen achtergrond, TickTick-import, MCP-server voor Claude, prullenbak 30 dagen, pinnen, zoeken, Engels en Nederlands). Ontbreekt `tile-widget.png` (Task 3 mislukt), dan schuift de widget naar die tekstregel en wordt het raster 11 tegels; kies dan een tegel minder of laat de laatste cel leeg.
  6. De bestaande lijst *All features* in een `<details><summary>All features</summary>`-blok, bijgewerkt met Tickmanager, rijmodus en iPhone (links naar `docs/tickmanager.md`, `docs/driving-mode.md`, `docs/iphone.md`).
  7. *Get your own in about 15 minutes* en alles daaronder blijft, op verwijzingen naar weggehaalde beelden na.
  Elke `<img>` krijgt een `alt` die beschrijft wat er te zien is, zoals nu. Onder de tegels: *The screenshots use made-up demo tasks.*
- [ ] **Step 2:** Controleer de paden (Review Focus 1). Draai in de repo:
  ```bash
  grep -oE '(src|href)="docs/[^"]+"|\]\(docs/[^)]+\)' README.md | sed -E 's/.*(docs\/[^")]+).*/\1/' | sort -u | while read p; do git ls-files --error-unmatch "$p" >/dev/null 2>&1 || echo "MIST: $p"; done
  ```
  Verwacht: geen uitvoer. (`git ls-files` is hoofdlettergevoelig, anders dan het Windows-bestandssysteem.)
- [ ] **Step 3:** Controleer de groottes (Review Focus 4):
  ```bash
  find docs/screenshots -maxdepth 1 -name '*.png' -size +400k; du -ch docs/screenshots/*.png | tail -1
  ```
  Verwacht: geen bestanden boven 400 KB, totaal onder 6 MB. Te groot: opnieuw renderen met kleinere afmetingen of comprimeren (lossless, bijvoorbeeld `oxipng` als het er is; anders het ruwe beeld kleiner uitsnijden).
- [ ] **Step 4:** Commit (`README: opnieuw opgebouwd rond plaatsen, delen en de Tickmanager`).

### Task 6: Opruimen en handleiding

**Files:**
- Modify: `docs/sharing.md` (alleen als alt-teksten niet meer kloppen bij de nieuwe beelden)
- Delete: `docs/screenshots/demo.gif`, `demo.mp4`, en oude PNG's die nergens meer naar verwezen worden

- [ ] **Step 1:** `git grep -n "screenshots/"` en noteer per oud bestand of er nog naar verwezen wordt. `mobile-*.png`, `desktop-*.png`, `trash.png`, `settings.png`, `demo.*` worden na Task 5 niet meer gebruikt; verwijder alleen wat `git grep` echt niet meer vindt.
- [ ] **Step 2:** Pas de alt-teksten in `docs/sharing.md` aan zodat ze beschrijven wat er nu op `shared-list.png` en `sharing.png` staat.
- [ ] **Step 3:** Commit (`Screenshots: oude beelden en demo-video weg, handleiding delen bijgewerkt`).

### Task 7: Social preview

**Files:**
- Modify: `docs/social-preview.html`, `docs/social-preview.png`

- [ ] **Step 1:** Herontwerp `docs/social-preview.html` (1280×640, geen externe bronnen behalve de beelden in `docs/`): logo, "Tick", de nieuwe belofte, de drie grote features (locatie, delen, Tickmanager) en in klein *Free · Web + Android · your own Cloudflare*. Beeldtaal gelijk aan de README: telefoons in frames (hergebruik `hero.png` of render de telefoons apart met `compose.html`), ronde hoeken. Logo, naam en belofte binnen het middelste vlak van 1040×520 (Review Focus 5). Werk het render-commentaar bovenaan bij als het verandert.
- [ ] **Step 2:** Render naar 2560×1280: met de Playwright-route uit Task 4 of zoals in het commentaar (`msedge --headless --screenshot=… --window-size=1280,640 --force-device-scale-factor=2`). Verwacht: `docs/social-preview.png` is 2560×1280 en kleiner dan 1 MB (GitHub-limiet).
- [ ] **Step 3:** Bekijk het beeld (Read-tool), ook met een overlay van het middelste vlak van 1040×520 in de scratchpad: niets belangrijks buiten dat vlak.
- [ ] **Step 4:** Commit (`Social preview: nieuwe kaart rond plaatsen, delen en de Tickmanager`).

### Task 8: Pushen en controleren op GitHub

- [ ] **Step 1:** `git push` naar `main` vanuit de repo op Drive. Verwacht: push zonder fouten.
- [ ] **Step 2:** Open `https://github.com/DioVayne/tick` in de ingebouwde browser. Controleer in licht en donker (`resize_window` met `colorScheme`) en op 390 px breed (Review Focus 2 en 3): alle beelden laden, geen grijze waas rond de transparante PNG's, tegels leesbaar en geen horizontale scroll in de tabel, het `[!NOTE]`-blok rendert als blok, het `<details>`-blok klapt open.
- [ ] **Step 3:** Fouten herstellen en als volgende commit pushen, tot Step 2 helemaal klopt. Zet daarna de browsergrootte terug (`preset: desktop`).
- [ ] **Step 4:** Werk de Drive-kopie bij als er in `C:\dev\tick-readme` iets is veranderd dat in git hoort (dat zou niet moeten). Stop `wrangler dev` en de emulator.
- [ ] **Step 5:** Geef Dio korte genummerde stappen om de social preview te uploaden:
  1. Ga naar github.com/DioVayne/tick → **Settings**.
  2. Onder **General**, bij **Social preview**: **Edit → Upload an image…**
  3. Kies `docs/social-preview.png` uit de repo-map.
  4. Controleer de voorvertoning en sla op.
