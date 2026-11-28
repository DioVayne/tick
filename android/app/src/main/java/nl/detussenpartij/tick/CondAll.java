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
 * Met een Home Assistant-trigger erbij (sinds 1.15.8) staat ook "trigger_at" in de taak: wanneer de trigger deze keer
 * afging, of null als nog niet. De poort is dan de laatste van tijd en trigger (een taak zonder tijd: alleen de
 * trigger); nog geen trigger = de poort is dicht. De server kan de app niet wekken: de app hoort van de trigger bij de
 * volgende sync (elke ~15 minuten, of bij openen); daarna zet Geo de geofence (aankomst met initial trigger).
 * Puur Java, zodat het zonder toestel te testen is. De server stuurt "all" alleen als de testfeature aanstaat.
 */
final class CondAll {
    /** Staat de taak op "Pas als alles klopt"? */
    static boolean all(JSONObject task) {
        return task != null && "all".equals(task.optString("conditions"));
    }

    /** Poort die nooit opengaat: plek + trigger en de trigger ging (nog) niet af. */
    static final long NEVER = Long.MAX_VALUE;

    /** Heeft de taak ook een Home Assistant-trigger als voorwaarde (veld "trigger_at", ook als het null is)? */
    static boolean withTrigger(JSONObject task) {
        return task != null && task.has("trigger_at");
    }

    /**
     * De poort in ms: remind_at, met een trigger erbij de laatste van remind_at en trigger_at (NEVER zolang de trigger
     * niet afging). -1 als er geen poort is (geen leesbare tijd en geen trigger).
     */
    static long gate(JSONObject task) {
        long time = ms(task, "remind_at");
        if (!withTrigger(task)) return time;
        long trigger = ms(task, "trigger_at");
        if (trigger < 0) return NEVER;
        return Math.max(time, trigger);
    }

    /** Een ISO-tijd uit de taak in ms, of -1 als hij er niet (leesbaar) is. */
    private static long ms(JSONObject task, String field) {
        if (task == null || task.isNull(field)) return -1;
        String at = task.optString(field, "");
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
            if (g == NEVER) continue; // wacht op de trigger: daarvoor zorgt de sync, geen wekker
            if (best < 0 || g < best) best = g;
        }
        return best;
    }

    private CondAll() {}
}
