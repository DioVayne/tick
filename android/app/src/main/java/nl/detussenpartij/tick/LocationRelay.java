package nl.detussenpartij.tick;

/**
 * Afspraken voor het doorgeven van je locatie aan de PWA (zie TickLocationHandler). Puur Java, zodat het zonder
 * toestel te testen is.
 */
final class LocationRelay {
    private LocationRelay() {}

    /** Opdrachten van Chrome. */
    static final String START = "startLocation";
    static final String STOP = "stopLocation";
    /** Antwoorden aan Chrome: de namen waar InstalledWebappGeolocationBridge naar luistert. */
    static final String CALLBACK_LOCATION = "onNewLocationAvailable";
    static final String CALLBACK_ERROR = "onNewLocationError";
    /** Een bewaarde locatie die ouder is dan dit (ms) sturen we niet eerst door. */
    static final long MAX_LAST_AGE_MS = 60_000;

    static boolean handles(String command) {
        return START.equals(command) || STOP.equals(command);
    }

    /** Hoe vaak (ms) om een nieuwe locatie vragen; nauwkeurig is wat de rijmodus vraagt. */
    static long intervalMs(boolean highAccuracy) {
        return highAccuracy ? 1000 : 5000;
    }

    /** Mag de laatst bekende locatie (tijd in ms) meteen door, zodat de pagina niet op de eerste nieuwe hoeft te wachten? */
    static boolean lastIsUsable(long fixTimeMs, long nowMs) {
        if (fixTimeMs <= 0) return false;
        long age = nowMs - fixTimeMs;
        return age <= MAX_LAST_AGE_MS && age >= -5000;
    }
}
