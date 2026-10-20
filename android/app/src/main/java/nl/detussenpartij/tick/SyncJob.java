package nl.detussenpartij.tick;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Verversen op de achtergrond, zodat nieuwe of gewijzigde plekken ook zonder widget of herstart een geofence krijgen.
 * Job 1: elke 15 minuten (met netwerk). Job 2: zo snel mogelijk, bijvoorbeeld na een plek in de PWA (tick://sync).
 * Job 3: direct (expedited), na een tik op de verversknop van de widget.
 */
public class SyncJob extends JobService {
    static final int PERIODIC = 1;
    static final int SOON = 2;
    static final int MANUAL = 3;
    /** Zoveel keer opnieuw (elke 10 s) als de server de wijziging uit de PWA nog niet heeft: samen ongeveer een minuut. */
    private static final int MAX_ATTEMPTS = 5;

    /** Plant het periodieke verversen, alleen als het er nog niet staat. Blijft staan na een herstart. */
    static void schedulePeriodic(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js.getPendingJob(PERIODIC) != null) return;
        js.schedule(new JobInfo.Builder(PERIODIC, new ComponentName(c, SyncJob.class))
                .setPeriodic(15 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build());
    }

    /**
     * Eén keer verversen zodra er netwerk is. Met een taak en zijn vorige updated_at (since) kijkt de job daarna of
     * de wijziging al op de server staat, en probeert hij het anders na 10 seconden opnieuw.
     */
    static void syncSoon(Context c, String taskId, String since, int attempt) {
        PersistableBundle extras = new PersistableBundle();
        extras.putString("task", taskId == null ? "" : taskId);
        extras.putString("since", since == null ? "" : since);
        extras.putInt("attempt", attempt);
        c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(SOON, new ComponentName(c, SyncJob.class))
                .setMinimumLatency(attempt == 0 ? 0 : 10_000)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setExtras(extras)
                .build());
    }

    /**
     * Nu verversen omdat de gebruiker erom vroeg. Expedited, zodat hij meteen loopt en de app niet bevriest; zonder
     * netwerkvoorwaarde, zodat je offline direct "geen verbinding" ziet. Lukt plannen niet (quotum), dan job 2.
     */
    static void syncNow(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        int r;
        try {
            r = js.schedule(new JobInfo.Builder(MANUAL, new ComponentName(c, SyncJob.class)).setExpedited(true).build());
        } catch (RuntimeException e) {
            r = JobScheduler.RESULT_FAILURE;
        }
        if (r != JobScheduler.RESULT_SUCCESS) syncSoon(c, null, null, 0);
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        final Context app = getApplicationContext();
        new Thread(() -> {
            Log.i("Tick", "SyncJob " + params.getJobId() + ": verversen");
            if (!Prefs.token(app).isEmpty()) Sync.refresh(app);
            Updates.checkIfDue(app);
            if (params.getJobId() == MANUAL) {
                TaskWidgetProvider.manualRefreshFinished(app);
                jobFinished(params, false);
                return;
            }
            PersistableBundle extras = params.getExtras();
            String task = extras.getString("task", "");
            String since = extras.getString("since", "");
            int attempt = extras.getInt("attempt", 0);
            // Eerst afmelden: een nieuwe job met hetzelfde id zou deze (nog lopende) anders stoppen.
            jobFinished(params, false);
            if (params.getJobId() == SOON && !task.isEmpty() && !Prefs.token(app).isEmpty()
                    && since.equals(updatedAt(app, task)) && attempt < MAX_ATTEMPTS) {
                Log.i("Tick", "SyncJob: taak nog niet gewijzigd op de server, poging " + (attempt + 1));
                syncSoon(app, task, since, attempt + 1);
            }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // bijvoorbeeld netwerk weg: later opnieuw
    }

    /** updated_at van de taak in de laatst opgehaalde lijst, of "" als hij er niet (meer) in staat. */
    private static String updatedAt(Context c, String id) {
        try {
            JSONArray arr = new JSONArray(Prefs.cache(c));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject t = arr.optJSONObject(i);
                if (t != null && id.equals(t.optString("id"))) return t.optString("updated_at");
            }
        } catch (Exception ignored) {
            // lege of kapotte cache: behandelen als "niet gevonden"
        }
        return "";
    }
}
