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
import java.util.List;
import java.util.Map;
import java.util.Set;

final class Sync {
    /** Zo lang blijft een afgevinkte taak zichtbaar (doorgestreept) en kun je hem nog terugzetten. */
    static final long UNDO_WINDOW_MS = PendingDecision.UNDO_WINDOW_MS;

    /**
     * Verzoeken die de server iets laten wijzigen (de wachtrij, Outbox) gaan een voor een: zo komt Ongedaan maken nooit
     * voor het afvinken aan, en een afvinktik op een offline toegevoegde taak nooit voor het toevoegen.
     */
    static final Object NET = new Object();

    /** Haalt de lijst op (blokkeert, dus niet op de hoofdthread), bewaart hem en ververst de widgets. */
    static void refresh(Context c) {
        refresh(c, false, true);
    }

    /**
     * Eerst de wachtrij versturen (force: ook wat nog even zou wachten, omdat de gebruiker erom vroeg), dan de lijst
     * ophalen. scheduleFlush: blijft er iets in de wachtrij, dan een job plannen die het opnieuw probeert (false in die
     * job zelf: een nieuwe job met hetzelfde id zou hem stoppen).
     */
    static void refresh(Context c, boolean force, boolean scheduleFlush) {
        if (!Prefs.token(c).isEmpty()) {
            flush(c, force);
            if (scheduleFlush) scheduleFlush(c);
        }
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
            // Een afvinktik die nog in de wachtrij staat: de taak blijft verborgen tot de server hem heeft.
            Set<String> queued = Outbox.doneIds(Prefs.outbox(c));
            while (keys.hasNext()) {
                String id = keys.next();
                if (queued.contains(id)) continue;
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
            // Eerst weggeveegde meldingen: die zetten location_notified in arr (en de cache) terug op false.
            if (retryRearm(c, arr, pending)) json = arr.toString();
            saveServerList(c, json);
            Prefs.setSyncError(c, null);
            Prefs.setLastSync(c, System.currentTimeMillis());
            retryLocationNotified(c, arr, fetchedFrom);
            Geo.apply(c, arr, false);
            DeviceStatus.report(c);
        } catch (Exception e) {
            Log.w("Tick", "Verversen mislukt", e);
            // Zonder sleutel toont de widget daar al een melding over.
            if (!Prefs.token(c).isEmpty()) Prefs.setSyncError(c, c.getString(R.string.sync_failed, errorText(c, e)), isOffline(e));
        }
        TaskWidgetProvider.updateAll(c);
    }

    /**
     * Bewaart de lijst van de server als cache, maar net afgevinkte taken (nog in het ongedaan-venster) blijven zoals
     * en waar ze stonden, zodat de widget niet onder je vinger verschuift. Zie UndoPlan.merge.
     */
    static void saveServerList(Context c, String json) {
        try {
            java.util.Set<String> held = UndoPlan.held(Prefs.pending(c), System.currentTimeMillis());
            if (!held.isEmpty()) {
                json = UndoPlan.merge(new JSONArray(Prefs.cache(c)), new JSONArray(json), held).toString();
            }
        } catch (Exception e) {
            Log.w("Tick", "Vasthouden van afgevinkte taken mislukt", e);
        }
        try {
            // Offline toegevoegde taken die de server nog niet kent, blijven zichtbaar.
            JSONArray ops = Prefs.outbox(c);
            if (ops.length() > 0) json = Outbox.withLocal(new JSONArray(json), ops).toString();
        } catch (Exception e) {
            Log.w("Tick", "Toegevoegde taken uit de wachtrij tonen mislukt", e);
        }
        Prefs.setCache(c, json);
    }

    /** Zet een wijziging in de wachtrij; een job vangt hem op als de app stopt voordat hij weg is. */
    static void enqueue(Context c, JSONObject op) {
        synchronized (Prefs.class) {
            JSONArray ops = Prefs.outbox(c);
            Outbox.add(ops, op);
            Prefs.setOutbox(c, ops);
        }
        SyncJob.flushLater(c, 60_000);
    }

    /**
     * Verstuurt de wachtrij, item voor item in volgorde (blokkeert). Stopt bij geen verbinding; een serverfout laat
     * alleen die taak wachten; een afwijzing (4xx) gooit het item weg, met een korte melding in de widget.
     */
    static void flush(Context c, boolean force) {
        synchronized (NET) {
            Set<String> skip = new HashSet<>();
            while (!Prefs.token(c).isEmpty()) {
                JSONObject op;
                synchronized (Prefs.class) {
                    JSONArray ops = Prefs.outbox(c);
                    op = Outbox.next(ops, System.currentTimeMillis(), force, skip);
                    if (op == null) break;
                    Outbox.markSending(ops, op.optString("k"), true);
                    Prefs.setOutbox(c, ops);
                }
                String id = op.optString("id");
                String res = null;
                int code;
                try {
                    res = Api.call(c, "POST", Outbox.path(op, Uri.encode(id)), op.optString("body"));
                    code = 200;
                } catch (IOException e) {
                    code = Outbox.httpCode(e.getMessage());
                    Log.w("Tick", "Wachtrij: " + op.optString("op") + " " + id + " mislukt", e);
                }
                Outbox.Outcome outcome = Outbox.outcome(code);
                List<JSONObject> removed;
                synchronized (Prefs.class) {
                    JSONArray ops = Prefs.outbox(c);
                    removed = Outbox.settle(ops, op.optString("k"), outcome, System.currentTimeMillis());
                    Prefs.setOutbox(c, ops);
                }
                if (outcome == Outbox.Outcome.SENT) {
                    sent(c, op, res);
                } else if (outcome == Outbox.Outcome.DROPPED) {
                    dropped(c, removed, code);
                } else if (outcome == Outbox.Outcome.RETRY) {
                    skip.add(id);
                } else {
                    break; // geen verbinding, of de sleutel geldt niet meer
                }
            }
        }
    }

