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
    private static final int REQ_BACKGROUND = 2;
    private static final int REQ_ACTIVITY = 3;

    private TextView result;
    private TextView locStatus;
    private TextView locStats;
    private Button road;
    private TextView roadStatus;
    private TextView pairStatus;
    private TextView addressStatus;
    private TextView batteryStatus;
    private Button battery;

    /**
     * Wat de app bij elke start nodig heeft: periodiek verversen, het kanaal "locatie" (zodat het in de instellingen staat
     * voordat de eerste melding komt) en de snelkoppelingen. Ook vanuit TickLauncherActivity, de gewone ingang.
     * En de widget opnieuw opbouwen: na "Gedwongen stoppen" (of een systeem dat de app zo stopt) zijn zijn klikacties
     * weg, en een opbouw vanaf de achtergrond houden sommige launchers tegen (Android 16+, "update deferred"); vanaf de
     * voorgrond niet.
     */
    static void setUp(Context c) {
        SyncJob.schedulePeriodic(c);
        Notify.ensureChannel(c);
        addShortcuts(c);
        TaskWidgetProvider.updateAll(c);
        // Na "Gedwongen stoppen" werken de geofences niet meer, terwijl de signature nog zegt dat ze staan.
        if (Geo.permitted(c) && !Geo.intentAlive(c)) {
            Prefs.setGeoSig(c, null);
            Geo.applyFromCache(c, true);
        }
        // Ook na "Gedwongen stoppen" is het abonnement op rijden en fietsen weg; opnieuw abonneren mag altijd.
        Road.subscribe(c);
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

        // Het adres van je Tick; wijzigen gaat via hetzelfde scherm als de eerste start.
        addressStatus = new TextView(this);
        addressStatus.setPadding(0, 0, 0, (int) (8 * d));
        root.addView(addressStatus);

        Button address = new Button(this, null, android.R.attr.borderlessButtonStyle);
        address.setText(R.string.address_change);
        address.setOnClickListener(v -> startActivity(new Intent(this, SetupActivity.class)));
        root.addView(address);

        Button open = new Button(this);
        open.setText(R.string.open_tick);
        // Dit scherm sluiten: anders komt een tweede Tick bovenop de TWA waar je vandaan kwam (tick://settings).
        open.setOnClickListener(v -> {
            startActivity(new Intent(this, TickLauncherActivity.class));
            finish();
        });
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

        // Hoe laat aankomstmeldingen kwamen (ArrivalStats); verborgen zolang er geen metingen zijn.
        locStats = new TextView(this);
        locStats.setPadding(0, 0, 0, (int) (12 * d));
        root.addView(locStats);

        // "Op tijd melden onderweg": knop, vaste uitleg en status.
        road = new Button(this);
        road.setOnClickListener(v -> toggleRoad());
        root.addView(road);

        TextView roadHelp = new TextView(this);
        roadHelp.setText(R.string.road_help);
        roadHelp.setPadding(0, (int) (4 * d), 0, (int) (4 * d));
        root.addView(roadHelp);

        roadStatus = new TextView(this);
        roadStatus.setPadding(0, 0, 0, (int) (12 * d));
        root.addView(roadStatus);

        battery = new Button(this);
        battery.setText(R.string.battery_button);
        battery.setOnClickListener(v -> Battery.ask(this));
        root.addView(battery);

        batteryStatus = new TextView(this);
        batteryStatus.setPadding(0, (int) (4 * d), 0, (int) (12 * d));
        root.addView(batteryStatus);

        Button look = new Button(this);
        look.setText(R.string.widget_settings);
        look.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
        root.addView(look);

        // Alleen de officiële app: een eigen build komt niet van GitHub Releases.
        if (Updates.available(this)) {
            Button update = new Button(this);
            update.setText(R.string.update_check);
            update.setOnClickListener(v -> checkForUpdate(update));
            root.addView(update);
        }

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
            String entered = token.getText().toString().trim();
            if (!entered.equals(Prefs.token(this))) {
                // Een handmatige sleutel kan van iedereen zijn: gegevens van de vorige sleutel wissen.
                Prefs.wipeAccountData(this);
                Prefs.setUserId(this, "");
                Geo.apply(this, new JSONArray(), true);
            }
            Prefs.setToken(this, entered);
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
        String base = Prefs.base(this);
        addressStatus.setText(base.isEmpty() ? getString(R.string.address_none) : getString(R.string.address_current, TickAddress.host(base)));
    }

    @Override
    protected void onResume() {
        super.onResume();
        updatePairStatus();
        updateLocStatus();
        updateBatteryStatus();
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

    private void updateBatteryStatus() {
        boolean free = Battery.unrestricted(this);
        batteryStatus.setText(free ? R.string.battery_status_free : R.string.battery_status_limited);
        battery.setVisibility(free ? View.GONE : View.VISIBLE);
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
        updateLocStats();
        updateRoadStatus();
    }

    private void updateLocStats() {
        String arrivals = Prefs.arrivals(this);
        ArrivalStats.Summary s = ArrivalStats.summary(arrivals, null);
        locStats.setVisibility(s.count == 0 ? View.GONE : View.VISIBLE);
        if (s.count == 0) return;
        StringBuilder text = new StringBuilder(getString(s.avgLate >= 0 ? R.string.loc_stats_inside : R.string.loc_stats_before,
                s.count, (int) Math.round(Math.abs(s.avgLate))));
        // Per soort onderweg, zodra die metingen er zijn.
        String[][] modes = {{"car", getString(R.string.road_car)}, {"bike", getString(R.string.road_bike)}};
        for (String[] m : modes) {
            ArrivalStats.Summary ms = ArrivalStats.summary(arrivals, m[0]);
            if (ms.count == 0) continue;
            text.append('\n').append(getString(ms.avgLate >= 0 ? R.string.loc_stats_mode_inside : R.string.loc_stats_mode_before,
                    m[1], (int) Math.round(Math.abs(ms.avgLate))));
        }
        locStats.setText(text);
    }

    /** Knoptekst en status van "Op tijd melden onderweg", met de marges die Tick nu gebruikt (op 50 m). */
    private void updateRoadStatus() {
        boolean on = Prefs.roadOn(this);
        road.setText(on ? R.string.road_button_off : R.string.road_button_on);
        if (!on) roadStatus.setText(R.string.road_status_off);
        else if (!Geo.permitted(this)) roadStatus.setText(R.string.road_status_location);
        else if (!Road.permitted(this)) roadStatus.setText(R.string.road_status_permission);
        else {
            String arrivals = Prefs.arrivals(this);
            roadStatus.setText(getString(R.string.road_status_on, round50(RoadPlan.margin(arrivals, "car")),
                    round50(RoadPlan.margin(arrivals, "bike"))));
        }
    }

    private static int round50(double m) {
        return (int) (Math.round(m / 50) * 50);
    }

    /** Aanzetten: eerst de uitleg, dan de systeemvraag. Uitzetten: abonnement weg en cirkels normaal. */
    private void toggleRoad() {
        if (Prefs.roadOn(this)) {
            Prefs.setRoadOn(this, false);
            Road.unsubscribe(this);
            updateRoadStatus();
            return;
        }
        if (!Geo.permitted(this)) {
            Toast.makeText(this, R.string.road_status_location, Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.road_dialog_title)
                .setMessage(R.string.road_dialog_text)
                .setPositiveButton(R.string.road_dialog_ok, (dlg, w) -> {
                    if (Road.permitted(this)) roadGranted();
                    else requestPermissions(new String[] {Manifest.permission.ACTIVITY_RECOGNITION}, REQ_ACTIVITY);
                })
                .setNegativeButton(R.string.road_dialog_cancel, null)
                .show();
    }

    private void roadGranted() {
        Prefs.setRoadOn(this, true);
        Road.subscribe(this);
        updateRoadStatus();
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
                    // "Altijd toestaan" staat nooit in de eerste systeemvraag. Vanaf Android 11 opent deze vraag
                    // meteen het locatiescherm van Tick, met die keuze erop. Weigert Android hem (twee keer
                    // geweigerd), dan valt onRequestPermissionsResult terug op de instellingen van de app.
                    .setPositiveButton(android.R.string.ok, (dlg, w) -> requestPermissions(
                            new String[] {Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BACKGROUND))
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
        } else if (code == REQ_ACTIVITY) {
            if (Road.permitted(this)) {
                roadGranted();
            } else if (!shouldShowRequestPermissionRationale(Manifest.permission.ACTIVITY_RECOGNITION)) {
                // Eerder geweigerd: Android vraagt het niet nog eens.
                openAppSettings(R.string.road_settings_hint);
            }
        } else if (code == REQ_BACKGROUND) {
            if (granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                enableLocation(); // volgende stap, of de geofences zetten
            } else if (!shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                openAppSettings(R.string.loc_settings_hint_background);
            }
        }
    }

    private void openAppSettings() {
        openAppSettings(R.string.loc_settings_hint);
    }

    private void openAppSettings(int hint) {
        Toast.makeText(this, hint, Toast.LENGTH_LONG).show();
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

    /** De knop "Zoeken naar updates": meteen kijken; nieuwer is een vraag om te downloaden, anders een korte melding. */
    private void checkForUpdate(Button button) {
        button.setEnabled(false);
        new Thread(() -> {
            String latest = null;
            String error = null;
            try {
                latest = Updates.checkNow(this);
            } catch (Exception e) {
                error = Sync.errorText(this, e);
            }
            final String newer = latest;
            final String failed = error;
            runOnUiThread(() -> {
                button.setEnabled(true);
                if (isFinishing()) return;
                if (failed != null) {
                    Toast.makeText(this, getString(R.string.update_failed, failed), Toast.LENGTH_LONG).show();
                } else if (newer == null) {
                    Toast.makeText(this, getString(R.string.update_latest, BuildConfig.VERSION_NAME), Toast.LENGTH_LONG).show();
                } else {
                    new AlertDialog.Builder(this)
                            .setTitle(getString(R.string.update_title, newer))
                            .setMessage(R.string.update_text)
                            .setPositiveButton(R.string.update_download, (dlg, w) -> startActivity(Updates.downloadIntent()))
                            .setNegativeButton(android.R.string.cancel, null)
                            .show();
                }
            });
        }).start();
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
