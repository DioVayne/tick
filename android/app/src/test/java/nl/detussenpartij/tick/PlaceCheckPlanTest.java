package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Testfeature "placecheck": de uitslag van de proefmelding. */
public class PlaceCheckPlanTest {
    private static final long T = 1_000_000;

    @Test
    public void uitslagVanDeProef() {
        assertEquals(PlaceCheckPlan.Result.NONE, PlaceCheckPlan.result(0, 0, false, T));
        assertEquals(PlaceCheckPlan.Result.WAITING, PlaceCheckPlan.result(T, 0, false, T + 20_000));
        assertEquals(PlaceCheckPlan.Result.MISSING, PlaceCheckPlan.result(T, 0, false, T + PlaceCheckPlan.MISSING_AFTER_MS + 1));
        assertEquals(PlaceCheckPlan.Result.ARRIVED, PlaceCheckPlan.result(T, T + 15_000, true, T + 60_000));
        assertEquals(PlaceCheckPlan.Result.BLOCKED, PlaceCheckPlan.result(T, T + 15_000, false, T + 60_000));
    }

    @Test
    public void eenAfgaanVanEenOudereProefTeltNiet() {
        assertEquals(PlaceCheckPlan.Result.WAITING, PlaceCheckPlan.result(T, T - 1, true, T + 5_000));
    }

    @Test
    public void teltDeSecondenTeLaat() {
        assertEquals(0, PlaceCheckPlan.lateSeconds(T, T + 15_000));
        assertEquals(0, PlaceCheckPlan.lateSeconds(T, T + 10_000));
        assertEquals(45, PlaceCheckPlan.lateSeconds(T, T + 60_000));
    }
}
