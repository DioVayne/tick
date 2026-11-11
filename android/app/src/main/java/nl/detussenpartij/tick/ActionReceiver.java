package nl.detussenpartij.tick;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

public class ActionReceiver extends BroadcastReceiver {
    static final String ACTION_DONE = BuildConfig.APPLICATION_ID + ".DONE";
    /** Ongedaan maken (knop in een net afgevinkte widgetrij). */
    static final String ACTION_UNDO = BuildConfig.APPLICATION_ID + ".UNDO";
    /** Locatiemelding weggeveegd: de herinnering weer klaarzetten voor de volgende keer. */
    static final String ACTION_DISMISSED = BuildConfig.APPLICATION_ID + ".DISMISSED";
    static final String EXTRA_ID = "id";
    /** Bij Ongedaan maken: het moment van de afvinktik die de rij toonde (ms). */
    static final String EXTRA_TICKED_AT = "tickedAt";
    /** GeoPlan.key van de plek uit de weggeveegde melding. */
    static final String EXTRA_KEY = "key";
    /** "Afvinken" in een locatiemelding. */
    static final String EXTRA_FROM_NOTIFICATION = "fromNotification";

    /**
     * Afvinken en ongedaan maken gaan een voor een naar de server, zodat Ongedaan maken nooit voor het afvinken
     * aankomt (dan zou de server het terugzetten negeren en daarna alsnog afronden).
     */
    private static final Object NET = new Object();

    /**
     * Tik op het bolletje: de taak wordt direct doorgestreept getoond, met Ongedaan maken, en meteen op de server
     * afgerond. De rij blijft UndoPlan.UNDO_WINDOW_MS op zijn plek; daarna verdwijnt hij. Een tweede tik op het bolletje
     * doet niets: terugzetten gaat alleen met de knop.
     */
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_DISMISSED.equals(intent.getAction())) {
            dismissed(context, intent);
            return;
        }
        if (ACTION_UNDO.equals(intent.getAction())) {
            undo(context, intent);
            return;
        }
        if (!ACTION_DONE.equals(intent.getAction())) return;
        final String id = intent.getStringExtra(EXTRA_ID);
        if (id == null || id.isEmpty()) return;
        final Context app = context.getApplicationContext();

        final JSONObject pending = Prefs.pending(app);
        if (!UndoPlan.tick(pending, id)) return; // al afgevinkt en onderweg (of nog in het venster)
        // Het moment van de afvinktik: daaruit volgt het actie-id dat ongedaan maken weer noemt.
        final long now = System.currentTimeMillis();
        try {
            pending.put(id, now);
        } catch (Exception e) {
            return;
        }
        Prefs.setPending(app, pending);
        // remind_at bij de tik onthouden: een herhalende taak blijft open op de server, maar met een nieuwe remind_at.
        JSONObject remind = Prefs.pendingRemind(app);
        String tickBody = "{}";
        try {
            JSONObject task = NotifyDecision.find(new JSONArray(Prefs.cache(app)), id);
            if (task != null) remind.put(id, Sync.remindAt(task));
            else remind.remove(id);
            // De keer die de widget toonde gaat mee: is de taak elders al doorgeschoven, dan doet de server niets.
            tickBody = TickBody.done(task, now);
        } catch (Exception e) {
            remind.remove(id);
        }
        Prefs.setPendingRemind(app, remind);
        final String body = tickBody;
        TaskWidgetProvider.updateAll(app); // direct zichtbaar, zonder netwerk

        final long started = SystemClock.elapsedRealtime();
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                boolean sent = false;
                synchronized (NET) {
                    // Al ongedaan gemaakt voordat het verzoek weg was: dan hoeft de server niets te horen.
                    if (Prefs.pending(app).optLong(id) == now) {
                        Api.call(app, "POST", "/api/tasks/" + Uri.encode(id) + "/done", body);
                        sent = true;
                    }
                }
                // Pas nu de locatiemelding weghalen (ook bij afvinken in de widget): de taak is echt af.
                if (sent && Prefs.pending(app).optLong(id) == now) Notify.cancel(app, id);
            } catch (Exception e) {
                Log.w("Tick", "Afvinken mislukt", e);
                // Direct weer tonen zoals hij op de server staat, in plaats van pas na 30 seconden.
                JSONObject p = Prefs.pending(app);
                if (p.optLong(id) == now) {
                    p.remove(id);
                    Prefs.setPending(app, p);
                    // De locatiemelding blijft staan en zegt dat het mislukt is; "Afvinken" probeert het opnieuw.
                    Notify.doneFailed(app, id, Sync.errorText(app, e));
                    toast(app, app.getString(R.string.done_failed, Sync.errorText(app, e)));
                }
            }
            try {
                // Na het venster de rij weghalen: TaskListService laat hem pas vallen als de lijst opnieuw gebouwd wordt.
                long wait = now + UndoPlan.UNDO_WINDOW_MS - System.currentTimeMillis();
                if (wait > 0) Thread.sleep(wait + 100);
                TaskWidgetProvider.updateAll(app);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                refreshWithin(app, started);
                result.finish();
            }
        }).start();
    }

    /**
     * Ongedaan maken: de rij staat meteen weer open, en de server draait precies die afvinkactie terug (bij een
     * herhalende taak: terug naar de keer van voor het doorschuiven). Werkt ook als het afvinken al op de server is.
     */
    private void undo(Context context, Intent intent) {
        final String id = intent.getStringExtra(EXTRA_ID);
        if (id == null || id.isEmpty()) return;
        final Context app = context.getApplicationContext();
        final long rowAt = intent.getLongExtra(EXTRA_TICKED_AT, 0);
        final long now = System.currentTimeMillis();
        JSONObject pending = Prefs.pending(app);
        final long tickedAt = UndoPlan.undo(pending, id, rowAt, now);
        if (tickedAt == 0) {
            if (rowAt > 0 && now - rowAt > UndoPlan.UNDO_WINDOW_MS + UndoPlan.UNDO_GRACE_MS) {
                toast(app, app.getString(R.string.undo_too_late));
            }
            return;
        }
        pending.remove(id);
        Prefs.setPending(app, pending);
        JSONObject remind = Prefs.pendingRemind(app);
        remind.remove(id);
        Prefs.setPendingRemind(app, remind);
        TaskWidgetProvider.updateAll(app); // direct weer open, zonder netwerk

        final long started = SystemClock.elapsedRealtime();
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                // Na een eventueel lopend afvinkverzoek; was dat nog niet weg, dan doet dit op de server niets.
                synchronized (NET) {
                    Api.call(app, "POST", "/api/tasks/" + Uri.encode(id) + "/reopen", TickBody.reopen(tickedAt));
                }
            } catch (Exception e) {
                Log.w("Tick", "Ongedaan maken mislukt", e);
                toast(app, app.getString(R.string.undo_failed, Sync.errorText(app, e)));
            } finally {
                refreshWithin(app, started);
                result.finish();
            }
        }).start();
    }

    /**
     * Verversen binnen de broadcast als daar nog tijd voor is (Android breekt hem na een minuut af; wachten op een traag
     * afvinkverzoek en de server kosten samen soms veel), anders direct de widget bijwerken en verversen via een job.
     */
    private static void refreshWithin(Context app, long started) {
        if (SystemClock.elapsedRealtime() - started < 30_000) {
            Sync.refresh(app);
        } else {
            TaskWidgetProvider.updateAll(app);
            SyncJob.syncSoon(app, null, null, 0);
        }
    }

    private static void toast(Context app, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(app, msg, Toast.LENGTH_LONG).show());
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
