package nl.detussenpartij.tick;

import android.content.Context;
import android.location.Location;
import android.os.Bundle;
import android.os.Looper;
import android.os.RemoteException;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.browser.trusted.TrustedWebActivityCallbackRemote;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.androidbrowserhelper.trusted.ExtraCommandHandler;

/**
 * Geeft je locatie door aan de PWA als Chrome erom vraagt (navigator.geolocation in de TWA), voor de rijmodus en
 * "mijn locatie" op de kaart. Vervangt dat deel van locationdelegation 1.1.2: die stopte zodra Android bij het starten
 * "nog geen locatie" meldde (wat bijna altijd gebeurt), gooide daarbij de verbinding met Chrome weg en stuurde zijn
 * fout onder een naam die Chrome niet kent. De pagina kreeg dan niets, ook geen fout. Wij blijven luisteren tot Chrome
 * "stopLocation" zegt. Toestemming vragen ("checkAndroidLocationPermission") laten we aan die bibliotheek.
 */
final class TickLocationHandler implements ExtraCommandHandler {
    private static final String TAG = "TickLocation";

    private FusedLocationProviderClient client;
    private TrustedWebActivityCallbackRemote target;
    private final LocationCallback updates = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            send(result.getLastLocation());
        }
        // onLocationAvailability(false) negeren we bewust: dat is "even geen fix" (binnen, net gestart), geen einde.
    };

    @NonNull
    @Override
    public Bundle handleExtraCommand(Context context, String command, Bundle args, TrustedWebActivityCallbackRemote callback) {
        Bundle result = new Bundle();
        if (!LocationRelay.handles(command)) {
            result.putBoolean(EXTRA_COMMAND_SUCCESS, false);
            return result;
        }
        if (LocationRelay.START.equals(command)) {
            if (callback == null) {
                result.putBoolean(EXTRA_COMMAND_SUCCESS, false);
                return result;
            }
            start(context, callback, args != null && args.getBoolean("enableHighAccuracy"));
        } else {
            stop();
        }
        result.putBoolean(EXTRA_COMMAND_SUCCESS, true);
        return result;
    }

    private synchronized void start(Context context, TrustedWebActivityCallbackRemote callback, boolean highAccuracy) {
        stop();
        target = callback;
        if (client == null) client = LocationServices.getFusedLocationProviderClient(context.getApplicationContext());
        LocationRequest request = new LocationRequest.Builder(
                highAccuracy ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                LocationRelay.intervalMs(highAccuracy)).build();
        try {
            // Eerst de laatst bekende locatie als die vers is: dan hoeft de pagina niet op de eerste nieuwe te wachten.
            client.getLastLocation().addOnSuccessListener(last -> {
                if (last != null && LocationRelay.lastIsUsable(last.getTime(), System.currentTimeMillis())) send(last);
            });
            client.requestLocationUpdates(request, updates, Looper.getMainLooper())
                    .addOnFailureListener(e -> fail("Unable to request location updates: " + e.getMessage()));
        } catch (SecurityException e) {
            fail("No location permission");
        }
    }

    private synchronized void stop() {
        if (client != null) client.removeLocationUpdates(updates);
        target = null;
    }

    private synchronized void send(Location location) {
        if (location == null || target == null) return;
        Bundle b = new Bundle();
        b.putDouble("latitude", location.getLatitude());
        b.putDouble("longitude", location.getLongitude());
        b.putLong("timeStamp", location.getTime());
        if (location.hasAltitude()) b.putDouble("altitude", location.getAltitude());
        if (location.hasAccuracy()) b.putDouble("accuracy", location.getAccuracy());
        if (location.hasBearing()) b.putDouble("bearing", location.getBearing());
        if (location.hasSpeed()) b.putDouble("speed", location.getSpeed());
        relay(LocationRelay.CALLBACK_LOCATION, b);
    }

    private synchronized void fail(String message) {
        if (target == null) return;
        Log.w(TAG, message);
        Bundle b = new Bundle();
        b.putString("message", message);
        relay(LocationRelay.CALLBACK_ERROR, b);
        stop();
    }

    private void relay(String name, Bundle bundle) {
        try {
            target.runExtraCallback(name, bundle);
        } catch (RemoteException e) {
            // Chrome is weg (tabblad dicht): niet blijven luisteren.
            Log.w(TAG, "Chrome not reachable, stopping location updates", e);
            stop();
        }
    }
}
