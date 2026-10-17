package nl.detussenpartij.tick;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

final class Sync {
    /** Zo lang blijft een afgevinkte taak zichtbaar (doorgestreept) en kun je hem nog terugzetten. */
    static final long UNDO_WINDOW_MS = PendingDecision.UNDO_WINDOW_MS;

    /** Haalt de lijst op (blokkeert, dus niet op de hoofdthread), bewaart hem en ververst de widgets. */
    static void refresh(Context c) {
        try {
            long fetchedFrom = System.currentTimeMillis();
            String json = Api.call(c, "GET", "/api/tasks", null);
            Map<String, JSONObject> open = new HashMap<>();
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) open.put(arr.getJSONObject(i).optString("id"), arr.getJSONObject(i));

            JSONObject pending = Prefs.pending(c);
            JSONObject remindThen = Prefs.pendingRemind(c);
            long now = System.currentTimeMillis();
            Iterator<String> keys = pending.keys();
            Set<String> drop = new HashSet<>();
            while (keys.hasNext()) {
                String id = keys.next();
                JSONObject t = open.get(id);
                String then = remindThen.has(id) ? remindThen.optString(id) : null;
                if (PendingDecision.clear(t != null, now - pending.optLong(id), then, remindAt(t))) drop.add(id);
            }
            if (!drop.isEmpty()) {
                for (String id : drop) {
                    pending.remove(id);
                    remindThen.remove(id);
                }
                Prefs.setPending(c, pending);
                Prefs.setPendingRemind(c, remindThen);
            }
            Prefs.setCache(c, json);
            Prefs.setSyncError(c, null);
            Prefs.setLastSync(c, System.currentTimeMillis());
            retryLocationNotified(c, arr, fetchedFrom);
            Geo.apply(c, arr, false);
            DeviceStatus.report(c);
        } catch (Exception e) {
            Log.w("Tick", "Verversen mislukt", e);
            // Zonder sleutel toont de widget daar al een melding over.
            if (!Prefs.token(c).isEmpty()) Prefs.setSyncError(c, c.getString(R.string.sync_failed, errorText(c, e)));
        }
        TaskWidgetProvider.updateAll(c);
    }

    /**
     * Locatiemeldingen die getoond zijn maar die de server nog niet kent: PATCH opnieuw proberen.
     * Is de taak weg, gewijzigd van plek of al gemeld op de server, dan hoeft de app het niet meer te onthouden.
     * Kende de server de melding al vóór deze GET en staat location_notified toch weer op false, dan is dezelfde
     * plek opnieuw gezet: dan ook vergeten, zodat hij weer kan afgaan.
     */
    private static void retryLocationNotified(Context c, JSONArray arr, long fetchedFrom) {
        JSONObject fired = Prefs.locFired(c);
        if (fired.length() == 0) return;
        JSONObject synced = Prefs.locSynced(c);
        Map<String, JSONObject> byId = new HashMap<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject t = arr.optJSONObject(i);
            if (t != null) byId.put(t.optString("id"), t);
        }
        Map<String, String> drop = new HashMap<>();
        Iterator<String> ids = fired.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject t = byId.get(id);
            JSONObject loc = t == null ? null : t.optJSONObject("location");
            boolean waiting = t != null && !t.optBoolean("done") && loc != null
                    && GeoPlan.key(loc).equals(fired.optString(id)) && !t.optBoolean("location_notified")
                    && !(synced.has(id) && synced.optLong(id) < fetchedFrom);
            if (!waiting) {
                drop.put(id, fired.optString(id));
                continue;
            }
            try {
                Api.call(c, "PATCH", "/api/tasks/" + Uri.encode(id), "{\"location_notified\":true}");
                Prefs.markLocSynced(c, id);
            } catch (Exception e) {
                Log.w("Tick", "location_notified opnieuw doorgeven mislukt", e);
            }
        }
        // Alleen weghalen wat er nog zo staat: de GeofenceReceiver kan intussen een nieuwe melding gezet hebben.
        if (!drop.isEmpty()) Prefs.dropLocFired(c, drop);
    }

    /** remind_at van een taak, of "" als hij er geen heeft (of de taak onbekend is). */
    static String remindAt(JSONObject t) {
        return t == null || t.isNull("remind_at") ? "" : t.optString("remind_at", "");
    }

    /** Korte, leesbare reden voor in de widget of een Toast. */
    static String errorText(Context c, Exception e) {
        String msg = e.getMessage();
        if (e instanceof IOException && msg != null && msg.startsWith("HTTP ")) return c.getString(R.string.error_server, msg.substring(5));
        return c.getString(R.string.error_offline);
    }

    private Sync() {}
}
