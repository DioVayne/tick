package nl.detussenpartij.tick;

/**
 * Testfeature "placecheck" (zie ARCHITECTURE.md, Testfeatures): de logica zonder Android, zodat JUnit hem kan testen.
 * Wat de laatste proefmelding zegt.
 */
final class PlaceCheckPlan {
    private PlaceCheckPlan() {}

    /** Zo lang na het indrukken wacht de proefmelding: tijd genoeg om het scherm te vergrendelen. */
    static final long DELAY_MS = 15_000;
    /** Is de proefmelding na zo lang nog niet gekomen, dan telt hij als niet aangekomen. */
    static final long MISSING_AFTER_MS = 3 * 60_000;

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
