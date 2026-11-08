package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LocationRelayTest {
    @Test
    public void namenZijnDieVanChrome() {
        // Chrome (InstalledWebappGeolocationBridge) luistert naar precies deze namen; locationdelegation 1.1.2 stuurde
        // fouten als "onNewErrorAvailable", en die negeert Chrome.
        assertEquals("startLocation", LocationRelay.START);
        assertEquals("stopLocation", LocationRelay.STOP);
        assertEquals("onNewLocationAvailable", LocationRelay.CALLBACK_LOCATION);
        assertEquals("onNewLocationError", LocationRelay.CALLBACK_ERROR);
    }

    @Test
    public void alleenStartEnStop() {
        assertTrue(LocationRelay.handles("startLocation"));
        assertTrue(LocationRelay.handles("stopLocation"));
        // Toestemming vragen doet de handler van Browser Helper (met zijn eigen scherm).
        assertFalse(LocationRelay.handles("checkAndroidLocationPermission"));
        assertFalse(LocationRelay.handles(null));
    }

    @Test
    public void nauwkeurigVakerDanZuinig() {
        assertEquals(1000, LocationRelay.intervalMs(true));
        assertTrue(LocationRelay.intervalMs(false) > LocationRelay.intervalMs(true));
    }

    @Test
    public void laatsteLocatieAlleenAlsHijVersIs() {
        long now = 1_000_000_000L;
        assertTrue(LocationRelay.lastIsUsable(now - 10_000, now));
        assertTrue(LocationRelay.lastIsUsable(now - LocationRelay.MAX_LAST_AGE_MS, now));
        assertFalse(LocationRelay.lastIsUsable(now - LocationRelay.MAX_LAST_AGE_MS - 1, now));
        assertFalse(LocationRelay.lastIsUsable(0, now));
        // Een klok die een eind voorloopt: niet vertrouwen.
        assertFalse(LocationRelay.lastIsUsable(now + 60_000, now));
    }
}
