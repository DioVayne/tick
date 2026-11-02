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

    private QuickAddPlan() {}
}
