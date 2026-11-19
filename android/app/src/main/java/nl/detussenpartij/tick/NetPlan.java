package nl.detussenpartij.tick;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Het vangnet voor aankomstmeldingen. Android meldt een aankomst soms niet (of veel te laat). Daarom kijkt de app
 * elke 15 minuten zelf waar je bent: was je bij een eerdere keer duidelijk buiten de cirkel van een taak, en ben je er
 * nu binnen, dan geeft hij alsnog de melding. Ben je er al bij de eerste keer kijken, dan niet: net als een geofence
 * meldt het vangnet pas de volgende aankomst. Vertrekmeldingen laat het vangnet aan Android. Puur Java, zodat het
 * zonder toestel te testen is.
 */
final class NetPlan {
    /** Een minder nauwkeurige locatie (m) telt niet als "binnen". */
    static final double MAX_ACCURACY = 150;
    /** Zo ver (m) buiten de cirkel moet je minstens zijn om als "buiten" te tellen, of verder als de locatie grover is. */
    static final double OUTSIDE_MARGIN = 100;

    static final class Result {
        /** Request-ids van de plekken waar je net bent aangekomen (één per taak), voor GeofenceReceiver.handle. */
        final List<String> arrived = new ArrayList<>();
        /** Nieuwe stand: taak-id -> GeoPlan.key van de plek(ken) waar je buiten was en die nog niet meldde. */
        final JSONObject outside = new JSONObject();
        /** Aantal bewaakte taken (met een aankomstplek). */
        int tasks;
    }

    /**
     * fences: de aankomst- en vertrekplekken die nu klaarstaan (GeoPlan.select, zonder onderweg-vergroting).
     * outsideBefore: de stand van de vorige keer. lat/lng/accuracy: waar je nu bent (accuracy NaN als onbekend).
     */
    static Result check(List<GeoPlan.Fence> fences, JSONObject outsideBefore, double lat, double lng, double accuracy) {
        Result r = new Result();
        // Per taak al zijn aankomstplekken, in lijstvolgorde.
        Map<String, List<GeoPlan.Fence>> byTask = new LinkedHashMap<>();
        for (GeoPlan.Fence f : fences) {
            if (f.exit) continue;
            List<GeoPlan.Fence> list = byTask.get(f.id);
            if (list == null) byTask.put(f.id, list = new ArrayList<>());
            list.add(f);
        }
        r.tasks = byTask.size();
        boolean accurate = !Double.isNaN(accuracy) && accuracy <= MAX_ACCURACY;
        double slack = Math.max(OUTSIDE_MARGIN, Double.isNaN(accuracy) ? Double.POSITIVE_INFINITY : accuracy);
        for (Map.Entry<String, List<GeoPlan.Fence>> e : byTask.entrySet()) {
            String id = e.getKey();
            String key = e.getValue().get(0).key;
            boolean wasOutside = outsideBefore != null && key.equals(outsideBefore.optString(id, null));
            GeoPlan.Fence inside = null;
            boolean farFromAll = true;
            for (GeoPlan.Fence f : e.getValue()) {
                double dist = ArrivalStats.distanceM(f.lat, f.lng, lat, lng);
                if (accurate && dist <= f.radius && inside == null) inside = f;
                if (!(dist > f.radius + slack)) farFromAll = false;
            }
            if (inside != null) {
                if (wasOutside) r.arrived.add(GeoPlan.requestId(inside));
                // Binnen: niet meer als buiten bewaren (gemeld, of je was er al bij de eerste keer).
                continue;
            }
            // Tussen binnen en duidelijk buiten (of een grove locatie): de vorige stand houden.
            if (farFromAll || wasOutside) put(r.outside, id, key);
        }
        return r;
    }

    private static void put(JSONObject o, String id, String key) {
        try {
            o.put(id, key);
        } catch (Exception ignored) {
        }
    }

    private NetPlan() {}
}
