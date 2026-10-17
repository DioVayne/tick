package nl.detussenpartij.tick;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

public class TaskWidgetProvider extends AppWidgetProvider {
    static final String ACTION_REFRESH = BuildConfig.APPLICATION_ID + ".REFRESH";
    /** Interval van het automatisch verversen. */
    private static final long REFRESH_INTERVAL_MS = AlarmManager.INTERVAL_FIFTEEN_MINUTES / 3;
    /** Alleen de knop zet dit; het automatisch verversen blijft stil. */
    private static final String EXTRA_MANUAL = "manual";
    /** Zo lang wacht een tik op de knop op de server, ruim binnen de 10 s die een broadcast mag duren. */
    private static final long MANUAL_WAIT_MS = 6000;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.list);
        scheduleRefresh(context);
        SyncJob.schedulePeriodic(context);
        syncInBackground(context);
    }

    @Override
    public void onEnabled(Context context) {
        scheduleRefresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        am.cancel(refreshIntent(context));
    }

    /**
     * Ververst elke 5 minuten, maar zuinig: een niet-wakkermakende, onnauwkeurige alarm.
     * Die wekt de telefoon nooit zelf; hij gaat af wanneer het toestel toch al wakker is
     * (scherm aan, ontgrendeld) en wordt in Doze vanzelf uitgesteld. Na een herstart roept
     * Android onUpdate aan, waardoor het alarm opnieuw wordt gezet.
     */
    private static void scheduleRefresh(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME,
                SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MS, REFRESH_INTERVAL_MS, refreshIntent(context));
    }

    private static PendingIntent refreshIntent(Context c) {
        return PendingIntent.getBroadcast(c, 3,
                new Intent(c, TaskWidgetProvider.class).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE);
    }

    /** De knop: dezelfde actie, maar met EXTRA_MANUAL (eigen request code, anders deelt hij de PendingIntent met het alarm). */
    private static PendingIntent manualRefreshIntent(Context c) {
        return PendingIntent.getBroadcast(c, 4,
                new Intent(c, TaskWidgetProvider.class).setAction(ACTION_REFRESH).putExtra(EXTRA_MANUAL, true),
                PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_REFRESH.equals(intent.getAction())) return;
        if (intent.getBooleanExtra(EXTRA_MANUAL, false)) {
            // Binnen de tik verversen (de app is dan actief), met als bevestiging de nieuwe tijd in de statusregel van
            // de lijst. Duurt het te lang, dan neemt een expedited job het over (een draad uit goAsync() kan bevriezen).
            final Context app = context.getApplicationContext();
            Thread sync = new Thread(() -> Sync.refresh(app));
            sync.start();
            try {
                sync.join(MANUAL_WAIT_MS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            updateAll(context);
            if (sync.isAlive()) SyncJob.syncNow(context);
        } else {
            updateAll(context);
            syncInBackground(context);
        }
    }

    /**
     * Na de handmatige verversing (in SyncJob): een toast met "Bijgewerkt ✓" of de fout, ook als er niets veranderd is.
     * Geen statusregel in de widget: Android 16 houdt widget-updates van een app op de achtergrond tegen
     * ("update deferred") en niet elke launcher haalt die later op, dus zo'n regel kon blijven hangen. Een toast
     * toont het systeem zelf.
     */
    /** Tijd van de laatste geslaagde verversing: vandaag alleen de tijd, anders met datum. */
    static String syncTime(Context c, long ms) {
        if (ms <= 0) return "";
        java.util.Date when = new java.util.Date(ms);
        String time = android.text.format.DateFormat.getTimeFormat(c).format(when);
        if (android.text.format.DateUtils.isToday(ms)) return time;
        return android.text.format.DateFormat.format("d MMM", when) + " " + time;
    }

    /** Terugval via SyncJob 3 (de tik duurde te lang): de widget kan het dan niet tonen, dus een toast. */
    static void manualRefreshFinished(Context app) {
        String error = Prefs.syncError(app);
        String text = error.isEmpty() ? app.getString(R.string.widget_refreshed) : error;
        // Wachten tot de toast is doorgegeven: na jobFinished kan Android de app meteen weer bevriezen.
        java.util.concurrent.CountDownLatch shown = new java.util.concurrent.CountDownLatch(1);
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            try {
                android.widget.Toast.makeText(app, text, android.widget.Toast.LENGTH_SHORT).show();
            } finally {
                shown.countDown();
            }
        });
        try {
            shown.await(2, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    /** Haalt de lijst van de server op, zonder de hoofdthread te blokkeren. */
    private void syncInBackground(Context context) {
        final Context app = context.getApplicationContext();
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                Sync.refresh(app);
            } finally {
                result.finish();
            }
        }).start();
    }

    /** Bouwt alle widgets opnieuw op vanuit de opgeslagen lijst (direct, zonder netwerk). */
    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TaskWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    private static RemoteViews build(Context c, int widgetId) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_tasks);

        Intent svc = new Intent(c, TaskListService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.list, svc);
        // Status (bijgewerkt, fout, niets te doen) staat als eerste regel in de lijst; zie TaskListService.statusRow.

        // Sjabloon voor klikken op een rij; id en actie (afvinken/openen) komen via de fill-in intent van elke rij.
        rv.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(c, 0,
                new Intent(c, WidgetClickActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));

        rv.setOnClickPendingIntent(R.id.header_title, PendingIntent.getActivity(c, 1,
                new Intent(Intent.ACTION_VIEW, Uri.parse(Api.BASE)), PendingIntent.FLAG_IMMUTABLE));
        rv.setOnClickPendingIntent(R.id.btn_add, PendingIntent.getActivity(c, 2,
                new Intent(c, QuickAddActivity.class), PendingIntent.FLAG_IMMUTABLE));
        rv.setOnClickPendingIntent(R.id.btn_refresh, manualRefreshIntent(c));
        return rv;
    }
}
