# Websitetekst ticktodo.nl

Datum: 2026-11-09. Status: concept, voor Dio om na te lezen.

Volledige tekst voor de marketingsite op ticktodo.nl. Eerst Nederlands (deel A), dan Engels (deel B). De knoppen- en schermtermen staan zoals de app ze toont (`public/i18n.js` en de Android-strings in `android/app/src/main/res/values*/strings.xml`). Opmerkingen voor de bouwer staan tussen `<!-- -->`.

Vaste links:
- Webapp: https://app.ticktodo.nl, aanmelden op https://app.ticktodo.nl/signup
- Privacy: https://app.ticktodo.nl/privacy
- Voorwaarden: https://app.ticktodo.nl/voorwaarden (NL), https://app.ticktodo.nl/terms (EN)
- Account verwijderen: https://app.ticktodo.nl/delete-account
- Broncode en zelf hosten: https://github.com/DioVayne/tick
- Android-app via GitHub: https://github.com/DioVayne/tick/releases/latest/download/Tick.apk
- Android-app in Google Play: `nl.ticktodo.app` (nog in de testfase, link volgt)

---

# DEEL A: NEDERLANDS

## 1. Hero

### Kopregel (kies er een, max. 8 woorden)
1. Tick meldt het als je bij de winkel bent.
2. De juiste herinnering. Op de juiste plek.
3. Onthouden laat je aan Tick over.
4. Melk kopen? Tick zegt het bij de supermarkt.
5. Een takenlijst die weet waar je bent.

### Subregel
Tick is een gratis to-do-app die je herinnert op het juiste moment. Op een tijd, of als je ergens aankomt. Voor je eigen hoofd vol losse eindjes, en voor alles wat je samen regelt. Zonder reclame, zonder tracking.

### Knoppen
- **Probeer gratis in je browser** → https://app.ticktodo.nl/signup
- **Gratis Android-app** <!-- Zolang de Play-versie in de testfase is: naar de APK op GitHub, of naar een sectie die beide uitlegt. Zie "Bronnen en twijfels". -->

Onder de knoppen, klein: *Op een iPhone of iPad zet je Tick op je beginscherm via Safari. Geen App Store nodig.*

### Interactieve kaartdemo

<!-- Echte plekmelding in de Android-app: titel = de taak, tekst = "📍 Aangekomen bij {plek}", één knop "Afvinken". Wegvegen = de melding komt de volgende keer dat je aankomt terug. "Over 1 uur" bestaat alleen bij meldingen op een tijd, niet bij een plek. Hieronder staat de demo zoals de app echt werkt; daaronder een variant met de tijdmelding-knoppen als je die toch wilt. -->

- **Sleephint bij het poppetje:** Sleep mij naar de winkel
- **Hint als het poppetje stilstaat:** Nog even. De supermarkt is daar.
- **Melding (titel):** Melk kopen
- **Melding (tekst):** 📍 Aangekomen bij de supermarkt
- **Knop in de melding:** Afvinken
- **Hint onder de melding:** Of veeg hem weg.
- **Na Afvinken:** Afgevinkt. Zie je, het werkt. Ik was zelf ook verbaasd.
- **Na wegvegen (knipoog):** Prima. De volgende keer dat je hier bent, meld ik me weer. Ik ben geduldig.
- **Fietsschakelaar (label):** Op de fiets
- **Uitleg bij de schakelaar:** Op de fiets ben je zo voorbij je cirkel. Met *Op tijd melden onderweg* maakt Tick de cirkel groter, zodat de melding op tijd komt.
- **Melding met fiets aan (tekst):** 📍 Bijna bij de supermarkt
- **Kleine regel onder de demo:** Meldingen op een plek werken in de Android-app. *Op tijd melden onderweg* zit alleen in de Android-app van GitHub.

**Variant met de knoppen van een tijdmelding** (alleen gebruiken als de demo laat zien dat een melding op een tijd komt):
- Knoppen: **Klaar** en **Over 1 uur**
- Na Klaar: Afgevinkt. Zie je, het werkt. Ik was zelf ook verbaasd.
- Na Over 1 uur (knipoog): Over een uur weer. Zeuren is het enige wat ik echt goed kan.

---

## 2. Het verhaal van de maker

### Kop
Hoe een hobbyproject een beetje uit de hand liep

### Tekst
Hoi, ik ben Dio. Ik heb Tick gemaakt omdat ik een app nodig had die mij aan dingen herinnert. Eentje die gewoon doet wat ik wil, en die niet ineens verdwijnt of geld gaat kosten.

Mijn vriendin heeft ADD. Zij zei wat Tick moest kunnen, in één zin: *"Tick geeft me herinneringen op het juiste moment, bijvoorbeeld als ik bij de winkel ben en iets niet mag vergeten te kopen."* Daar is het mee begonnen. We gebruiken het nu allebei, elke dag.

Het idee was een klein lijstje voor ons tweeën. Toen kwamen er gedeelde lijsten bij, een Android-app, een kalender, en een rijmodus. Nu heeft het een eigen website. Ik zou zeggen dat het zo gepland was, maar dat is niet zo.

---

## 3. Vier grote verhalen

### 3.1 Op de juiste plek

**Kop:** Een herinnering als je er bent

**Tekst:**
Sommige dingen kun je pas doen als je ergens bent. Melk kopen bij de supermarkt. Het pakketje meenemen als je de deur uit gaat. Geef een taak een plek op de kaart en kies **Bij aankomst** of **Bij vertrek**. Je telefoon let zelf op die plek en Tick meldt het op het moment dat het telefoon zegt dat je er bent. Met de auto of de fiets ben je soms al voorbij voordat Android het doorheeft. Daarom maakt Tick de cirkel onderweg groter. En zit je achter het stuur, dan wordt het scherm groter en eenvoudiger.

**Details:**
- Kies een plek door te zoeken, de kaart te slepen, *Mijn locatie* of een favoriet. Straal van 200 m tot 2 km.
- Veeg de melding weg en hij komt de volgende keer dat je aankomt terug. **Afvinken** maakt de taak af.
- Al gemeld en wil je hem nog een keer? Tik op **Opnieuw melden**.
- Een gedeelde taak met een plek: iedereen krijgt een eigen melding. Wie het eerst langs de winkel komt, doet de boodschappen.
- **Op tijd melden onderweg** (alleen de Android-app van GitHub): in de auto of op de fiets worden de cirkels groter. Hoeveel, leert Tick van je eerdere meldingen.
- **Rijmodus**: rijdt Tick mee, dan zie je grote knoppen, taken *Hier vlakbij* en wat voor vandaag is.
- Je positie gaat niet naar Tick. Je telefoon meldt alleen dat een herinnering afging.
- Meldingen op een plek werken in de Android-app. Op een iPhone kun je een plek instellen, maar krijg je er geen melding van.

### 3.2 Samen of kopie

**Kop:** Samen doen, of ieder zijn eigen

**Tekst:**
Je kunt een taak op twee manieren met iemand delen. **Gedeeld** is één taak voor jullie samen: afgevinkt is afgevinkt voor iedereen. Handig voor de boodschappen, of het vuilnis dat buiten moet. **Kopie** geeft de ander een eigen exemplaar. Ieder vinkt zijn eigen af, en je ziet hoe ver de ander is. Handig als jullie allebei hetzelfde moeten doen, zoals je belastingaangifte. Je kunt ook een hele lijst delen. Dan tik je op **Oppakken** en ziet de rest dat jij het doet.

**Details:**
- **Gedeeld:** iedereen kan de taak wijzigen en subtaken toevoegen. Ieder houdt hem in een eigen lijst en volgorde. Een herinnering op een tijd of plek bereikt iedereen die meedoet.
- Bij gedeeld krijg je een melding als iemand afvinkt (*"Sanne heeft dit afgevinkt ✓"*) of de taak een plek geeft.
- **Kopie:** de ander krijgt een eigen exemplaar met alle subtaken open. Wijzigingen gaan daarna niet meer over en weer.
- Bij een kopie zie je per persoon een naam met een balkje, of een ✓ als die klaar is. Titel, notities en subtaken van de ander zie je nooit.
- Een taak verwijderen die gedeeld is, verwijdert hem voor iedereen.
- **Omzetten:** nog niet geaccepteerd? Dan wissel je gewoon tussen gedeeld en kopie. Gedeeld en al geaccepteerd? Dan kun je er een kopie van maken. Een geaccepteerde kopie kan niet meer gedeeld worden; die moet eerst weg.
- **Gedeelde lijst:** iedereen in de lijst kan toevoegen, wijzigen, afvinken en verwijderen. Afgevinkte taken blijven onderaan staan, met wie het deed en wanneer.
- Sleep je een taak uit een gedeelde lijst naar een eigen lijst, dan is hij alleen van jou. Sleep je een eigen taak erin, dan is hij van iedereen.
- In de gratis versie op app.ticktodo.nl deel je met één persoon: zoveel taken en lijsten als je wilt.

**Labels voor de demo met twee telefoons**
<!-- Links "Jij", rechts "Sanne" (de voorbeeldnaam uit de handleiding). Bovenaan een schakelaar Gedeeld / Kopie. -->
- Schakelaar: **Gedeeld** | **Kopie**
- Uitleg bij Gedeeld: Eén taak voor jullie samen: afgevinkt is afgevinkt voor iedereen.
- Uitleg bij Kopie: Die krijgt een eigen exemplaar; jullie zien elkaars voortgang.
- Telefoon-labels: **Jij** | **Sanne**
- Taak: *Vuilnis buiten zetten* (gedeeld) / *Belastingaangifte doen* (kopie), met subtaken *Jaaropgave zoeken*, *Inloggen*, *Versturen*
- Rij bij Gedeeld (jouw telefoon): Gedeeld met Sanne
- Regel in de taak bij Gedeeld: Afvinken geldt voor iedereen.
- Rij bij Kopie (jouw telefoon): Kopie gestuurd aan Sanne
- Rij bij Kopie (telefoon van Sanne): Kopie van Dio
- Regel in de taak bij Kopie: Ieder vinkt zijn eigen exemplaar af.
- Hint: Vink links iets af en kijk rechts.
- Na afvinken bij Gedeeld, melding rechts: *Dio heeft dit afgevinkt ✓* <!-- In de app staat hier de naam van wie afvinkte (`share.push_done`). -->
- Na afvinken bij Gedeeld, uitleg: Afgevinkt aan beide kanten.
- Na afvinken van een subtaak bij Kopie, uitleg: Sanne ziet jouw balkje groeien. Wat je afvinkte, ziet ze niet.
- Na afvinken van de hele kopie, melding rechts: *Dio is klaar ✓*
- Lijstdemo, knop: **Oppakken**; daarna bij de ander: *Dio pakt het op*; bij jezelf: *Jij pakt het op*

### 3.3 Vrije momenten (LATER: niet op de site)

<!-- Weggehaald op 2026-11-10: agenda koppelen is nog niet af en de sectie klopte niet met de app. Tekst blijft hier staan voor later; de HTML, stijl en het script staan in site/later/. -->

**Kop:** Tick weet wanneer je tijd hebt

**Tekst:**
Een taak inplannen gaat makkelijker als je weet wanneer je kunt. Koppel je online agenda en Tick ziet wanneer je bezet bent. Bij een herinnering stelt Tick dan vrije momenten voor: het eerste vrije halfuur, een vrije avond en een moment in het weekend. Staat er al iets op *Morgen*, dan zegt Tick **Bezet:** met de naam van de afspraak. Tick leest je agenda alleen. Het verandert er nooit iets in.

**Details:**
- Werkt met Google Agenda, Outlook, iCloud en elke agenda met een iCal-adres. Tot 10 agenda's.
- Tick haalt alleen titel, begin en eind op, van vandaag en de komende 14 dagen. Geen omschrijving, locatie of deelnemers.
- Ongeveer elk uur bijgewerkt. Het geheime adres wordt versleuteld bewaard en nooit meer getoond.
- Vrije momenten vallen tussen 08:00 en 22:00, op elke dag. Tick gaat niet uit van kantooruren.
- Je afspraken staan als grijze blokken in je **Kalender**, naast je taken.
- Andersom kan ook: **Zet in je agenda** maakt van een taak een afspraak in Google Agenda, of een .ics-bestand voor Outlook en Apple.
- Ontkoppelen wist alles wat Tick ophaalde.

