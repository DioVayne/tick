package nl.detussenpartij.tick;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONArray;

/**
 * Testfeature "condall": een onnauwkeurige wekker (setAndAllowWhileIdle, geen toestemming voor exacte wekkers nodig)
 * op de eerstvolgende poort van een taak in de stand "Pas als alles klopt". Gaat hij af, dan zet de app de geofences
 * opnieuw vanuit de cache; die taak komt er dan bij (zie CondAll). Een paar minuten te laat is goed; mist hij (herstart),
 * dan doet de sync van elke 15 minuten hetzelfde.
 */
public class CondAllAlarm extends BroadcastReceiver {
    private static final int REQUEST = 7;

    private static PendingIntent intent(Context app) {
        return PendingIntent.getBroadcast(app, REQUEST, new Intent(app, CondAllAlarm.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Zet (of verzet) de wekker op de eerstvolgende poort in deze lijst, of haalt hem weg als er geen is. */
    static void schedule(Context c, JSONArray tasks) {
        try {
            Context app = c.getApplicationContext();
            AlarmManager am = app.getSystemService(AlarmManager.class);
            long at = CondAll.next(tasks, System.currentTimeMillis());
            if (at < 0) {
                am.cancel(intent(app));
                return;
            }
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent(app));
        } catch (Exception e) {
            // Een fout hier mag het zetten van de geofences nooit tegenhouden.
            Log.w("Tick", "condall-wekker zetten mislukt", e);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        Geo.applyFromCache(context.getApplicationContext(), false, GeoLog.Why.CHANGED);
    }
}
