package nl.detussenpartij.tick;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.util.Log;

/**
 * Na een herstart of een app-update: eerst de widgets opnieuw opbouwen (Android roept onUpdate na een update niet
 * altijd aan, zie AfterRestart), dan de geofences opnieuw zetten (die zijn weg), eerst uit de cache en dan na een refresh.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        int widgets = 0;
        try {
            widgets = AppWidgetManager.getInstance(app)
                    .getAppWidgetIds(new ComponentName(app, TaskWidgetProvider.class)).length;
        } catch (RuntimeException e) {
            Log.w("Tick", "Widgets tellen mislukt", e);
        }
        final AfterRestart plan = AfterRestart.plan(intent.getAction(), widgets, !Prefs.token(app).isEmpty(), online(app));
        if (!plan.handled) return;
        if (plan.rebuildWidgets) TaskWidgetProvider.repair(app);
        try {
            // Een stand onderweg van voor de herstart geldt niet meer; het nieuwe abonnement levert de huidige stand.
            Prefs.clearRoad(app);
            Geo.applyFromCache(app, true);
            Road.subscribe(app);
        } catch (RuntimeException e) {
            // Plekken mogen het verversen en de periodieke job hieronder nooit tegenhouden.
            Log.w("Tick", "Plekken opnieuw zetten mislukt", e);
        }
        // Zonder netwerk nu: de periodieke job ververst zodra er wel netwerk is.
        SyncJob.schedulePeriodic(app);
        if (!plan.refresh) return;

        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                Sync.refresh(app);
            } catch (Throwable t) {
                Log.w("Tick", "Verversen na herstart mislukt", t);
            } finally {
                result.finish();
            }
        }).start();
    }

    private static boolean online(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException e) {
            return false;
        }
    }
}