<!-- LET OP: Agenda koppelen staat op app.ticktodo.nl (en dus in de Play-app) nog uit. Zet deze sectie pas live als het daar aan staat, of zet er de regel onder: -->
*Agenda koppelen staat op app.ticktodo.nl nog niet aan. Op een eigen Tick werkt het al. **Zet in je agenda** werkt overal.*

### 3.4 Tickmanager

**Kop:** Oude taken krijgen een tweede kans

**Tekst:**
Elke lijst heeft ze: taken die maanden geleden naar beneden zakten. De Tickmanager haalt ze een voor een terug, de oudste eerst. Per taak kies je: **Inplannen**, **Bovenaan zetten**, **Laten staan** of **Verwijderen**. Eén tik, en door naar de volgende. Een oranje knop laat zien hoeveel er wachten. Zo ruim je je lijst op in een paar minuten, zonder dat je alles tegelijk hoeft te overzien.

**Details:**
- Een nieuwe taak is oud na 14 dagen. Een taak die je al bekeek in de Tickmanager is weer oud na 30 dagen. Beide stel je zelf in.
- Vastgezette taken, herhalende taken en taken met een herinnering in de toekomst doen niet mee.
- Je kiest welke lijsten meedoen. Een lijst *Ooit* sla je gewoon over.
- **Inplannen** biedt *Vandaag*, *Morgen*, *Volgende week* of **Kies datum…**. Met een gekoppelde agenda komen je vrije momenten eerst.
- Aan het eind zie je wat je deed: *"2 ingepland, 1 bovenaan, 1 verwijderd, 4 laten staan"*.
- Werkt ook offline. Uitzetten kan in Instellingen.

---

## 4. Alle functies

<!-- Per functie: tegel (titel + één regel), een uitklapbaar "Lees meer"-verhaal en een anker. Knoptekst onder elke tegel: "Lees meer". -->

### Invoerkaart
- **Anker:** `#invoerkaart`
- **Tegel:** Invoerkaart · Typ een taak en zet er meteen bij wat erbij hoort.
- **Lees meer:**
Een taak toevoegen begint met typen in het veld bovenaan je lijst. Druk op Enter en hij staat erin. Wil je meer, dan opent het veld zich tot een kaart. Daarop staat per onderdeel een korte zin: **Herinner me…**, **Herhalen**, **Herinner me op een plek**, de lijst waar hij in komt, en **Samen doen met…**. Een zin in grijs is nog leeg. Tik erop en kies.

Onder de zinnen staat **Omschrijving, subtaken of bijlage**. Daar schrijf je notities, zet je subtaken neer, of voeg je een foto of bestand toe. Een plaatje plakken of een bestand op de kaart slepen kan ook.

Tick haalt geen datum uit wat je typt. Je kiest de tijd zelf, met *Vandaag*, *Morgen*, *Volgende week* of **Andere dag en tijd…**. Zo weet je altijd precies wat er staat.

Met een toetsenbord: **N** opent het veld, **Shift+Enter** voegt de taak toe en opent hem meteen, **Esc** maakt de kaart leeg. Open je de taak later, dan zie je dezelfde zinnen terug. Wat je hebt ingevuld staat in kleur.

### Herinneringen
- **Anker:** `#herinneringen`
- **Tegel:** Herinneringen · Vandaag, morgen of volgende week, met één tik.
- **Lees meer:**
Tik bij een taak op **Herinner me…** en kies *Vandaag*, *Morgen* of *Volgende week*. Voor een ander moment is er **Andere dag en tijd…**. Een nieuwe herinnering begint op het volgende hele uur. Kies je alleen een datum, dan gebruikt Tick je standaardtijd: 09:00, tenzij je dat veranderde.

Op dat moment krijg je een melding op elk apparaat waar je meldingen aanzette. De melding heeft twee knoppen: **Klaar** vinkt de taak af, **Over 1 uur** schuift hem een uur op. Tik je op de melding zelf, dan opent de taak.

De herinnering is ook de deadline. Er is geen aparte einddatum. In de lijst staat de tijd in grijs onder de taak. Is hij voorbij, dan wordt hij rood.

Elke dag om 09:00 stuurt Tick een melding voor taken die te laat zijn, met **Klaar** en **Morgen**. Hoogstens tien, de oudste eerst. Die tijd verander je, of je zet hem uit.

Meldingen kunnen tot een minuut later komen, want Tick kijkt eens per minuut. Eerlijk is eerlijk.

### Herhalen
- **Anker:** `#herhalen`
- **Tegel:** Herhalen · Elke week op woensdag, tot een datum als je wilt.
- **Lees meer:**
Bij een herinnering kies je onder **Herhalen** hoe vaak: elke dag, week, maand of elk jaar. Of om de zoveel dagen, op bepaalde weekdagen, op een dag van de maand, of op bijvoorbeeld de derde zondag. Een einddatum kan ook.

Vink je een herhalende taak af, dan schuift hij door naar de volgende keer. Hij blijft open staan, en de subtaken gaan weer open.

Een gemiste keer slaat Tick over. De volgende keer ligt altijd in de toekomst, dus je krijgt geen stapel inhaalmeldingen.

Snooze je, of kies je *Morgen*, dan verschuift alleen deze ene keer. Wil je alle keren anders, dan pas je het ritme aan onder **Herhalen**.

Tijden volgen de klok van je tijdzone. 10:00 blijft 10:00, ook als de zomertijd ingaat. "Op de 31e" valt in kortere maanden op de laatste dag.

### Vandaag-strook
- **Anker:** `#vandaag`
- **Tegel:** Voor vandaag · Wat vandaag moet, uit al je lijsten, bovenaan.
- **Lees meer:**
Bovenaan je lijst staat een balk **Voor vandaag** met een getal. Dat is hoeveel taken vandaag moeten, de te late meegeteld. Is er iets te laat, dan is de balk rood.

Tik op de balk en hij klapt open. Je ziet dan alle taken voor vandaag uit al je lijsten, ook de gedeelde, de vroegste eerst, met de naam van hun lijst erbij. Tik een taak open, of vink hem meteen af. Per apparaat onthoudt Tick of je de balk open of dicht liet.

Hetzelfde getal staat op het app-icoon en op het tabblad in je browser. Het kleine icoon in het tabblad krijgt een rood stipje als iets te laat is. Zo zie je in één blik of er iets wacht, zonder de app te openen.

Niets voor vandaag? Dan is de balk weg. Liever geen getal? Zet de teller per apparaat uit in Instellingen.

### Kalender
- **Anker:** `#kalender`
- **Tegel:** Kalender · Een maandoverzicht en een agenda van wat er komt.
- **Lees meer:**
**Kalender** in de zijbalk laat je open taken met een datum zien. Op twee manieren: als maandoverzicht, met streepjes op de dagen waar iets staat, en als agenda, dag na dag. Wat te laat is, staat bovenaan.

Herhalende taken staan er met hun komende keren in. Zo zie je ook de vuilnisbak van over drie weken.

De week begint op maandag of zondag, zoals je in Instellingen kiest. Heb je een agenda gekoppeld, dan staan je afspraken als grijze blokken tussen je taken. Die open je niet in Tick; ze zijn er om te laten zien wanneer je bezet bent.

Tik op een taak om hem te openen en de tijd te veranderen.

### Agenda koppelen
- **Anker:** `#agenda-koppelen`
- **Tegel:** Agenda koppelen · Tick ziet wanneer je bezet bent en stelt vrije momenten voor.
- **Lees meer:**
Koppel je online agenda met het geheime iCal-adres. Dat werkt met Google Agenda, Outlook, iCloud en elke agenda die zo'n adres heeft. In Tick ga je naar **Instellingen › Agenda's**, plak je het adres en tik je op **Agenda koppelen**. Tot tien agenda's, bijvoorbeeld *Werk* en *Thuis*.

Tick haalt ongeveer elk uur je afspraken op: alleen titel, begin en eind, van vandaag en de komende 14 dagen. Omschrijvingen, locaties en deelnemers leest Tick niet. Afspraken die op *vrij* staan en afgezegde afspraken slaat het over.

Daarna stelt Tick vrije momenten voor, in het herinneringsmenu onder *Vrij in je agenda* en in de Tickmanager. Het eerste vrije halfuur, de eerste vrije avond en een moment in het weekend. Staat er al iets op een voorgestelde tijd, dan zegt Tick **Bezet:** met de titel erbij.

Tick leest alleen. Het verandert nooit iets in je agenda. Het adres wordt versleuteld bewaard en nooit meer getoond. **Ontkoppelen** wist alles wat Tick ophaalde.

Andersom: **Zet in je agenda** maakt een afspraak van 30 minuten op de tijd van de herinnering, in Google Agenda of als .ics-bestand. Dat werkt ook zonder koppeling.

*Op app.ticktodo.nl staat agenda koppelen nog uit.*

### Subtaken
- **Anker:** `#subtaken`
- **Tegel:** Subtaken · 2/4 klaar, gewoon in je lijst.
- **Lees meer:**
Een grote taak breek je op in kleine stappen. Een taak kan één laag subtaken hebben. In de lijst staan ze samen in één grijs blok: de subtaken kleiner en lichter, met een dun lijntje naar de taak erboven. Naast de titel staat hoeveel er af zijn, bijvoorbeeld **2/4**.

Een subtaak volgt zijn taak. Hij staat in dezelfde lijst, en vink je de taak af, dan gaan de subtaken mee. Vink je een subtaak af, dan zakt hij naar onderen binnen zijn taak.

Bij een herhalende taak gaan de subtaken weer open zodra de taak doorschuift. Handig voor een vast rondje, zoals de wekelijkse schoonmaak.

Deel je een taak als kopie, dan telt de voortgang van de ander mee in het balkje dat jij ziet. Hun subtaken zelf zie je niet.

### Notities met checklists
- **Anker:** `#notities`
- **Tegel:** Notities · Met kopjes, links en lijstjes om af te vinken.
- **Lees meer:**
Elke taak heeft een **Omschrijving**. Daar zet je wat je wilt: een adres, een link, een boodschappenlijstje. Je schrijft in markdown: kopjes, **vet**, *schuin*, lijsten, links, citaten en code.

Een regel als `- [ ] melk` wordt een vakje dat je kunt afvinken als je de notitie leest. Zo heb je een snel lijstje binnen een taak, zonder dat elk ding een eigen subtaak hoeft te zijn.

Tabellen, afbeeldingen en HTML toont Tick als gewone tekst. Titel en notities worden bewaard terwijl je typt.

De zoekfunctie zoekt ook in je notities, ook die van afgeronde taken.

### Bijlagen
- **Anker:** `#bijlagen`
- **Tegel:** Foto's en bestanden · Hang ze aan elke taak.
- **Lees meer:**
Een foto van de verfkleur, het bonnetje, de handleiding als pdf. Tik bij een taak op **Foto of bestand**, of plak of sleep het erin. Tik op een foto voor een grote weergave, met vorige en volgende.

Foto's worden kleiner gemaakt voordat ze worden geüpload. Ze verliezen daarbij hun EXIF-gegevens, zoals waar ze gemaakt zijn.

Per taak maximaal 20 bestanden, elk tot 10 MB. Op app.ticktodo.nl heb je 100 MB per account. Onder **Instellingen › Data › Opslag** zie je hoeveel je gebruikt.

Een bijlage verwijderen kan niet ongedaan worden. Bijlagen hebben een verbinding nodig; foto's die je al zag, blijven offline zichtbaar. In een back-up staat welke bijlagen er waren, maar de bestanden zelf zitten er niet in.

### Offline
- **Anker:** `#offline`
- **Tegel:** Werkt offline · Wijzigingen gaan mee zodra je weer online bent.
- **Lees meer:**
In de kelder, in de trein, in het buitenland zonder bundel. Tick werkt ook zonder verbinding, zodra je het een keer online hebt geopend en bent ingelogd.

Taken toevoegen, wijzigen en afvinken gaat gewoon door. Tick bewaart het op je apparaat en stuurt het door als je weer verbinding hebt. Hebben twee apparaten hetzelfde veld veranderd, dan wint de laatste wijziging.

In een gedeelde lijst kun je offline toevoegen, afvinken en **Oppakken**. Pakken twee mensen offline dezelfde taak op, dan krijgt wie het eerst online is hem.

