# Melden en blokkeren — ontwerp

Datum: 2026-11-08. Besproken met Dio.

## Waarom

Op `app.ticktodo.nl` (een openbare Tick, `OPEN_SIGNUP`) kan iedereen een account maken en via een e-mailadres taken en
lijsten met anderen delen, met bijlagen. Google Play vraagt bij apps met gedeelde gebruikersinhoud dat je inhoud en
gebruikers kunt **melden** en **blokkeren**. Dio wil daarnaast misbruik van bijlagen voorkomen: als er iets fouts
gedeeld wordt, wil hij het snel weten, het kunnen bekijken zonder het in zijn mailbox te krijgen, en het kunnen
weghalen.

## Doelen

1. **Melden.** Wie iets gedeeld kreeg van een ander, kan dat melden: een gedeelde taak, een gedeelde lijst, een bijlage
   van een ander, of een uitnodiging die nog openstaat. Een melding gaat altijd ook over een **persoon** (wie het
   deelde of uploadde).
2. **Blokkeren.** Je kunt een persoon met wie je deelt (of die jou iets stuurde) blokkeren. Dan stopt alle delen tussen
   jullie, en nieuwe uitnodigingen van die persoon komen niet meer aan.
3. **Mail aan Dio** bij elke melding, met reden, titel en een link naar een beheerpagina.
4. **Beheerpagina** voor de gemelde inhoud, alleen voor de ingelogde beheerder, met drie acties: niets aan de hand,
   inhoud verwijderen, account schorsen (en schorsing opheffen).
5. Google Play kan de vraag "Kun je gebruikers of inhoud melden?" daarna eerlijk met "Ja" beantwoorden.

## Niet-doelen

- Melden en blokkeren op een Tick zonder `OPEN_SIGNUP`. Daar kent de beheerder iedereen; er verandert niets.
- Geen bericht aan de melder over het besluit van de beheerder (gebruikelijk, en spaart mailtegoed).
- Geen bericht aan wie geblokkeerd of gemeld wordt.
- Geen automatische filters, geen scannen van bijlagen.
- Geen beroepsprocedure in de app; een geschorst account kan via het contactadres (`ADMIN_CONTACT`) mailen.
- Een **geaccepteerde kopie** is een eigen taak van de ontvanger geworden (zonder band met de afzender); die meld je
  niet meer, die verwijder je zelf. Een kopie-**uitnodiging** die nog openstaat, kun je wel melden.

## Anti-doelen (dan is het mislukt, ook al werkt het)

- Melden of blokkeren verraadt welke e-mailadressen een account hebben, of laat de geblokkeerde merken dat hij
  geblokkeerd is (een ander antwoord bij delen, een foutmelding). Dat de blokkeerder uit een gedeelde taak of lijst
  vertrekt, ziet de ander wel, maar dat ziet er hetzelfde uit als gewoon vertrekken; dat is gebruikelijk en goed.
- Een mail met (een kopie van) de gemelde bijlage, of een link waarmee iemand zonder beheerderslogin de bijlage opent.
  Hotlinking blijft dicht: bijlagen alleen met login en toegang tot de taak (of als beheerder via de beheerpagina).
- Een gemelde bijlage verdwijnt voordat Dio hem kon bekijken, alleen doordat de melder meldde.
- Een eigen Tick (zonder `OPEN_SIGNUP`) krijgt knoppen of gedrag dat er niet hoort.
- Met melden kan iemand mailtegoed opmaken of Dio volmailen.

## Besluiten (van Dio)

- Melden kan voor een gedeelde taak of bijlage, en voor de persoon die deelde.
- Bij een melding krijgt Dio meteen een mail via Resend (`src/mail.ts`), met de reden, de titel van de taak en een link
  die de inhoud alleen voor Dio als ingelogde beheerder opent. Geen bestand in de mail.
