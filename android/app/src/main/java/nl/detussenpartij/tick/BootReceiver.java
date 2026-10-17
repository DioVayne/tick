package nl.detussenpartij.tick;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;

/** Na een herstart (of een app-update) zijn alle geofences weg: zet ze opnieuw, eerst uit de cache en dan na een refresh. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        final Context app = context.getApplicationContext();
        Geo.applyFromCache(app, true);
        // Zonder netwerk nu: de periodieke job ververst zodra er wel netwerk is.
        SyncJob.schedulePeriodic(app);

        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                // Vlak na het opstarten is er vaak nog geen netwerk: dan niet verversen (en dus geen
                // "geen verbinding" in de widget). De cache staat al; een latere refresh haalt het in.
                if (!Prefs.token(app).isEmpty() && online(app)) Sync.refresh(app);
            } finally {
                result.finish();
            }
        }).start();
    }

    private static boolean online(Context c) {
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }
}