Wat een verbinding nodig heeft: delen, de prullenbak, bijlagen en de kaart. De Tickmanager werkt offline, met de taken die al op je apparaat staan.

### Thema's
- **Anker:** `#themas`
- **Tegel:** Licht, donker of jaren 70 · Maak hem een beetje van jou.
- **Lees meer:**
Tick volgt je apparaat in licht of donker, of je kiest het zelf. Daarnaast is er een kleurthema: het gewone, of **Retro jaren 70**, ook in licht en donker. Ik had er spijt van kunnen krijgen. Heb ik niet.

Je stelt de tekstgrootte in en de ruimte tussen taken: compact, normaal of ruim. Een voorbeeldtaak verandert mee, zodat je ziet wat je kiest.

Wil je een eigen **achtergrondfoto**? Die stel je een keer in, voor al je apparaten.

Bij het afvinken komt er confetti. Vraagt je apparaat om minder beweging, dan laat Tick dat achterwege.

Thema, kleurthema en tekstgrootte gelden per apparaat. Zo kan je telefoon donker zijn en je laptop licht.

### Widget en snel toevoegen
- **Anker:** `#widget`
- **Tegel:** Widget en snel toevoegen · Je lijst op je beginscherm (Android).
- **Lees meer:**
Zet de Tick-widget op het beginscherm van je Android-telefoon. Je kiest wat hij laat zien: alle taken, *Vandaag en te laat*, of één lijst. Tekstgrootte en regelafstand stel je zelf in, en je maakt hem zo groot als je wilt.

Vink taken direct op de widget af. Je hebt drie seconden om het ongedaan te maken. Tik op een taak om hem te openen, of op de kop om de app te openen op die lijst. Elke regel laat zien wat erbij hoort: herinnering, lijst, plek, herhalen, delen en open subtaken.

Met **➕** op de widget, de snelkoppeling *Nieuwe taak* op het app-icoon, of *Delen* vanuit een andere app, opent een paneel onderaan. Typ de titel en kies eventueel een lijst, een herinnering, een plek of herhalen. Zet *nog een toevoegen* aan om meerdere taken achter elkaar te typen.

De widget en snel toevoegen zitten alleen in de Android-app.

### Plekken
- **Anker:** `#plekken`
- **Tegel:** Plekken · Een melding als je aankomt of weggaat (Android).
- **Lees meer:**
Geef een taak een plek en Tick meldt het als je er **aankomt** of er **vertrekt**. Het boodschappenlijstje bij de supermarkt. De schroeven als je bij de bouwmarkt parkeert. Het pakketje als je de deur uit stapt.

Tik bij een taak op **Herinner me op een plek**. Zoek een adres, sleep de kaart, tik op *Mijn locatie* of kies een favoriet. Kies **Bij aankomst** of **Bij vertrek**, en de straal: van 200 m tot 2 km. Een plek die je vaak gebruikt, bewaar je met **☆ Bewaar als favoriet**.

Niet het goede moment? Veeg de melding weg en hij komt de volgende keer dat je aankomt terug. **Opnieuw melden** zet een plek die al afging weer aan.

Je telefoon let zelf op de plekken en vertelt Tick alleen dat een melding afging. Tick houdt niet bij waar je bent geweest.

Meldingen op een plek werken alleen in de Android-app. Op een iPhone of in de browser kun je de plek wel instellen. Kaarten komen van OpenStreetMap.

### Rijmodus
- **Anker:** `#rijmodus`
- **Tegel:** Rijmodus · Groot en simpel achter het stuur.
- **Lees meer:**
Merkt Tick dat je rijdt, dan wordt het scherm groter en eenvoudiger. Je ziet een balk **Rijmodus gedetecteerd**, met de taken **Hier vlakbij** (binnen 3 km, de dichtstbijzijnde eerst) en wat er **Vandaag** moet. Elke taak heeft een grote ronde knop om af te vinken, en er is een grote knop **Taak toevoegen**.

Tick zet de rijmodus aan als de app open is en je een halve minuut sneller gaat dan ongeveer 25 km/u. Drie minuten stilstaan of lopen, en het gewone scherm komt terug. Een stoplicht of file niet.

Zit je naast de bestuurder, of in de trein? Tik op **Nu niet**. **Nooit meer** zet het uit op al je apparaten.

Tick gebruikt je locatie hiervoor alleen op dit apparaat, alleen terwijl Tick open is. Het wordt niet naar de server gestuurd en niet bewaard. Tick vraagt nooit zomaar om je locatie.

Kijk alsjeblieft niet te lang naar je scherm onder het rijden. Daarvoor is hij juist groot.

### Op tijd melden onderweg
- **Anker:** `#op-tijd-onderweg`
- **Tegel:** Op tijd onderweg · Op de fiets of in de auto toch op tijd (Android, GitHub-versie).
- **Lees meer:**
Android merkt pas na een paar minuten dat je bij een plek bent. Lopend maakt dat weinig uit. Met de auto of de fiets ben je dan al voorbij.

Zet in de Android-app onder **Tick op deze telefoon** *Op tijd melden onderweg* aan. Zolang je rijdt of fietst, maakt Tick de aankomstcirkels groter. De melding komt dan rond de rand van de cirkel die je instelde, en zegt *"Bijna bij …"*.

Hoeveel groter, leert Tick van je eerdere meldingen, apart voor de auto en de fiets. Een cirkel wordt nooit zo groot dat je er bij vertrek al in staat. Stap je uit of af, dan worden de cirkels weer normaal.

Tick vraagt hiervoor toestemming voor **Fysieke activiteit**, alleen om te weten óf je rijdt of fietst. Het is geen fitnessfunctie. Er wordt niets verstuurd over waar je bent of hoe je reist.

Deze functie zit alleen in de Android-app van GitHub, niet in de versie uit Google Play.

### Tickmanager
- **Anker:** `#tickmanager`
- **Tegel:** Tickmanager · Oude taken komen een voor een terug.
- **Lees meer:**
Taken waar je lang niet naar keek, zakken weg onderaan een lijst. De Tickmanager haalt ze terug. Een oranje bliksemknop (op een breed scherm: *Tickmanager* onder Inbox) laat zien hoeveel er wachten.

Tik op **Opruimen starten** en je ziet één taak tegelijk, de oudste eerst, met hoe lang je er niet naar keek. Per taak kies je: **Inplannen**, **Bovenaan zetten**, **Laten staan** of **Verwijderen**. Bovenaan staat hoe ver je bent, en met **Stoppen** ga je later verder.

Een nieuwe taak is oud na 14 dagen, een taak die je al bekeek na 30 dagen. Allebei stel je zelf in. Vastgezette taken, herhalende taken en taken met een herinnering in de toekomst doen niet mee. Per lijst kies je of hij meedoet.

In een gedeelde lijst telt "bekeken" voor iedereen. Welke lijsten je overslaat, is van jou.

Werkt ook offline. Liever niet? Zet **Tickmanager tonen** uit in Instellingen.

### Delen
- **Anker:** `#delen`
- **Tegel:** Taken delen · Gedeeld voor samen, of een kopie voor ieder.
- **Lees meer:**
Open een taak en tik op **Samen doen met…**. Kies iemand en kies hoe.

**Gedeeld** is één taak voor iedereen. Afgevinkt is afgevinkt voor iedereen, iedereen kan hem wijzigen en subtaken toevoegen, en ieder houdt hem in een eigen lijst. Een herinnering op een tijd of plek bereikt iedereen. Je herkent hem aan het blauwe mensen-icoon en *Gedeeld met …*.

**Kopie** geeft de ander een eigen exemplaar, met alle subtaken open. Ieder vinkt zijn eigen af. Je herkent hem aan het grijze icoon van twee vellen en een naam met een voortgangsbalkje. Is de ander klaar, dan krijg je een melding *"… is klaar ✓"*.

De ander krijgt een melding met **Accepteren** en **Weigeren**. Een geaccepteerde taak komt in de Inbox.

Op app.ticktodo.nl deel je met een e-mailadres. Heeft die persoon nog geen account, dan krijgt die een uitnodiging per mail. Eerst bevestig je je eigen e-mailadres. In de gratis versie deel je met één persoon: zoveel taken en lijsten als je wilt.

### Gedeelde lijsten
- **Anker:** `#gedeelde-lijsten`
- **Tegel:** Gedeelde lijsten · Samen één lijst, en je ziet wie wat doet.
- **Lees meer:**
De boodschappen voor thuis, de paklijst voor een weekend weg. Deel een hele lijst en elke taak erin is gedeeld met iedereen in de lijst. Kies in het lijstmenu **Delen…** en nodig iemand uit. Die accepteert een keer en heeft dan de hele lijst.

Iedereen kan toevoegen, wijzigen, afvinken en verwijderen. Tik op **Oppakken** onder een taak, dan zien de anderen *"… pakt het op"*. Alleen jij kunt hem dan afvinken. Tik nog eens om los te laten.

Een afgevinkte taak verdwijnt niet. Hij gaat naar het blok **Afgevinkt** onderaan, met wie het deed en wanneer. **Opruimen** zet ze voor iedereen in de prullenbak.

Standaard krijg je geen melding als een ander iets afvinkt. Zet **Meldingen bij afvinken** aan voor de hele lijst, of kies per taak **Meld me als dit is afgevinkt**.

Sleep een taak naar een eigen lijst en hij is alleen van jou. Sleep een eigen taak erin en hij is van iedereen. Alleen wie de lijst deelde, kan mensen uitnodigen, eruit halen of de lijst verwijderen.

### Melden en blokkeren
- **Anker:** `#melden-en-blokkeren`
- **Tegel:** Melden en blokkeren · Iets gekregen wat niet hoort? Weg ermee.
- **Lees meer:**
Op app.ticktodo.nl kan iedereen een account maken. Dus kan het gebeuren dat iemand je iets stuurt wat je niet wilt. Daarvoor is **Melden**.

Je kunt een uitnodiging melden, een taak die iemand met je deelde, een gedeelde lijst (**Lijst melden**), of een bestand dat iemand anders toevoegde. Kies een reden: spam, ongepast, illegaal of iets anders, en schrijf er als je wilt iets bij. Het verdwijnt meteen uit jouw Tick. De beheerder krijgt een mail en kijkt ernaar.

**Blokkeer ook** staat standaard aan. Blokkeren stopt alles wat je met die persoon deelt, beide kanten op, en hun uitnodigingen komen niet meer aan. Die persoon krijgt dat niet te horen. Je kunt ook **Alleen blokkeren**.

Wie je geblokkeerd hebt, staat onder **Instellingen › Account › Geblokkeerde mensen**. Daar haal je de blokkade weer weg.

Op een Tick die je zelf host voor je huishouden bestaan deze knoppen niet. Daar ken je elkaar.

### Importeren uit TickTick
- **Anker:** `#ticktick`
- **Tegel:** Overstappen van TickTick · Neem je taken mee.
- **Lees meer:**
Kom je van TickTick? Maak daar een back-up. Dat geeft een CSV-bestand. In Tick ga je naar **Instellingen › Data** en kies je het bestand bij *Taken uit TickTick halen*.

Tick zet je taken erin en laat zien hoeveel er nieuw waren, hoeveel er al stonden en hoeveel er werden overgeslagen. Importeer je hetzelfde bestand nog een keer, dan slaat Tick over wat er al is en houdt het je wijzigingen.

Het bestand mag tot 10 MB zijn.

Van een andere app overstappen? Dat heb ik nog niet gebouwd. TickTick was de app die ik zelf gebruikte.

### Back-up
- **Anker:** `#back-up`
- **Tegel:** Back-up · Download al je taken in één bestand.
- **Lees meer:**
Onder **Instellingen › Data** download je een back-up van al je taken. Afgeronde taken en plekken zitten erin. Je instellingen, sleutels, taken die anderen met je deelden en de bestanden van bijlagen niet.

Met **Backup terugzetten** zet je zo'n bestand weer terug. Tick laat eerst zien wat erin staat. Daarna voegt het samen per taak: taken uit het bestand vervangen dezelfde taak hier, en verwijderde taken komen terug. Er wordt niets gewist.

Een back-up is ook je uitweg. Je taken zijn van jou, en je neemt ze mee als je wilt.

### Koppelingen
- **Anker:** `#koppelingen`
- **Tegel:** Koppelingen · Claude, Home Assistant en een inbox voor je eigen automatisering.
- **Lees meer:**
Voor wie graag knutselt, heeft Tick een paar ingangen.