- Hotlinking blijft dicht.
- Dio koos het voorstel "zoals gebruikelijk" (2026-11-08), in punten:
  1. In het menu van gedeelde inhoud staat **Melden**. Je kiest een reden (spam, ongepast, illegaal, anders) en
     eventueel een korte toelichting.
  2. Daarna ziet de melder "Bedankt, we bekijken je melding" en verdwijnt de gemelde inhoud uit zijn Tick (het delen
     wordt voor hem opgezegd).
  3. In hetzelfde scherm staat **"Blokkeer ook *naam*"**, standaard aangevinkt.
  4. Blokkeren zegt al het delen met die persoon op (beide richtingen); nieuwe uitnodigingen van die persoon komen
     niet aan.
  5. De geblokkeerde merkt niets: zijn uitnodiging lijkt verstuurd, maar wordt nooit geaccepteerd.
  6. Instellingen › Account toont je geblokkeerde mensen; je kunt een blokkade daar opheffen.
  7. Dio krijgt meteen een mail met reden, titel en link.
  8. De link opent een beheerpagina (alleen voor Dio) met de taak, de bijlagen, wie het deelde, en de knoppen "Niets
     aan de hand", "Inhoud verwijderen" en "Account schorsen".
  9. Een geschorst account kan niet meer inloggen en niet meer delen; wat het deelde verdwijnt bij de anderen.
     Opheffen kan op dezelfde pagina.
  10. De melder krijgt geen bericht over het besluit.

## Hoe het werkt

### Alleen op een openbare Tick

Alles hieronder werkt alleen als `openSignup(env)` waar is. Anders geven de nieuwe routes `404` en toont de app geen
meld- of blokkeerknoppen (de app weet via de bestaande config of het een openbare Tick is; de builder kijkt hoe de app
dat nu al weet, bijvoorbeeld voor de verify-balk).

### Wat je kunt melden, en wie dan "de persoon" is

| Wat | Waar in de app | De gemelde persoon | Wat er voor de melder gebeurt |
|---|---|---|---|
| Openstaande uitnodiging voor een taak (gedeeld of kopie) | bij de uitnodiging: "Melden" naast weigeren | de afzender (`task_shares.from_user`) | uitnodiging geweigerd |
| Openstaande uitnodiging voor een lijst | idem | de eigenaar van de lijst | uitnodiging geweigerd |
| Gedeelde taak van een ander (jij bent ontvanger) | menu van de taak | de eigenaar van de taak | je stopt met deze taak (`leaveShareStmts`) |
| Gedeelde lijst van een ander (jij bent lid) | menu van de lijst | de eigenaar van de lijst | je verlaat de lijst (`leaveListStmts`) |
| Taak in een gedeelde lijst (jij bent lid of eigenaar) | menu van de taak | wie de taak in de lijst zette (zie hieronder) | lid: je verlaat de lijst; eigenaar: die persoon gaat uit de lijst |
| Bijlage die een ander uploadde, in een taak die je ziet | bij de bijlage | de uploader (`attachments.user_id`) | zie hieronder |

**Wie zette een taak in een gedeelde lijst?** Elke taak in een gedeelde lijst staat op naam van de eigenaar
(`tasks.user_id`); wie hem schreef, wordt nu niet bewaard. Een nieuwe kolom `tasks.added_by` (in de nieuwe migratie)
krijgt het account dat de taak aanmaakte of in de gedeelde lijst zette. Bij oudere taken (leeg) is de gemelde persoon de
eigenaar van de lijst. Je kunt een taak die je zelf in de lijst zette niet melden. *(Mijn keuze.)*

Bij een **bijlage**: ben je ontvanger van de taak (of lid van de lijst), dan vertrek je uit die taak of lijst, net als
hierboven. Ben je zelf de **eigenaar** van de taak en uploadde een deelnemer de bijlage, dan haalt Tick die deelnemer
uit de taak (zoals "iemand eraf halen" nu); hoort de taak bij een gedeelde lijst van jou, dan haalt Tick hem uit de
lijst. Ben je lid (niet eigenaar) van die lijst, dan vertrek je zelf. *(Mijn keuze.)* De bijlage zelf blijft in beide gevallen staan tot Dio beslist (of de
eigenaar hem zelf verwijdert): anders kan Dio hem niet meer bekijken. *(Mijn keuze.)*

Je kunt niets melden wat je zelf deelde of uploadde (`400`). Een bijlage in een taak die alleen van jou is (ook een
geaccepteerde kopie) krijgt geen meldknop: die verwijder je zelf. Melden kan alleen bij een taak die echt gedeeld
is (je bent ontvanger, of er is een geaccepteerde deelnemer of een lid van de gedeelde lijst). *(Mijn keuze; zo klopt
het met het niet-doel over kopieën.)*

### Melding opslaan

Nieuwe migratie `0022_melden_en_blokkeren.sql` (bestaande migraties niet wijzigen). Tabel `reports`:

- `id`, `reporter_id` (users), `reported_id` (users), `reason` (`spam` | `inappropriate` | `illegal` | `other`),
  `note` (vrije tekst, hoogstens 500 tekens, mag leeg), `created_at`.
