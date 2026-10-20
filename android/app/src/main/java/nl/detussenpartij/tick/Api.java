package nl.detussenpartij.tick;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class Api {
    /** Korte time-outs voor een broadcast (geofence), die maar beperkt mag doorlopen. */
    static final int SHORT_TIMEOUT_MS = 3_000;

    /** Roept de Tick-API aan met de opgeslagen sleutel. Gooit een IOException bij een fout of niet-2xx. */
    static String call(Context c, String method, String path, String json) throws IOException {
        return call(c, method, path, json, 10_000, 15_000);
    }

    /** Zelfde, met eigen time-outs voor verbinden en lezen (ms). Bij een 401 vergeet de app de sleutel. */
    static String call(Context c, String method, String path, String json, int connectMs, int readMs) throws IOException {
        String token = Prefs.token(c);
        if (token.isEmpty()) throw new IOException(c.getString(R.string.error_no_key));
        Response res = send(Prefs.base(c), method, path, json, token, connectMs, readMs);
        // Alleen als het nog dezelfde sleutel is: een koppeling die intussen klaar is, mag niet gewist worden.
        if (shouldForget(res.code, true) && token.equals(Prefs.token(c))) {
            // De sleutel is ingetrokken of verwijderd: vergeten, zodat de widget "niet gekoppeld" toont en de PWA
            // bij de volgende start opnieuw koppelt (pair=1).
            forgetAccount(c);
            TaskWidgetProvider.updateAll(c);
            Prefs.setSyncError(c, c.getString(R.string.error_no_key));
        }
        if (res.code < 200 || res.code >= 300) throw new IOException("HTTP " + res.code);
        return res.body;
    }

    /** Vergeet sleutel, gebruiker en hun gegevens (cache, wachtrijen, geofences). Blokkeert niet lang, maar niet op de hoofdthread als het kan. */
    static void forgetAccount(Context c) {
        Prefs.setToken(c, "");
        Prefs.wipeAccountData(c);
        Prefs.setUserId(c, "");
        Geo.apply(c, new JSONArray(), true);
    }

    /** Alleen een 401 terwijl er een sleutel is betekent dat die sleutel niet meer geldt; 403 en 5xx niet. */
    static boolean shouldForget(int httpCode, boolean hasToken) {
        return httpCode == 401 && hasToken;
    }

    /** Uitkomst van het koppelen: de sleutel en de user_id van wie hem heeft ("" als het antwoord er geen had). */
    static final class Redeemed {
        final String key;
        final String userId;

        Redeemed(String key, String userId) {
            this.key = key;
            this.userId = userId;
        }
    }

    /**
     * Wisselt een koppelcode in voor een sleutel (POST /api/pair/redeem, zonder Authorization). Een niet-lege oldKey
     * gaat mee als old_key, zodat de server die intrekt; geef hem alleen mee als base dezelfde Tick is als waar hij vandaan komt. Blokkeert: niet op de hoofdthread. Gooit een IOException bij
     * een fout, of als de code ongeldig, verlopen of al gebruikt is (400).
     */
    static Redeemed redeem(String base, String code, String name, String oldKey) throws IOException {
        String body;
        try {
            JSONObject req = new JSONObject().put("code", code);
            if (name != null) req.put("name", name);
            if (oldKey != null && !oldKey.isEmpty()) req.put("old_key", oldKey);
            body = req.toString();
        } catch (JSONException e) {
            throw new IOException(e);
        }
        Response res = send(base, "POST", "/api/pair/redeem", body, null, 10_000, 15_000);
        if (res.code < 200 || res.code >= 300) throw new IOException("HTTP " + res.code);
        String key;
        String userId;
        try {
            JSONObject o = new JSONObject(res.body);
            key = o.getString("key").trim();
            userId = o.optString("user_id", "").trim();
        } catch (JSONException e) {
            throw new IOException(e);
        }
        if (key.isEmpty()) throw new IOException("HTTP " + res.code);
        return new Redeemed(key, userId);
    }

    private static final class Response {
        final int code;
        final String body;

        Response(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }

    /**
     * Is dit adres een Tick? GET /api/hello geeft zonder inloggen {"app":"tick"}. Blokkeert: niet op de hoofdthread.
     * Gooit een IOException als het adres niet bereikbaar is.
     */
    static boolean isTick(String base) throws IOException {
        Response res = send(base, "GET", "/api/hello", null, null, 10_000, 15_000);
        if (res.code != 200) return false;
        try {
            return "tick".equals(new JSONObject(res.body).optString("app"));
        } catch (JSONException e) {
            return false;
        }
    }

    /** Eén verzoek naar Tick; zonder token (null) gaat het zonder Authorization. */
    private static Response send(String base, String method, String path, String json, String token, int connectMs, int readMs) throws IOException {
        if (base == null || base.isEmpty()) throw new IOException("no Tick address");
        HttpURLConnection con = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            con.setRequestMethod(method);
            con.setConnectTimeout(connectMs);
            con.setReadTimeout(readMs);
            if (token != null) con.setRequestProperty("Authorization", "Bearer " + token);
            con.setRequestProperty("Accept", "application/json");
            if (json != null) {
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = con.getOutputStream()) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = con.getResponseCode();
            return new Response(code, read(code >= 400 ? con.getErrorStream() : con.getInputStream()));
        } finally {
            con.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private Api() {}
}