**Claude (MCP):** Tick heeft een MCP-server, zodat Claude Code of Claude Desktop je taken kan beheren: zoeken, toevoegen, wijzigen, afvinken, snoozen en naar de prullenbak verplaatsen. Claude gebruikt een eigen sleutel die je altijd kunt intrekken. Bij je instellingen, sleutels en wachtwoord kan Claude niet.

**Inbox-API:** met een *Inbox*-sleutel voeg je taken toe vanuit een snelkoppeling, een script of een mailregel. Met titel, notities, datum, lijst en herhaling. Zo'n sleutel kan alleen taken toevoegen, verder niets.

**Home Assistant:** sensoren voor je open taken, die van vandaag en de te late, en acties om taken af te vinken, uit te stellen en toe te voegen. Alles in één pakketbestand.

**Reservewebhook:** kon een melding binnen 15 minuten niet worden bezorgd, dan kan Tick hem naar een webhook van jezelf sturen, bijvoorbeeld een chat-app.

Sleutels maak je onder **Instellingen › Geavanceerd › Sleutels**. Je ziet een sleutel één keer, en intrekken werkt meteen.

### Account
- **Anker:** `#account`
- **Tegel:** Je account · Wachtwoord kwijt of weg willen? Dat regel je zelf.
- **Lees meer:**
**Wachtwoord vergeten?** Tik erop op het inlogscherm en vul je e-mailadres in. Je krijgt een mail met een link om een nieuw wachtwoord te kiezen. Die werkt een uur. Geen mail? Kijk in je spam. Na vijf minuten kun je een nieuwe link vragen.

Onder **Instellingen › Account** verander je je naam, e-mailadres en wachtwoord. **Uitloggen op andere apparaten** helpt als je je telefoon kwijt bent.

**Account verwijderen** wist alles: taken, plekken, bijlagen, instellingen, sleutels en gekoppelde apparaten. Je bevestigt met je wachtwoord, en het kan niet ongedaan worden. Het gaat direct. Reservekopieën zijn binnen 30 dagen gewist. Een gedeelde lijst van jou gaat naar een ander lid. Taken die je los deelde, verdwijnen ook bij de anderen; kopieën blijven.

Kun je niet meer inloggen? Op app.ticktodo.nl/delete-account staat hoe je je account toch laat verwijderen, en hoe je alleen een deel van je gegevens wist.

Wil je je taken houden? Download eerst een back-up.

### Talen
- **Anker:** `#talen`
- **Tegel:** Nederlands en Engels · Per apparaat, met je eigen tijdzone.
- **Lees meer:**
Tick is er in het Nederlands en het Engels. Standaard volgt het de taal van je apparaat, of je kiest zelf onder **Instellingen › Taal en tijd**. Foutmeldingen en het inlogscherm volgen mee.

De taal hoort bij het apparaat. Je telefoon kan Nederlands zijn en je werklaptop Engels. Meldingen komen in de taal van het apparaat waar ze heen gaan.

Je stelt ook je tijdzone in, met een knop om die van je apparaat over te nemen. Verander je hem, dan blijven je herinneringen op dezelfde kloktijd in de nieuwe zone. Verder kies je je standaardtijd voor een herinnering zonder tijd, en of de week op maandag of zondag begint.

Meer talen? Misschien later. Ik spreek er zelf maar twee goed genoeg.

---

## 5. Wat werkt waar

Kolommen:
- **Webapp:** app.ticktodo.nl in een browser, op je computer of telefoon
- **Android (Play Store):** de app `nl.ticktodo.app`, nog in de testfase, verbonden met app.ticktodo.nl
- **Android (APK via GitHub):** de app van GitHub, voor app.ticktodo.nl of je eigen Tick
- **iPhone/iPad:** Tick op je beginscherm via Safari
- **Zelf gehost:** je eigen Tick op je eigen Cloudflare-account

| Functie | Webapp | Android (Play Store) | Android (APK via GitHub) | iPhone/iPad | Zelf gehost |
|---|---|---|---|---|---|
| Taken, lijsten, subtaken, notities | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- tasks-and-lists.md; iphone.md "Everything else works the same" -->
| Herinneringen op een tijd (meldingen) | ✓ | ✓ | ✓ | ✓ (iOS 16.4+, vanaf het beginscherm) | ✓ | <!-- reminders.md "Notifications on your devices"; iphone.md -->
| Herhalen | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- reminders.md -->
| Voor vandaag en teller op het icoon | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- reminders.md "The counter on the icon"; iPhone badge niet expliciet in docs: zie twijfels -->
| Kalender | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- reminders.md "The calendar"; iphone.md -->
| Agenda koppelen | nog uit | nog uit | alleen met je eigen Tick | nog uit | ✓ | <!-- calendar.md "For whoever runs Tick" (CALENDAR_FEEDS); op app.ticktodo.nl staat CALENDAR_FEEDS op "false" (beheernotitie, niet in docs) -->
| Zet in je agenda | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- calendar.md "Add to calendar ... works without linking"; werkt ook met CALENDAR_FEEDS uit -->
| Plek instellen op een taak | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- places.md NOTE "You can set a place in the web app on any device" -->
| Melding op een plek | — | ✓ | ✓ | — | met de Android-app | <!-- places.md NOTE; iphone.md "no place reminders"; android.md -->
| Op tijd melden onderweg | — | — | ✓ | — | met de GitHub-app | <!-- places.md "On the road" (not in Google Play); android.md -->
| Rijmodus | ✓ (op een telefoon, met locatie) | ✓ | ✓ | ✓ | ✓ | <!-- driving-mode.md; iphone.md noemt driving mode; Android-app 1.12.1 of nieuwer nodig -->
| Widget op het beginscherm | — | ✓ | ✓ | — | met de Android-app | <!-- android.md "The widget"; iphone.md "no widget" -->
| Snel toevoegen en delen vanuit andere apps | — | ✓ | ✓ | — | met de Android-app | <!-- android.md "Quick add and sharing to Tick"; iphone.md "no quick add from the share menu" -->
| Werkt offline | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- tasks-and-lists.md "Offline"; README "Works offline as an installable web app" -->
| Taken en lijsten delen | met 1 persoon (gratis) | met 1 persoon (gratis) | met 1 persoon op app.ticktodo.nl | met 1 persoon (gratis) | ✓ met iedereen op je Tick | <!-- sharing.md "On an open Tick" (Free version: one person); sharing.md "Accounts" -->
| Zelf een account maken | ✓ | ✓ | ✓ op app.ticktodo.nl | ✓ | via een uitnodigingslink | <!-- signup.md; sharing.md "Accounts" (invite link). Een eigen Tick kan ook open aanmelding aanzetten (OPEN_SIGNUP, signup.md/privacy.md) -->
| Melden en blokkeren | ✓ | ✓ | ✓ op app.ticktodo.nl | ✓ | — (alleen op een open Tick) | <!-- reporting.md "On a Tick for your own household these buttons don't exist" -->
| Tickmanager | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- tickmanager.md -->
| Foto's en bestanden | ✓ (100 MB per account) | ✓ | ✓ | ✓ | als je ze aanzet | <!-- tasks-and-lists.md "Attachments (optional)"; 100 MB = MAX_ACCOUNT_MB op app.ticktodo.nl (beheernotitie, niet in docs) -->
| Back-up en TickTick-import | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- settings.md "Data"; in de apps via het instellingenscherm van de webapp -->
| Thema's, taal en tijdzone | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- settings.md -->
| Claude (MCP), inbox-API, Home Assistant | ✓ | ✓ | ✓ | ✓ | ✓ | <!-- integrations.md; werkt via de server met een sleutel, niet via een app. Zie twijfels over app.ticktodo.nl -->
| Updates | vanzelf | via Google Play | app meldt een nieuwe versie | vanzelf | zelf bijwerken (*"update Tick"* in Claude Code) | <!-- android.md "Getting it"; iphone.md "It updates itself"; README "Updating later" -->

Onder de tabel: *Meldingen op een plek, de widget en snel toevoegen hebben de Android-app nodig. Apple geeft een app op het beginscherm minder ruimte. Alles wat met taken, lijsten, herinneringen en delen te maken heeft, werkt overal.*

---

## 6. Privacy

### Kop
Je taken zijn van jou

### Tekst
Ik maak Tick zelf, in Nederland. Er zit geen reclame in, geen tracking en geen statistieken over hoe je de app gebruikt. Je gegevens worden niet verkocht en niet gedeeld voor marketing. De code is open source, dus iedereen kan nakijken wat Tick doet.

**Wat Tick bewaart**
- Je account: naam, e-mailadres, je wachtwoord als versleutelde code, en wanneer je Tick voor het laatst gebruikte.
- Wat je erin zet: taken, notities, lijsten, herinneringen, plekken die je opslaat, bijlagen en je instellingen.
- Gekoppelde telefoons, en het adres dat je browser of telefoon geeft om meldingen te bezorgen.
- Koppel je een agenda, dan van elke afspraak alleen titel, begin en eind, voor de komende 14 dagen.

**Wat Tick niet bewaart**
- Waar je bent. Je telefoon kijkt zelf of je bij een plek aankomt, en vertelt Tick alleen dat een melding afging. Er is geen logboek van waar je was.
- Je rijgedrag. Rijmodus en *Op tijd melden onderweg* gebruiken je locatie en beweging alleen op je telefoon.
- Waar je foto's zijn gemaakt. Tick haalt die gegevens eruit voordat ze worden geüpload.

**Welke diensten Tick gebruikt**
Cloudflare host Tick; daar staan je gegevens. Meldingen gaan via de pushdienst van je browser of telefoon, versleuteld. Kaarten en adressen zoeken komen van OpenStreetMap. Mails, zoals *Wachtwoord vergeten?*, gaan via Resend.

**Zelf aan de knoppen**
Je kunt al je taken downloaden onder **Instellingen › Data**, en je account zelf verwijderen. Dan gaat alles direct weg; reservekopieën zijn binnen 30 dagen gewist.

Eén cookie houdt je ingelogd. Meer niet.

**Link:** Lees de volledige privacyverklaring → https://app.ticktodo.nl/privacy

---

## 7. Kost het iets?

### Kop
Kost het iets?

### Tekst
Nee. Tick is nu gratis.

In de gratis versie op app.ticktodo.nl deel je met één persoon. Zoveel taken en lijsten als je wilt, maar wel met dezelfde persoon. Wat anderen met jou delen, telt niet mee. Een uitnodiging accepteren kan dus altijd.

Hosting en ontwikkeling kosten wel wat. Misschien komen er later betaalde extra's om dat te dekken. Tick hoeft geen winst te maken. Als het zichzelf terugverdient, ben ik tevreden.

Wat gratis is als je je aanmeldt, wordt niet betaald zonder dat ik het je van tevoren laat weten. Dat staat ook in de voorwaarden.

Liever helemaal zelf? Tick is open source. Je kunt het op je eigen gratis Cloudflare-account zetten, zonder grens aan het aantal mensen.

---

## 8. Veelgestelde vragen

**Wat is het verschil tussen gedeeld en kopie?**
Gedeeld is één taak voor jullie samen: afgevinkt is afgevinkt voor iedereen, en iedereen kan hem wijzigen. Een kopie is een eigen exemplaar voor de ander. Ieder vinkt zijn eigen af, en jullie zien elkaars voortgang.

**Wat ziet de ander bij een kopie?**
Een eigen taak, met de titel, de omschrijving en alle subtaken open, en de regel *Kopie van* met jouw naam. Daarna is het hun taak: wat zij veranderen, zie jij niet, en andersom. Jullie zien alleen elkaars voortgang: een naam met een balkje, of een ✓ als iemand klaar is.

**Wat gebeurt er als ik een gedeelde taak verwijder?**
Dan verdwijnt hij voor iedereen die meedoet. Hij gaat naar de prullenbak en blijft daar 30 dagen staan. Wil je er alleen zelf vanaf, zonder hem voor de ander weg te halen? Kies dan **Stoppen met delen**.

**Kan ik een kopie later delen?**
Zolang de ander de kopie nog niet accepteerde, ja: kies dezelfde persoon en tik op **Omzetten**. Heeft die de kopie al geaccepteerd, dan niet, want die kopie kan intussen veranderd zijn. De ander verwijdert de kopie eerst, daarna kun je de taak delen. Andersom kan wel: een gedeelde taak omzetten in een kopie.

