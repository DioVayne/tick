package nl.detussenpartij.tick;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PendingDecisionTest {
    private static final String EERST = "2026-10-17T08:00:00Z";
    private static final String DAARNA = "2026-10-18T08:00:00Z";

    @Test
    public void wegVanDeServer() {
        assertTrue(PendingDecision.clear(false, 1000, EERST, null));
    }

    @Test
    public void binnenHetOngedaanVensterBlijftHij() {
        // Ook als de server de herhalende taak al heeft doorgeschoven: binnen 3 s kun je nog terugzetten.
        assertFalse(PendingDecision.clear(true, PendingDecision.UNDO_WINDOW_MS, EERST, DAARNA));
        assertFalse(PendingDecision.clear(true, 1000, EERST, EERST));
    }

    @Test
    public void herhalendeTaakDoorgeschoven() {
        assertTrue(PendingDecision.clear(true, PendingDecision.UNDO_WINDOW_MS + 1, EERST, DAARNA));
    }

    @Test
    public void herinneringErbijGekomen() {
        // Bij het tikken had de taak geen herinnering ("").
        assertTrue(PendingDecision.clear(true, PendingDecision.UNDO_WINDOW_MS + 1, "", DAARNA));
    }

    @Test
    public void nogOpenMetDezelfdeHerinneringWachtOpDeServer() {
        assertFalse(PendingDecision.clear(true, 10_000, EERST, EERST));
        assertFalse(PendingDecision.clear(true, 10_000, "", ""));
    }

    @Test
    public void onbekendeWaardeBijHetTikkenWachtTot30Seconden() {
        // Afgevinkt met een oudere versie van de app: die bewaarde remind_at nog niet.
        assertFalse(PendingDecision.clear(true, 10_000, null, DAARNA));
        assertTrue(PendingDecision.clear(true, PendingDecision.FAILED_AFTER_MS + 1, null, DAARNA));
    }

    @Test
    public void na30SecondenNogOpenIsMislukt() {
        assertFalse(PendingDecision.clear(true, PendingDecision.FAILED_AFTER_MS, EERST, EERST));
        assertTrue(PendingDecision.clear(true, PendingDecision.FAILED_AFTER_MS + 1, EERST, EERST));
    }
}
