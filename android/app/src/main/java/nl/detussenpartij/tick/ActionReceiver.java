package nl.detussenpartij.tick;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

public class ActionReceiver extends BroadcastReceiver {
    static final String ACTION_DONE = BuildConfig.APPLICATION_ID + ".DONE";
    /** Locatiemelding weggeveegd: de herinnering weer klaarzetten voor de volgende keer. */
    static final String ACTION_DISMISSED = BuildConfig.APPLICATION_ID + ".DISMISSED";
    static final String EXTRA_ID = "id";
    /** GeoPlan.key van de plek uit de weggeveegde melding. */
    static final String EXTRA_KEY = "key";
    /** "Afvinken" in een locatiemelding: een tweede tik maakt niets ongedaan, die knop is alleen om af te ronden. */
    static final String EXTRA_FROM_NOTIFICATION = "fromNotification";

    /**
     * Eerste tik: de taak wordt direct doorgestreept getoond (de lijst schuift nog niet op) en op de server afgerond.
     * Tik binnen enkele seconden nogmaals op dezelfde taak: ongedaan maken. Daarna verdwijnt de taak uit de lijst.
     */
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_DISMISSED.equals(intent.getAction())) {
            dismissed(context, intent);
            return;
        }
        if (!ACTION_DONE.equals(intent.getAction())) return;
        final String id = intent.getStringExtra(EXTRA_ID);
        if (id == null || id.isEmpty()) return;
        final Context app = context.getApplicationContext();
        final boolean fromNotification = intent.getBooleanExtra(EXTRA_FROM_NOTIFICATION, false);

        final JSONObject pending = Prefs.pending(app);
        final long now = System.currentTimeMillis();
        final boolean known = pending.has(id);
        final boolean undo = known && now - pending.optLong(id) <= Sync.UNDO_WINDOW_MS;
        if (known && !undo) return; // taak is al weg (of op weg); een late tik doet niets
        if (undo && fromNotification) return; // dubbele tik op "Afvinken" in de melding: hij is al onderweg

        try {
            if (undo) pending.remove(id);
            else pending.put(id, now);
        } catch (Exception e) {
            return;
        }
        Prefs.setPending(app, pending);
        // remind_at bij de tik onthouden: een herhalende taak blijft open op de server, maar met een nieuwe remind_at.
        JSONObject remind = Prefs.pendingRemind(app);
        try {
            JSONObject task = undo ? null : NotifyDecision.find(new JSONArray(Prefs.cache(app)), id);
            if (task != null) remind.put(id, Sync.remindAt(task));
            else remind.remove(id);
        } catch (Exception e) {
            remind.remove(id);
        }
        Prefs.setPendingRemind(app, remind);
        TaskWidgetProvider.updateAll(app); // direct zichtbaar, zonder netwerk

        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                String path = "/api/tasks/" + Uri.encode(id) + (undo ? "/reopen" : "/done");
                Api.call(app, "POST", path, "{}");
                if (!undo) {
                    // Pas nu de locatiemelding weghalen (ook bij afvinken in de widget): de taak is echt af.
                    Notify.cancel(app, id);
                    long wait = now + Sync.UNDO_WINDOW_MS - System.currentTimeMillis();
                    if (wait > 0) Thread.sleep(wait);
                    TaskWidgetProvider.updateAll(app); // nu pas uit de lijst halen
                }
            } catch (Exception e) {
                Log.w("Tick", "Afvinken mislukt", e);
                // Direct weer tonen zoals hij op de server staat, in plaats van pas na 30 seconden.
                JSONObject p = Prefs.pending(app);
                p.remove(id);
                Prefs.setPending(app, p);
                // De locatiemelding blijft staan en zegt dat het mislukt is; "Afvinken" probeert het opnieuw.
                if (!undo) Notify.doneFailed(app, id, Sync.errorText(app, e));
                String msg = app.getString(undo ? R.string.undo_failed : R.string.done_failed, Sync.errorText(app, e));
                new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(app, msg, Toast.LENGTH_LONG).show());
            } finally {
                Sync.refresh(app);
                result.finish();
            }
        }).start();
    }

    /**
     * Locatiemelding weggeveegd: "nu niet". De herinnering staat weer klaar voor de volgende aankomst (of het volgende
     * vertrek); de geofence gaat niet meteen opnieuw af, want hij wordt gezet zonder initiële trigger. Lukt de PATCH
     * niet (offline), dan probeert Sync.refresh het later opnieuw via locRearm.
     */
    private void dismissed(Context context, Intent intent) {
        final String id = intent.getStringExtra(EXTRA_ID);
        final String key = intent.getStringExtra(EXTRA_KEY);
        if (id == null || id.isEmpty() || key == null) return;
        final Context app = context.getApplicationContext();
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                JSONArray tasks;
                try {
                    tasks = new JSONArray(Prefs.cache(app));
                } catch (Exception e) {
                    tasks = new JSONArray();
                }
                RearmDecision.Result r = RearmDecision.decide(tasks, id, key, Prefs.pending(app));
                if (r != RearmDecision.Result.REARM) {
                    Log.i("Tick", "Weggeveegde locatiemelding niet klaargezet voor " + id + ": " + r);
                    return;
                }
                Map<String, String> seen = new HashMap<>();
                seen.put(id, key);
                Prefs.dropLocFired(app, seen);
                Prefs.markLocRearm(app, id, key);
                Prefs.setCache(app, RearmDecision.withNotifiedFalse(Prefs.cache(app), id));
                Geo.applyFromCache(app, false);
                try {
                    Api.call(app, "PATCH", "/api/tasks/" + Uri.encode(id), "{\"location_notified\":false}",
                            Api.SHORT_TIMEOUT_MS, Api.SHORT_TIMEOUT_MS);
                    Prefs.dropLocRearm(app, id, key);
                } catch (Exception e) {
                    Log.w("Tick", "location_notified terugzetten mislukt; later opnieuw", e);
                }
            } finally {
                result.finish();
            }
        }).start();
    }
}
