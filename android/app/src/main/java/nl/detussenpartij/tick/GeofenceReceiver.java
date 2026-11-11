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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
            // Twee plekken van dezelfde taak tegelijk (cirkels die overlappen): één melding is genoeg.
            if (notified.containsKey(id)) {
                done.add(rid);
                continue;
            }
            NotifyDecision.Result r = NotifyDecision.decide(tasks, id, GeoPlan.fenceKey(rid), exit, fired, pending);
            if (r != NotifyDecision.Result.MELDEN) {
                Log.i("Tick", "Geen locatiemelding voor " + id + ": " + r);
                continue;
            }
            JSONObject task = NotifyDecision.find(tasks, id);
            JSONObject loc = task.optJSONObject("location");
            // De plek die afging (bij meerdere plekken een van de extra); de key is die van de hele taak.
            JSONObject place = GeoPlan.place(loc, GeoPlan.placeIndex(rid));
            // Onderweg vergrote cirkel: je bent er nog niet, maar bijna.
            boolean road = !exit && !GeoPlan.roadMode(rid).isEmpty();
            boolean shown = Notify.location(app, id, GeoPlan.key(loc), task.optString("title"),
                    app.getString(exit ? R.string.loc_left : road ? R.string.loc_almost : R.string.loc_arrived, place.optString("name")));
            if (!shown) {
                // Meldingen staan uit: de herinnering niet stilletjes opmaken.
                Log.w("Tick", "Locatiemelding niet getoond: meldingen staan uit");
                continue;
            }
            notified.put(id, GeoPlan.key(loc));
            done.add(rid);
            measure(app, exit, rid, place, fix);
        }
        if (notified.isEmpty()) return;
        Prefs.markLocFired(app, notified);
        // Alleen deze taken zijn klaar, met al hun plekken; de rest blijft gewoon staan.
        Set<String> gone = new LinkedHashSet<>(done);
        Set<String> registered = Prefs.geoIds(app);
        if (registered != null) gone.addAll(GeoPlan.ofTasks(registered, notified.keySet()));
        Geo.removeFired(app, new ArrayList<>(gone));

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

    /**
     * Legt vast hoe ver je van het midden was (van de plek die afging). Een fout hierin mag de melding en de PATCH
     * nooit tegenhouden.
     */
    private static void measure(Context app, boolean exit, String rid, JSONObject loc, Location fix) {
        try {
            double radius = loc.optDouble("radius");
            // Soort en gebruikte straal uit de request-id: de stand onderweg kan al voorbij zijn als Android meldt.
            float road = GeoPlan.roadRadius(rid);
            double used = Float.isNaN(road) ? radius : road;
            JSONObject m = ArrivalStats.fromFix(System.currentTimeMillis(), exit, GeoPlan.roadMode(rid), loc.optDouble("lat"),
                    loc.optDouble("lng"), radius, used,
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
