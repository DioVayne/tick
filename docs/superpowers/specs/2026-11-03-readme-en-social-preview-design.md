# Nieuwe README en social preview

## Waarom
Tick heeft sinds de vorige README veel nieuwe features gekregen (Tickmanager, rijmodus, gedeelde lijsten, iPhone-pagina, widget) en de app ziet er anders uit. De GitHub-pagina en de social preview tonen een verouderde app en noemen de nieuwe dingen niet. Dio wil dat iemand die op de repo terechtkomt binnen tien seconden snapt wat Tick is, wat het kost en wat het oplevert, en dat de pagina er verzorgd uitziet ("niet goedkoop").

## Doelen
- De README opnieuw opbouwen rond de belangrijkste features, in de volgorde die Dio koos (zie Opbouw).
- Alle screenshots opnieuw maken in de huidige app.
- Schermen tonen in een telefoonframe; uitgelichte features als ingezoomde uitsnede; alle beelden met afgeronde hoeken.
- Een nieuwe social preview die bij de nieuwe README past.

## Geen doel
- De techniekdelen onderaan (Requirements, How to install, Built with, Commands, Tests, Database, Security, Contributing, License) inhoudelijk herschrijven. Alleen verwijzingen bijwerken die niet meer kloppen.
- De gebruikershandleiding in `docs/` herschrijven. Bestaande docs-pagina's mogen naar de nieuwe screenshots verwijzen als ze nu een oude gebruiken, maar dat is geen opdracht.
- Een nieuwe demo-GIF of -video. *(Mijn keuze: de huidige `demo.gif`/`demo.mp4` verdwijnt uit de README en uit de repo, omdat hij de oude app laat zien en nergens anders gebruikt wordt.)*

## Wat het niet mag worden
- Goedkoop ogend: platte schermafdrukken met rechte hoeken, rommelige maten, beelden die niet bij elkaar passen.
- Een muur van tekst of een featurelijst zonder beeld.
- Beloftes die niet kloppen, vooral over de iPhone (geen plaatsherinneringen) en over de kosten (gratis Cloudflare, bijlagen vragen een betaalmethode).

## Opbouw van de README (Dio's keuze, bevestigd in de mockup)
1. **Hero:** logo, "Tick", één belofte. Richting: *Your own free to-do app, for the web and Android. With reminders that know where you are.* (Exacte tekst: aan de bouwer.)
2. **Verwachtingen, meteen onder de hero** (Dio: "eerst verwachtingsmanagement"): een opvallend blok (GitHub `> [!NOTE]` of vergelijkbaar) met:
   - draait op je eigen **gratis Cloudflare-account**, opzetten kost **ongeveer 15 minuten** met Claude Code;
   - **Android:** app met home-screen widget; **web:** elke browser, installeerbaar, werkt offline;
   - **iPhone:** voorlopig alleen de webapp, dus **geen plaatsherinneringen**.