- Wat er gemeld is: `task_id`, `list_id`, `attachment_id` (wat van toepassing is; geen cascade bij verwijderen, want
  de melding moet blijven bestaan als bewijs van wat Dio deed — de builder kiest of dat met `ON DELETE SET NULL` of
  zonder foreign key gaat).
- `title`: de titel van de taak of de naam van de lijst op het moment van melden (voor de mail en als de inhoud later
  weg is). Bij een bijlage ook `attachment_name`.
- `status`: `open` | `dismissed` | `removed` | `suspended`, plus `handled_at`.

Grenzen tegen misbruik: hoogstens een paar meldingen per melder per dag (voorstel: 10; builder kiest). Boven de grens
toch "Bedankt" laten zien en de inhoud laten verdwijnen, maar geen rij en geen mail meer. *(Mijn keuze: zo geeft de
grens geen andere ervaring, en kan iemand Dio niet volmailen.)*

### Mail aan Dio

- Naar het e-mailadres van de beheerder(s) (`users.role = 'admin'` met een e-mailadres); zonder zo'n adres naar het
  adres uit `ADMIN_CONTACT` (`contactEmail`). Zonder mail ingesteld of zonder adres: geen mail, de melding staat wel in
  de lijst op de beheerpagina. *(Mijn keuze.)*
- Via `reserveMail` met een eigen soort (`report`), per melder, zodat het binnen de daggrens blijft. Volle grens: geen
  mail, de melding blijft staan.
- Inhoud via `mailLayout`, in de taal van de beheerder (zijn instelling, anders de standaardtaal): kop "Nieuwe
  melding in Tick", de reden, de toelichting, de titel (en de naam van de bijlage), en een knop naar
  `<origin>/admin/reports/<id>`. Geen bijlage, geen afbeelding, geen e-mailadressen van melder of gemelde in de mail
  (alleen namen). *(Namen zijn mijn keuze; adressen staan op de beheerpagina.)*
- Versturen gebeurt op de achtergrond (`inBackground`), zodat de melder er niet op wacht.

### Beheerpagina

- `GET /admin/reports`: lijst van meldingen, open eerst, met datum, reden, titel, melder en gemelde. Alleen voor een
  beheerder met een sessie (`adminOnly`-regels: een API-sleutel krijgt `403`). Niet ingelogd → naar `/login?next=…`
  zoals elke pagina nu.
- `GET /admin/reports/:id`: de melding (reden, toelichting, wanneer), melder en gemelde (naam, e-mailadres, sinds
  wanneer het account bestaat, of het geschorst is), en de gemelde inhoud **zoals hij nu is**: titel, beschrijving,
  subtaken, en de bijlagen. Is de inhoud intussen weg, dan staat er "Deze inhoud bestaat niet meer" met de bewaarde
  titel.
- Bijlagen bekijken: een route alleen voor de beheerder (bijvoorbeeld `/admin/reports/:id/files/:attachmentId`) die
  een bestand geeft als het bij de gemelde taak (of haar subtaken, of de taken van de gemelde lijst) hoort. Met
  dezelfde veilige headers als de gewone bijlage-route (sandbox-CSP, download voor niet-afbeeldingen). Niets van de
  rest van Tick wordt voor de beheerder opengezet.
- De pagina's zijn door de server gemaakt, zoals `/privacy`, zonder inline scripts (CSP). Knoppen zijn formulieren
  met `POST` naar dezelfde pagina; een korte bevestiging voor de zware acties mag met een eigen script uit
  `public/` (builder). Teksten via `public/i18n.js`, in de taal van het verzoek.
- Acties (`POST /admin/reports/:id/…`), alleen beheerder, sessie, en een controle dat het verzoek van Tick zelf komt
  (de builder kijkt hoe Tick dat nu doet; het cookie is `SameSite=Lax`):
  - **Niets aan de hand**: `status = dismissed`.
  - **Inhoud verwijderen**: de gemelde taak (met subtaken) of de gemelde bijlage wordt definitief gewist, niet naar de
    prullenbak (anders zet de eigenaar hem terug). **Bestanden gaan overal weg** (Dio, 2026-11-08): een geaccepteerde
    kopie verwijst naar hetzelfde R2-object (`copyAttachmentStmt`), dus alle `attachments`-rijen met hetzelfde
    `r2_key` als de gewiste bijlage(n) verdwijnen, ook uit kopieën van anderen, en het R2-object wordt gewist. De tekst
    van die kopieën blijft staan (die is van de ontvangers). Bij een
    gemelde **lijst** is deze knop er niet; daar schors je of klik je "niets aan de hand". *(Mijn keuze: een hele lijst
    van iemand wissen is te grof.)* `status = removed`.
  - **Account schorsen**: zie hieronder. `status = suspended`. Andere open meldingen over hetzelfde account blijven
    open (Dio ziet ze in de lijst).
  - **Schorsing opheffen**: zet het account terug (alleen de schorsing; wat al verwijderd is komt niet terug).
