package nl.detussenpartij.tick;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Adressen waarmee de app de PWA opent. Zonder Android-klassen, zodat het in een gewone JUnit-test draait. */
final class StartUrl {
    private StartUrl() {}

    /** De start van de app; met needsPair vraagt de PWA een koppelcode aan (de app heeft nog geen sleutel). */
    static String launch(String base, boolean needsPair) {
        return base + "/?app=android" + pair(needsPair);
    }

    /** Opent een taak (vanuit een melding of de widget). */
    static String task(String base, String taskId, boolean needsPair) {
        return base + "/?app=android&task=" + URLEncoder.encode(taskId, StandardCharsets.UTF_8) + pair(needsPair);
    }

    /** Opent een lijst (vanuit de kop van een widget die die lijst toont). */
    static String list(String base, String name, boolean needsPair) {
        return base + "/?app=android&list=" + URLEncoder.encode(name, StandardCharsets.UTF_8) + pair(needsPair);
    }

    /**
     * Het adres uit een intent (een taak uit Launch.task of een link naar je Tick): alleen als het op base ligt, anders de
     * gewone start. De app opent zo nooit een andere site schermvullend. Zonder sleutel komt er pair=1 bij.
     */
    static String fromIntent(String base, String url, boolean needsPair) {
        if (!TickAddress.sameOrigin(base, url)) return launch(base, needsPair);
        if (!needsPair || url.matches(".*[?&]pair=[^&#]*.*")) return url;
        int hash = url.indexOf('#');
        String head = hash < 0 ? url : url.substring(0, hash);
        String tail = hash < 0 ? "" : url.substring(hash);
        return head + (head.contains("?") ? "&" : "?") + "pair=1" + tail;
    }

    private static String pair(boolean needsPair) {
        return needsPair ? "&pair=1" : "";
    }
}