3. **Eerste indruk:** een strook van drie telefoons met de hele app, de middelste iets groter.
4. **Drie grote features**, elk met tekst en een uitgelicht beeld, links/rechts afwisselend:
   1. **Taken op locatie**, met de verwijzing naar Google Keep (die link staat in de huidige README).
   2. **Taken delen** met partner, vrienden of familie (lijsten en losse taken, *I'll take it*).
   3. **Hulp bij inplannen van oude taken:** de Tickmanager.
5. **Overige features, subtieler:** kleine tegels met een eigen beeldje, een titel van 1 à 3 woorden en één zinnetje. Dio noemde: bijlagen, groepstaken, subtaken, herinneringen, herhalen, vegen om te verwijderen of te verplaatsen, slepen, kalender, agenda, rijmodus. *(Mijn toevoeging: widget en offline.)* Wat geen tegel krijgt, komt als één tekstregel eronder (kleurthema's, TickTick-import, MCP voor Claude, en dergelijke).
6. **Get your own in about 15 minutes** en daarna de bestaande techniekdelen.

De lijst "All features" met links naar de handleiding blijft bestaan, maar compacter onder de tegels of in een `<details>`-blok. *(Mijn keuze: hij bevat waardevolle links naar `docs/`.)*

## Beeldstijl
De mockup die Dio goedkeurde staat naast dit document: [2026-11-03-readme-mockup-v2.html](2026-11-03-readme-mockup-v2.html). De beelden erin waren oude screenshots als opvulling (ze laden daar niet meer); het gaat om de verhoudingen: frame en notch, middelste telefoon iets groter (ongeveer 200 tegen 170 px breed), uitgelichte beelden ongeveer 300×230 naast de tekst, tegels in vier kolommen.

- **Telefoonframe** voor hele schermen: donker frame, ronde hoeken, kleine notch, zoals in de mockup.
- **Uitgelichte beelden** bij de grote features: ingezoomde uitsnede van één schermdeel (bijvoorbeeld de kaart met de cirkel, of *Board games · Sanne is on it*), groot weergegeven, met flink ronde hoeken en een zachte schaduw, zonder telefoonframe.
- **Tegels:** zelfde ronde hoeken, kleiner, zonder frame. Alle tegels even groot.
- **Alle afbeeldingen zijn kant-en-klare PNG's.** GitHub haalt CSS uit de README, dus frames, ronde hoeken en schaduw zitten in het beeld zelf. Achtergrond transparant, zodat het op GitHub licht én donker goed staat. *(Mijn keuze.)* Controleer beide GitHub-thema's; een schaduw die op donker vies wordt, gaat eruit of wordt subtieler.
- Op 2× pixeldichtheid renderen, zodat het scherp is op retina.
- Eén lijn in licht/donker per rij beelden, zodat het rustig oogt. Welke modus waar: aan de bouwer.
- Demotaken, geen echte gegevens. Engelse app-taal, zoals nu.

## Hoe de beelden gemaakt worden
- Er is al een werkwijze buiten de repo: `C:\dev\tick-docs-scripts` (`seed.mjs` vult een lokale Tick met demotaken via de API, `shot.mjs` maakt met Playwright een screenshot van een scherm, met vaste klok 2026-10-27 en Europe/Amsterdam) en `C:\dev\tick-docs-seed.sql` (demogebruikers Robin, Sanne en Alex). Bouw daarop voort; de seed moet waarschijnlijk worden uitgebreid voor de Tickmanager (oude taken), rijmodus, bijlagen, kalender enzovoort.
- Draai niets vanaf Google Drive: werk in een kopie in `C:\dev` en zet alleen de resultaten in de repo.
- Het opmaken (frame, uitsnede, ronde hoeken) gebeurt met een klein HTML-sjabloon dat met headless browser naar PNG wordt gerenderd, net als `docs/social-preview.html` nu. De bronbestanden van die sjablonen horen in de repo naast de beelden, zodat ze later opnieuw te maken zijn. *(Mijn keuze; de precieze map is aan de bouwer.)*
- **Native Android (widget, Android-melding):** Playwright kan die niet vastleggen. *(Mijn keuze:)* gebruik een Android-emulator met de demodata als die in `C:\dev` al werkt (er staan Android-builds); lukt dat niet zonder grote opzet, dan gaat de widget naar de tekstregel in plaats van een tegel. Niet in HTML nabouwen: het beeld moet tonen wat de app echt doet. Een vastgelegd emulatorbeeld gaat de repo in als bron, zodat het opmaken later opnieuw kan.
- `docs/sharing.md` gebruikt `shared-list.png` en `sharing.png`. *(Mijn keuze:)* die krijgen ook nieuwe versies onder dezelfde naam, zodat de handleiding niet de oude app toont. Niets anders gebruikt `demo.gif`/`demo.mp4`, dus die worden verwijderd.
- Locatie en rijmodus zijn lastig na te bootsen in een browser; een gefingeerde positie of een kleine `js:`-stap in `shot.mjs` is prima, zolang het beeld laat zien wat de app echt doet.

## Social preview
- Formaat 1280×640, gerenderd op 2× (2560×1280), net als nu. Bron in `docs/social-preview.html`, resultaat `docs/social-preview.png`.
- Ontwerp is aan de bouwer (Dio: "verras me"). Richting: dezelfde beeldtaal als de README (telefoonframes, ronde hoeken), het logo, "Tick", de nieuwe belofte en de drie grote features: locatie, delen, Tickmanager. Plus in klein: *Free · Web + Android · your own Cloudflare*.
- Belangrijk deel moet binnen het middelste vlak blijven, omdat sommige sites de kaart bijsnijden.
- **GitHub laat de social preview niet via git of API instellen.** Dio moet het nieuwe PNG zelf uploaden onder *Settings → General → Social preview* van de repo. Geef Dio daarvoor korte genummerde stappen.

## Regels uit het project
- De README is in het Engels. De docs blijven Engels.
- Geen wijzigingen aan app-code nodig. Mocht een screenshot een bug blootleggen, dan meld je die apart en wordt die niet stil gerepareerd.
- `npm run typecheck` en `npm test` hoeven alleen als er toch code verandert.

## Werkwijze in git (Dio's keuze)
Direct op `main` committen en pushen; geen branch of pull request. Controleer de gerenderde pagina daarna op github.com/DioVayne/tick in licht en donker, en push correcties gewoon als volgende commit. Houd tussenstappen netjes: push pas als een onderdeel af is, niet halverwege met kapotte afbeeldingen.

## Klaar als
- De README heeft de opbouw hierboven, met nieuwe screenshots in de afgesproken stijl, en ziet er goed uit op GitHub in licht en donker (controleer de gerenderde pagina, niet alleen het markdownbestand).
- Alle beelden in de README tonen de huidige app.
- `docs/social-preview.png` is vernieuwd en Dio heeft de stappen om hem te uploaden.
- Oude screenshots die nergens meer gebruikt worden, zijn verwijderd.

## Aan de bouwer
- Exacte teksten (Engels), welke tegels precies en in welke volgorde.
- Welke schermdelen precies uitgelicht worden.
- Licht of donker per rij, maten in pixels.
- Het ontwerp van de social preview binnen de richting hierboven.
