package nl.detussenpartij.tick;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** Leest de koppelcode uit tick://pair?code=… (de PWA geeft hem zo door). Zonder Android-klassen, voor een gewone JUnit-test. */
final class PairLink {
    private PairLink() {}

    /** De code, of null bij een ander schema of host, een kapot adres of een lege code. */
    static String code(String uri) {
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
            if (!part.startsWith("code=")) continue;
            String code;
            try {
                code = URLDecoder.decode(part.substring("code=".length()), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                return null;
            }
            return code.isEmpty() ? null : code;
        }
        return null;
    }
}
