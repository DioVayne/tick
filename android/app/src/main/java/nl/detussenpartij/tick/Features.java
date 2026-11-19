package nl.detussenpartij.tick;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.TreeSet;
import java.util.Set;

/**
 * Testfeatures (zie ARCHITECTURE.md, Testfeatures): welke er op de gekoppelde Tick aanstaan. De server geeft ze in
 * GET /api/config (testFeatures, uit TEST_FEATURES); de app onthoudt de laatste lijst, zodat een scherm ze ook
 * zonder verbinding kent. Zonder koppeling of met een oudere Tick: geen.
 */
final class Features {
    private static final String FILE = "tick_features";
    private static final String KEY = "on";

    private Features() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** Staat deze testfeature aan op de gekoppelde Tick (volgens de laatst opgehaalde lijst)? */
    static boolean on(Context c, String name) {
        if (Prefs.token(c).isEmpty()) return false;
        String list = prefs(c).getString(KEY, "");
        return new HashSet<>(Arrays.asList(list.split(","))).contains(name);
    }

    /** Haalt de lijst op (blokkeert: niet op de hoofdthread). Geeft true als hij veranderd is. Fouten: de oude lijst blijft. */
    static boolean refresh(Context c) {
        if (Prefs.token(c).isEmpty()) return false;
        try {
            JSONArray arr = new JSONObject(Api.call(c, "GET", "/api/config", null)).optJSONArray("testFeatures");
            Set<String> names = new TreeSet<>(); // gesorteerd: dezelfde lijst geeft dezelfde tekst
            if (arr != null) for (int i = 0; i < arr.length(); i++) names.add(arr.optString(i));
            String list = String.join(",", names);
            if (list.equals(prefs(c).getString(KEY, ""))) return false;
            prefs(c).edit().putString(KEY, list).apply();
            return true;
        } catch (Exception e) {
            Log.w("Tick", "testfeatures ophalen mislukt", e);
            return false;
        }
    }
}
