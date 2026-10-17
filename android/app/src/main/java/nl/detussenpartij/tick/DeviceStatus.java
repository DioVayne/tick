package nl.detussenpartij.tick;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

/** Meldt aan Tick wat dit apparaat kan (meldingen, locatie), voor de pagina Apparaten in de instellingen. */
final class DeviceStatus {
    /** Zo lang hoeft dezelfde status niet opnieuw gemeld te worden. */
    static final long RESEND_MS = 6L * 60 * 60 * 1000;

    /** De JSON-body voor POST /api/device (met de hand opgebouwd: org.json werkt niet in gewone JUnit-tests). */
    static String json(String name, boolean notifications, String location, String appVersion) {
        return "{\"name\":" + quote(name) + ",\"notifications\":" + notifications
                + ",\"location\":" + quote(location) + ",\"app_version\":" + quote(appVersion) + "}";
    }

    /** Sturen als de status anders is dan de laatst gemelde, of als die melding al langer dan 6 uur geleden is. */
    static boolean shouldSend(String lastJson, long lastAtMs, String json, long nowMs) {
        return !json.equals(lastJson) || nowMs - lastAtMs > RESEND_MS;
    }

    /** Langste naam die de server accepteert (tekens). */
    static final int MAX_NAME = 100;

    /** Naam van het apparaat: fabrikant + model, zonder dubbeling, 1-100 tekens (nooit midden in een teken afgekapt). */
    static String deviceName(String manufacturer, String model) {
        String man = manufacturer == null ? "" : manufacturer.trim();
        String mod = model == null ? "" : model.trim();
        String name;
        if (mod.isEmpty()) name = man;
        else if (man.isEmpty() || mod.toLowerCase(java.util.Locale.ROOT).startsWith(man.toLowerCase(java.util.Locale.ROOT))) name = mod;
        else name = man + " " + mod;
        if (name.isEmpty()) return "Android";
        if (name.length() > MAX_NAME) { // de server telt UTF-16-eenheden (JS-lengte), dus ook wij
            int end = MAX_NAME;
            if (Character.isHighSurrogate(name.charAt(end - 1))) end--;
            name = name.substring(0, end).trim();
        }
        // Kapte hij op een spatie af, dan kan er niets overblijven; Android is dan de veilige naam.
        return name.isEmpty() ? "Android" : name;
    }

    /** Meldingen mogen (toestemming op Android 13+ en niet uitgezet in de systeeminstellingen). */
    static boolean notificationsOk(Context c) {
        if (Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    /** always (fijn + achtergrond), foreground (alleen fijn) of off. */
    static String location(Context c) {
        if (Geo.permitted(c)) return "always";
        if (c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) return "foreground";
        return "off";
    }

    /** Blokkeert (netwerk): niet op de hoofdthread. Slikt alle fouten: de status is niet kritiek en mag sync niet breken. */
    static void report(Context c) {
        try {
            String json = json(deviceName(Build.MANUFACTURER, Build.MODEL), notificationsOk(c), location(c), BuildConfig.VERSION_NAME);
            long now = System.currentTimeMillis();
            if (!shouldSend(Prefs.deviceStatus(c), Prefs.deviceStatusAt(c), json, now)) return;
            Api.call(c, "POST", "/api/device", json);
            Prefs.setDeviceStatus(c, json, now);
        } catch (Exception e) {
            Log.w("Tick", "Apparaatstatus melden mislukt", e);
        }
    }

    private static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
                    else sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }

    private DeviceStatus() {}
}
