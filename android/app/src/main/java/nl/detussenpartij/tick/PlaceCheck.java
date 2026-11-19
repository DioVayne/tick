package nl.detussenpartij.tick;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Testfeature "placecheck" (zie ARCHITECTURE.md, Testfeatures): een blok in "Tick op deze telefoon" met
 * 1. een proefmelding: 15 seconden na de knop een melding in het kanaal "locatie", via een wekker van Android, zodat
 *    je met een vergrendeld scherm ziet of een Tick-melding doorkomt; en
 * 2. uitleg per merk telefoon: waar je de batterijbeperking voor Tick uitzet, met een knop naar de app-instellingen.
 * Het blok staat er alleen als de gekoppelde Tick "placecheck" in TEST_FEATURES heeft.
 */
final class PlaceCheck {
    static final String FEATURE = "placecheck";
    private static final String FILE = "tick_placecheck";
    private static final String REQUESTED = "requested";
    private static final String FIRED = "fired";
    private static final String SHOWN = "shown";
    private static final String LOCKED = "locked";
    /** Vaste id voor de proefmelding (botst niet met id.hashCode() van een taak in de praktijk; dezelfde proef vervangt zichzelf). */
    private static final int NOTIFICATION_ID = 0x71C4;

    private final Activity a;
    private final LinearLayout box;
    private final TextView status;

    private PlaceCheck(Activity a, LinearLayout box, TextView status) {
        this.a = a;
        this.box = box;
        this.status = status;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** Bouwt het blok onderaan root (verborgen tot refresh weet dat de testfeature aanstaat). */
    static PlaceCheck addTo(Activity a, LinearLayout root) {
        float d = a.getResources().getDisplayMetrics().density;
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setVisibility(View.GONE);
        root.addView(box);

        TextView title = new TextView(a);
        title.setText(R.string.placecheck_title);
        title.setTextSize(18);
        title.setPadding(0, (int) (12 * d), 0, (int) (4 * d));
        box.addView(title);

        TextView help = new TextView(a);
        help.setText(R.string.placecheck_help);
        box.addView(help);

        Button test = new Button(a);
        test.setText(R.string.placecheck_button);
        test.setOnClickListener(v -> schedule(a));
        box.addView(test);

        TextView status = new TextView(a);
        status.setPadding(0, (int) (4 * d), 0, (int) (12 * d));
        box.addView(status);

        TextView brandTitle = new TextView(a);
        brandTitle.setText(a.getString(R.string.placecheck_brand_title, brandName()));
        brandTitle.setTextSize(16);
        brandTitle.setPadding(0, (int) (8 * d), 0, (int) (4 * d));
        box.addView(brandTitle);

        TextView steps = new TextView(a);
        steps.setText(steps(PlaceCheckPlan.brand(Build.MANUFACTURER, Build.BRAND)));
        box.addView(steps);

        Button settings = new Button(a);
        settings.setText(R.string.placecheck_open_settings);
        settings.setOnClickListener(v -> a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", a.getPackageName(), null))));
        box.addView(settings);

        return new PlaceCheck(a, box, status);
    }

    /** Toont de status nu, en haalt op de achtergrond op of de testfeature (nog) aanstaat. Uit onResume. */
    void refresh() {
        show();
        new Thread(() -> {
            if (Features.refresh(a)) a.runOnUiThread(() -> {
                if (!a.isFinishing()) show();
            });
        }).start();
    }

    private void show() {
        if (!Features.on(a, FEATURE)) {
            box.setVisibility(View.GONE);
            return;
        }
        box.setVisibility(View.VISIBLE);
        SharedPreferences p = prefs(a);
        long requested = p.getLong(REQUESTED, 0);
        long fired = p.getLong(FIRED, 0);
        switch (PlaceCheckPlan.result(requested, fired, p.getBoolean(SHOWN, false), System.currentTimeMillis())) {
            case NONE: status.setText(R.string.placecheck_status_none); break;
            case WAITING: status.setText(R.string.placecheck_status_waiting); break;
            case BLOCKED: status.setText(R.string.placecheck_status_blocked); break;
            case MISSING: status.setText(R.string.placecheck_status_missing); break;
            case ARRIVED:
                long late = PlaceCheckPlan.lateSeconds(requested, fired);
                String when = a.getString(late <= 5 ? R.string.placecheck_on_time : R.string.placecheck_late, late);
                status.setText(a.getString(p.getBoolean(LOCKED, false)
                        ? R.string.placecheck_status_arrived_locked : R.string.placecheck_status_arrived_unlocked, when));
                break;
        }
    }

    /** Zet de wekker voor de proefmelding (onnauwkeurig mag: geen extra toestemming nodig, en 15 s is geen afspraak). */
    private static void schedule(Activity a) {
        prefs(a).edit().putLong(REQUESTED, System.currentTimeMillis()).putLong(FIRED, 0).apply();
        a.getSystemService(AlarmManager.class).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + PlaceCheckPlan.DELAY_MS, pending(a));
        Toast.makeText(a, R.string.placecheck_scheduled, Toast.LENGTH_LONG).show();
    }

    private static PendingIntent pending(Context c) {
        return PendingIntent.getBroadcast(c, NOTIFICATION_ID, new Intent(c, Receiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** De wekker gaat af: de proefmelding tonen en vastleggen hoe het ging (getoond, scherm op slot). */
    public static final class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            boolean shown = !Notify.channelBlocked(c) && nm.areNotificationsEnabled();
            if (shown) {
                PendingIntent open = PendingIntent.getActivity(c, NOTIFICATION_ID, new Intent(c, MainActivity.class),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification n = new Notification.Builder(c, Notify.CHANNEL)
                        .setSmallIcon(R.drawable.ic_notify_place)
                        .setContentTitle(c.getString(R.string.placecheck_notification_title))
                        .setContentText(c.getString(R.string.placecheck_notification_text))
                        .setStyle(new Notification.BigTextStyle().bigText(c.getString(R.string.placecheck_notification_text)))
                        .setCategory(Notification.CATEGORY_REMINDER)
                        .setContentIntent(open)
                        .setAutoCancel(true)
                        .build();
                try {
                    nm.notify(NOTIFICATION_ID, n);
                } catch (SecurityException e) {
                    shown = false; // geen toestemming voor meldingen
                }
            }
            KeyguardManager km = c.getSystemService(KeyguardManager.class);
            prefs(c).edit().putLong(FIRED, System.currentTimeMillis()).putBoolean(SHOWN, shown)
                    .putBoolean(LOCKED, km != null && km.isKeyguardLocked()).apply();
        }
    }

    /** De naam van het merk zoals de telefoon hem noemt (eerste letter hoofdletter), of "Android". */
    private static String brandName() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        if (m.isEmpty()) return "Android";
        return m.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + m.substring(1);
    }

    private static int steps(PlaceCheckPlan.Brand brand) {
        switch (brand) {
            case XIAOMI: return R.string.placecheck_steps_xiaomi;
            case SAMSUNG: return R.string.placecheck_steps_samsung;
            case ONEPLUS: return R.string.placecheck_steps_oneplus;
            case VIVO: return R.string.placecheck_steps_vivo;
            case HUAWEI: return R.string.placecheck_steps_huawei;
            default: return R.string.placecheck_steps_other;
        }
    }
}
