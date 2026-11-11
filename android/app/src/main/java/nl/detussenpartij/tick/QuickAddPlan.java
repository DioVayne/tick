package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Rekenwerk voor de snelle-taak-popup (QuickAddActivity), los van Android zodat het te testen is. */
final class QuickAddPlan {
    /** Tijd voor "Morgen" en "Volgende week", net als de standaardtijd van de webapp. */
    static final LocalTime DEFAULT_TIME = LocalTime.of(9, 0);

    /** Ritmes in de popup, met dezelfde regels als de snelkeuzes in public/repeat.js. */
    enum Repeat { NONE, DAILY, WEEKLY, BIWEEKLY, MONTHLY, YEARLY }

    private static final String[] CODES = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"};

    /** "Vandaag": het eerstvolgende hele uur, of null als dat al morgen is (na 23:00). */
    static LocalDateTime today(LocalDateTime now) {
        LocalDateTime at = now.plusHours(1).withMinute(0).withSecond(0).withNano(0);
        return at.toLocalDate().equals(now.toLocalDate()) ? at : null;
    }

    /**
     * De herinnering waarmee de popup begint. Vanuit de widget Vandaag het eerstvolgende hele uur (anders staat de taak
     * niet in die widget), na 23:00 meteen; anders geen. De popup toont hem altijd als regel, zodat hij niet verrast.
     */
    static LocalDateTime startReminder(boolean fromToday, LocalDateTime now) {
        if (!fromToday) return null;
        LocalDateTime t = today(now);
        return t != null ? t : now.withSecond(0).withNano(0);
    }

    /** Hoe de herinneringsregel de dag noemt: "vandaag", "morgen" of de datum. */
    enum Day { TODAY, TOMORROW, OTHER }

    static Day day(LocalDateTime now, LocalDateTime at) {
        LocalDate d = at.toLocalDate();
        LocalDate n = now.toLocalDate();
        if (d.equals(n)) return Day.TODAY;
        if (d.equals(n.plusDays(1))) return Day.TOMORROW;
        return Day.OTHER;
    }

    static LocalDateTime tomorrow(LocalDateTime now) {
        return now.toLocalDate().plusDays(1).atTime(DEFAULT_TIME);
    }

    /** "Volgende week": de eerste dag van de volgende week (firstDay: maandag of zondag, uit de locale). */
    static LocalDateTime nextWeek(LocalDateTime now, DayOfWeek firstDay) {
        return now.toLocalDate().with(TemporalAdjusters.next(firstDay)).atTime(DEFAULT_TIME);
    }

    /** De RRULE voor de server; start is de dag van de herinnering (of vandaag). null bij NONE. */
    static String rule(Repeat r, LocalDate start) {
        String day = CODES[start.getDayOfWeek().getValue() - 1];
        switch (r) {
            case DAILY: return "FREQ=DAILY";
            case WEEKLY: return "FREQ=WEEKLY;BYDAY=" + day;
            case BIWEEKLY: return "FREQ=WEEKLY;INTERVAL=2;BYDAY=" + day;
            case MONTHLY: return "FREQ=MONTHLY;BYMONTHDAY=" + start.getDayOfMonth();
            case YEARLY: return "FREQ=YEARLY";
            default: return null;
        }
    }

    /** Straal als de plek er zelf geen heeft, net als RADIUS_DEFAULT in src/location.ts. */
    static final int RADIUS_ENTER = 500;
    static final int RADIUS_EXIT = 200;
    /** MAX_LOC_NAME in src/location.ts. */
    static final int MAX_NAME = 100;

    /** Een plek voor de nieuwe taak. radius null: de standaard bij de gekozen trigger (500 m aankomst, 200 m vertrek). */
    static final class Place {
        final String name;
        final double lat, lng;
        final Integer radius;

        Place(String name, double lat, double lng, Integer radius) {
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radius = radius;
        }

