package nl.detussenpartij.tick;

import java.net.URI;
import java.util.Locale;

/** Het adres van een Tick (https://host[:poort]), zoals je het intypt of uit een koppellink krijgt. Pure Java, zonder Android. */
final class TickAddress {
    private TickAddress() {}

    /**
     * Maakt van wat je intypt een oorsprong zonder pad: "tick.example.com/" wordt "https://tick.example.com". Alleen
     * https; http mag alleen naar localhost (een debug-build met adb reverse). Null als het geen bruikbaar adres is.
     */
    static String normalize(String input) {
        if (input == null) return null;
        String s = input.trim();
        if (s.isEmpty()) return null;
        if (!s.contains("://")) s = "https://" + s;
        URI u;
        try {
            u = new URI(s);
        } catch (Exception e) {
            return null;
        }
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        String host = u.getHost();
        if (host == null || host.isEmpty() || u.getRawUserInfo() != null) return null;
        host = host.toLowerCase(Locale.ROOT);
        boolean local = host.equals("localhost") || host.equals("127.0.0.1");
        if (!scheme.equals("https") && !(scheme.equals("http") && local)) return null;
        int port = u.getPort();
        boolean defaultPort = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
        return scheme + "://" + host + (defaultPort ? "" : ":" + port);
    }

    /** Ligt url op deze Tick (zelfde schema, host en poort)? Ook false als een van beide geen geldig adres is. */
    static boolean sameOrigin(String base, String url) {
        String a = normalize(base);
        if (a == null || url == null || !url.contains("://")) return false;
        return a.equals(normalize(url));
    }

    /** De host om te tonen ("tick.example.com"), of het adres zelf als het niet te lezen is. */
    static String host(String base) {
        try {
            String h = new URI(base).getHost();
            return h == null ? base : h;
        } catch (Exception e) {
            return base;
        }
    }
}
