package nl.detussenpartij.tick;

import java.util.Locale;

/**
 * Testfeature "placecheck" (zie ARCHITECTURE.md, Testfeatures): de logica zonder Android, zodat JUnit hem kan testen.
 * Welk merk de telefoon is (voor de uitleg per merk) en wat de laatste proefmelding zegt.
 */
final class PlaceCheckPlan {
    private PlaceCheckPlan() {}

    /** Zo lang na het indrukken wacht de proefmelding: tijd genoeg om het scherm te vergrendelen. */
    static final long DELAY_MS = 15_000;
    /** Is de proefmelding na zo lang nog niet gekomen, dan telt hij als niet aangekomen. */
    static final long MISSING_AFTER_MS = 3 * 60_000;

    enum Brand { XIAOMI, SAMSUNG, ONEPLUS, VIVO, HUAWEI, OTHER }

    /** Het merk naar Build.MANUFACTURER (en Build.BRAND, want een Redmi of POCO meldt zich soms als Xiaomi en soms niet). */
    static Brand brand(String manufacturer, String brand) {
        String s = ((manufacturer == null ? "" : manufacturer) + " " + (brand == null ? "" : brand)).toLowerCase(Locale.ROOT);
        if (s.contains("xiaomi") || s.contains("redmi") || s.contains("poco")) return Brand.XIAOMI;
        if (s.contains("samsung")) return Brand.SAMSUNG;
        if (s.contains("oneplus") || s.contains("oppo") || s.contains("realme")) return Brand.ONEPLUS;
        if (s.contains("vivo") || s.contains("iqoo")) return Brand.VIVO;
        if (s.contains("huawei") || s.contains("honor")) return Brand.HUAWEI;
        return Brand.OTHER;
    }

    enum Result { NONE, WAITING, ARRIVED, BLOCKED, MISSING }

    /**
     * Wat de laatste proef zegt. requestedAt: wanneer hij gevraagd is (0 = nooit); firedAt: wanneer hij afging (0 = nog
     * niet, of hoort bij een oudere proef); shown: of de melding getoond kon worden toen hij afging.
     */
    static Result result(long requestedAt, long firedAt, boolean shown, long now) {
        if (requestedAt <= 0) return Result.NONE;
        if (firedAt >= requestedAt) return shown ? Result.ARRIVED : Result.BLOCKED;
        return now - requestedAt > MISSING_AFTER_MS ? Result.MISSING : Result.WAITING;
    }

    /** Hoeveel seconden later dan gepland de melding kwam (niet negatief). */
    static long lateSeconds(long requestedAt, long firedAt) {
        return Math.max(0, (firedAt - requestedAt - DELAY_MS) / 1000);
    }
}
