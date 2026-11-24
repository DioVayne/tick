package nl.detussenpartij.tick;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Batterijoptimalisatie: zonder vrijstelling stellen sommige telefoons (vooral Samsung en Xiaomi) het verversen van de
 * widget en de locatiemeldingen uit. Webmeldingen komen via de pushdienst en hebben dit niet nodig.
 * De Play-app mag de systeemvraag niet stellen (Play-beleid): daar uitleg per merk en een knop naar de app-instellingen.
 */
final class Battery {
    private Battery() {}

    /** Mag de app de systeemvraag tonen? Niet in de Play-app: die heeft REQUEST_IGNORE_BATTERY_OPTIMIZATIONS niet. */
    static boolean canPrompt() {
        return !BuildConfig.PLAY_STORE;
    }

    /** Is Tick vrijgesteld van batterijoptimalisatie? */
    static boolean unrestricted(Context c) {
        PowerManager pm = c.getSystemService(PowerManager.class);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    /**
     * Vraagt Android om de vrijstelling (de systeemvraag "Toestaan dat app op de achtergrond blijft draaien?"). Geeft false
     * als er niets te vragen was. Heeft de telefoon die vraag niet, dan de lijst met batterij-instellingen.
     */
    static boolean ask(Activity a) {
        if (unrestricted(a)) return false;
        if (!canPrompt()) {
            // De Play-app heeft de directe vraag niet (zie src/play/AndroidManifest.xml): de app-instellingen, met uitleg.
            openAppSettings(a);
            return true;
        }
        try {
            a.startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.fromParts("package", a.getPackageName(), null)));
        } catch (ActivityNotFoundException e) {
            try {
                a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (ActivityNotFoundException e2) {
                Log.w("Tick", "geen batterij-instellingen op deze telefoon", e2);
                return false;
            }
        }
        return true;
    }

    /** De app-instellingen van Tick (daar staat Batterij), met een korte aanwijzing. */
    static void openAppSettings(Activity a) {
        Toast.makeText(a, R.string.battery_settings_hint, Toast.LENGTH_LONG).show();
        a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", a.getPackageName(), null)));
    }

    /**
     * Na het koppelen (zie BatteryPlan.afterPair): niets, de systeemvraag, of in de Play-app uitleg per merk met een
     * knop naar de instellingen. Roept daarna done aan (ook bij Later of wegtikken).
     */
    static void afterPair(Activity a, Runnable done) {
        switch (BatteryPlan.afterPair(BuildConfig.PLAY_STORE, unrestricted(a))) {
            case SYSTEM_PROMPT:
                ask(a);
                done.run();
                break;
            case EXPLAIN:
                new AlertDialog.Builder(a)
                        .setTitle(R.string.battery_dialog_title)
                        .setMessage(a.getString(R.string.battery_dialog_text, brandName(), a.getString(steps())))
                        .setPositiveButton(R.string.battery_dialog_open, (dlg, w) -> {
                            openAppSettings(a);
                            done.run();
                        })
                        .setNegativeButton(R.string.battery_dialog_later, (dlg, w) -> done.run())
                        .setOnCancelListener(dlg -> done.run())
                        .show();
                break;
            default:
                done.run();
        }
    }

    /**
     * Ingeklapt blok in "Tick op deze telefoon": de stappen voor dit merk (Samsung en Xiaomi hebben meer dan de ene
     * schakelaar van Android) met een knop naar de app-instellingen. Geeft een functie die het blok openklapt.
     */
    static Help addHelp(Activity a, LinearLayout root) {
        float d = a.getResources().getDisplayMetrics().density;
        String label = a.getString(R.string.battery_brand_toggle, brandName());
        Button toggle = new Button(a, null, android.R.attr.borderlessButtonStyle);
        root.addView(toggle);
        LinearLayout box = new LinearLayout(a);
        box.setOrientation(LinearLayout.VERTICAL);
        root.addView(box);

        TextView steps = new TextView(a);
        steps.setText(steps());
        box.addView(steps);

        Button settings = new Button(a);
        settings.setText(R.string.battery_open_settings);
        settings.setOnClickListener(v -> openAppSettings(a));
        box.addView(settings);
        box.setPadding(0, 0, 0, (int) (12 * d));

        Help help = new Help(toggle, box, label);
        toggle.setOnClickListener(v -> {
            help.touched = true;
            help.show(box.getVisibility() != View.VISIBLE);
        });
        help.show(false);
        return help;
    }

    static final class Help {
        private final Button toggle;
        private final LinearLayout box;
        private final String label;
        private boolean touched;

        private Help(Button toggle, LinearLayout box, String label) {
            this.toggle = toggle;
            this.box = box;
            this.label = label;
        }

        private void show(boolean open) {
            box.setVisibility(open ? View.VISIBLE : View.GONE);
            toggle.setText(label + (open ? " ▾" : " ▸"));
        }

        /** Uit onResume: open zolang Android Tick nog afremt, tenzij je hem zelf al in- of uitklapte. */
        void refresh(boolean unrestricted) {
            if (!touched) show(!unrestricted);
        }
    }

    /** De naam van het merk zoals de telefoon hem noemt (eerste letter hoofdletter), of "Android". */
    static String brandName() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        if (m.isEmpty()) return "Android";
        return m.substring(0, 1).toUpperCase(java.util.Locale.ROOT) + m.substring(1);
    }

    /** De stappen voor dit merk. */
    static int steps() {
        switch (BatteryPlan.brand(Build.MANUFACTURER, Build.BRAND)) {
            case XIAOMI: return R.string.battery_steps_xiaomi;
            case SAMSUNG: return R.string.battery_steps_samsung;
            case ONEPLUS: return R.string.battery_steps_oneplus;
            case VIVO: return R.string.battery_steps_vivo;
            case HUAWEI: return R.string.battery_steps_huawei;
            default: return R.string.battery_steps_other;
        }
    }
}
