package nl.detussenpartij.tick;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Leest tick://pair?code=…&base=… (de PWA geeft hem zo door): de eenmalige code en het adres van de Tick die hem gaf.
 * Zonder Android-klassen, voor een gewone JUnit-test.
 */
final class PairLink {
    private PairLink() {}

    /** De code, of null bij een ander schema of host, een kapot adres of een lege code. */
    static String code(String uri) {
        return param(uri, "code");
    }

    /** Het adres van de Tick (genormaliseerd, zie TickAddress), of null als de link er geen (geldig) adres in heeft. */
    static String base(String uri) {
        return TickAddress.normalize(param(uri, "base"));
    }

    private static String param(String uri, String name) {
        if (uri == null) return null;
        URI u;
        try {
            u = new URI(uri);
        } catch (Exception e) {
            return null;
        }
        if (!"tick".equalsIgnoreCase(u.getScheme()) || !"pair".equalsIgnoreCase(u.getHost())) return null;
        String query = u.getRawQuery();
        if (query == null) return null;
        for (String part : query.split("&")) {
            if (!part.startsWith(name + "=")) continue;
            String value;
            try {
                value = URLDecoder.decode(part.substring(name.length() + 1), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                return null;
            }
            return value.isEmpty() ? null : value;
        }
        return null;
    }
}
