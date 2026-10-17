package nl.detussenpartij.tick;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CacheWipeTest {
    @Test public void wisselNaarAnderePersoonWist() { assertTrue(CacheWipe.shouldWipe("u-a", "u-b", CacheWipe.Reason.REDEEM)); }
    @Test public void zelfdePersoonWistNiet() { assertFalse(CacheWipe.shouldWipe("u-a", "u-a", CacheWipe.Reason.REDEEM)); }
    @Test public void sleutelVanVoorDeUpdateTeltAlsZelfde() {
        assertFalse(CacheWipe.shouldWipe("", "u-b", CacheWipe.Reason.REDEEM));
        assertFalse(CacheWipe.shouldWipe(null, "u-b", CacheWipe.Reason.REDEEM));
        assertFalse(CacheWipe.shouldWipe("u-a", "", CacheWipe.Reason.REDEEM));
    }
    @Test public void na401AltijdWissen() {
        assertTrue(CacheWipe.shouldWipe("u-a", "", CacheWipe.Reason.UNAUTHORIZED));
        assertTrue(CacheWipe.shouldWipe("", "", CacheWipe.Reason.UNAUTHORIZED));
    }
}
