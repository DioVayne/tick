package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import nl.detussenpartij.tick.PairSteps.Step;

import org.junit.Test;

public class PairStepsTest {
    @Test public void nieuweTelefoonBegintMetLocatie() { assertEquals(Step.LOCATION, PairSteps.first(false, false, false)); }
    @Test public void locatieAlGegevenDanAltijdToestaan() { assertEquals(Step.BACKGROUND, PairSteps.first(false, true, false)); }
    @Test public void alleLocatieGegevenDanMeldingenOfBatterij() {
        assertEquals(Step.NOTIFICATIONS, PairSteps.first(false, true, true));
        assertEquals(Step.BATTERY, PairSteps.first(true, true, true));
    }
    @Test public void naLocatievraag() {
        assertEquals(Step.BACKGROUND, PairSteps.afterLocation(true, false));
        assertEquals(Step.BATTERY, PairSteps.afterLocation(true, true));
        assertEquals(Step.BATTERY, PairSteps.afterLocation(false, false)); // geweigerd: niet doorzeuren
    }
    @Test public void nietNuBijLocatie() {
        assertEquals(Step.NOTIFICATIONS, PairSteps.skipLocation(false));
        assertEquals(Step.BATTERY, PairSteps.skipLocation(true));
    }
}
