package nl.detussenpartij.tick;

import android.content.Context;
import android.location.Location;
import android.util.Log;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Het vangnet voor aankomstmeldingen (zie NetPlan): de periodieke job kijkt elke 15 minuten waar je bent en geeft een
 * aankomstmelding die Android niet (op tijd) gaf. Vraagt alleen een locatie als er taken met een aankomstplek open
 * staan. De locatie gaat alleen de berekening in en wordt niet bewaard.
 */
final class SafetyNet {
    /** Zo lang mag een locatie zoeken duren. */
    private static final long LOCATION_TIMEOUT_MS = 30_000;

    /** Blokkeert (locatie en netwerk): alleen vanuit een job-thread. */
    static void check(Context c) {
        final Context app = c.getApplicationContext();
        if (!Geo.permitted(app)) return;
        JSONArray tasks;
        try {
            tasks = new JSONArray(Prefs.cache(app));
        } catch (Exception e) {
            return;
        }
        // De gewone cirkels, niet de onderweg vergrote: het vangnet meldt pas als je er echt bent.
        List<GeoPlan.Fence> fences = new ArrayList<>();
        for (GeoPlan.Fence f : GeoPlan.select(tasks, Prefs.locFired(app), GeoPlan.MAX)) if (!f.exit) fences.add(f);
        if (fences.isEmpty()) {
            Prefs.setNetOutside(app, new JSONObject());
            return;
        }
        Location here = currentLocation(app);
        long now = System.currentTimeMillis();
        if (here == null) {
            Prefs.log(app, GeoLog.netNoFix(now));
            return;
        }
        double acc = here.hasAccuracy() ? here.getAccuracy() : Double.NaN;
        NetPlan.Result r = NetPlan.check(fences, Prefs.netOutside(app), here.getLatitude(), here.getLongitude(), acc);
        Prefs.setNetOutside(app, r.outside);
        Prefs.log(app, GeoLog.net(now, r.tasks, acc, r.arrived.size()));
        if (r.arrived.isEmpty()) return;
        int shown = GeofenceReceiver.handle(app, r.arrived, false, null, true);
        if (shown > 0) {
            // Android gaf deze aankomst niet (op tijd): alle plekken opnieuw aanmelden, voor als Android ze kwijt is.
            Prefs.setGeoSig(app, null);
            Geo.applyFromCache(app, true, GeoLog.Why.MISSED);
        }
    }

    /** Eén verse locatie (stroomzuinig: wifi en zendmasten volstaan), of null. */
    private static Location currentLocation(Context app) {
        try {
            CurrentLocationRequest req = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                    .setDurationMillis(LOCATION_TIMEOUT_MS)
                    .build();
            return Tasks.await(LocationServices.getFusedLocationProviderClient(app).getCurrentLocation(req, null),
                    LOCATION_TIMEOUT_MS + 5_000, TimeUnit.MILLISECONDS);
        } catch (SecurityException e) {
            return null;
        } catch (Exception e) {
            Log.w("Tick", "Vangnet: geen locatie", e);
            return null;
        }
    }

    private SafetyNet() {}
}
