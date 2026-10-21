package nl.detussenpartij.tick;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updatemelding voor de officiële app: één keer per dag kijkt de app op GitHub Releases of er een nieuwere versie is,
 * en meldt die één keer, met een tik naar de download. Een eigen build (ander applicationId) kijkt niet: die komt
 * niet van GitHub Releases.
 */
final class Updates {
    static final String CHANNEL = "updates";
    private static final String OFFICIAL_PACKAGE = "nl.detussenpartij.tick";
    private static final String LATEST_API = "https://api.github.com/repos/DioVayne/tick/releases/latest";
    /** Vaste naam in elke release (zie .github/workflows/android-release.yml), dus deze link blijft altijd goed. */
    private static final String DOWNLOAD = "https://github.com/DioVayne/tick/releases/latest/download/Tick.apk";
    private static final int NOTIFICATION_ID = 0x7ac0;

    private Updates() {}

    /** Kijkt als het een dag geleden is. Blokkeert (netwerk): alleen vanuit een achtergrondthread, zoals SyncJob. */
    static void checkIfDue(Context c) {
        if (!OFFICIAL_PACKAGE.equals(c.getPackageName())) return;
        long now = System.currentTimeMillis();
        if (!UpdateCheck.due(Prefs.updateCheckedAt(c), now)) return;
        // Ook bij een fout als gekeken tellen: anders probeert elke verversing (elk kwartier) het opnieuw.
        Prefs.setUpdateCheckedAt(c, now);
        String latest;
        try {
            latest = UpdateCheck.version(new JSONObject(fetch()).optString("tag_name"));
        } catch (Exception e) {
            Log.w("Tick", "updatecheck mislukt", e);
            return;
        }
        if (!UpdateCheck.isNewer(latest, BuildConfig.VERSION_NAME)) return;
        if (latest.equals(Prefs.updateNotified(c))) return; // deze versie al gemeld
        notify(c, latest);
        Prefs.setUpdateNotified(c, latest);
    }

    /** Voor de knop in MainActivity: alleen de officiële app haalt updates van GitHub Releases. */
    static boolean available(Context c) {
        return OFFICIAL_PACKAGE.equals(c.getPackageName());
    }

    /**
     * Kijkt meteen (de knop "Zoeken naar updates"), ook als het nog geen dag geleden is. Geeft de nieuwere versie, of
     * null als deze app de nieuwste is. Blokkeert (netwerk): alleen vanuit een achtergrondthread.
     */
    static String checkNow(Context c) throws Exception {
        Prefs.setUpdateCheckedAt(c, System.currentTimeMillis());
        String latest = UpdateCheck.version(new JSONObject(fetch()).optString("tag_name"));
        if (!UpdateCheck.isNewer(latest, BuildConfig.VERSION_NAME)) return null;
        Prefs.setUpdateNotified(c, latest); // al gezien via de knop: geen melding meer voor deze versie
        return latest;
    }

    /** Opent de download van de nieuwste APK (de browser of downloadmanager neemt hem over). */
    static Intent downloadIntent() {
        return new Intent(Intent.ACTION_VIEW, Uri.parse(DOWNLOAD));
    }

    private static String fetch() throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(LATEST_API).openConnection();
        try {
            con.setConnectTimeout(10_000);
            con.setReadTimeout(15_000);
            con.setRequestProperty("Accept", "application/vnd.github+json");
            con.setRequestProperty("User-Agent", "Tick-Android"); // GitHub weigert verzoeken zonder User-Agent
            if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
            try (InputStream in = con.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        } finally {
            con.disconnect();
        }
    }

    private static void notify(Context c, String version) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, c.getString(R.string.update_channel), NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(c, NOTIFICATION_ID,
                new Intent(Intent.ACTION_VIEW, Uri.parse(DOWNLOAD)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = c.getString(R.string.update_text);
        nm.notify(NOTIFICATION_ID, new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(c.getString(R.string.update_title, version))
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build());
    }
}
