package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WidgetStatusTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final long FRESH = NOW - 5 * 60 * 1000L;
    private static final long OLD = NOW - 2 * 60 * 60 * 1000L;

    private static WidgetStatus decide(boolean paired, boolean note, int waiting, boolean error, boolean offline,
                                       boolean empty, long last) {
        return WidgetStatus.decide(paired, note, waiting, error, offline, empty, last, NOW);
    }

    @Test
    public void gewoonGebruikToontNiets() {
        WidgetStatus s = decide(true, false, 0, false, false, false, FRESH);
        assertEquals(WidgetStatus.Kind.NONE, s.kind);
        assertFalse(s.visible());
        // Nog nooit ververst (net gekoppeld): ook niets; de eerste verversing komt zo.
        assertEquals(WidgetStatus.Kind.NONE, decide(true, false, 0, false, false, false, 0).kind);
    }

    @Test
    public void oudeLijstToontKleinDeTijd() {
        WidgetStatus s = decide(true, false, 0, false, false, false, OLD);
        assertEquals(WidgetStatus.Kind.STALE, s.kind);
        assertEquals(WidgetStatus.Action.NONE, s.action);
        assertFalse(s.alert());
        // Precies op de grens nog niet.
        assertEquals(WidgetStatus.Kind.NONE,
                WidgetStatus.decide(true, false, 0, false, false, false, NOW - WidgetStatus.STALE_MS, NOW).kind);
    }

    @Test
    public void nietGekoppeldWintAltijd() {
        WidgetStatus s = decide(false, true, 3, true, true, true, OLD);
        assertEquals(WidgetStatus.Kind.PAIR, s.kind);
        assertEquals(WidgetStatus.Action.PAIR, s.action);
    }

    @Test
    public void afgewezenWijzigingVoorWachtrij() {
        WidgetStatus s = decide(true, true, 2, true, true, true, OLD);
        assertEquals(WidgetStatus.Kind.NOTE, s.kind);
        assertEquals(WidgetStatus.Action.NONE, s.action);
        assertTrue(s.alert());
    }

    @Test
    public void wachtrijIsRustigMetOpnieuwProberen() {
        WidgetStatus s = decide(true, false, 2, true, true, true, OLD);
        assertEquals(WidgetStatus.Kind.WAITING, s.kind);
        assertEquals(WidgetStatus.Action.RETRY, s.action);
        assertFalse(s.alert());
    }

    @Test
    public void geenVerbindingOfServerfoutMetOpnieuwProberen() {
        WidgetStatus off = decide(true, false, 0, true, true, true, OLD);
        assertEquals(WidgetStatus.Kind.OFFLINE, off.kind);
        assertEquals(WidgetStatus.Action.RETRY, off.action);
        assertTrue(off.alert());
        WidgetStatus server = decide(true, false, 0, true, false, false, FRESH);
        assertEquals(WidgetStatus.Kind.SERVER, server.kind);
        assertEquals(WidgetStatus.Action.RETRY, server.action);
    }

    @Test
    public void legeLijstBiedtToevoegen() {
        WidgetStatus s = decide(true, false, 0, false, false, true, OLD);
        assertEquals(WidgetStatus.Kind.EMPTY, s.kind);
        assertEquals(WidgetStatus.Action.ADD, s.action);
        assertFalse(s.alert());
    }
}
