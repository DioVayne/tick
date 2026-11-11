package nl.detussenpartij.tick;

import org.json.JSONObject;

/**
 * Body van POST /api/tasks/:id/done en /reopen vanuit de widget of een melding. Bij een herhalende taak gaat de keer
 * mee die de widget toonde (`occurrence`): is de taak intussen elders al afgevinkt, dan schuift de server hem niet nog
 * een keer door. Ongedaan maken noemt dezelfde afvinkactie (`action` / `undo`), zodat de server precies die stap
 * terugdraait. Het actie-id volgt uit het moment van de tik, dat al in Prefs.pending staat.
 */
final class TickBody {
    private TickBody() {}

    static String action(long tickedAt) {
        return "android-" + tickedAt;
    }

    /** Afvinken van `task` (uit de cache; mag null zijn). */
    static String done(JSONObject task, long tickedAt) {
        JSONObject b = new JSONObject();
        try {
            JSONObject repeat = task == null || task.isNull("repeat") ? null : task.optJSONObject("repeat");
            String at = repeat == null || repeat.isNull("at") ? "" : repeat.optString("at", "");
            if (!at.isEmpty()) b.put("occurrence", at);
            b.put("action", action(tickedAt)); // de server bewaart het alleen bij een herhalende taak
        } catch (Exception e) {
            return "{}";
        }
        return b.toString();
    }

    /** Ongedaan maken van de tik op `tickedAt`. */
    static String reopen(long tickedAt) {
        JSONObject b = new JSONObject();
        try {
            if (tickedAt > 0) b.put("undo", action(tickedAt));
        } catch (Exception e) {
            return "{}";
        }
        return b.toString();
    }
}
