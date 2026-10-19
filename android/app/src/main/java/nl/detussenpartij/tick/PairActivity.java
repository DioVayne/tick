package nl.detussenpartij.tick;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;

/**
 * tick://pair?code=…: de PWA geeft een eenmalige koppelcode door. Doorzichtig: de app wisselt de code op de achtergrond
 * in voor een sleutel, vraagt zo nodig om meldingen en sluit; daarna staat de TWA er weer. Mislukt het, dan toont de
 * PWA zelf een knop om het opnieuw te proberen.
 */
public class PairActivity extends Activity {
    private static final int REQ_NOTIFICATIONS = 1;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String code = PairLink.code(getIntent().getDataString());
        if (code == null) {
            failed(getApplicationContext());
            finish();
            return;
        }
        final Context app = getApplicationContext();
        new Thread(() -> {
            boolean ok;
            try {
                String before = Prefs.userId(app);
                Api.Redeemed r = Api.redeem(app, code, Build.MODEL, Prefs.token(app));
                if (CacheWipe.shouldWipe(before, r.userId, CacheWipe.Reason.REDEEM)) {
                    // Een andere persoon: zijn cache en geofences mogen niet blijven staan.
                    Prefs.wipeAccountData(app);
                    Geo.apply(app, new JSONArray(), true);
                }
                Prefs.setToken(app, r.key);
                Prefs.setUserId(app, r.userId);
                TaskWidgetProvider.updateAll(app);
                // Nieuwe sleutel: de apparaatstatus opnieuw melden, net als na "Opslaan en testen".
                Prefs.setDeviceStatus(app, "", 0);
                Prefs.setSyncError(app, null);
                SyncJob.syncSoon(app, null, null, 0);
                DeviceStatus.report(app);
                ok = true;
            } catch (Exception e) {
                Log.w("Tick", "Koppelen mislukt", e);
                ok = false;
            }
            final boolean linked = ok;
            runOnUiThread(() -> done(linked));
        }).start();
    }

    private void done(boolean linked) {
        if (!linked) {
            // Ook als je het scherm intussen verliet: de melding gaat via de app-context, dus die komt toch.
            failed(getApplicationContext());
            finish();
            return;
        }
        if (isFinishing() || isDestroyed()) return;
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        } else {
            askBatteryAndFinish();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_NOTIFICATIONS) {
            // De meldingsstatus is net veranderd: opnieuw melden (DeviceStatus stuurt alleen als het anders is).
            final Context app = getApplicationContext();
            new Thread(() -> DeviceStatus.report(app)).start();
            askBatteryAndFinish();
        }
    }

    /** Na het koppelen ook de batterijvraag: zonder vrijstelling verversen widget en locatiemeldingen op sommige telefoons niet. */
    private void askBatteryAndFinish() {
        Battery.ask(this);
        finish();
    }

    private static void failed(Context app) {
        Toast.makeText(app, R.string.pair_failed, Toast.LENGTH_LONG).show();
    }
}
