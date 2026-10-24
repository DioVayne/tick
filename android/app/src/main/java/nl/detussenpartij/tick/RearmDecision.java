package nl.detussenpartij.tick;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Een locatiemelding is weggeveegd: mag de herinnering weer klaarstaan voor de volgende keer? Puur Java, zodat het
 * zonder toestel te testen is.
 */
final class RearmDecision {
    enum Result {
        /** Weer klaarzetten: location_notified terug op false en de geofence opnieuw. */
        REARM,
        /** Taak staat niet (meer) in de lijst met open taken. */
        GEEN_TAAK,
        /** Taak is af, of net afgevinkt in de widget of de melding. */
        AF,
        /** Taak heeft geen plek meer, of een andere dan die van de melding. */
        ANDERE_PLEK,
    }

    /** key: GeoPlan.key van de plek uit de melding. pending: taken die net afgevinkt zijn. */
    static Result decide(JSONArray tasks, String id, String key, JSONObject pending) {
        JSONObject task = NotifyDecision.find(tasks, id);
        if (task == null) return Result.GEEN_TAAK;
        if (task.optBoolean("done") || pending.has(id)) return Result.AF;
        JSONObject loc = task.optJSONObject("location");
        if (loc == null || !GeoPlan.key(loc).equals(key)) return Result.ANDERE_PLEK;
        return Result.REARM;
    }

    /**
     * De cache met location_notified = false voor deze taak, zodat Geo.applyFromCache de geofence meteen weer zet
     * (ook als de server het nog niet weet). Onleesbare cache blijft zoals hij is.
     */
    static String withNotifiedFalse(String cacheJson, String id) {
        try {
            JSONArray arr = new JSONArray(cacheJson);
            JSONObject task = NotifyDecision.find(arr, id);
            if (task == null) return cacheJson;
            task.put("location_notified", false);
            return arr.toString();
        } catch (Exception e) {
            return cacheJson;
        }
    }

    private RearmDecision() {}
}
