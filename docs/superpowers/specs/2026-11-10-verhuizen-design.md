# Verhuizen naar een andere Tick — ontwerp

Datum: 2026-11-10. Dio: "Alles zo compleet en gebruikersvriendelijk mogelijk. Jij weet wat hierin het beste is."
De keuzes hieronder zijn dus van Claude, niet door Dio één voor één besloten.

## Waarom

Taken delen werkt alleen binnen één server (geen federatie). Dio wil zelfhosters niet vragen om ook een account op
app.ticktodo.nl te nemen. Wie van app.ticktodo.nl naar een eigen Tick wil (eigen Worker + D1 op een gratis
Cloudflare-account), of andersom, moet zijn hele account kunnen meenemen.

## Doelen

1. Verhuizen in beide richtingen tussen twee willekeurige Ticks, zonder bestanden te downloaden en te uploaden.
2. Alles wat van jou is gaat mee: taken (open, afgevinkt en in de prullenbak), subtaken, notities, herinneringen,
   herhalingen, locatie bij een taak, vastgepind, plekken, bijlagen (de bestanden zelf), achtergrondfoto,
   instellingen, lege lijsten, lijsten die je overslaat in de Tickmanager, gekoppelde agenda's.
3. Taken die met jou gedeeld zijn en taken in gedeelde lijsten komen mee als jouw eigen taak, in jouw lijst.
4. Je ziet vooraf wat er meekomt, tijdens het verhuizen een voortgang, en na afloop wat je nog zelf moet doen.
5. Opnieuw verhuizen (na een fout of onderbreking) maakt geen dubbele taken.

## Niet-doelen

- Delen tussen servers (federatie).
- Het oude account automatisch verwijderen. Dat doe je zelf, als je hebt gecontroleerd dat alles er is.
- Wachtwoord, sleutels, gekoppelde telefoons, pushabonnementen, uitnodigingen, blokkades en meldingen: die horen bij
  een server en gaan niet mee.
- De back-upknop (bestand) verandert niet.

## Anti-doelen

- Een verhuizing die stilletjes iets kwijtraakt (bijlagen zonder bestandsopslag, gedeelde taken): wat niet mee kan,
  staat in het overzicht.
- Iemand anders kan met een gelekte code je gegevens ophalen nadat je klaar bent: de code verloopt na een uur en een
  nieuwe code maakt de vorige ongeldig.
- Een verhuizing die taken van een ander account op de nieuwe server overschrijft.

## Hoe de gebruiker het doet

1. Op de **oude** Tick: Instellingen › Gegevens › **Verhuizen naar een andere Tick** › *Verhuiscode maken*. Je ziet
   één regel (de verhuiscode) met een kopieerknop en drie stappen. De code is een uur geldig.
2. Op de **nieuwe** Tick (inloggen of eerst een account maken): Instellingen › Gegevens › **Verhuizen hierheen** ›
   *Code plakken*. Tick laat zien van welke Tick en welk account, en wat er meekomt (aantallen). Ook: "Gedeelde
   taken komen mee als je eigen taak; het delen stopt" en "Niets op deze Tick wordt verwijderd".
3. *Verhuizen*: eerst de taken en de rest, dan de bijlagen één voor één met een teller.
4. Klaar-scherm: wat er is gekomen, wat niet, en de stappen voor daarna: telefoon op het nieuwe adres zetten
   (Telefooninstellingen › Adres wijzigen), controleren, en daarna eventueel het oude account verwijderen.

## Hoe het werkt

### De code

- Tabel `move_codes` (migratie `0025_verhuiscode.sql`): `id`, `user_id`, `hash` (SHA-256 van het geheim, uniek),
  `created_at`, `expires_at`. Een nieuwe code van dezelfde persoon wist zijn oude.
- De verhuiscode is één URL: `https://oude.tick/api/move/<geheim>`. Zo hoeft de gebruiker maar één ding te kopiëren
  en weet de nieuwe server meteen waar hij moet zijn. Het geheim is 32 willekeurige bytes (zoals een sleutel).
- Een uur geldig en binnen dat uur vaker te gebruiken (de nieuwe server haalt per bijlage apart op).

### Oude server: uitlezen (zonder inlog, met de code)

