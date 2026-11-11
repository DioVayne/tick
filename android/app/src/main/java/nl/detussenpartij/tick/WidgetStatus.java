package nl.detussenpartij.tick;

/**
 * Welke melding de widget bovenaan zijn lijst toont, en wat een tik erop doet. Zonder Android, zodat het testbaar is;
 * TaskListService zet de keuze om in tekst (WidgetRows.status).
 *
 * Gewoon gebruik: geen melding, of hooguit een kleine tijd als de lijst al een tijd niet ververst is. Problemen: een
 * duidelijke melding met een actie (tikvlak minstens 48 dp). De volgorde hieronder is de voorrang: wat bovenaan staat,
 * wint.
 */
final class WidgetStatus {
    /** Wat er te melden is, van belangrijk naar onbelangrijk. NONE: niets, dan staat er geen statusregel. */
    enum Kind { PAIR, NOTE, WAITING, OFFLINE, SERVER, EMPTY, STALE, NONE }

    /** Wat een tik op de regel doet. */
    enum Action { NONE, PAIR, RETRY, ADD }

    /** Na zo lang zonder geslaagde verversing toont de widget klein de tijd van de laatste. */
    static final long STALE_MS = 60 * 60 * 1000L;

    final Kind kind;
    final Action action;

    private WidgetStatus(Kind kind, Action action) {
        this.kind = kind;
        this.action = action;
    }

    /** Is er een regel te tonen? */
    boolean visible() {
        return kind != Kind.NONE;
    }

    /** Rood: er ging iets mis dat de gebruiker moet weten. Wachten en leeg zijn rustig (grijs). */
    boolean alert() {
        return kind == Kind.NOTE || kind == Kind.OFFLINE || kind == Kind.SERVER;
    }

    /**
     * De keuze.
     *
     * @param paired     de telefoon heeft een sleutel
     * @param noteActive de server wees net een wijziging af en die melding is nog vers (Outbox.NOTE_MS)
     * @param waiting    aantal wijzigingen in de wachtrij
     * @param error      de laatste verversing mislukte
     * @param offline    die fout was geen verbinding (anders: een fout van de server)
     * @param empty      de widget toont geen taken
     * @param lastSyncMs laatste geslaagde verversing (ms), of 0
     * @param nowMs      nu (ms)
     */
    static WidgetStatus decide(boolean paired, boolean noteActive, int waiting, boolean error, boolean offline,
                               boolean empty, long lastSyncMs, long nowMs) {
        if (!paired) return new WidgetStatus(Kind.PAIR, Action.PAIR);
        if (noteActive) return new WidgetStatus(Kind.NOTE, Action.NONE);
        // Wijzigingen in de wachtrij gaan vanzelf weg; de tik probeert het meteen opnieuw.
        if (waiting > 0) return new WidgetStatus(Kind.WAITING, Action.RETRY);
        if (error) return new WidgetStatus(offline ? Kind.OFFLINE : Kind.SERVER, Action.RETRY);
        if (empty) return new WidgetStatus(Kind.EMPTY, Action.ADD);
        // Nooit ververst, of al lang niet: klein de tijd (zonder actie; de knop Verversen staat erboven).
        if (lastSyncMs > 0 && nowMs - lastSyncMs > STALE_MS) return new WidgetStatus(Kind.STALE, Action.NONE);
        return new WidgetStatus(Kind.NONE, Action.NONE);
    }
}
