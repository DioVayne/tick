package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

/** Moet een afgegane geofence een melding geven? Puur Java, zodat het zonder toestel te testen is. */
final class NotifyDecision {
    enum Result {
        /** Melding tonen. */
        MELDEN,
        /** Taak staat niet (meer) in de lijst met open taken: afgerond of verwijderd. */
        GEEN_TAAK,
        /** Taak is af, of net afgevinkt in de widget. */
        AF,
        /** De server kent de melding voor deze plek al. */
        AL_GEMELD,
        /** Taak heeft geen plek meer, of een andere dan die van de geofence. */
        ANDERE_PLEK,
        /** Deze plek gaf op dit toestel al een melding. */
        AL_AFGEGAAN,
        /** Aankomst bij een vertrek-plek of andersom. */
        ANDERE_RICHTING,
    }

    /**
     * tasks: open taken (vers van de server, of de cache als dat niet lukte).
     * fenceKey: GeoPlan.key van de plek waarvoor de geofence gezet is, of null als onbekend (oudere geofence).
     * fired: taak-id -> key van een plek die al afging. pending: taken die net in de widget afgevinkt zijn.
     */
    static Result decide(JSONArray tasks, String id, String fenceKey, boolean exitEvent, JSONObject fired, JSONObject pending) {
        JSONObject task = find(tasks, id);
        if (task == null) return Result.GEEN_TAAK;
        if (task.optBoolean("done") || pending.has(id)) return Result.AF;
        if (task.optBoolean("location_notified")) return Result.AL_GEMELD;
        JSONObject loc = task.optJSONObject("location");
        if (loc == null) return Result.ANDERE_PLEK;
        String key = GeoPlan.key(loc);
        if (fenceKey != null && !fenceKey.equals(key)) return Result.ANDERE_PLEK;
        if (key.equals(fired.optString(id, null))) return Result.AL_AFGEGAAN;
        if (exitEvent != GeoPlan.isExit(loc)) return Result.ANDERE_RICHTING;
        return Result.MELDEN;
    }

    static JSONObject find(JSONArray tasks, String id) {
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t != null && id.equals(t.optString("id"))) return t;
        }
        return null;
    }

    private NotifyDecision() {}
}