**Heeft de ander een account nodig?**
Op app.ticktodo.nl deel je met een e-mailadres. Heeft dat adres nog geen account, dan krijgt het een uitnodiging per mail, met een link om je aan te melden. De uitnodiging staat dan klaar. Een uitnodiging blijft 30 dagen open. Je bevestigt eerst je eigen e-mailadres voordat je kunt delen.

**Met hoeveel mensen kan ik delen?**
In de gratis versie met één persoon, zoveel taken en lijsten als je wilt. Wat anderen met jou delen, telt niet mee.

**Werkt Tick op een iPhone?**
Ja. Open app.ticktodo.nl in Safari, tik op de deelknop en kies **Zet op beginscherm**. Dan opent Tick als een app, met meldingen (iOS 16.4 of nieuwer). Meldingen op een plek, een widget en snel toevoegen kan een iPhone niet. Een App Store-app is er niet: die heeft een betaald Apple-account en een keuring voor elke update nodig.

**Is er een Android-app?**
Ja. Er is een gratis app op GitHub, en een versie in Google Play die nog in de testfase is. De versie van GitHub heeft ook *Op tijd melden onderweg*. Gebruik er één van, niet allebei.

**Weet Tick waar ik ben?**
Nee. Je telefoon let zelf op je plekken en vertelt Tick alleen dat een melding afging. Rijmodus gebruikt je locatie alleen op je apparaat, terwijl Tick open is. Tick bewaart alleen de plekken die je zelf opslaat.

**Haalt Tick een datum uit wat ik typ?**
Nee. Je kiest de tijd zelf met *Vandaag*, *Morgen*, *Volgende week* of een andere dag en tijd. Dan weet je zeker wat er staat.

**Hoe verwijder ik mijn account?**
In de app: **Instellingen › Account › Account verwijderen**. Je bevestigt met je wachtwoord en alles gaat direct weg. Kun je niet meer inloggen, kijk dan op app.ticktodo.nl/delete-account. Download eerst een back-up als je je taken wilt houden.

**Kan ik Tick zelf hosten?**
Ja. De code staat op GitHub (DioVayne/tick), onder de MIT-licentie. Je zet het op een gratis Cloudflare-account. Met Claude Code duurt dat ongeveer een kwartier; het kan ook met de hand. Daarna kun je iedereen in je huishouden uitnodigen.

**Wat als Dio ermee stopt?**
Dan hoor je dat minstens 30 dagen van tevoren, zodat je je taken kunt downloaden. En omdat Tick open source is, verdwijnt het niet: je kunt het zelf hosten, of iemand anders doet het. Ik ben het overigens niet van plan. Ik gebruik het zelf elke dag.

**Kan ik over van TickTick?**
Ja. Maak in TickTick een back-up (CSV) en importeer die onder **Instellingen › Data**.

**Is mijn gegevens kwijt als mijn telefoon stuk gaat?**
Nee. Je taken staan op de server en op je apparaten. Log in op een nieuw apparaat en alles is er weer.

---

## 9. Footer en SEO

### Footer
- Tagline: *Tick. Herinneringen op het juiste moment.*
- Kolom **Tick**: Probeer gratis · Android-app · iPhone en iPad · Wat werkt waar · Veelgestelde vragen
- Kolom **Meer**: Handleiding (GitHub) · Broncode · Zelf hosten
- Kolom **Juridisch**: Privacy · Voorwaarden · Account verwijderen
- Regel: *Gemaakt in Nederland door Dio. Geen reclame, geen tracking. Open source onder de MIT-licentie.*
- Contact: *Vragen? Mail dio@ticktodo.nl.* <!-- Dat is het ADMIN_CONTACT-adres van app.ticktodo.nl. -->
- Aanbieder: *Tick op app.ticktodo.nl wordt aangeboden door Dio Communicatieadvies.* <!-- Naam uit OPERATOR_NAME; staat ook in de voorwaarden. -->

### SEO
- **Paginatitel:** Tick: to-do-app met herinneringen op tijd en op plek
- **Meta-omschrijving:** Gratis to-do-app die je herinnert op het juiste moment, ook als je bij de winkel bent. Deel taken en lijsten. Geen reclame, geen tracking, open source.
- **OG-titel:** Tick: herinneringen op het juiste moment
- **OG-omschrijving:** Een gratis takenapp die meldt als je bij de supermarkt bent. Samen lijsten delen, oude taken opruimen, en geen reclame. Gemaakt in Nederland.

---

# PART B: ENGLISH

## 1. Hero

### Headline (pick one, max. 8 words)
1. Tick reminds you when you reach the shop.
2. The right reminder. In the right place.
3. Leave the remembering to Tick.
4. Buy milk? Tick says so at the supermarket.
5. A to-do list that knows where you are.

### Subline
Tick is a free to-do app that reminds you at the right moment. At a time, or when you get somewhere. For your own head full of loose ends, and for everything you sort out together. No ads, no tracking.

### Buttons
- **Try it free in your browser** → https://app.ticktodo.nl/signup
- **Free Android app** <!-- See the note in the Dutch part. -->

Under the buttons, small: *On an iPhone or iPad, add Tick to your home screen from Safari. No App Store needed.*

### Interactive map demo
<!-- Same note as the Dutch part: a real place notification has one button, "Complete". -->
- **Drag hint on the walker:** Drag me to the shop
- **Hint when the walker stops:** Almost. The supermarket is over there.
- **Notification (title):** Buy milk
- **Notification (text):** 📍 Arrived at the supermarket
- **Button in the notification:** Complete
- **Hint under the notification:** Or swipe it away.
- **After Complete:** Ticked off. See, it works. I was surprised too.
- **After swiping away (wink):** Fine. Next time you are here, I'll be back. I'm patient.
- **Bike toggle (label):** On the bike
- **Text next to the toggle:** On a bike you are past your circle in no time. With *On time on the road*, Tick makes the circle bigger, so the notification comes in time.
- **Notification with the bike on (text):** 📍 Almost at the supermarket
- **Small line under the demo:** Place reminders work in the Android app. *On time on the road* is only in the Android app from GitHub.

**Variant with the buttons of a time notification:**
- Buttons: **Done** and **In 1 hour**
- After Done: Ticked off. See, it works. I was surprised too.
- After In 1 hour (wink): See you in an hour. Nagging is the one thing I'm really good at.

---

## 2. The maker's story

### Heading
How a hobby project got slightly out of hand

### Text
Hi, I'm Dio. I made Tick because I needed an app that reminds me of things. One that does what I want, and doesn't suddenly disappear or start costing money.

My girlfriend has ADD. She said what Tick had to do, in one sentence: *"Tick gives me reminders at the right moment, for example when I'm at the shop and mustn't forget to buy something."* That's where it started. We both use it now, every day.

The idea was a small list for the two of us. Then came shared lists, an Android app, a calendar and a driving mode. Now it has its own website. I'd like to say this was the plan. It wasn't.

---

## 3. Four big stories

### 3.1 In the right place

**Heading:** A reminder when you get there

**Text:**
Some things you can only do once you're somewhere. Buying milk at the supermarket. Taking the parcel when you leave the house. Give a task a place on the map and choose **On arrival** or **On leaving**. Your phone watches that place itself, and Tick lets you know the moment your phone says you're there. By car or bike you are sometimes past it before Android notices. So Tick makes the circle bigger on the road. And when you're behind the wheel, the screen gets bigger and simpler.

**Details:**
- Pick a place by searching, dragging the map, *My location* or a favorite. Radius from 200 m to 2 km.
- Swipe the notification away and it comes back the next time you arrive. **Complete** finishes the task.
- Already notified and you want it again? Tap **Notify again**.
- A shared task with a place: everyone gets their own notification. Whoever passes the shop first does the shopping.
- **On time on the road** (only the Android app from GitHub): in the car or on the bike, circles get bigger. How much, Tick learns from your earlier notifications.
- **Driving mode**: when Tick notices you're driving, you see big buttons, tasks *Nearby* and what's due today.
- Your position is not sent to Tick. Your phone only reports that a reminder went off.
- Place reminders work in the Android app. On an iPhone you can set a place, but you won't get a notification for it.

### 3.2 Shared or copy

**Heading:** Do it together, or each your own

**Text:**
You can share a task with someone in two ways. **Shared** is one task for both of you: done is done for everyone. Handy for the groceries, or the bins that need to go out. **Copy** gives the other person their own copy. You each tick off your own, and you see how far the other is. Handy when you both have to do the same thing, like your tax return. You can also share a whole list. Then you tap **Take it** and the others see you're on it.

**Details:**
- **Shared:** everyone can change the task and add subtasks. Each person keeps it in their own list and order. A reminder at a time or place reaches everyone on it.
- With shared, you get a notification when someone ticks it off (*"Sanne ticked this off ✓"*) or gives the task a place.
- **Copy:** the other person gets their own copy with all subtasks open. After that, changes no longer go back and forth.
- With a copy you see a name with a small bar per person, or a ✓ when they're done. You never see the other person's title, notes or subtasks.
- Deleting a shared task deletes it for everyone.
- **Change:** not accepted yet? Then you simply switch between shared and copy. Shared and already accepted? Then you can turn it into a copy. An accepted copy can't become shared; it has to go first.
- **Shared list:** everyone in the list can add, change, tick off and delete. Ticked-off tasks stay at the bottom, with who did it and when.
- Drag a task from a shared list to one of your own lists and it's yours alone. Drag one of your own tasks in, and it belongs to everyone.
- In the free version on app.ticktodo.nl you share with one person: as many tasks and lists as you like.