        int radius(boolean exit) {
            return radius != null ? radius : exit ? RADIUS_EXIT : RADIUS_ENTER;
        }

        /** Het location-object voor POST /api/tasks. */
        JSONObject toJson(boolean exit) throws JSONException {
            return new JSONObject().put("name", name).put("lat", lat).put("lng", lng)
                    .put("radius", radius(exit)).put("trigger", exit ? "exit" : "enter");
        }
    }

    /** Naam van een zoekresultaat: het deel voor de eerste komma (zoals in public/map.js), hooguit MAX_NAME tekens. */
    static String shortName(String displayName) {
        String n = displayName == null ? "" : displayName.split(",")[0].trim();
        if (n.isEmpty()) n = displayName == null ? "" : displayName.trim();
        return n.length() > MAX_NAME ? n.substring(0, MAX_NAME).trim() : n;
    }

    /**
     * Plekken uit taken (de widgetcache), de laatst gewijzigde eerst, elke naam één keer en zonder de namen in skip
     * (de favorieten, die staan er al). Met hun eigen straal en trigger: wie "bij vertrek" koos, wil dat vaak weer.
     */
    static List<JSONObject> recentPlaces(JSONArray tasks, Iterable<String> skip, int max) {
        List<JSONObject> withLoc = new ArrayList<>();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            JSONObject loc = t == null ? null : t.optJSONObject("location");
            if (loc != null && !loc.optString("name").trim().isEmpty() && loc.has("lat") && loc.has("lng")) withLoc.add(t);
        }
        // ISO-tijden in UTC: als tekst sorteren is op tijd sorteren.
        withLoc.sort((a, b) -> b.optString("updated_at").compareTo(a.optString("updated_at")));
        List<String> seen = new ArrayList<>();
        for (String n : skip) seen.add(n.trim().toLowerCase(Locale.ROOT));
        List<JSONObject> out = new ArrayList<>();
        for (JSONObject t : withLoc) {
            JSONObject loc = t.optJSONObject("location");
            String key = loc.optString("name").trim().toLowerCase(Locale.ROOT);
            if (seen.contains(key)) continue;
            seen.add(key);
            out.add(loc);
            if (out.size() == max) break;
        }
        return out;
    }

    /**
     * De taak zoals de widget hem toont tot de server hem kent, uit de body van POST /api/tasks (met het eigen id van de
     * app). Een herinnering met ritme toont de server soms op een iets andere eerste keer; dat ziet de widget na de sync.
     */
    static JSONObject localTask(JSONObject body, String nowIso) throws JSONException {
        JSONObject t = new JSONObject();
        t.put("id", body.getString("id"));
        t.put("title", body.optString("title"));
        t.put("description", body.optString("description", ""));
        t.put("list", body.has("list") ? body.optString("list") : JSONObject.NULL);
        t.put("parent_id", JSONObject.NULL);
        t.put("remind_at", body.has("remind_at") ? body.optString("remind_at") : JSONObject.NULL);
        t.put("repeat", body.has("repeat") ? new JSONObject().put("rule", body.optString("repeat")) : JSONObject.NULL);
        t.put("location", body.has("location") ? body.getJSONObject("location") : JSONObject.NULL);
        t.put("pinned", false);
        t.put("done", false);
        t.put("created_at", nowIso);
        t.put("updated_at", nowIso);
        t.put("local", true);
        return t;
    }

    /** Hoe lang een concept blijft staan; een ouder concept is vergeten werk, geen per ongeluk gesloten popup. */
    static final long DRAFT_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000;

    /**
     * Wat er in de popup stond toen hij zonder toevoegen dichtging (terug, naast het paneel getikt, andere app). De
     * volgende keer komt het terug. Lijst en herinnering alleen als je die zelf koos: anders gelden die van de widget
     * waar je nu op tikt, zodat een concept uit de widget "Werk" niet stilletjes in "Boodschappen" belandt.
     */
    static final class Draft {
        String title = "";
        String notes = "";
        String list;
        /** De lijst is anders dan die waarmee de popup opende: dan wint hij ook in een andere widget. */
        boolean listChanged;
        LocalDateTime remindAt;
        /** Je koos of wiste de herinnering zelf (en liet niet de beginwaarde van de widget staan). */
        boolean remindChanged;
        Repeat repeat = Repeat.NONE;
        Place place;
        boolean placeOnExit;
        long savedAt;

        /** Alleen met tekst is er iets om te bewaren; losse keuzes zonder titel niet. */
        boolean worthKeeping() {
            return !title.trim().isEmpty() || !notes.trim().isEmpty();
        }

        /** Gebruikt het concept iets onder "Meer opties"? Dan gaat dat deel open. */
        boolean usesExtras() {
            return !notes.trim().isEmpty() || repeat != Repeat.NONE || place != null;
        }

        boolean expired(long nowMs) {
            return nowMs - savedAt > DRAFT_MAX_AGE_MS;
        }

        /** De lijst bij het terugzetten: de zelf gekozen lijst, anders die van de widget waar je nu op tikte. */
        String listFor(String openedWith) {
            return listChanged && list != null && !list.trim().isEmpty() ? list : openedWith;
        }

        /** De zelf gekozen herinnering blijft, tenzij hij inmiddels voorbij is; anders de beginwaarde van nu. */
        LocalDateTime remindFor(LocalDateTime openedWith, LocalDateTime now) {
            if (!remindChanged) return openedWith;
            if (remindAt == null) return null;
            return remindAt.isAfter(now) ? remindAt : openedWith;
        }

        /** Blijft de herinnering van het concept staan (dan telt hij weer als zelf gekozen)? */
        boolean keepsReminder(LocalDateTime now) {
            return remindChanged && (remindAt == null || remindAt.isAfter(now));
        }

        JSONObject toJson() throws JSONException {
            JSONObject j = new JSONObject().put("title", title).put("notes", notes)
                    .put("listChanged", listChanged).put("remindChanged", remindChanged)
                    .put("repeat", repeat.name()).put("placeOnExit", placeOnExit).put("savedAt", savedAt);
            if (list != null) j.put("list", list);
            if (remindAt != null) j.put("remindAt", remindAt.toString());
            if (place != null) {
                JSONObject p = new JSONObject().put("name", place.name).put("lat", place.lat).put("lng", place.lng);
                if (place.radius != null) p.put("radius", place.radius);
                j.put("place", p);
            }
            return j;
        }

        /** Een concept uit de voorkeuren; null als het leeg of onleesbaar is. */
        static Draft fromJson(String json) {
            if (json == null || json.isEmpty()) return null;
            try {
                JSONObject j = new JSONObject(json);
                Draft d = new Draft();
                d.title = j.optString("title", "");
                d.notes = j.optString("notes", "");
                d.list = j.has("list") ? j.optString("list") : null;
                d.listChanged = j.optBoolean("listChanged");
                d.remindAt = j.has("remindAt") ? LocalDateTime.parse(j.getString("remindAt")) : null;
                d.remindChanged = j.optBoolean("remindChanged");
                try {
                    d.repeat = Repeat.valueOf(j.optString("repeat", "NONE"));
                } catch (IllegalArgumentException e) {
                    d.repeat = Repeat.NONE;
                }
                JSONObject p = j.optJSONObject("place");
                if (p != null && p.has("lat") && p.has("lng")) {
                    d.place = new Place(p.optString("name"), p.getDouble("lat"), p.getDouble("lng"),
                            p.has("radius") ? p.getInt("radius") : null);
                }
                d.placeOnExit = j.optBoolean("placeOnExit");
                d.savedAt = j.optLong("savedAt");
                return d;
            } catch (Exception e) {
                return null;
            }
        }
    }

    private QuickAddPlan() {}
}