    /** Plant de job die de wachtrij later opnieuw probeert, of haalt hem weg als de wachtrij leeg is. */
    static void scheduleFlush(Context c) {
        long due = Outbox.nextDue(Prefs.outbox(c));
        if (due < 0 || Prefs.token(c).isEmpty()) SyncJob.cancelFlush(c);
        else SyncJob.flushLater(c, due - System.currentTimeMillis());
    }

    /** De server heeft een item: een toegevoegde taak meteen vervangen door die van de server. */
    private static void sent(Context c, JSONObject op, String res) {
        if (!Outbox.CREATE.equals(op.optString("op")) || res == null) return;
        try {
            JSONObject task = new JSONObject(res);
            if (op.optString("id").equals(task.optString("id"))) {
                Prefs.setCache(c, Outbox.replace(new JSONArray(Prefs.cache(c)), task).toString());
            }
        } catch (Exception e) {
            Log.w("Tick", "Toegevoegde taak bijwerken mislukt", e);
        }
    }

    /**
     * De server wees items af (taak weg, niet meer gedeeld, ongeldig): niet opnieuw proberen. Een afgevinkte taak staat
     * weer zoals de server hem heeft, een toegevoegde verdwijnt, en de widget zegt het even.
     */
    private static void dropped(Context c, List<JSONObject> removed, int code) {
        if (removed.isEmpty()) return;
        // Weg of niet meer gedeeld: dat zeggen, in plaats van een statuscode.
        String reason = code == 403 || code == 404 ? c.getString(R.string.outbox_gone)
                : c.getString(R.string.error_server, String.valueOf(code));
        JSONObject pending = Prefs.pending(c);
        JSONObject remind = Prefs.pendingRemind(c);
        boolean pendingChanged = false;
        String cache = Prefs.cache(c);
        for (JSONObject op : removed) {
            String id = op.optString("id");
            String kind = op.optString("op");
            if (Outbox.DONE.equals(kind) && pending.optLong(id) == op.optLong("at")) {
                pending.remove(id);
                remind.remove(id);
                pendingChanged = true;
                Notify.doneFailed(c, id, reason);
            } else if (Outbox.CREATE.equals(kind)) {
                try {
                    cache = Outbox.without(new JSONArray(cache), id).toString();
                } catch (Exception ignored) {
                    // kapotte cache: de volgende verversing zet hem goed
                }
            }
        }
        if (pendingChanged) {
            Prefs.setPending(c, pending);
            Prefs.setPendingRemind(c, remind);
        }
        Prefs.setCache(c, cache);
        String title = removed.get(0).optString("title");
        Prefs.setOutboxNote(c, c.getString(R.string.outbox_dropped, title, reason), System.currentTimeMillis());
        Log.w("Tick", "Wachtrij: " + removed.size() + " wijziging(en) afgewezen (HTTP " + code + ")");
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

    /**
     * Weggeveegde locatiemeldingen die de server nog als gemeld kent: PATCH false opnieuw proberen. Is de plek intussen
     * opnieuw afgegaan (locFired heeft dezelfde key weer), de taak af of weg, of de plek veranderd, dan vergeten.
     * Geeft true als arr is aangepast (location_notified terug op false), zodat de geofence meteen weer staat.
     */
    private static boolean retryRearm(Context c, JSONArray arr, JSONObject pending) {
        JSONObject rearm = Prefs.locRearm(c);
        if (rearm.length() == 0) return false;
        JSONObject fired = Prefs.locFired(c);
        boolean changed = false;
        Iterator<String> ids = rearm.keys();
        Map<String, String> drop = new HashMap<>();
        while (ids.hasNext()) {
            String id = ids.next();
            String key = rearm.optString(id);
            JSONObject t = NotifyDecision.find(arr, id);
            if (key.equals(fired.optString(id, null))
                    || RearmDecision.decide(arr, id, key, pending) != RearmDecision.Result.REARM
                    || !t.optBoolean("location_notified")) {
                drop.put(id, key);
                continue;
            }
            try {
                Api.call(c, "PATCH", "/api/tasks/" + Uri.encode(id), "{\"location_notified\":false}");
                t.put("location_notified", false);
                changed = true;
                drop.put(id, key);
            } catch (Exception e) {
                Log.w("Tick", "location_notified terugzetten opnieuw mislukt", e);
            }
        }
        for (Map.Entry<String, String> e : drop.entrySet()) Prefs.dropLocRearm(c, e.getKey(), e.getValue());
        return changed;
    }

    /** remind_at van een taak, of "" als hij er geen heeft (of de taak onbekend is). */
    static String remindAt(JSONObject t) {
        return t == null || t.isNull("remind_at") ? "" : t.optString("remind_at", "");
    }

    /** Korte, leesbare reden voor in de widget of een Toast. */
    static String errorText(Context c, Exception e) {
        if (!isOffline(e)) return c.getString(R.string.error_server, e.getMessage().substring(5));
        return c.getString(R.string.error_offline);
    }

    /** Geen verbinding (of geen leesbaar antwoord), tegenover een HTTP-fout van de server ("HTTP 503"). */
    static boolean isOffline(Exception e) {
        String msg = e.getMessage();
        return !(e instanceof IOException && msg != null && msg.startsWith("HTTP "));
    }

    private Sync() {}
}
