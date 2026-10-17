package nl.detussenpartij.tick;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Map;

final class Prefs {
    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("tick", Context.MODE_PRIVATE);
    }

    static String token(Context c) {
        return sp(c).getString("token", "");
    }

    static void setToken(Context c, String token) {
        sp(c).edit().putString("token", token.trim()).apply();
    }

    /** De user_id van de sleutel (uit het koppelen), of leeg als die niet bekend is. */
    static String userId(Context c) {
        return sp(c).getString("userId", "");
    }

    static void setUserId(Context c, String id) {
        sp(c).edit().putString("userId", id == null ? "" : id).apply();
    }

    /** Wist de gegevens van de vorige gebruiker: cache, wachtrijen, getoonde locatiemeldingen en geofence-handtekening. */
    static synchronized void wipeAccountData(Context c) {
        sp(c).edit().putString("cache", "[]").remove("pending").remove("pendingRemind")
                .remove("locFired").remove("locSynced").remove("geoSig").commit();
    }

    static String cache(Context c) {
        return sp(c).getString("cache", "[]");
    }

    static void setCache(Context c, String json) {
        sp(c).edit().putString("cache", json).apply();
    }

    static int fontSp(Context c) {
        return sp(c).getInt("fontSp", SettingsActivity.FONT_DEFAULT);
    }

    static int spacingDp(Context c) {
        return sp(c).getInt("spacingDp", SettingsActivity.SPACING_DEFAULT);
    }

    static void setLook(Context c, int fontSp, int spacingDp) {
        sp(c).edit().putInt("fontSp", fontSp).putInt("spacingDp", spacingDp).apply();
    }

    /** Foutmelding van de laatste mislukte sync voor in de widget, of leeg als die gelukt is. */
    /** Moment (ms) van de laatste geslaagde verversing, of 0. */
    static long lastSync(Context c) {
        return sp(c).getLong("lastSync", 0);
    }

    static void setLastSync(Context c, long ms) {
        sp(c).edit().putLong("lastSync", ms).apply();
    }

    static String syncError(Context c) {
        return sp(c).getString("syncError", "");
    }

    static void setSyncError(Context c, String msg) {
        sp(c).edit().putString("syncError", msg == null ? "" : msg).apply();
    }

    /** Taken die net zijn afgevinkt in de widget: id -> tijdstip van de tik (ms). */
    static synchronized JSONObject pending(Context c) {
        try {
            return new JSONObject(sp(c).getString("pending", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void setPending(Context c, JSONObject pending) {
        sp(c).edit().putString("pending", pending.toString()).commit();
    }

    /**
     * remind_at van de taken in pending zoals die was bij de tik ("" als er geen was). Schuift de server een herhalende
     * taak door, dan blijft hij open met een andere remind_at: zo ziet Sync dat het afvinken gelukt is.
     */
    static synchronized JSONObject pendingRemind(Context c) {
        try {
            return new JSONObject(sp(c).getString("pendingRemind", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void setPendingRemind(Context c, JSONObject remind) {
        sp(c).edit().putString("pendingRemind", remind.toString()).commit();
    }

    /**
     * Locatiemeldingen die al getoond zijn: taak-id -> GeoPlan.key van de plek die afging.
     * Voorkomt een dubbele melding zolang de server location_notified nog niet kent (bijvoorbeeld offline).
     */
    static synchronized JSONObject locFired(Context c) {
        try {
            return new JSONObject(sp(c).getString("locFired", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void setLocFired(Context c, JSONObject fired) {
        sp(c).edit().putString("locFired", fired.toString()).commit();
    }

    /**
     * Locatiemeldingen uit locFired die de server sinds een bepaald moment kent: taak-id -> tijdstip (ms) van de geslaagde PATCH.
     * Zegt de server daarna toch location_notified == false, dan is de plek opnieuw gezet en mag hij weer afgaan.
     */
    static synchronized JSONObject locSynced(Context c) {
        try {
            return new JSONObject(sp(c).getString("locSynced", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void setLocSynced(Context c, JSONObject synced) {
        sp(c).edit().putString("locSynced", synced.toString()).commit();
    }

    /** Nieuwe meldingen (id -> key): onthouden als afgegaan; de server kent ze pas na de PATCH. */
    static synchronized void markLocFired(Context c, Map<String, String> fired) {
        JSONObject f = locFired(c);
        JSONObject s = locSynced(c);
        try {
            for (Map.Entry<String, String> e : fired.entrySet()) {
                f.put(e.getKey(), e.getValue());
                s.remove(e.getKey());
            }
        } catch (Exception ignored) {
        }
        setLocFired(c, f);
        setLocSynced(c, s);
    }

    /** De server heeft location_notified voor deze taak net aangenomen. */
    static synchronized void markLocSynced(Context c, String id) {
        JSONObject s = locSynced(c);
        try {
            s.put(id, System.currentTimeMillis());
        } catch (Exception ignored) {
        }
        setLocSynced(c, s);
    }

    /** Vergeet meldingen (id -> key zoals gezien), maar alleen als er intussen geen nieuwere melding voor is. */
    static synchronized void dropLocFired(Context c, Map<String, String> seen) {
        JSONObject f = locFired(c);
        JSONObject s = locSynced(c);
        for (Map.Entry<String, String> e : seen.entrySet()) {
            if (!e.getValue().equals(f.optString(e.getKey(), null))) continue;
            f.remove(e.getKey());
            s.remove(e.getKey());
        }
        setLocFired(c, f);
        setLocSynced(c, s);
    }

    /** GeoPlan.signature van de geofences die nu geregistreerd zijn, of leeg als er niets (bekend) staat. */
    static String geoSig(Context c) {
        return sp(c).getString("geoSig", "");
    }

    static void setGeoSig(Context c, String sig) {
        sp(c).edit().putString("geoSig", sig == null ? "" : sig).apply();
    }

    /** De laatst aan Tick gemelde apparaatstatus (JSON) en het tijdstip (ms) van die melding. */
    static String deviceStatus(Context c) {
        return sp(c).getString("deviceStatus", "");
    }

    static long deviceStatusAt(Context c) {
        return sp(c).getLong("deviceStatusAt", 0);
    }

    static void setDeviceStatus(Context c, String json, long atMs) {
        sp(c).edit().putString("deviceStatus", json).putLong("deviceStatusAt", atMs).apply();
    }

    private Prefs() {}
}