- Een beheerder kan nooit geschorst worden (ook niet zichzelf).

### Schorsen

- `users.suspended_at TEXT` (NULL = niet geschorst).
- Bij schorsen, in één batch:
  - `suspended_at` zetten en de sessieversie ophogen (`bumpSessionVersionStmt`): alle sessies zijn meteen uit.
  - Al het delen met anderen stopt: deelrijen van en naar dit account (`task_shares`), lidmaatschappen van lijsten van
    anderen, leden van zijn eigen gedeelde lijsten (de lijst wordt weer gewoon zijn eigen lijst, zoals
    `dissolveStmts`), en zijn `email_invites`. De taken zelf blijven van de eigenaar.
- Een geschorst account:
  - kan niet inloggen. `/login` geeft voor een geschorst account met het **juiste** wachtwoord een eigen melding ("Dit
    account is geschorst. Neem contact op via *ADMIN_CONTACT*."); met een fout wachtwoord de gewone fout. Dat verraadt
    alleen iets aan wie het wachtwoord heeft. *(Mijn keuze.)*
  - kan niets met een API-sleutel of de Android-koppeling (de auth-middleware weigert `401`, net als bij een
    verwijderd account).
  - kan "wachtwoord vergeten" gebruiken, maar inloggen blijft geweigerd.
  - kan niet opnieuw een account met hetzelfde adres maken (dat geeft al `409`).
  - wordt niet als verwijderd behandeld: de taken blijven bewaard tot Dio het account verwijdert of de schorsing
    opheft.
- Delen **met** een geschorst account (iemand typt zijn adres): zoals bij blokkeren een `email_invites`-rij zonder
  mail, die nooit wordt omgezet.

### Blokkeren

- Tabel `blocks`: `user_id` (wie blokkeert), `blocked_id`, `created_at`, primaire sleutel op beide. Weg bij het
  verwijderen van een van beide accounts (`deleteUserStmts`).
- Blokkeren kan vanuit het meldscherm (vinkje, standaard aan) en los vanuit het menu van gedeelde inhoud of een
  uitnodiging ("Blokkeer *naam*", met bevestiging). Je kunt alleen iemand blokkeren die je kent: de afzender of
  eigenaar van iets dat met jou gedeeld is of was, of iemand uit `knownPeople`. Blokkeren op getypt e-mailadres kan
  niet (dat zou verraden welke adressen bestaan).
- Bij blokkeren, in één batch, voor het paar (jij, de ander):
  - Alle deelrijen tussen jullie weg, in beide richtingen (zijn taken bij jou, jouw taken bij hem), ook
    openstaande uitnodigingen.
  - Gedeelde lijsten: is een van jullie eigenaar en de ander lid, dan vertrekt het lid (`leaveListStmts`). Zitten
    jullie allebei als lid in de lijst van een derde, dan blijft dat zo. *(Mijn keuze: een blokkade mag de lijst van
    een ander niet slopen.)*
  - Zijn `email_invites` aan jouw adres weg.
- Zolang de blokkade staat:
  - Deelt hij met jouw adres (taak of lijst): Tick doet precies wat het doet bij een adres zonder account: een rij in
    `email_invites` (die hij ziet als openstaand, die een tweede keer `409` geeft en meetelt voor
    `FREE_SHARE_PEOPLE`), maar zonder uitnodigingsmail en zonder push. Omdat jouw account al bevestigd is, wordt die
    rij nooit omgezet; na 30 dagen verloopt hij. Zo is een blokkade niet te onderscheiden van een adres zonder account
    dat de mail negeert. *(Mijn keuze.)*
  - Deel jij met hem: hetzelfde. *(Mijn keuze: zo hoeft de app niets anders te tonen; de lijst geblokkeerde mensen
    staat in Instellingen.)*
  - Hij verschijnt niet in jouw `knownPeople`, en jij niet in de zijne.
  - Wordt een `email_invite` van hem omgezet als jouw account later bevestigd wordt: overslaan.
- **Instellingen › Account**: een blok "Geblokkeerde mensen" (alleen op een openbare Tick, alleen als er iemand
  geblokkeerd is) met naam en een knop "Deblokkeren". Deblokkeren haalt alleen de blokkade weg; wat opgezegd is,
  komt niet terug.
- API: `GET /api/blocks`, `POST /api/blocks` (met een verwijzing naar wat gedeeld werd of een id uit `knownPeople`),
  `DELETE /api/blocks/:userId`. Namen en paden kiest de builder.

### Melden in de app

- Een meldvenster (nieuwe module in `public/`, in `SHELL` in `public/sw.js`, `CACHE` ophogen): kop "*Titel* melden",
  vier keuzes voor de reden, een tekstveld "Toelichting (optioneel)", het vinkje "Blokkeer ook *naam*" (standaard
  aan), en "Melden". Na melden: een korte melding "Bedankt, we bekijken je melding" en de inhoud verdwijnt uit beeld.
- Plaatsen (alleen op een openbare Tick, alleen bij inhoud van een ander):
  - de uitnodigingen (taak en lijst) waar je nu accepteert of weigert;
  - het menu van een gedeelde taak in het detailpaneel;
  - het menu van een gedeelde lijst;
  - bij elke bijlage die een ander uploadde.
- `POST /api/reports` met wat er gemeld wordt (`share_id`, `task_id`, `list_id` of `attachment_id`), `reason`, `note`
  en `block`. De server bepaalt zelf wie de gemelde persoon is en of de melder toegang heeft; zonder toegang `404`.
- Het antwoord is altijd hetzelfde (`{ ok: true }`), ook boven de grens.

### Teksten

Alle teksten (app, beheerpagina, mail, foutmeldingen) in `public/i18n.js`, en en nl. Fouten als `HttpError` met een
sleutel.

### Privacy

- `/privacy` (op een openbare Tick): een melding bewaart wie meldde, wie gemeld werd, reden, toelichting en titel, en
  is alleen voor de beheerder te zien; een blokkade bewaart wie wie blokkeerde. Bewaartermijn van meldingen: zolang
  beide accounts bestaan; bij het verwijderen van een account gaan zijn meldingen (als melder en als gemelde) mee.
  *(Mijn keuze; de builder past `deleteUserStmts` aan.)*

## Tests

In de stijl van de bestaande tests (Vitest met de Workers-pool):

- Zonder `OPEN_SIGNUP`: `/api/reports`, `/api/blocks` en `/admin/reports` geven `404`.
- Melden van elke soort uit de tabel: rij in `reports` met de goede gemelde persoon, het delen voor de melder
  opgezegd, de bijlage nog aanwezig, één nagebootste Resend-aanroep aan de beheerder zonder bestand of bijlage-URL.
- Melden zonder toegang → `404`; eigen inhoud → `400`; boven de daggrens → `{ ok: true }` zonder rij en zonder mail.
- Blokkeren: alle delen tussen het paar weg (taken, lijsten als eigenaar/lid), lijst van een derde blijft; delen
  daarna in beide richtingen → zelfde antwoord als bij een onbekend adres, niets aangemaakt, geen mail of push;
  `knownPeople` zonder elkaar; deblokkeren.
- Beheerpagina en bijlage-route: gewone gebruiker → `403`, API-sleutel → `403`, niet ingelogd → doorsturen naar
  `/login`; de bijlage-route geeft alleen bestanden van de gemelde inhoud.
- Acties: verwijderen wist taak of bijlage definitief; schorsen logt uit, stopt al het delen, weigert inloggen met de
  eigen melding, weigert API-sleutels; opheffen laat weer inloggen; een beheerder schorsen kan niet.
- i18n en+nl gelijk; `SHELL` en `CACHE` in `public/sw.js` bijgewerkt.

## Docs

- `docs/`: een nieuwe pagina "Melden en blokkeren" (met een rij in `docs/README.md`), en de pagina's over delen en
  aanmelden verwijzen ernaar.
- `ARCHITECTURE.md`: `reports`, `blocks`, `suspended_at`, de beheerpagina.
- `/privacy`: zie hierboven.

## Live zetten

Zoals gebruikelijk: mergen naar `main`, migratie en deploy op beide Ticks, controleren met
`npx wrangler deployments list`. Op app.ticktodo.nl een echte melding testen met de testaccounts
(`ik+test1@koprust.nl` meldt iets van `ik+test2@koprust.nl`); Dio kijkt of de mail aankomt en de link werkt. Daarna
de testaccounts weer weg.

## Aan de builder overgelaten

Exacte teksten, de vormgeving van het meldvenster en de beheerpagina, namen van routes en functies, de exacte
daggrens voor meldingen, en hoe de bestaande deel-, vertrek- en verwijdercode het best hergebruikt wordt.
