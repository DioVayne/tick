# Meerdere plekken per taak

Datum: 2026-11-11. Status: gebouwd.

## Wat en waarom
Een taak kan nu meer dan één plek hebben, bijvoorbeeld de drie Albert Heijns die je gebruikt. Er komt **één melding**: bij de eerste van die plekken waar je aankomt (of die je verlaat). Dit is de veilige tussenweg in plaats van "bij elke supermarkt": je kiest de plekken zelf, er wordt niets op de achtergrond opgezocht, er gaat geen locatie naar een server en de telefoon bewaakt alleen een paar cirkels extra. De belofte blijft kloppen: *Tick weet niet waar je bent; je telefoon let zelf op je plekken.*

## Keuzes
- **Hooguit 10 plekken per taak** (`MAX_PLACES`, server en web-app). Genoeg voor "mijn winkels", en er passen dan altijd minstens 10 taken in de ~100 plekken die Android per app bewaakt.
- **Eén trigger voor de hele taak** (aankomst of vertrek). Een straal per plek (een grote winkel aan de ringweg mag een grotere cirkel hebben).
- **Eén melding per taak.** `location_notified` blijft per taak en per persoon; de eerste plek die afgaat, maakt hem op. Wegvegen of *Opnieuw melden* zet alle plekken weer klaar.
- **Geen achtergrond-zoeken, geen "categorie" (alle AH's).** Je voegt elke plek zelf toe, met zoeken, een favoriet of de kaart.

## Datamodel
Migratie `0027_meerdere_plekken.sql`: `ALTER TABLE tasks ADD COLUMN loc_more TEXT`.
- De **eerste plek** blijft in `loc_name`, `loc_lat`, `loc_lng`, `loc_radius`, `loc_trigger`. Zo werken oudere apps (en oudere back-ups) gewoon met die ene plek.
- De **andere plekken** staan als JSON in `loc_more`: `[{ name, lat, lng, radius }]`, of `NULL` bij één plek. Gecontroleerd zoals de eerste plek (naam 1-100, lat/lng, straal 200-2000).
- Waarom een kolom en geen tabel: de plekken horen altijd bij precies één taak, worden altijd samen gelezen en geschreven (`location` vervangt alles), en gaan zo vanzelf mee in kopieën, back-ups en verhuizen zonder extra queries. Een kapotte waarde maakt de taak niet stuk: dan telt alleen de eerste plek.

## API
- `location` in `GET`/`POST`/`PATCH /api/tasks`: `{ name, lat, lng, radius, trigger, more? }`. `more` is een lijst van hooguit 9 `{ name, lat, lng, radius? }` (zonder straal: de standaard van de trigger). Een lege lijst = één plek. `GET` geeft `more` alleen als er extra plekken zijn, dus een taak met één plek ziet er precies hetzelfde uit als vroeger.
- `PATCH location` vervangt alle plekken; zonder `more` blijft alleen de eerste over.
- Fouten: meer dan 9 extra plekken → 400 `err.too_many_places` (`{max: 10}`); een ongeldige extra plek → 400 zoals bij de eerste plek (`location.more.N.lat` enz.).
- Elke plekwijziging zet `location_notified` terug voor iedereen (zoals altijd). De push "X gaf een gedeelde taak een plek" gaat alleen bij een echt andere ligging (ook van een extra plek), niet bij een nieuwe naam.
- Kopie accepteren, back-up (`loc_more` in de export; bij terugzetten opnieuw gecontroleerd) en verhuizen nemen alle plekken mee. MCP toont "arriving at A, B or C".

## Web-app (UI)
Bewust klein gehouden; het kaartscherm blijft één scherm:
- De pin is de plek die je nu kiest. Nieuwe knop **+ Nog een plek**: de pin gaat in de lijst **Ook bij** (chips met ✕), en je schuift de kaart naar de volgende plek. De andere plekken staan als lichte, gestippelde cirkels op de kaart.
- Een chip aantikken zet die plek onder de pin (om hem te verschuiven of de straal te wijzigen); ✕ haalt hem weg.
- **Gebruik deze plek(ken)** bewaart de pin plus de lijst. Staat de pin nog precies waar hij bij *+ Nog een plek* stond, dan telt hij niet dubbel.
- Wie maar één plek wil, merkt niets: kiezen en *Gebruik deze plek* werkt zoals altijd.
- Een notitie bij meerdere plekken: "Eén melding, bij de eerste van deze plekken waar je aankomt."
- Taakscherm: alle namen en "3 plekken" in plaats van de straal. Lijstregel en invoerkaart: "AH Centrum +2". Rijmodus: de dichtstbijzijnde plek telt (en die naam staat erbij).
- Waarschuwing in het kaartscherm als je open taken samen meer dan 100 plekken hebben.

## Android-app
Ja, er is een **nieuwe Android-build** nodig: de huidige app leest alleen de eerste plek (die blijft dus werken, maar meldt alleen daar).
- `GeoPlan`: elke plek een eigen geofence. Request-id: `taak-id#key` voor de eerste plek (het oude formaat), `taak-id#key/N` voor plek N, eventueel met `@car:straal` erachter.
- `GeoPlan.key` (de "welke plek"-sleutel van een taak, gebruikt in `locFired`, wegvegen en opnieuw melden): met één plek precies als vroeger; met meer plekken `m` plus een FNV-1a-hash (16 hex) over alle plekken, zodat de request-id onder de 100 tekens blijft.
- `GeofenceReceiver`: de melding noemt de plek die afging ("Aangekomen bij AH Noord"), de meting (hoe ver binnen de cirkel) gebruikt die plek, en daarna gaan **alle** geofences van de taak weg. Twee plekken van dezelfde taak tegelijk geven één melding.
- "Op tijd melden onderweg": de vergrote straal is per plek (`taak-id/N` in de onderweg-stralen).
- Snel toevoegen via de widget maakt nog steeds één plek; meer plekken voeg je toe in de app.

## De grens van ~100 plekken
Android bewaakt per app hooguit 100 geofences. Tick vult ze in lijstvolgorde (zoals `GET /api/tasks` ze geeft):
- Een taak krijgt **al zijn plekken of geen**; een taak die niet meer past, wordt overgeslagen en een latere taak met minder plekken kan er nog wel bij.
- Taken die al gemeld zijn of af zijn, tellen niet mee.
- Het scherm **Tick op deze telefoon** zegt hoeveel taken met een plek nu niet bewaakt worden.
- Het kaartscherm in de web-app waarschuwt als je open taken samen boven de 100 plekken komen.

## Gedeelde taken
Ongewijzigd principe: iedereen die meedoet, krijgt een eigen melding (eigen `loc_notified` in de deelrij), bij de eerste van de plekken waar híj aankomt. Elke telefoon bewaakt alle plekken van de taak.

## Privacy
Niets nieuws gaat naar de server: de plekken zijn dezelfde soort gegevens als de ene plek die er al was (door jou gekozen), en de telefoon meldt alleen *dat* er een melding was (`location_notified`), niet bij welke plek. Geen wijziging in de Data safety van Google Play.
