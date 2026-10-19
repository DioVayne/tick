package nl.detussenpartij.tick;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONArray;

/**
 * tick://pair?code=…&base=…: de PWA geeft een eenmalige koppelcode en haar adres door (vanuit de app, of vanuit de
 * browser op de telefoon). Is het adres nieuw of anders, dan vraagt de app eerst of dat klopt. Doorzichtig: de app
 * wisselt de code op de achtergrond in voor een sleutel, vraagt zo nodig om meldingen en sluit; daarna staat de TWA
 * (of de browser) er weer. Mislukt het, dan toont de PWA zelf een knop om het opnieuw te proberen.
 */
public class PairActivity extends Activity {
    private static final int REQ_NOTIFICATIONS = 1;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String data = getIntent().getDataString();
        String code = PairLink.code(data);
        // Het adres uit de link (nieuwere PWA), anders het adres dat de app al heeft.
        String linked = PairLink.base(data);
        String current = Prefs.base(this);
        String base = linked != null ? linked : current;
        if (code == null || base.isEmpty()) {
            failed(getApplicationContext());
            finish();
            return;
        }
        if (TickAddress.sameOrigin(current, base)) {
            redeem(code, base, false);
            return;
        }
        // Een andere (of eerste) Tick: eerst vragen. Zo kan een willekeurige link de app niet naar een andere server sturen.
        String host = TickAddress.host(base);
        new AlertDialog.Builder(this)
                .setTitle(getString(R.string.pair_confirm_title, host))
                .setMessage(current.isEmpty() ? getString(R.string.pair_confirm_new, host)
                        : getString(R.string.pair_confirm_switch, TickAddress.host(current), host))
                .setPositiveButton(R.string.pair_confirm_ok, (dlg, w) -> redeem(code, base, true))
                .setNegativeButton(android.R.string.cancel, (dlg, w) -> finish())
                .setOnCancelListener(dlg -> finish())
                .show();
    }

    /** Wisselt de code in bij base. Bij een andere Tick gaat de oude sleutel niet mee, en pas na succes het nieuwe adres in. */
    private void redeem(String code, String base, boolean switching) {
        final Context app = getApplicationContext();
        new Thread(() -> {
            boolean ok;
            try {
                String before = Prefs.userId(app);
                Api.Redeemed r = Api.redeem(base, code, Build.MODEL, switching ? null : Prefs.token(app));
                if (switching) {
                    SetupActivity.useAddress(app, base);
                } else if (CacheWipe.shouldWipe(before, r.userId, CacheWipe.Reason.REDEEM)) {
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
