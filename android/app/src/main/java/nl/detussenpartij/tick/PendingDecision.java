package nl.detussenpartij.tick;

/** Mag een taak die net in de widget is afgevinkt weer gewoon getoond worden? Puur Java, zodat het zonder toestel te testen is. */
final class PendingDecision {
    /** Zo lang blijft een afgevinkte taak zichtbaar (doorgestreept) en kun je hem nog terugzetten. */
    static final long UNDO_WINDOW_MS = 3000;
    /** Staat een afgevinkte taak na zo lang nog open op de server, dan is het afvinken mislukt. */
    static final long FAILED_AFTER_MS = 30_000;

    /**
     * open: de taak staat nog in de lijst van de server. ageMs: tijd sinds de tik.
     * remindAtThen: remind_at bij het tikken ("" als er geen was), of null als onbekend (oudere versie van de app).
     * remindAtNow: remind_at nu op de server ("" als er geen is).
     */
    static boolean clear(boolean open, long ageMs, String remindAtThen, String remindAtNow) {
        // Afgerond en weg van de server.
        if (!open) return true;
        // Na 30 seconden nog open: mislukt, dus weer tonen.
        if (ageMs > FAILED_AFTER_MS) return true;
        // Herhalende taak: de server heeft hem doorgeschoven naar de volgende keer, dus hij blijft open met een nieuwe remind_at.
        return ageMs > UNDO_WINDOW_MS && remindAtThen != null && !remindAtThen.equals(remindAtNow);
    }

    private PendingDecision() {}
}
