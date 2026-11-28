package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

/**
 * Testfeature "condall" (src/condall.ts): een taak met een tijd en een plek in de stand "Pas als alles klopt"
 * (conditions = "all" in GET /api/tasks) meldt pas als je na de tijd op de plek bent. De tijd is dan een poort:
 * - vóór de tijd zet de app geen geofence voor de taak (GeoPlan slaat hem over) en meldt een late gebeurtenis niets
 *   (NotifyDecision.TE_VROEG);
 * - op de tijd (CondAllAlarm, een onnauwkeurige wekker, of de sync van elke 15 minuten) komt de geofence erbij; bij
 *   aankomst met initial trigger, zodat "je bent er al" ook meldt; bij vertrek zonder, dus alleen een echt vertrek.
 * Puur Java, zodat het zonder toestel te testen is. De server stuurt "all" alleen als de testfeature aanstaat.
 */
final class CondAll {
    /** Staat de taak op "Pas als alles klopt"? */
    static boolean all(JSONObject task) {
        return task != null && "all".equals(task.optString("conditions"));
    }

    /** remind_at in ms, of -1 als er geen (leesbare) tijd is. */
    static long gate(JSONObject task) {
        if (task == null || task.isNull("remind_at")) return -1;
        String at = task.optString("remind_at", "");
        if (at.isEmpty()) return -1;
        try {
            return Instant.parse(at).toEpochMilli();
        } catch (Exception e) {
            return -1;
        }
    }

    /** "Alles" en de tijd is er nog niet: nog niets bewaken of melden. */
    static boolean waiting(JSONObject task, long now) {
        return all(task) && gate(task) > now;
    }

    /** "Alles" en de tijd is voorbij: de plek wordt nu bewaakt; bij aankomst met initial trigger. */
    static boolean open(JSONObject task, long now) {
        if (!all(task)) return false;
        long g = gate(task);
        return g >= 0 && g <= now;
    }

    /**
     * De eerstvolgende poort van een open taak met een plek die nog moet melden, of -1. Daarop zet CondAllAlarm de
     * geofences opnieuw.
     */
    static long next(JSONArray tasks, long now) {
        long best = -1;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null || t.optBoolean("done") || t.optBoolean("location_notified") || t.optJSONObject("location") == null) continue;
            if (!waiting(t, now)) continue;
            long g = gate(t);
            if (best < 0 || g < best) best = g;
        }
        return best;
    }

    private CondAll() {}
}
