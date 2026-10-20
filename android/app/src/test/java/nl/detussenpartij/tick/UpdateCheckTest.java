package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateCheckTest {
    @Test public void versieUitTag() {
        assertEquals("1.5.2", UpdateCheck.version("android-v1.5.2"));
        assertNull(UpdateCheck.version("v1.5.2"));
        assertNull(UpdateCheck.version("android-v1.5.2-beta"));
        assertNull(UpdateCheck.version(null));
    }
    @Test public void nieuwerPerGetal() {
        assertTrue(UpdateCheck.isNewer("1.5.2", "1.5.1"));
        assertTrue(UpdateCheck.isNewer("1.10.0", "1.9.9"));
        assertTrue(UpdateCheck.isNewer("2.0", "1.9.9"));
        assertFalse(UpdateCheck.isNewer("1.5.1", "1.5.1"));
        assertFalse(UpdateCheck.isNewer("1.5", "1.5.0"));
        assertFalse(UpdateCheck.isNewer("1.4.9", "1.5.0"));
        assertFalse(UpdateCheck.isNewer(null, "1.5.0"));
        assertFalse(UpdateCheck.isNewer("1.6", "1.5-debug"));
    }
    @Test public void eenKeerPerDag() {
        long day = UpdateCheck.INTERVAL_MS;
        assertTrue(UpdateCheck.due(0, day));
        assertFalse(UpdateCheck.due(day, day + day - 1));
        assertTrue(UpdateCheck.due(day, day + day));
        assertTrue(UpdateCheck.due(5 * day, day)); // klok teruggezet
    }
}
