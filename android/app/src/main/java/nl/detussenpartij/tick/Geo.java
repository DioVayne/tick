package nl.detussenpartij.tick;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Zet de geofences voor taken met een plek (via Google Play-diensten). */
final class Geo {
    /** Fijne locatie en achtergrondlocatie ("Altijd toestaan"); zonder die twee werkt geofencing niet. */
    static boolean permitted(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                && c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Eén PendingIntent voor alle geofences; mutable, want Play-diensten vullen er de gebeurtenis in. */
    private static PendingIntent intent(Context c) {
        return PendingIntent.getBroadcast(c, 4, new Intent(c, GeofenceReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    /**
     * Na "Gedwongen stoppen" annuleert Android alle PendingIntents van de app; de geofences staan dan nog bij
     * Play-diensten, maar kunnen ons niet meer bereiken. Zonder levende PendingIntent moet alles opnieuw gezet worden.
     */
    static boolean intentAlive(Context c) {
        Context app = c.getApplicationContext();
        return PendingIntent.getBroadcast(app, 4, new Intent(app, GeofenceReceiver.class),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_MUTABLE) != null;
    }

    /**
     * Registreert de geofences opnieuw als de set veranderd is (of bij force, zoals na een herstart).
     * Zonder permissie haalt hij alles weg.
     */
    static void apply(Context c, JSONArray tasks, boolean force) {
        final Context app = c.getApplicationContext();
        final GeofencingClient client = LocationServices.getGeofencingClient(app);
        final PendingIntent pi = intent(app);
        if (!permitted(app)) {
            client.removeGeofences(pi);
            Prefs.setGeoSig(app, null);
            return;
        }
        final List<GeoPlan.Fence> fences = GeoPlan.select(tasks, Prefs.locFired(app), GeoPlan.MAX);
        final String sig = GeoPlan.signature(fences);
        if (!force && sig.equals(Prefs.geoSig(app))) return;

        client.removeGeofences(pi).addOnCompleteListener(removed -> {
            if (fences.isEmpty()) {
                Log.i("Tick", "Geofences: 0");
                Prefs.setGeoSig(app, sig);
                return;
            }
            List<Geofence> list = new ArrayList<>();
            for (GeoPlan.Fence f : fences) {
                list.add(new Geofence.Builder()
                        .setRequestId(GeoPlan.requestId(f))
                        .setCircularRegion(f.lat, f.lng, f.radius)
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setTransitionTypes(f.exit ? Geofence.GEOFENCE_TRANSITION_EXIT : Geofence.GEOFENCE_TRANSITION_ENTER)
                        .build());
            }
            // Geen initiële trigger: sta je al op de plek, dan meldt hij pas bij de volgende aankomst.
            GeofencingRequest req = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(list).build();
            try {
                client.addGeofences(req, pi)
                        .addOnSuccessListener(v -> {
                            Log.i("Tick", "Geofences: " + list.size());
                            Prefs.setGeoSig(app, sig);
                        })
                        .addOnFailureListener(e -> {
                            Log.w("Tick", "Geofences zetten mislukt", e);
                            Prefs.setGeoSig(app, null);
                        });
            } catch (SecurityException e) {
                Log.w("Tick", "Geen locatietoestemming voor geofences", e);
                Prefs.setGeoSig(app, null);
            }
        });
    }

    /**
     * Haalt alleen de geofences weg die net afgingen (request-ids), zonder de rest opnieuw te registreren:
     * opnieuw registreren kan een aankomst wissen die Play-diensten nog niet afgeleverd hebben.
     */
    static void removeFired(Context c, List<String> requestIds) {
        if (requestIds.isEmpty()) return;
        final Context app = c.getApplicationContext();
        final Set<String> taskIds = new HashSet<>();
        for (String rid : requestIds) taskIds.add(GeoPlan.taskId(rid));
        LocationServices.getGeofencingClient(app).removeGeofences(requestIds)
                .addOnSuccessListener(v -> {
                    Log.i("Tick", "Geofences weggehaald: " + requestIds.size());
                    Prefs.setGeoSig(app, GeoPlan.signatureWithout(Prefs.geoSig(app), taskIds));
                })
                // Blijft de signature staan, dan registreert de volgende refresh alles opnieuw; locFired
                // voorkomt intussen een tweede melding.
                .addOnFailureListener(e -> Log.w("Tick", "Geofences weghalen mislukt", e));
    }

    /** Zelfde als apply, met de laatst opgehaalde lijst (zonder netwerk). */
    static void applyFromCache(Context c, boolean force) {
        JSONArray tasks;
        try {
            tasks = new JSONArray(Prefs.cache(c));
        } catch (Exception e) {
            tasks = new JSONArray();
        }
        apply(c, tasks, force);
    }

    private Geo() {}
}
