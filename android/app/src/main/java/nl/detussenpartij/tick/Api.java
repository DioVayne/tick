package nl.detussenpartij.tick;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class Api {
    /** Het adres van je Tick, uit -PtickBase=... of android/tick.properties bij het bouwen. */
    static final String BASE = BuildConfig.TICK_BASE;

    /** Korte time-outs voor een broadcast (geofence), die maar beperkt mag doorlopen. */
    static final int SHORT_TIMEOUT_MS = 3_000;

    /** Roept de Tick-API aan met de opgeslagen sleutel. Gooit een IOException bij een fout of niet-2xx. */
    static String call(Context c, String method, String path, String json) throws IOException {
        return call(c, method, path, json, 10_000, 15_000);
    }

    /** Zelfde, met eigen time-outs voor verbinden en lezen (ms). */
    static String call(Context c, String method, String path, String json, int connectMs, int readMs) throws IOException {
        String token = Prefs.token(c);
        if (token.isEmpty()) throw new IOException(c.getString(R.string.error_no_key));
        HttpURLConnection con = (HttpURLConnection) new URL(BASE + path).openConnection();
        try {
            con.setRequestMethod(method);
            con.setConnectTimeout(connectMs);
            con.setReadTimeout(readMs);
            con.setRequestProperty("Authorization", "Bearer " + token);
            con.setRequestProperty("Accept", "application/json");
            if (json != null) {
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = con.getOutputStream()) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = con.getResponseCode();
            String body = read(code >= 400 ? con.getErrorStream() : con.getInputStream());
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            return body;
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
