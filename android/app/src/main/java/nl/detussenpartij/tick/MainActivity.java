package nl.detussenpartij.tick;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** "Tick op deze telefoon": koppelstatus, locatiemeldingen, widget en (ingeklapt) de sleutel met de hand. Ook via tick://settings. */
public class MainActivity extends Activity {
    private static final int REQ_FOREGROUND = 1;

    private TextView result;
    private TextView locStatus;
    private TextView pairStatus;

    /**
     * Wat de app bij elke start nodig heeft: periodiek verversen, het kanaal "locatie" (zodat het in de instellingen staat
     * voordat de eerste melding komt) en de snelkoppelingen. Ook vanuit TickLauncherActivity, de gewone ingang.
     */
    static void setUp(Context c) {
        SyncJob.schedulePeriodic(c);
        Notify.ensureChannel(c);
        addShortcuts(c);
    }

    /**
     * Snelkoppelingen bij lang indrukken van het app-icoon: "Nieuwe taak" en "Telefooninstellingen". Dynamisch in plaats
     * van in res/xml, omdat die het applicationId vast zou moeten noemen, en dat verschilt per eigen build. Een ander id
     * dan de oude statische "add".
     */
    private static void addShortcuts(Context c) {
        ShortcutManager sm = c.getSystemService(ShortcutManager.class);
        if (sm == null) return;
        ShortcutInfo add = new ShortcutInfo.Builder(c, "quick_add")
                .setShortLabel(c.getString(R.string.shortcut_add))
                .setIcon(Icon.createWithResource(c, R.drawable.ic_add))
                .setIntent(new Intent(Intent.ACTION_VIEW).setClass(c, QuickAddActivity.class))
                .build();
        ShortcutInfo settings = new ShortcutInfo.Builder(c, "phone_settings")
                .setShortLabel(c.getString(R.string.shortcut_phone_settings))
                .setIcon(Icon.createWithResource(c, R.mipmap.ic_launcher))
                .setIntent(new Intent(Intent.ACTION_VIEW).setClass(c, MainActivity.class))
                .build();
        // Een vastgepinde snelkoppeling uit een oudere versie (id "add", uit res/xml) mag de app nooit laten crashen.
        try {
            sm.setDynamicShortcuts(Arrays.asList(add, settings));
        } catch (RuntimeException e) {
            android.util.Log.w("Tick", "snelkoppeling niet gezet", e);
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setUp(this);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(R.string.phone_title);
        title.setTextSize(26);
        root.addView(title);
        setTitle(R.string.phone_title);

        pairStatus = new TextView(this);
        pairStatus.setPadding(0, (int) (8 * d), 0, (int) (8 * d));
        root.addView(pairStatus);

        Button open = new Button(this);
        open.setText(R.string.open_tick);
        open.setOnClickListener(v -> startActivity(new Intent(this, TickLauncherActivity.class)));
        root.addView(open);

        Button add = new Button(this);
        add.setText(R.string.add);
        add.setOnClickListener(v -> startActivity(new Intent(this, QuickAddActivity.class)));
        root.addView(add);

        Button loc = new Button(this);
        loc.setText(R.string.loc_button);
        loc.setOnClickListener(v -> enableLocation());
        root.addView(loc);

        locStatus = new TextView(this);
        locStatus.setPadding(0, (int) (4 * d), 0, (int) (12 * d));
        root.addView(locStatus);

        Button look = new Button(this);
        look.setText(R.string.widget_settings);
        look.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        root.addView(look);

        // Ingeklapt: de sleutel met de hand, voor als koppelen via Tick niet lukt.
        LinearLayout advanced = new LinearLayout(this);
        advanced.setOrientation(LinearLayout.VERTICAL);
        advanced.setVisibility(View.GONE);

        Button toggle = new Button(this, null, android.R.attr.borderlessButtonStyle);
        toggle.setText(getString(R.string.advanced_key) + " ▸");
        toggle.setOnClickListener(v -> {
            boolean show = advanced.getVisibility() != View.VISIBLE;
            advanced.setVisibility(show ? View.VISIBLE : View.GONE);
            toggle.setText(getString(R.string.advanced_key) + (show ? " ▾" : " ▸"));
        });
        root.addView(toggle);
        root.addView(advanced);

        TextView help = new TextView(this);
        help.setText(R.string.main_help);
        help.setPadding(0, (int) (8 * d), 0, (int) (8 * d));
        advanced.addView(help);

        EditText token = new EditText(this);
        token.setHint(R.string.main_token_hint);
        token.setSingleLine(true);
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        token.setText(Prefs.token(this));
        advanced.addView(token);

        Button save = new Button(this);
        save.setText(R.string.main_save_test);
        save.setOnClickListener(v -> {
            Prefs.setToken(this, token.getText().toString());
            // Nieuwe of opnieuw gekoppelde sleutel: bij de volgende sync de apparaatstatus opnieuw melden.
            Prefs.setDeviceStatus(this, "", 0);
            result.setText(R.string.main_busy);
            updatePairStatus();
            test();
        });
        advanced.addView(save);

        result = new TextView(this);
        result.setPadding(0, (int) (12 * d), 0, (int) (12 * d));
        advanced.addView(result);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        scroll.setFitsSystemWindows(true); // edge-to-edge vanaf targetSdk 35
        setContentView(scroll);
    }

    /** Gekoppeld of niet; een 401 (ingetrokken sleutel) maakt de sleutel leeg, dus dit volgt dat vanzelf. */
    private void updatePairStatus() {
        pairStatus.setText(Prefs.token(this).isEmpty() ? R.string.pair_status_not_linked : R.string.pair_status_linked);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updatePairStatus();
        updateLocStatus();
        // Zonder toestemming of na "locatie uit" is de signature gewist: dan alles opnieuw zetten. Anders alleen
        // als de set veranderd is; elke keer opnieuw registreren kan een nog niet afgeleverde aankomst wissen.
        if (Geo.permitted(this)) {
            Geo.applyFromCache(this, Prefs.geoSig(this).isEmpty());
        } else {
            // Bij het intrekken gooien Play-diensten de geofences weg (en stopt Android het proces), maar de
            // signature bleef staan. Wissen, zodat de eerste apply na het teruggeven alles opnieuw zet.
            Prefs.setGeoSig(this, null);
        }
        // Bij openen ook de lijst ophalen (op de achtergrond), bijvoorbeeld voor een plek die op de laptop gezet is.
        if (!Prefs.token(this).isEmpty()) SyncJob.syncSoon(this, null, null, 0);
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean notificationsOk() {
        return DeviceStatus.notificationsOk(this);
    }

    /** Locatie staat aan in de systeeminstellingen (snelle instellingen); zonder gaan geofences niet af. */
    private boolean systemLocationOn() {
        return getSystemService(LocationManager.class).isLocationEnabled();
    }

    private void updateLocStatus() {
        List<String> missing = new ArrayList<>();
        if (!notificationsOk()) missing.add(getString(R.string.loc_missing_notifications));
        else if (Notify.channelBlocked(this)) missing.add(getString(R.string.loc_missing_channel));
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) missing.add(getString(R.string.loc_missing_location));
        if (!granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) missing.add(getString(R.string.loc_missing_background));
        if (!systemLocationOn()) missing.add(getString(R.string.loc_missing_system_location));
        locStatus.setText(missing.isEmpty() ? getString(R.string.loc_status_on)
                : getString(R.string.loc_status_missing, String.join(", ", missing)));
    }

    /** Vraagt de toestemmingen achter elkaar: eerst meldingen en locatie, daarna apart "Altijd toestaan". */
    private void enableLocation() {
        if (!notificationsOk() || !granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            List<String> ask = new ArrayList<>();
            if (Build.VERSION.SDK_INT >= 33) ask.add(Manifest.permission.POST_NOTIFICATIONS);
            ask.add(Manifest.permission.ACCESS_FINE_LOCATION);
            ask.add(Manifest.permission.ACCESS_COARSE_LOCATION);
            requestPermissions(ask.toArray(new String[0]), REQ_FOREGROUND);
        } else if (!granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.loc_background_title)
                    .setMessage(getText(R.string.loc_background_text))
                    // Direct naar de instellingen van de app: daar komt de systeemvraag vanaf Android 11 ook op uit,
                    // en zo werkt het ook als "Altijd toestaan" eerder geweigerd is. onResume ziet het resultaat.
                    .setPositiveButton(android.R.string.ok, (dlg, w) -> openAppSettings())
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        } else if (Notify.channelBlocked(this)) {
            // Toestemming is er, maar het kanaal "locatie" staat uit: dat kan alleen in de instellingen.
            startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, Notify.CHANNEL));
        } else if (!systemLocationOn()) {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } else {
            Geo.applyFromCache(this, true);
            updateLocStatus();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        updateLocStatus();
        if (code == REQ_FOREGROUND) {
            if (notificationsOk() && granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
                enableLocation(); // volgende stap: "Altijd toestaan"
            } else if (!canAskAgain()) {
                // Eerder geweigerd: Android vraagt het niet nog eens, dus naar de instellingen van de app.
                openAppSettings();
            }
        }
    }

    private void openAppSettings() {
        Toast.makeText(this, R.string.loc_settings_hint, Toast.LENGTH_LONG).show();
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null)));
    }

    /** Of Android de ontbrekende meldings- en locatietoestemming nog in een dialoog wil vragen. */
    private boolean canAskAgain() {
        // Toestemming wel gegeven, maar meldingen in de app-instellingen uitgezet: dat kan alleen daar terug.
        if ((Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
                && !getSystemService(NotificationManager.class).areNotificationsEnabled()) return false;
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)
                && !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)) return false;
        return Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)
                || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS);
    }

    private void test() {
        new Thread(() -> {
            String msg;
            try {
                int n = new JSONArray(Api.call(this, "GET", "/api/tasks", null)).length();
                msg = getString(R.string.main_connected, n);
                Sync.refresh(this);
            } catch (Exception e) {
                msg = getString(R.string.failed, e.getMessage());
            }
            final String shown = msg;
            runOnUiThread(() -> {
                result.setText(shown);
                updatePairStatus(); // een 401 heeft de sleutel misschien net gewist
            });
        }).start();
    }
}
