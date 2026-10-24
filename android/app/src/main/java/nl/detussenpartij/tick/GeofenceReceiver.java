package nl.detussenpartij.tick;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofenceStatusCodes;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Een geofence ging af: toon de melding (één keer per plek) en meld het aan de server. */
public class GeofenceReceiver extends BroadcastReceiver {
    /** Na zoveel ms geen nieuwe PATCH meer beginnen; Sync.refresh probeert de rest later opnieuw. */
    private static final long PATCH_BUDGET_MS = 7_000;

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;
        if (event.hasError()) {
            Log.w("Tick", "Geofence-fout: " + GeofenceStatusCodes.getStatusCodeString(event.getErrorCode()));
            // Locatie is uitgezet: Play-diensten hebben alle geofences weggegooid. Signature wissen,
            // zodat de volgende refresh (of het openen van de app) ze opnieuw zet.
            if (event.getErrorCode() == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                Prefs.setGeoSig(context.getApplicationContext(), null);
            }
            return;
        }
        List<Geofence> triggered = event.getTriggeringGeofences();
        if (triggered == null || triggered.isEmpty()) return;
        final Context app = context.getApplicationContext();
        final boolean exit = event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_EXIT;
        final List<String> requestIds = new ArrayList<>();
        for (Geofence g : triggered) requestIds.add(g.getRequestId());
        // Waar je was toen hij afging (mag ontbreken): alleen voor de meting van hoe laat de melding kwam.
        final Location fix = event.getTriggeringLocation();

        // De beslissing pas op de achtergrond: eerst kort bij de server navragen of de taak nog open is.
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                handle(app, requestIds, exit, fix);
            } finally {
                result.finish();
            }
        }).start();
    }

    private static void handle(Context app, List<String> requestIds, boolean exit, Location fix) {
        long start = SystemClock.elapsedRealtime();
        JSONArray tasks = fresh(app);
        JSONObject pending = Prefs.pending(app);
        JSONObject fired = Prefs.locFired(app);
        Map<String, String> notified = new HashMap<>();
        List<String> done = new ArrayList<>();
        for (String rid : requestIds) {
            String id = GeoPlan.taskId(rid);
            NotifyDecision.Result r = NotifyDecision.decide(tasks, id, GeoPlan.fenceKey(rid), exit, fired, pending);
            if (r != NotifyDecision.Result.MELDEN) {
                Log.i("Tick", "Geen locatiemelding voor " + id + ": " + r);
                continue;
            }
            JSONObject task = NotifyDecision.find(tasks, id);
            JSONObject loc = task.optJSONObject("location");
            boolean shown = Notify.location(app, id, task.optString("title"),
                    app.getString(exit ? R.string.loc_left : R.string.loc_arrived, loc.optString("name")));
            if (!shown) {
                // Meldingen staan uit: de herinnering niet stilletjes opmaken.
                Log.w("Tick", "Locatiemelding niet getoond: meldingen staan uit");
                continue;
            }
            notified.put(id, GeoPlan.key(loc));
            done.add(rid);
            measure(app, exit, loc, fix);
        }
        if (notified.isEmpty()) return;
        Prefs.markLocFired(app, notified);
        // Alleen deze geofences zijn klaar; de rest blijft gewoon staan.
        Geo.removeFired(app, done);

        for (String id : notified.keySet()) {
            if (SystemClock.elapsedRealtime() - start > PATCH_BUDGET_MS) break;
            try {
                Api.call(app, "PATCH", "/api/tasks/" + Uri.encode(id), "{\"location_notified\":true}",
                        Api.SHORT_TIMEOUT_MS, Api.SHORT_TIMEOUT_MS);
                Prefs.markLocSynced(app, id);
            } catch (Exception e) {
                // Sync.refresh probeert het later opnieuw (locFired onthoudt het).
                Log.w("Tick", "location_notified doorgeven mislukt", e);
            }
        }
    }

    /** Legt vast hoe ver je van het midden was. Een fout hierin mag de melding en de PATCH nooit tegenhouden. */
    private static void measure(Context app, boolean exit, JSONObject loc, Location fix) {
        try {
            double radius = loc.optDouble("radius");
            JSONObject m = ArrivalStats.fromFix(System.currentTimeMillis(), exit, "", loc.optDouble("lat"),
                    loc.optDouble("lng"), radius, radius,
                    fix == null ? null : fix.getLatitude(), fix == null ? null : fix.getLongitude(),
                    fix != null && fix.hasSpeed() ? (double) fix.getSpeed() : null,
                    fix != null && fix.hasAccuracy() ? (double) fix.getAccuracy() : null,
                    fix == null ? null : fix.getTime());
            if (m != null) Prefs.addArrival(app, m);
        } catch (Exception e) {
            Log.w("Tick", "Meting van locatiemelding mislukt", e);
        }
    }

    /**
     * De open taken vers van de server (één GET voor alle geofences samen), en meteen als cache bewaard.
     * Lukt dat niet (offline, time-out), dan de laatst opgehaalde lijst.
     */
    private static JSONArray fresh(Context app) {
        try {
            String json = Api.call(app, "GET", "/api/tasks", null, Api.SHORT_TIMEOUT_MS, Api.SHORT_TIMEOUT_MS);
            JSONArray arr = new JSONArray(json);
            Prefs.setCache(app, json);
            TaskWidgetProvider.updateAll(app);
            return arr;
        } catch (Exception e) {
            Log.w("Tick", "Verse controle mislukt, cache gebruikt", e);
        }
        try {
            return new JSONArray(Prefs.cache(app));
        } catch (Exception e) {
            return new JSONArray();
        }
    }
}