Routes vóór de inlogcontrole, zoals `/api/pair/redeem`. Een onbekende of verlopen code telt mee in `LOGIN_LIMITER`
(per IP); een goede code niet, want de nieuwe server doet veel verzoeken.

- `GET /api/move/:secret`: het pakket (JSON, `app: 'tick', kind: 'move', version: 1`):
  - `account`: naam, `source`: het adres van de oude Tick;
  - `tasks`: alles wat je ziet (`visibleTasks`), ook afgevinkt en in de prullenbak (`deleted_at`). Gedeelde taken met
    jouw lijst, volgorde en pin (`overlay`); `shared: 1` bij taken van een ander;
  - `places`, `lists` (lege lijsten), `review_skip` (namen van lijsten), `settings` (een vaste lijst sleutels);
  - `calendars`: naam en het ontsleutelde adres. Het adres gaat alleen over https en alleen met de code;
  - `attachments`: de gegevens van de bijlagen (niet de bytes), `background`: of er een achtergrondfoto is.
- `GET /api/move/:secret/file/:id`: de bytes van één bijlage, alleen als die bij een taak uit het pakket hoort.
- `GET /api/move/:secret/background`: de achtergrondfoto.

### Nieuwe server: binnenhalen (met inlog)

- `POST /api/move/preview {code}`: haalt het pakket en geeft aantallen terug (voor het venster vooraf).
- `POST /api/move/import {code}`: haalt het pakket en schrijft alles in één keer (in batches). Geeft de lijst
  bijlagen terug die nog opgehaald moeten worden (`files: [{ id, size }]`).
- `POST /api/move/file {code, id}`: haalt één bijlage op en zet hem in R2. Bestaat de rij al, dan niets.
- `POST /api/move/background {code}`: haalt de achtergrondfoto op.

De browser stuurt de bestanden één voor één. Zo blijft elk Worker-verzoek klein (gratis plan: 50 subrequests en
weinig CPU per verzoek) en ziet de gebruiker de voortgang.

### Samenvoegen en ids

- Samenvoegen zoals de back-up: bestaat een id al bij jou, dan wordt hij bijgewerkt; er wordt niets gewist.
- Is een id op de nieuwe server van een ander account (bijv. terugverhuizen terwijl het oude account nog bestaat),
  dan krijgt het een nieuw id dat vast afhangt van jouw account en het oude id (SHA-256). Opnieuw verhuizen geeft dus
  hetzelfde id en geen dubbele taak. Subtaken en bijlagen volgen hun ouder.
- Plekken met een naam die je al hebt: overslaan (zoals de back-up).
- Een herinnering die al voorbij is telt als gemeld (geen stoot oude meldingen), zoals de back-up.
- Hoofdtaken in een lijst die op de nieuwe server een gedeelde lijst van je is, komen in die lijst (`attachImported`).
- Agenda's: nieuw versleuteld met de sleutel van de nieuwe server; een adres dat je al hebt wordt overgeslagen; hooguit
  10. De volgende keer dat de app opent (of de cron) worden ze opgehaald.

### Wat niet kan

- Nieuwe server zonder bestandsopslag (R2, `FILES`): bijlagen en achtergrondfoto gaan niet mee; het venster vooraf
  en het overzicht zeggen hoeveel. De gegevens van de taak komen wel.
- Een bijlage boven de grootste bijlage (`MAX_UPLOAD_MB`) of boven je opslag (`MAX_ACCOUNT_MB`) op de nieuwe server:
  overgeslagen en geteld.
- Agenda's als `CALENDAR_FEEDS` uit staat op de nieuwe server: overgeslagen en geteld.
- Een oude Tick zonder deze functie: melding "werk die Tick eerst bij".

### Veiligheid

- De nieuwe server haalt alleen `https://…/api/move/…` op (http alleen voor localhost), met een time-out, en hooguit
  50 MB voor het pakket.
- Het geheim staat nooit in een log of antwoord van de nieuwe server.
- Alleen met een sessie (geen API-sleutel) kun je een code maken of verhuizen.

## Play

De Android-app laadt de PWA van de server; er verandert niets in `android/`. Geen Play-release nodig. Geen nieuwe
gegevenssoort voor Data safety: het gaat om dezelfde gegevens, op verzoek van de gebruiker naar een server die hij
zelf kiest.