**Labels for the two-phone demo**
- Toggle: **Shared** | **Copy**
- Text for Shared: One task for both of you: done is done for everyone.
- Text for Copy: They get their own copy; you see each other's progress.
- Phone labels: **You** | **Sanne**
- Task: *Put the bins out* (shared) / *Do the tax return* (copy), with subtasks *Find the annual statement*, *Log in*, *Submit*
- Row for Shared (your phone): Shared with Sanne
- Line in the task for Shared: Ticking it off counts for everyone.
- Row for Copy (your phone): Copy sent to Sanne
- Row for Copy (Sanne's phone): Copy from Dio
- Line in the task for Copy: Everyone ticks off their own copy.
- Hint: Tick something off on the left and watch the right.
- After ticking off with Shared, notification on the right: *Dio ticked this off ✓*
- After ticking off with Shared, text: Ticked off on both sides.
- After ticking off a subtask with Copy, text: Sanne sees your bar grow. What you ticked off, she doesn't see.
- After ticking off the whole copy, notification on the right: *Dio is done ✓*
- List demo, button: **Take it**; then for the other person: *Dio is on it*; for yourself: *You're on it*

### 3.3 Free moments (LATER: not on the site)

<!-- Removed on 2026-11-10, see the Dutch section. -->

**Heading:** Tick knows when you have time

**Text:**
Planning a task is easier when you know when you can. Link your online calendar and Tick sees when you're busy. When you set a reminder, Tick then suggests free moments: the first free half hour, a free evening and a moment at the weekend. Already have something on *Tomorrow*? Then Tick says **Busy:** with the name of the appointment. Tick only reads your calendar. It never changes anything in it.

**Details:**
- Works with Google Calendar, Outlook, iCloud and any calendar with an iCal address. Up to 10 calendars.
- Tick only fetches the title, start and end, for today and the next 14 days. No descriptions, locations or attendees.
- Updated about once an hour. The secret address is stored encrypted and never shown again.
- Free moments fall between 08:00 and 22:00, on any day. Tick doesn't assume office hours.
- Your appointments show as grey blocks in your **Calendar**, next to your tasks.
- The other way round works too: **Add to calendar** turns a task into an appointment in Google Calendar, or an .ics file for Outlook and Apple.
- Unlinking erases everything Tick fetched.

*Linking a calendar is not switched on at app.ticktodo.nl yet. It already works on your own Tick. **Add to calendar** works everywhere.*

### 3.4 Tickmanager

**Heading:** Old tasks get a second chance

**Text:**
Every list has them: tasks that sank to the bottom months ago. The Tickmanager brings them back one by one, oldest first. For each task you choose: **Schedule**, **Move to top**, **Leave it** or **Delete**. One tap, and on to the next. An orange button shows how many are waiting. So you tidy your list in a few minutes, without having to take in everything at once.

**Details:**
- A new task is old after 14 days. A task you already looked at in the Tickmanager is old again after 30 days. You can change both.
- Pinned tasks, repeating tasks and tasks with a reminder in the future don't take part.
- You choose which lists take part. A list called *Someday* you simply skip.
- **Schedule** offers *Today*, *Tomorrow*, *Next week* or **Pick a date…**. With a linked calendar, your free moments come first.
- At the end you see what you did: *"2 scheduled, 1 moved to top, 1 deleted, 4 left as is"*.
- Works offline too. You can turn it off in Settings.

---

## 4. All features

### Entry card
- **Anchor:** `#entry-card`
- **Tile:** Entry card · Type a task and add what belongs with it straight away.
- **Read more:**
Adding a task starts with typing in the field at the top of your list. Press Enter and it's in. Want more? The field opens into a card. It has a short sentence for each part: **Remind me…**, **Repeat**, **Remind me at a place**, the list it goes into, and **Do it together with…**. A sentence in grey is still empty. Tap it and choose.

Under the sentences is **Description, subtasks or attachment**. There you write notes, add subtasks, or attach a photo or file. You can also paste a picture or drop a file on the card.

Tick doesn't pull a date out of what you type. You choose the time yourself, with *Today*, *Tomorrow*, *Next week* or **Other day and time…**. So you always know exactly what's set.

With a keyboard: **N** opens the field, **Shift+Enter** adds the task and opens it right away, **Esc** empties the card. Open the task later and you see the same sentences. What you filled in shows in colour.

### Reminders
- **Anchor:** `#reminders`
- **Tile:** Reminders · Today, tomorrow or next week, in one tap.
- **Read more:**
Tap **Remind me…** on a task and choose *Today*, *Tomorrow* or *Next week*. For another moment there's **Other day and time…**. A new reminder starts at the next whole hour. Pick only a date, and Tick uses your default time: 09:00, unless you changed it.

At that moment you get a notification on every device where you turned notifications on. It has two buttons: **Done** ticks the task off, **In 1 hour** moves it an hour later. Tap the notification itself to open the task.

The reminder is also the deadline. There is no separate due date. In the list, the time is in grey under the task. Once it has passed, it turns red.

Every day at 09:00 Tick sends a notification for overdue tasks, with **Done** and **Tomorrow**. At most ten, oldest first. You can change that time, or turn it off.

Notifications can be up to a minute late, because Tick checks once a minute. Fair is fair.

### Repeating
- **Anchor:** `#repeating`
- **Tile:** Repeating · Every week on Wednesday, until a date if you like.
- **Read more:**
At a reminder, choose under **Repeat** how often: every day, week, month or year. Or every so many days, on certain weekdays, on a day of the month, or on, say, the third Sunday. An end date works too.

Tick off a repeating task and it moves on to the next time. It stays open, and its subtasks reopen.

A missed time is skipped. The next time is always in the future, so you don't get a pile of catch-up notifications.

Snooze, or choose *Tomorrow*, and only this one time moves. To change every time, change the rhythm under **Repeat**.

Times follow the clock of your time zone. 10:00 stays 10:00 when daylight saving time starts. "On the 31st" falls on the last day of shorter months.

### Due today
- **Anchor:** `#due-today`
- **Tile:** Due today · What's due today, from all your lists, at the top.
- **Read more:**
At the top of your list is a bar **Due today** with a number. That's how many tasks are due today, overdue ones included. When something is overdue, the bar is red.

Tap the bar and it folds open. You see every task due today from all your lists, shared ones too, earliest first, with the name of its list. Open a task, or tick it off right there. Each device remembers whether you left the bar open or closed.

The same number is on the app icon and on the browser tab. The small tab icon gets a red dot when something is overdue. So you see at a glance whether something is waiting, without opening the app.

Nothing due today? Then the bar is gone. Rather not see a number? Turn the counter off per device in Settings.

### Calendar
- **Anchor:** `#calendar`
- **Tile:** Calendar · A month view and an agenda of what's coming.
- **Read more:**
**Calendar** in the sidebar shows your open tasks with a date. In two ways: as a month grid, with bars on the days that have something, and as an agenda, day by day. What's overdue is at the top.

Repeating tasks show with their coming times. So you also see the bins three weeks from now.

The week starts on Monday or Sunday, as you choose in Settings. With a linked calendar, your appointments show as grey blocks between your tasks. You can't open those in Tick; they're there to show when you're busy.

Tap a task to open it and change the time.

### Linking your calendar
- **Anchor:** `#link-calendar`
- **Tile:** Link your calendar · Tick sees when you're busy and suggests free moments.
- **Read more:**
Link your online calendar with its secret iCal address. That works with Google Calendar, Outlook, iCloud and any calendar that has such an address. In Tick, go to **Settings › Calendars**, paste the address and tap **Link calendar**. Up to ten calendars, for example *Work* and *Home*.

About once an hour, Tick fetches your appointments: only title, start and end, for today and the next 14 days. Descriptions, locations and attendees are not read. Appointments marked *free* and cancelled ones are skipped.

Tick then suggests free moments, in the reminder menu under *Free in your calendar* and in the Tickmanager. The first free half hour, the first free evening and a moment at the weekend. When you already have something at a suggested time, Tick says **Busy:** with the title.

Tick only reads. It never changes anything in your calendar. The address is stored encrypted and never shown again. **Unlink** erases everything Tick fetched.

The other way round: **Add to calendar** makes a 30-minute appointment at the reminder time, in Google Calendar or as an .ics file. That works without linking.

*At app.ticktodo.nl, linking a calendar is not switched on yet.*

### Subtasks
- **Anchor:** `#subtasks`
- **Tile:** Subtasks · 2/4 done, right in your list.
- **Read more:**
Break a big task into small steps. A task can have one level of subtasks. In the list they share one grey block: the subtasks smaller and lighter, with a thin line to the task above. Next to the title you see how many are done, such as **2/4**.

A subtask follows its task. It's in the same list, and when you tick off the task, the subtasks go with it. Tick off a subtask and it drops to the bottom within its task.

In a repeating task the subtasks reopen as soon as the task moves on. Handy for a fixed round, like the weekly cleaning.

Share a task as a copy, and the other person's progress shows in the bar you see. Their subtasks themselves you don't see.

### Notes with checklists
- **Anchor:** `#notes`
- **Tile:** Notes · With headings, links and lists to tick off.
- **Read more:**
Every task has a **Description**. Put in whatever you like: an address, a link, a shopping list. You write in markdown: headings, **bold**, *italics*, lists, links, quotes and code.

A line like `- [ ] milk` becomes a box you can tick while reading the note. So you have a quick list inside a task, without every item needing its own subtask.

Tables, images and HTML show as plain text. Title and notes save while you type.

Search looks in your notes too, including those of completed tasks.

### Attachments
- **Anchor:** `#attachments`
- **Tile:** Photos and files · Add them to any task.
- **Read more:**
A photo of the paint colour, the receipt, the manual as a PDF. Tap **Photo or file** on a task, or paste or drop it in. Tap a photo for a large view, with previous and next.

Photos are scaled down before they're uploaded. They lose their EXIF data on the way, such as where they were taken.

At most 20 files per task, each up to 10 MB. At app.ticktodo.nl you have 100 MB per account. **Settings › Data › Storage** shows how much you use.

Deleting an attachment can't be undone. Attachments need a connection; photos you've already seen stay visible offline. A backup lists which attachments there were, but doesn't contain the files.

### Offline
- **Anchor:** `#offline`
- **Tile:** Works offline · Changes go along once you're back online.
- **Read more:**
In the basement, on the train, abroad without data. Tick works without a connection, once you've opened it online and logged in.

Adding, changing and ticking off tasks just carries on. Tick saves it on your device and sends it once you're connected again. If two devices changed the same field, the last change wins.

In a shared list you can add, tick off and **Take it** offline. If two people take the same task offline, whoever comes online first gets it.

What needs a connection: sharing, the trash, attachments and the map. The Tickmanager works offline, with the tasks already on your device.

### Themes
- **Anchor:** `#themes`
- **Tile:** Light, dark or the 70s · Make it a bit yours.
- **Read more:**
Tick follows your device in light or dark, or you choose. There's also a colour theme: the default, or **Retro 70s**, in light and dark too. I could have regretted that one. I don't.

You set the text size and the space between tasks: compact, normal or roomy. An example task changes along, so you see what you pick.

Want your own **background photo**? Set it once, for all your devices.

Ticking off a task gives you confetti. If your device asks for reduced motion, Tick leaves it out.

Theme, colour theme and text size are per device. So your phone can be dark and your laptop light.

### Widget and quick add
- **Anchor:** `#widget`
- **Tile:** Widget and quick add · Your list on your home screen (Android).
- **Read more:**
Put the Tick widget on your Android home screen. You choose what it shows: all tasks, *Today and overdue*, or one list. You set the text size and line spacing, and make it as big as you like.

Tick tasks off right on the widget. You get three seconds to undo. Tap a task to open it, or the header to open the app on that list. Each row shows what belongs with it: reminder, list, place, repeat, sharing and open subtasks.

With **➕** on the widget, the *New task* shortcut on the app icon, or *Share* from another app, a panel opens at the bottom. Type the title and pick a list, a reminder, a place or a repeat if you like. Turn on *Add another one after this* to type several tasks in a row.

The widget and quick add are only in the Android app.

### Places
- **Anchor:** `#places`
- **Tile:** Places · A notification when you arrive or leave (Android).
- **Read more:**
Give a task a place and Tick lets you know when you **arrive** or **leave**. The shopping list at the supermarket. The screws when you park at the hardware store. The parcel as you step out the door.

Tap **Remind me at a place** on a task. Search for an address, drag the map, tap *My location* or pick a favorite. Choose **On arrival** or **On leaving**, and the radius: from 200 m to 2 km. A place you use often, you keep with **☆ Save as favorite**.

Not the right moment? Swipe the notification away and it comes back the next time you arrive. **Notify again** re-arms a place that already went off.

Your phone watches the places itself and only tells Tick that a notification went off. Tick keeps no record of where you've been.

Place reminders only work in the Android app. On an iPhone or in the browser you can still set the place. Maps come from OpenStreetMap.

### Driving mode
- **Anchor:** `#driving-mode`
- **Tile:** Driving mode · Big and simple behind the wheel.
- **Read more:**
When Tick notices you're driving, the screen gets bigger and simpler. You see a bar **Driving mode detected**, with tasks **Nearby** (within 3 km, closest first) and what's due **Today**. Every task has a big round button to tick it off, and there's a big **Add task** button.

Tick switches it on when the app is open and you've been going faster than about 25 km/h for half a minute. Three minutes of standing still or walking, and the normal view comes back. A traffic light or a jam doesn't count.

Sitting next to the driver, or on a train? Tap **Not now**. **Never** turns it off on all your devices.

For this, Tick uses your location only on this device, only while Tick is open. It's not sent to the server and not stored. Tick never asks for your location out of the blue.

Please don't look at your screen too long while driving. That's exactly why it's big.

### On time on the road
- **Anchor:** `#on-time-on-the-road`
- **Tile:** On time on the road · On time by bike or car (Android, GitHub version).
- **Read more:**
Android only notices you've reached a place a few minutes later. On foot that hardly matters. By car or bike you're past it by then.

In the Android app, under **Tick on this phone**, turn on *On time on the road*. While you drive or cycle, Tick makes arrival circles bigger. The notification then comes around the edge of the circle you set, and says *"Almost at …"*.

How much bigger, Tick learns from your earlier notifications, separately for car and bike. A circle never grows so big that you're already inside it when you set off. When you get out or off, the circles go back to normal.

Tick asks for the permission **Physical activity**, only to know *whether* you drive or cycle. It's not a fitness feature. Nothing about where you are or how you travel is sent.

This is only in the Android app from GitHub, not in the Google Play version.

### Tickmanager
- **Anchor:** `#tickmanager`
- **Tile:** Tickmanager · Old tasks come back one by one.
- **Read more:**
Tasks you haven't looked at in a long time sink to the bottom of a list. The Tickmanager brings them back. An orange lightning button (on a wide screen: *Tickmanager* under Inbox) shows how many are waiting.

Tap **Start tidying up** and you see one task at a time, oldest first, with how long you haven't looked at it. For each task you choose: **Schedule**, **Move to top**, **Leave it** or **Delete**. At the top you see how far you are, and **Stop** lets you continue later.

A new task is old after 14 days, a task you already looked at after 30. You can change both. Pinned tasks, repeating tasks and tasks with a reminder in the future don't take part. You choose per list whether it takes part.

In a shared list, "looked at" counts for everyone. Which lists you skip is yours.

Works offline too. Rather not? Turn off **Show Tickmanager** in Settings.

### Sharing
- **Anchor:** `#sharing`
- **Tile:** Sharing tasks · Shared to do together, or a copy for each.
- **Read more:**
Open a task and tap **Do it together with…**. Pick someone and choose how.

**Shared** is one task for everyone. Done is done for everyone, everyone can change it and add subtasks, and each person keeps it in their own list. A reminder at a time or place reaches everyone. You recognise it by the blue people icon and *Shared with …*.

**Copy** gives the other person their own copy, with all subtasks open. You each tick off your own. You recognise it by the grey icon of two sheets and a name with a progress bar. When the other is done, you get a notification *"… is done ✓"*.

The other person gets a notification with **Accept** and **Decline**. An accepted task lands in their Inbox.

At app.ticktodo.nl you share with an email address. If that person has no account yet, they get an invitation by email. You confirm your own email address first. In the free version you share with one person: as many tasks and lists as you like.

### Shared lists
- **Anchor:** `#shared-lists`
- **Tile:** Shared lists · One list together, and you see who does what.
- **Read more:**
The groceries for the house, the packing list for a weekend away. Share a whole list and every task in it is shared with everyone in the list. Choose **Share…** in the list menu and invite someone. They accept once and have the whole list.

Everyone can add, change, tick off and delete. Tap **Take it** under a task and the others see *"… is on it"*. Only you can tick it off then. Tap again to let go.

A ticked-off task doesn't vanish. It moves to the **Ticked off** block at the bottom, with who did it and when. **Clear** moves them to the trash for everyone.

By default you get no notification when someone else ticks something off. Turn on **Notify when ticked off** for the whole list, or choose **Notify me when this is ticked off** per task.

Drag a task to one of your own lists and it's yours alone. Drag one of your own tasks in and it belongs to everyone. Only the person who shared the list can invite people, remove them or delete the list.

### Reporting and blocking
- **Anchor:** `#reporting-and-blocking`
- **Tile:** Reporting and blocking · Got something that shouldn't be there? Gone.
- **Read more:**
At app.ticktodo.nl anyone can make an account. So it can happen that someone sends you something you don't want. That's what **Report** is for.

You can report an invitation, a task someone shared with you, a shared list (**Report list**), or a file someone else added. Choose a reason: spam, inappropriate, illegal or something else, and add a note if you like. It disappears from your Tick straight away. The administrator gets an email and looks at it.

**Also block** is ticked by default. Blocking stops everything you share with that person, both ways, and their invitations no longer reach you. They aren't told. You can also choose **Only block**.

The people you blocked are under **Settings › Account › Blocked people**. You can lift the block there.

On a Tick you host yourself for your household, these buttons don't exist. There you know each other.

### Import from TickTick
- **Anchor:** `#ticktick`
- **Tile:** Moving from TickTick · Bring your tasks along.
- **Read more:**
Coming from TickTick? Make a backup there. That gives you a CSV file. In Tick, go to **Settings › Data** and pick the file at *Get tasks from TickTick*.

Tick adds your tasks and shows how many were new, how many were already there and how many were skipped. Import the same file again and Tick skips what's already there and keeps your changes.

The file can be up to 10 MB.

Moving from another app? I haven't built that yet. TickTick was the app I used myself.

### Backup
- **Anchor:** `#backup`
- **Tile:** Backup · Download all your tasks in one file.
- **Read more:**
Under **Settings › Data** you download a backup of all your tasks. Completed tasks and places are included. Your settings, keys, tasks others shared with you and the files of attachments are not.

With **Restore a backup** you put such a file back. Tick first shows what's in it. Then it merges by task: tasks in the file replace the same task here, and deleted ones come back. Nothing is deleted.

A backup is also your way out. Your tasks are yours, and you take them with you if you want.

### Integrations
- **Anchor:** `#integrations`
- **Tile:** Integrations · Claude, Home Assistant and an inbox for your own automations.
- **Read more:**
For people who like to tinker, Tick has a few ways in.

**Claude (MCP):** Tick has an MCP server, so Claude Code or Claude Desktop can manage your tasks: search, add, change, tick off, snooze and move them to the trash. Claude uses a key of its own that you can revoke at any time. It can't reach your settings, keys or password.

**Inbox API:** with an *Inbox* key you add tasks from a shortcut, a script or an email rule. With title, notes, date, list and repeat. Such a key can only add tasks, nothing else.

**Home Assistant:** sensors for your open, today's and overdue tasks, and actions to complete, postpone and add tasks. All in one package file.

**Fallback webhook:** when a notification couldn't be delivered within 15 minutes, Tick can send it to a webhook of your own, for example a chat app.

You make keys under **Settings › Advanced › Keys**. You see a key once, and revoking works immediately.

### Account
- **Anchor:** `#account`
- **Tile:** Your account · Lost your password, or want to leave? You do it yourself.
- **Read more:**
**Forgot password?** Tap it on the login screen and enter your email address. You get an email with a link to choose a new password. It works for an hour. No email? Check your spam. After five minutes you can ask for a new link.

Under **Settings › Account** you change your name, email address and password. **Log out on other devices** helps when you've lost your phone.

**Delete account** erases everything: tasks, places, attachments, settings, keys and linked devices. You confirm with your password, and it can't be undone. It happens right away. Backups are erased within 30 days. A shared list you own passes to another member. Tasks you shared on their own disappear for the others too; copies stay.

Can't log in anymore? app.ticktodo.nl/delete-account explains how to get your account deleted anyway, and how to delete only part of your data.

Want to keep your tasks? Download a backup first.

### Languages
- **Anchor:** `#languages`
- **Tile:** English and Dutch · Per device, in your own time zone.
- **Read more:**
Tick comes in English and Dutch. By default it follows your device's language, or you choose under **Settings › Language and time**. Error messages and the login screen follow along.

The language belongs to the device. Your phone can be in Dutch and your work laptop in English. Notifications come in the language of the device they go to.

You also set your time zone, with a button to take the one from your device. Change it, and your reminders stay at the same clock time in the new zone. You also pick your default time for a reminder without a time, and whether the week starts on Monday or Sunday.

More languages? Maybe later. I only speak two well enough myself.

---

## 5. What works where

Columns:
- **Web app:** app.ticktodo.nl in a browser, on your computer or phone
- **Android (Play Store):** the app `nl.ticktodo.app`, still in testing, connected to app.ticktodo.nl
- **Android (APK via GitHub):** the app from GitHub, for app.ticktodo.nl or your own Tick
- **iPhone/iPad:** Tick on your home screen from Safari
- **Self-hosted:** your own Tick on your own Cloudflare account

<!-- Sources per row: see the comments in the Dutch table. -->

| Feature | Web app | Android (Play Store) | Android (APK via GitHub) | iPhone/iPad | Self-hosted |
|---|---|---|---|---|---|
| Tasks, lists, subtasks, notes | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reminders at a time (notifications) | ✓ | ✓ | ✓ | ✓ (iOS 16.4+, from the home screen) | ✓ |
| Repeating | ✓ | ✓ | ✓ | ✓ | ✓ |
| Due today and counter on the icon | ✓ | ✓ | ✓ | ✓ | ✓ |
| Calendar | ✓ | ✓ | ✓ | ✓ | ✓ |
| Linking your calendar | not yet | not yet | only with your own Tick | not yet | ✓ |
| Add to calendar | ✓ | ✓ | ✓ | ✓ | ✓ |
| Setting a place on a task | ✓ | ✓ | ✓ | ✓ | ✓ |
| Place notifications | — | ✓ | ✓ | — | with the Android app |
| On time on the road | — | — | ✓ | — | with the GitHub app |
| Driving mode | ✓ (on a phone, with location) | ✓ | ✓ | ✓ | ✓ |
| Home-screen widget | — | ✓ | ✓ | — | with the Android app |
| Quick add and sharing from other apps | — | ✓ | ✓ | — | with the Android app |
| Works offline | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sharing tasks and lists | with 1 person (free) | with 1 person (free) | with 1 person at app.ticktodo.nl | with 1 person (free) | ✓ with everyone on your Tick |
| Make your own account | ✓ | ✓ | ✓ at app.ticktodo.nl | ✓ | through an invitation link |
| Reporting and blocking | ✓ | ✓ | ✓ at app.ticktodo.nl | ✓ | — (only on an open Tick) |
| Tickmanager | ✓ | ✓ | ✓ | ✓ | ✓ |
| Photos and files | ✓ (100 MB per account) | ✓ | ✓ | ✓ | if you turn them on |
| Backup and TickTick import | ✓ | ✓ | ✓ | ✓ | ✓ |
| Themes, language and time zone | ✓ | ✓ | ✓ | ✓ | ✓ |
| Claude (MCP), inbox API, Home Assistant | ✓ | ✓ | ✓ | ✓ | ✓ |
| Updates | automatic | through Google Play | the app tells you about a new version | automatic | update it yourself (*"update Tick"* in Claude Code) |

Under the table: *Place notifications, the widget and quick add need the Android app. Apple gives a home-screen app less room. Everything to do with tasks, lists, reminders and sharing works everywhere.*

---

## 6. Privacy

### Heading
Your tasks are yours

### Text
I make Tick myself, in the Netherlands. There are no ads, no tracking and no statistics about how you use the app. Your data is not sold or shared with anyone for marketing. The code is open source, so anyone can check what Tick does.

**What Tick keeps**
- Your account: name, email address, your password as a scrambled code, and when you last used Tick.
- What you put in: tasks, notes, lists, reminders, places you save, attachments and your settings.
- Linked phones, and the address your browser or phone gives to deliver notifications.
- If you link a calendar: only the title, start and end of each appointment, for the next 14 days.

**What Tick doesn't keep**
- Where you are. Your phone checks itself whether you arrive at a place, and only tells Tick that a notification went off. There's no log of where you've been.
- How you drive. Driving mode and *On time on the road* use your location and movement only on your phone.
- Where your photos were taken. Tick removes that data before they're uploaded.

**Services Tick uses**
Cloudflare hosts Tick; your data is stored there. Notifications go through the push service of your browser or phone, encrypted. Maps and address search come from OpenStreetMap. Emails, such as *Forgot password?*, go through Resend.

**You're in control**
You can download all your tasks under **Settings › Data**, and delete your account yourself. Then everything goes right away; backups are erased within 30 days.

One cookie keeps you logged in. That's it.

**Link:** Read the full privacy policy → https://app.ticktodo.nl/privacy

---

## 7. Does it cost anything?

### Heading
Does it cost anything?

### Text
No. Tick is free right now.

In the free version on app.ticktodo.nl you share with one person. As many tasks and lists as you like, but with that same person. What others share with you doesn't count. So you can always accept an invitation.

Hosting and development do cost something. Maybe there will be paid extras later to cover that. Tick doesn't need to make a profit. If it pays for itself, I'm happy.

What's free when you sign up won't become paid without me telling you in advance. That's in the terms too.

Rather do it all yourself? Tick is open source. You can put it on your own free Cloudflare account, with no limit on the number of people.

---

## 8. Frequently asked questions

**What's the difference between shared and copy?**
Shared is one task for both of you: done is done for everyone, and everyone can change it. A copy is the other person's own copy. You each tick off your own, and you see each other's progress.

**What does the other person see with a copy?**
A task of their own, with the title, the description and all subtasks open, and the line *Copy from* with your name. After that it's their task: what they change, you don't see, and the other way round. You only see each other's progress: a name with a small bar, or a ✓ when someone is done.

**What happens when I delete a shared task?**
It disappears for everyone on it. It goes to the trash and stays there for 30 days. Only want to be rid of it yourself, without removing it for the other person? Choose **Stop sharing**.

**Can I share a copy later?**
As long as the other person hasn't accepted the copy yet, yes: pick the same person and tap **Change**. Once they've accepted it, no, because that copy may have changed. They delete the copy first; then you can share the task. The other way round does work: turning a shared task into a copy.

**Does the other person need an account?**
At app.ticktodo.nl you share with an email address. If that address has no account yet, it gets an invitation by email, with a link to sign up. The invitation is then waiting for them. An invitation stays open for 30 days. You confirm your own email address before you can share.

**How many people can I share with?**
In the free version, one person, with as many tasks and lists as you like. What others share with you doesn't count.

**Does Tick work on an iPhone?**
Yes. Open app.ticktodo.nl in Safari, tap the Share button and choose **Add to Home Screen**. Tick then opens like an app, with notifications (iOS 16.4 or newer). Place reminders, a widget and quick add aren't possible on an iPhone. There's no App Store app: that needs a paid Apple account and a review for every update.

**Is there an Android app?**
Yes. There's a free app on GitHub, and a version in Google Play that's still in testing. The GitHub version also has *On time on the road*. Use one of them, not both.

**Does Tick know where I am?**
No. Your phone watches your places itself and only tells Tick that a notification went off. Driving mode uses your location only on your device, while Tick is open. Tick only keeps the places you save yourself.

**Does Tick pick up a date from what I type?**
No. You choose the time yourself with *Today*, *Tomorrow*, *Next week* or another day and time. Then you know for sure what's set.

**How do I delete my account?**
In the app: **Settings › Account › Delete account**. You confirm with your password and everything goes right away. Can't log in anymore? See app.ticktodo.nl/delete-account. Download a backup first if you want to keep your tasks.

**Can I host Tick myself?**
Yes. The code is on GitHub (DioVayne/tick), under the MIT licence. You put it on a free Cloudflare account. With Claude Code that takes about fifteen minutes; you can also do it by hand. Then you can invite everyone in your household.

**What if Dio stops?**
Then you'll hear at least 30 days in advance, so you can download your tasks. And because Tick is open source, it doesn't disappear: you can host it yourself, or someone else does. I'm not planning to, by the way. I use it every day.

**Can I move from TickTick?**
Yes. Make a backup (CSV) in TickTick and import it under **Settings › Data**.

**Do I lose my data if my phone breaks?**
No. Your tasks are on the server and on your devices. Log in on a new device and everything is back.

---

## 9. Footer and SEO

### Footer
- Tagline: *Tick. Reminders at the right moment.*
- Column **Tick**: Try it free · Android app · iPhone and iPad · What works where · FAQ
- Column **More**: User guide (GitHub) · Source code · Host it yourself
- Column **Legal**: Privacy · Terms · Delete account
- Line: *Made in the Netherlands by Dio. No ads, no tracking. Open source under the MIT licence.*
- Contact: *Questions? Email dio@ticktodo.nl.*
- Provider: *Tick at app.ticktodo.nl is offered by Dio Communicatieadvies.*

### SEO
- **Page title:** Tick: to-do app with reminders by time and place
- **Meta description:** A free to-do app that reminds you at the right moment, even when you reach the shop. Share tasks and lists. No ads, no tracking, open source.
- **OG title:** Tick: reminders at the right moment
- **OG description:** A free to-do app that lets you know when you're at the supermarket. Share lists, tidy up old tasks, and no ads. Made in the Netherlands.

---

# Bronnen en twijfels

1. **"Ik pak hem" bestaat niet in de app.** De knop heet **Oppakken** (EN *Take it*); daarna *Jij pakt het op* / *{naam} pakt het op* (`slist.i_take`, `slist.you_take`, `slist.takes`). Ik heb overal de echte termen gebruikt.
2. **Plekmelding heeft geen "Over 1 uur".** De Android-plekmelding heeft één knop, **Afvinken** / *Complete* (`android/.../strings.xml` `done`, `Notify.java`), en de tekst *📍 Aangekomen bij …* / *📍 Arrived at …*. Wegvegen = komt bij de volgende aankomst terug. *Klaar* / *Over 1 uur* zijn de knoppen van een tijdmelding (`push.done`, `push.snooze`). De demo volgt de echte plekmelding; er staat een variant bij. Let op: `docs/places.md` zegt "Tap **Done**", maar de app zegt *Complete*/*Afvinken*. De handleiding klopt daar dus niet helemaal.
3. **Agenda koppelen staat uit op app.ticktodo.nl** (`CALENDAR_FEEDS: "false"`, volgens de beheernotitie, niet in de docs). De sectie "Vrije momenten" belooft dus iets wat de webapp en de Play-app nu niet hebben. Ik heb er een regel onder gezet. Zet hem pas groot neer als het daar aanstaat, of schuif het verhaal naar achteren.
4. **100 MB per account** op app.ticktodo.nl komt uit de beheernotitie (`MAX_ACCOUNT_MB`); de docs noemen 100 MB alleen als voorbeeld.
5. **E-mail (Resend) op app.ticktodo.nl:** aanmelden, bevestigen, uitnodigen per mail en *Wachtwoord vergeten?* hebben `RESEND_API_KEY` nodig. Volgens de notitie van 2026-11-05 moest Dio die nog zetten. Controleer of mail echt werkt voordat de site dit belooft.
6. **Knop "Gratis Android-app":** de Play-versie zit nog in de testfase. Waar moet de knop heen? De APK op GitHub werkt nu al, maar wie de APK installeert moet zelf het adres app.ticktodo.nl intypen.
7. **"Gemaakt in Nederland"** klopt voor de maker en het recht (Nederlands recht in de voorwaarden). De gegevens staan bij Cloudflare (Amerikaans bedrijf); waar precies, staat nergens. Ik heb niet beweerd dat de data in Nederland staat.
8. **De ADD van je vriendin** staat in het makersverhaal, zoals in de briefing. Laat dit wel even lezen door haar zelf.
9. **Wie kan een gedeelde taak terugzetten** na verwijderen? De docs zeggen alleen "deletes it for everyone" en de app zegt "naar de prullenbak voor iedereen". In de FAQ staat niet wie hem terug kan zetten.
10. **Teller op het app-icoon op iPhone:** de docs noemen "app icon", maar niet specifiek iOS. In de tabel staat ✓; niet getest.
11. **Rijmodus in de webapp:** op een computer haal je geen 25 km/u. Daarom staat er "op een telefoon, met locatie". In de Android-apps is versie 1.12.1 of nieuwer nodig.
12. **Koppelingen (MCP, inbox-API, Home Assistant) op app.ticktodo.nl:** de docs beschrijven ze voor elke Tick, met een sleutel. Of je ze op de gehoste Tick wilt aanraden (belasting, voorwaarden over geautomatiseerde verzoeken), is aan jou.
13. **Back-up terugzetten op een andere Tick** (FAQ "Wat als Dio stopt"): niet beweerd. Er staat alleen dat je je taken kunt downloaden en zelf kunt hosten. Of een back-up van app.ticktodo.nl goed terugkomt op een eigen Tick, staat niet in de docs.
14. **Aanbieder in de footer:** "Dio Communicatieadvies" komt uit `OPERATOR_NAME` (beheernotitie) en staat ook op de voorwaardenpagina. Vermeld eventueel ook het KvK-nummer als `OPERATOR_KVK` gezet is.
15. **Gedeelde taak "Stoppen met delen"** (FAQ): dit is de knop *Stoppen met delen* / *Stop sharing* (`share.leave`) voor wie meedoet. De eigenaar ziet *Verwijderen* bij anderen (`share.remove`); of de eigenaar zelf kan stoppen zonder te verwijderen, staat niet in de docs.
16. **iPhone-menutekst:** "Zet op beginscherm" is de Nederlandse iOS-term zoals ik die ken; de docs noemen alleen de Engelse *Add to Home Screen*.
17. **"Kopie van Dio" in de demo:** de app toont *Kopie van* gevolgd door een naam (`copy.from`). Dat de naam er direct achter staat, volgt uit `docs/sharing.md` ("Copy from Dio").

# Revisie 2026-11-10 (feedback van Dio)

Wat er na de eerste versie op de site veranderd is. De tekst hierboven is het origineel; waar het hieronder anders staat, geldt dit.

**Vorm**
- Alle echte knoppen zijn pillen (helemaal rond). De markeerstift onder koppen is een smalle streep onder in de regel, die nooit over een andere regel valt. Op donker zakt de streep naar de onderkant, zodat de letters licht blijven.
- Kantlijnnotities hebben alleen een pijl als die ergens naar wijst: bij het groeilijstje (omhoog naar het lijstje) en bij de rijmodus (naar het rijmodus-scherm). Bij privacy en de FAQ zijn de pijlen weg.
- Het groeilijstje in het makersverhaal is een gewone regel tekst met kleine emoji (📝 👥 🤖 📅 🚗 🌐), geen pillen meer.
- Kaartdemo: het poppetje is oranje met een witte rand en begint op het gras naast het huis, niet op de deur. De deur is op donker niet meer wit. In de melding staat geen rondje meer; **Afvinken** / *Complete* is genoeg.
- Samen of kopie: beide telefoons doen mee. Gedeeld: afvinken op de ene telefoon vinkt hem op beide af, en de ander krijgt een melding. Kopie: ieder vinkt zijn eigen exemplaar af; het balkje op de ene telefoon is de voortgang van de ander. Nieuwe regels: *Vink iets af, links of rechts. Allebei de telefoons doen mee.* / *Tick something off, left or right. Both phones join in.* en *Ieder ziet het balkje van de ander groeien. Wat de ander afvinkte, zie je niet.* / *You each see the other's bar grow. What the other ticked off, you don't see.*
- Alle functies: elke tegel heeft een emoji, en elk verhaal een echt scherm uit de app (NL-schermen op de NL-pagina, EN op de EN-pagina; `site/public/img/app/`, gemaakt met de demodata van de Play-schermen).
- Wat werkt waar: rijen in groepen (Taken en herinneringen, Plekken en onderweg, Samen, Op je telefoon, Je gegevens en de rest), een icoon per kolom, drie tekens met een uitleg erboven (ja = groen met vinkje, deels = half oranje, nee = hol grijs) en om en om een lichte rij. Op een telefoon: de eerste kolom blijft staan, *Schuif de tabel opzij voor alle apparaten →* en een vervaging rechts zolang er meer is.

**Tekst**
- Makersverhaal: *Mijn vriendin, die ADD heeft, zei in één zin wat Tick moest kunnen:* / *My girlfriend, who has ADD, put what Tick had to do in one sentence:*
- Sterretje bij *bij de winkel bent* (hero) en *als je er bent* (plekken). Voetnoot: *\* Meldingen op een plek werken (alleen) in de Android-app. Een iPhone-versie wil ik ooit ook maken, maar daar moet ik eerst nog even voor sparen.* / *\* Place reminders (only) work in the Android app. I'd like to make an iPhone version someday, but I'll have to save up for that first.*
- Plekken: nieuw scherm van de rijmodus naast het plek-scherm, met de notitie *Kijk alsjeblieft niet te lang naar je scherm onder het rijden…* die ernaar wijst.
- Demo na wegvegen, in de derde persoon (Tick praat niet als "ik", Dio wel): *Prima. De volgende keer dat je hier bent, meldt Tick zich weer. Tick is geduldig.* / *Fine. Next time you are here, Tick will be back. Tick is patient.*
- Agenda koppelen (tegel): *Je afspraken naast je taken. Nog niet helemaal af.* / *Your appointments next to your tasks. Not quite finished.* Het verhaal belooft geen vrije momenten meer, alleen dat het op een eigen Tick in de maak is.
- Zelf gehost: kolomkop *gratis Cloudflare-account, wat installeerwerk* / *free Cloudflare account, some setup*, een blok onder de tabel met een link naar SETUP.md, en eerlijk over delen: **Delen gaat alleen met mensen op dezelfde Tick-server** / **You can only share with people on the same Tick server**. Ook in *Kost het iets?* en FAQ 12. <!-- Nog te onderzoeken; als dat anders blijkt, pas het aan in de tabel (cel Taken en lijsten delen), het blok onder de tabel, Kost het iets? en FAQ 12. -->
- FAQ 13: *Wat als je ermee stopt, Dio?* / *What if you stop, Dio?*, antwoord in de ik-vorm. Kantlijn bij de FAQ: *Stoppen met Tick? Ben ik niet van plan. Ik gebruik het zelf elke dag.* / *Stop making Tick? Not planning to. I use it every day.*
- NL: *Instellingen › Data* heet in de app *Instellingen › Gegevens*; overal aangepast. Typfout *dat het telefoon zegt* → *dat je telefoon zegt*.
