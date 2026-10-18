package nl.detussenpartij.tick;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

/**
 * Batterijoptimalisatie: zonder vrijstelling stellen sommige telefoons (vooral Samsung en Xiaomi) het verversen van de
 * widget en de locatiemeldingen uit. Webmeldingen komen via de pushdienst en hebben dit niet nodig.
 */
final class Battery {
    private Battery() {}

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
}
