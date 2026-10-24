package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Metingen van locatiemeldingen: hoe ver je van het midden van de plek was toen hij afging. Daaruit volgt hoe laat
 * meldingen komen. Alleen afstanden, snelheden en tijden, nooit coördinaten. Puur Java, zodat het zonder toestel te
 * testen is.
 */
final class ArrivalStats {
    /** Zoveel metingen blijven bewaard; oudere vallen eraf. */
    static final int KEEP = 30;

    private static final double EARTH_M = 6371008.8;

    /** Afstand in meters tussen twee punten (haversine). */
    static double distanceM(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /**
     * Eén meting. mode: "" (niet onderweg), "car" of "bike". radius: ingestelde straal; usedRadius: de straal van de
     * geofence die afging (groter als hij onderweg vergroot was). speed (m/s) en accuracy (m) mogen null zijn.
     */
    static JSONObject measurement(long at, boolean exit, String mode, double radius, double usedRadius, double distance,
                                  Double speed, Double accuracy, long ageMs) {
        JSONObject m = new JSONObject();
        try {
            m.put("at", at).put("exit", exit).put("mode", mode == null ? "" : mode).put("radius", radius)
                    .put("used", usedRadius).put("dist", distance).put("age", ageMs);
            if (speed != null) m.put("speed", speed);
            if (accuracy != null) m.put("acc", accuracy);
        } catch (Exception ignored) {
            // alleen bij NaN/oneindig; dan ontbreekt dat veld
        }
        return m;
    }

    /**
     * Meting uit de locatie waarop de geofence afging, of null als die er niet was. De coördinaten van de fix gaan
     * alleen de afstandsberekening in en worden niet bewaard.
     */
    static JSONObject fromFix(long now, boolean exit, String mode, double centerLat, double centerLng, double radius,
                              double usedRadius, Double fixLat, Double fixLng, Double speed, Double accuracy, Long fixTime) {
        if (fixLat == null || fixLng == null) return null;
        double dist = distanceM(centerLat, centerLng, fixLat, fixLng);
        return measurement(now, exit, mode, radius, usedRadius, dist, speed, accuracy, fixTime == null ? 0 : now - fixTime);
    }

    /** Voegt een meting toe en houdt de laatste KEEP over. Onleesbare opslag telt als leeg. */
    static String add(String json, JSONObject m) {
        JSONArray old = parse(json);
        JSONArray out = new JSONArray();
        for (int i = Math.max(0, old.length() + 1 - KEEP); i < old.length(); i++) out.put(old.opt(i));
        out.put(m);
        return out.toString();
    }

    /** Hoeveel meter je al binnen de ingestelde cirkel was; negatief als de melding vóór de rand kwam. */
    static double late(JSONObject m) {
        return m.optDouble("radius") - m.optDouble("dist");
    }

    static final class Summary {
        /** Aantal aankomstmetingen; 0 als er geen zijn. */
        int count;
        /** Gemiddeld "te laat" (m) over die metingen. */
        double avgLate;
    }

    /** Samenvatting van de aankomsten (vertrek telt niet mee); mode null: alle soorten, anders alleen die soort. */
    static Summary summary(String json, String mode) {
        JSONArray arr = parse(json);
        Summary s = new Summary();
        double total = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject m = arr.optJSONObject(i);
            if (m == null || m.optBoolean("exit")) continue;
            if (mode != null && !mode.equals(m.optString("mode"))) continue;
            double late = late(m);
            if (Double.isNaN(late)) continue;
            total += late;
            s.count++;
        }
        if (s.count > 0) s.avgLate = total / s.count;
        return s;
    }

    private static JSONArray parse(String json) {
        if (json == null) return new JSONArray();
        try {
            return new JSONArray(json);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private ArrivalStats() {}
}
