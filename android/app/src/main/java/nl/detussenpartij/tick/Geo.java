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
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;

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
        // Onderweg (auto of fiets) zijn aankomstcirkels groter; zie Road.
        final List<GeoPlan.Fence> fences = GeoPlan.select(tasks, Prefs.locFired(app), GeoPlan.MAX, Road.radii(app), Road.activeMode(app));
        final String sig = GeoPlan.signature(fences);
        if (!force && sig.equals(Prefs.geoSig(app))) return;
        final List<String> ids = new ArrayList<>();
        for (GeoPlan.Fence f : fences) ids.add(GeoPlan.requestId(f));

        // Is bekend wat er staat, dan alleen het verschil: ongewijzigde geofences blijven staan, zodat een nog niet
        // afgeleverde aankomst of vertrek niet verloren gaat (bijvoorbeeld bij het begin of einde van een rit).
        final Set<String> registered = Prefs.geoIds(app);
        if (!force && !Prefs.geoSig(app).isEmpty() && registered != null) {
            final GeoPlan.Diff d = GeoPlan.diff(registered, fences);
            Task<Void> removed = d.remove.isEmpty() ? Tasks.forResult(null) : client.removeGeofences(d.remove);
            removed.addOnCompleteListener(r -> add(app, client, pi, d.add, d.addArrived, sig, ids));
            return;
        }
        client.removeGeofences(pi).addOnCompleteListener(r -> add(app, client, pi, fences, new ArrayList<>(), sig, ids));
    }

    /**
     * Zet de geofences in fresh zonder initiële trigger (sta je al op de plek, dan meldt hij pas bij de volgende
     * aankomst) en die in arrived met (GeoPlan.Diff.addArrived). Bewaart daarna signature en request-ids.
     */
    private static void add(Context app, GeofencingClient client, PendingIntent pi, List<GeoPlan.Fence> fresh,
                            List<GeoPlan.Fence> arrived, String sig, List<String> ids) {
        try {
            Task<Void> first = fresh.isEmpty() ? Tasks.forResult(null) : client.addGeofences(request(fresh, 0), pi);
            first.onSuccessTask(v -> arrived.isEmpty() ? Tasks.forResult(null)
                            : client.addGeofences(request(arrived, GeofencingRequest.INITIAL_TRIGGER_ENTER), pi))
                    .addOnSuccessListener(v -> {
                        Log.i("Tick", "Geofences: " + ids.size() + " (nieuw " + (fresh.size() + arrived.size()) + ")");
                        Prefs.setGeo(app, sig, ids);
                    })
                    .addOnFailureListener(e -> {
                        Log.w("Tick", "Geofences zetten mislukt", e);
                        Prefs.setGeoSig(app, null);
                    });
        } catch (SecurityException e) {
            Log.w("Tick", "Geen locatietoestemming voor geofences", e);
            Prefs.setGeoSig(app, null);
        }
    }

    private static GeofencingRequest request(List<GeoPlan.Fence> fences, int initialTrigger) {
        List<Geofence> list = new ArrayList<>();
        for (GeoPlan.Fence f : fences) {
            list.add(new Geofence.Builder()
                    .setRequestId(GeoPlan.requestId(f))
                    .setCircularRegion(f.lat, f.lng, f.radius)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(f.exit ? Geofence.GEOFENCE_TRANSITION_EXIT : Geofence.GEOFENCE_TRANSITION_ENTER)
                    .build());
        }
        return new GeofencingRequest.Builder().setInitialTrigger(initialTrigger).addGeofences(list).build();
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
                    Prefs.removeGeoIds(app, requestIds);
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
