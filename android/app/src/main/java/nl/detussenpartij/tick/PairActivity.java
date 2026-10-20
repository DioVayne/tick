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
 * wisselt de code op de achtergrond in voor een sleutel, vraagt zo nodig om locatie, meldingen en de batterij
 * (PairSteps) en sluit; daarna staat de TWA (of de browser) er weer. Mislukt het, dan toont de PWA zelf een knop om het opnieuw te proberen.
 */
public class PairActivity extends Activity {
    private static final int REQ_NOTIFICATIONS = 1;
    private static final int REQ_LOCATION = 2;
    private static final int REQ_BACKGROUND = 3;

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
        next(PairSteps.first(notificationsGranted(), granted(Manifest.permission.ACCESS_FINE_LOCATION),
                granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)));
    }

    /** Eén stap na het koppelen (zie PairSteps); elke stap gaat via een systeemvraag of dialoog naar de volgende. */
    private void next(PairSteps.Step step) {
        if (isFinishing() || isDestroyed()) return;
        switch (step) {
            case LOCATION:
                // Eerst uitleggen waarom: anders komt de locatievraag van Android uit het niets.
                new AlertDialog.Builder(this)
                        .setTitle(R.string.pair_loc_title)
                        .setMessage(R.string.pair_loc_text)
                        .setPositiveButton(R.string.pair_loc_ok, (dlg, w) -> requestPermissions(foregroundPermissions(), REQ_LOCATION))
                        .setNegativeButton(R.string.pair_loc_later, (dlg, w) -> next(PairSteps.skipLocation(notificationsGranted())))
                        .setOnCancelListener(dlg -> next(PairSteps.skipLocation(notificationsGranted())))
                        .show();
                break;
            case BACKGROUND:
                // "Altijd toestaan" staat nooit in de eerste systeemvraag; deze vraag opent het locatiescherm van Tick.
                new AlertDialog.Builder(this)
                        .setTitle(R.string.loc_background_title)
                        .setMessage(getText(R.string.loc_background_text))
                        .setPositiveButton(android.R.string.ok, (dlg, w) -> requestPermissions(
                                new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BACKGROUND))
                        .setNegativeButton(android.R.string.cancel, (dlg, w) -> askBatteryAndFinish())
                        .setOnCancelListener(dlg -> askBatteryAndFinish())
                        .show();
                break;
            case NOTIFICATIONS:
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
                break;
            default:
                askBatteryAndFinish();
        }
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean notificationsGranted() {
        return Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS);
    }

    /** Locatie en meldingen in één systeemvraag, zoals in "Tick op deze telefoon". */
    private String[] foregroundPermissions() {
        return notificationsGranted()
                ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}
                : new String[]{Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION};
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        // De status is net veranderd: opnieuw melden (DeviceStatus stuurt alleen als het anders is), en met
        // locatie de geofences meteen zetten.
        final Context app = getApplicationContext();
        new Thread(() -> {
            if (Geo.permitted(app)) Geo.applyFromCache(app, true);
            DeviceStatus.report(app);
        }).start();
        boolean background = granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        if (code == REQ_LOCATION) next(PairSteps.afterLocation(granted(Manifest.permission.ACCESS_FINE_LOCATION), background));
        else askBatteryAndFinish();
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
