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

    private static String pair(boolean needsPair) {
        return needsPair ? "&pair=1" : "";
    }
}
