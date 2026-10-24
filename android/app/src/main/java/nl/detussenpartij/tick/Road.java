package nl.detussenpartij.tick;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.DetectedActivity;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * "Op tijd melden onderweg": Android meldt wanneer je gaat rijden of fietsen (Activity Transition API); dan worden de
 * aankomstcirkels groter (RoadPlan), zodat de melding ondanks de vertraging van geofences op tijd komt. Na het
 * uit- of afstappen weer normaal. Je locatie wordt alleen even gebruikt om de stralen te berekenen, niet bewaard.
 */
final class Road {
    /** Zo lang (ms) wachten op een verse locatie bij het begin van een rit. */
    private static final long LOCATION_TIMEOUT_MS = 20_000;
    /** Een laatst bekende locatie mag zo oud (ms) zijn als er geen verse komt. */
    private static final long LAST_LOCATION_MAX_AGE_MS = 2 * 60_000;

    /** Toestemming "Fysieke activiteit". */
    static boolean permitted(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Aangezet, met toestemming, en de gewone locatiemeldingen werken. */
    static boolean on(Context c) {
        return Prefs.roadOn(c) && permitted(c) && Geo.permitted(c);
    }

    private static PendingIntent intent(Context c) {
        return PendingIntent.getBroadcast(c, 5, new Intent(c, ActivityReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    /**
     * Abonneert op begin en einde van auto en fiets. Mag vaker (vervangt het vorige). Let op: Android levert daarna
     * meteen de huidige stand opnieuw af, met een oud tijdstip; ActivityReceiver verwerkt dat zonder bijwerkingen.
     */
    static void subscribe(Context c) {
        Context app = c.getApplicationContext();
        if (!on(app)) return;
        List<ActivityTransition> list = new ArrayList<>();
        for (int type : new int[] {DetectedActivity.IN_VEHICLE, DetectedActivity.ON_BICYCLE}) {
            list.add(new ActivityTransition.Builder().setActivityType(type)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER).build());
            list.add(new ActivityTransition.Builder().setActivityType(type)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT).build());
        }
        try {
            ActivityRecognition.getClient(app).requestActivityTransitionUpdates(new ActivityTransitionRequest(list), intent(app))
                    .addOnFailureListener(e -> Log.w("Tick", "Onderweg: abonneren mislukt", e));
        } catch (SecurityException e) {
            Log.w("Tick", "Onderweg: geen toestemming voor Fysieke activiteit", e);
        }
    }

    /** Uitzetten: abonnement opzeggen en de cirkels terug naar normaal. */
    static void unsubscribe(Context c) {
        Context app = c.getApplicationContext();
        try {
            ActivityRecognition.getClient(app).removeActivityTransitionUpdates(intent(app));
        } catch (SecurityException ignored) {
            // zonder toestemming is er ook geen abonnement
        }
        Prefs.clearRoad(app);
        Geo.applyFromCache(app, false);
    }

    /** "car" of "bike" als die stand nu geldt en het aan staat, anders "". */
    static String activeMode(Context c) {
        String mode = Prefs.roadMode(c);
        return on(c) && RoadPlan.isActive(mode, Prefs.roadModeAt(c), System.currentTimeMillis()) ? mode : "";
    }

    /** De onderwegstralen (taak-id -> straal) zolang de stand geldt, anders leeg. */
    static Map<String, Float> radii(Context c) {
        if (activeMode(c).isEmpty()) return Collections.emptyMap();
        Map<String, Float> out = new HashMap<>();
        try {
            JSONObject o = new JSONObject(Prefs.roadRadii(c));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String id = it.next();
                out.put(id, (float) o.getDouble(id));
            }
        } catch (Exception e) {
            return Collections.emptyMap();
        }
        return out;
    }

    /**
     * Begin van rijden of fietsen (startedAt: volgens Android). Blokkeert tot de locatie er is: niet op de hoofdthread.
     * Zonder locatie blijven de cirkels normaal voor dit ritje. Een plek die tijdens de rit bijkomt, krijgt ook de
     * gewone straal (de locatie van het begin wordt niet bewaard).
     */
    static void enter(Context c, String mode, long startedAt) {
        Location here = currentLocation(c);
        JSONArray tasks;
        try {
            tasks = new JSONArray(Prefs.cache(c));
        } catch (Exception e) {
            tasks = new JSONArray();
        }
        double margin = RoadPlan.margin(Prefs.arrivals(c), mode);
        JSONObject radii = new JSONObject();
        for (GeoPlan.Fence f : GeoPlan.select(tasks, Prefs.locFired(c), GeoPlan.MAX)) {
            if (f.exit) continue;
            Double d = here == null ? null : ArrivalStats.distanceM(f.lat, f.lng, here.getLatitude(), here.getLongitude());
            float r = RoadPlan.roadRadius(f.radius, margin, d);
            try {
                if (r > f.radius) radii.put(f.id, (double) r);
            } catch (Exception ignored) {
            }
        }
        Prefs.setRoad(c, mode, startedAt, radii.toString());
        Log.i("Tick", "Onderweg (" + mode + "): " + radii.length() + " cirkels groter, marge " + Math.round(margin) + " m"
                + (here == null ? ", geen locatie" : ""));
        Geo.applyFromCache(c, false);
    }

    /** Einde van rijden of fietsen. Een einde van een andere soort dan de huidige stand telt niet. */
    static void exit(Context c, String mode) {
        if (!mode.equals(Prefs.roadMode(c))) return;
        Prefs.clearRoad(c);
        Log.i("Tick", "Onderweg (" + mode + ") voorbij: cirkels normaal");
        Geo.applyFromCache(c, false);
    }

    /** Eén verse locatie, of anders de laatst bekende als die jong genoeg is; null als geen van beide lukt. */
    private static Location currentLocation(Context c) {
        FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(c);
        try {
            CurrentLocationRequest req = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                    .setDurationMillis(LOCATION_TIMEOUT_MS)
                    .build();
            Location fresh = Tasks.await(client.getCurrentLocation(req, null), LOCATION_TIMEOUT_MS + 5_000, TimeUnit.MILLISECONDS);
            if (fresh != null) return fresh;
        } catch (SecurityException e) {
            return null;
        } catch (Exception e) {
            Log.w("Tick", "Onderweg: geen verse locatie", e);
        }
        try {
            Location last = Tasks.await(client.getLastLocation(), 5, TimeUnit.SECONDS);
            if (last != null && (SystemClock.elapsedRealtimeNanos() - last.getElapsedRealtimeNanos()) / 1_000_000 <= LAST_LOCATION_MAX_AGE_MS) {
                return last;
            }
        } catch (SecurityException e) {
            return null;
        } catch (Exception e) {
            Log.w("Tick", "Onderweg: geen laatst bekende locatie", e);
        }
        return null;
    }

    private Road() {}
}
