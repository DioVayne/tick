package nl.detussenpartij.tick;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class Prefs {
    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("tick", Context.MODE_PRIVATE);
    }

    /**
     * Het adres van je Tick (https://host, zonder pad), of leeg als de app het nog niet weet. Een eigen build met
     * tickBase begint met dat adres; de algemene app vraagt het bij de eerste start (SetupActivity) of krijgt het uit
     * de koppellink.
     */
    static String base(Context c) {
        return sp(c).getString("base", BuildConfig.TICK_BASE);
    }

    static void setBase(Context c, String base) {
        sp(c).edit().putString("base", base).commit();
    }

    /** Moment (ms) waarop de app voor het laatst op GitHub naar een nieuwere versie keek, of 0. */
    static long updateCheckedAt(Context c) {
        return sp(c).getLong("updateCheckedAt", 0);
    }

    static void setUpdateCheckedAt(Context c, long ms) {
        sp(c).edit().putLong("updateCheckedAt", ms).apply();
    }

    /** De laatste versie waarvoor al een updatemelding kwam, of leeg. */
    static String updateNotified(Context c) {
        return sp(c).getString("updateNotified", "");
    }

    static void setUpdateNotified(Context c, String version) {
        sp(c).edit().putString("updateNotified", version).apply();
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
                .remove("locFired").remove("locSynced").remove("locRearm").remove("geoSig").remove("geoIds")
                .remove("roadMode").remove("roadModeAt").remove("roadRadii").commit();
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

    /** Wat een widget toont: "" (Alles), WidgetFilter.TODAY of een lijstnaam. Per widget-id. */
    static String widgetView(Context c, int widgetId) {
        return sp(c).getString("widget_" + widgetId + "_view", "");
    }

    static void setWidgetView(Context c, int widgetId, String view) {
        sp(c).edit().putString("widget_" + widgetId + "_view", view == null ? "" : view).apply();
    }

    static void forgetWidget(Context c, int widgetId) {
        sp(c).edit().remove("widget_" + widgetId + "_view").apply();
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

    /**
     * Metingen van locatiemeldingen (ArrivalStats, JSON-array): alleen afstanden en tijden, geen coördinaten. Hoort bij
     * het toestel, niet bij een account: wipeAccountData laat ze staan.
     */
    static synchronized String arrivals(Context c) {
        return sp(c).getString("arrivals", "[]");
    }

    static synchronized void addArrival(Context c, JSONObject m) {
        sp(c).edit().putString("arrivals", ArrivalStats.add(arrivals(c), m)).apply();
    }

    /**
     * Weggeveegde locatiemeldingen waarvan de server location_notified = false nog niet kent: taak-id -> GeoPlan.key.
     * Sync.refresh probeert de PATCH opnieuw (bijvoorbeeld na offline wegvegen).
     */
    static synchronized JSONObject locRearm(Context c) {
        try {
            return new JSONObject(sp(c).getString("locRearm", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void markLocRearm(Context c, String id, String key) {
        JSONObject r = locRearm(c);
        try {
            r.put(id, key);
        } catch (Exception ignored) {
        }
        sp(c).edit().putString("locRearm", r.toString()).commit();
    }

    /** Vergeet een weggeveegde melding, maar alleen als er intussen geen nieuwere (andere key) voor is. */
    static synchronized void dropLocRearm(Context c, String id, String key) {
        JSONObject r = locRearm(c);
        if (!key.equals(r.optString(id, null))) return;
        r.remove(id);
        sp(c).edit().putString("locRearm", r.toString()).commit();
    }

    /** "Op tijd melden onderweg" staat aan (de knop in "Tick op deze telefoon"). */
    static boolean roadOn(Context c) {
        return sp(c).getBoolean("roadOn", false);
    }

    static void setRoadOn(Context c, boolean on) {
        sp(c).edit().putBoolean("roadOn", on).apply();
    }

    /** Huidige stand onderweg: "car", "bike" of "" (RoadPlan.isActive bepaalt of hij nog geldt). */
    static synchronized String roadMode(Context c) {
        return sp(c).getString("roadMode", "");
    }

    /** Moment (ms) waarop de stand begon, volgens Android. */
    static synchronized long roadModeAt(Context c) {
        return sp(c).getLong("roadModeAt", 0);
    }

    /** Onderwegstralen bij het begin van de stand: taak-id -> straal (m), als JSON-object. */
    static synchronized String roadRadii(Context c) {
        return sp(c).getString("roadRadii", "{}");
    }

    static synchronized void setRoad(Context c, String mode, long at, String radiiJson) {
        sp(c).edit().putString("roadMode", mode).putLong("roadModeAt", at).putString("roadRadii", radiiJson).commit();
    }

    static synchronized void clearRoad(Context c) {
        sp(c).edit().remove("roadMode").remove("roadModeAt").remove("roadRadii").commit();
    }

    /** GeoPlan.signature van de geofences die nu geregistreerd zijn, of leeg als er niets (bekend) staat. */
    static String geoSig(Context c) {
        return sp(c).getString("geoSig", "");
    }

    /** Een lege signature betekent: onbekend wat er staat; dan ook de request-ids vergeten (volgende keer alles). */
    static synchronized void setGeoSig(Context c, String sig) {
        SharedPreferences.Editor e = sp(c).edit().putString("geoSig", sig == null ? "" : sig);
        if (sig == null || sig.isEmpty()) e.remove("geoIds");
        e.apply();
    }

    /** Request-ids van de geofences die nu geregistreerd zijn, of null als dat niet bekend is. */
    static synchronized Set<String> geoIds(Context c) {
        String json = sp(c).getString("geoIds", null);
        if (json == null) return null;
        try {
            JSONArray arr = new JSONArray(json);
            Set<String> out = new HashSet<>();
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    static synchronized void setGeo(Context c, String sig, List<String> ids) {
        sp(c).edit().putString("geoSig", sig).putString("geoIds", new JSONArray(ids).toString()).apply();
    }

    static synchronized void removeGeoIds(Context c, List<String> ids) {
        Set<String> now = geoIds(c);
        if (now == null) return;
        now.removeAll(ids);
        sp(c).edit().putString("geoIds", new JSONArray(now).toString()).apply();
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
