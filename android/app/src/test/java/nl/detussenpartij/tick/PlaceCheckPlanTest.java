package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Testfeature "placecheck": merk herkennen en de uitslag van de proefmelding. */
public class PlaceCheckPlanTest {
    private static final long T = 1_000_000;

    @Test
    public void herkentMerkenOokViaBrand() {
        assertEquals(PlaceCheckPlan.Brand.XIAOMI, PlaceCheckPlan.brand("Xiaomi", "Redmi"));
        assertEquals(PlaceCheckPlan.Brand.XIAOMI, PlaceCheckPlan.brand("", "POCO"));
        assertEquals(PlaceCheckPlan.Brand.SAMSUNG, PlaceCheckPlan.brand("samsung", "samsung"));
        assertEquals(PlaceCheckPlan.Brand.ONEPLUS, PlaceCheckPlan.brand("OnePlus", "OnePlus"));
        assertEquals(PlaceCheckPlan.Brand.ONEPLUS, PlaceCheckPlan.brand("realme", "realme"));
        assertEquals(PlaceCheckPlan.Brand.VIVO, PlaceCheckPlan.brand("vivo", "iQOO"));
        assertEquals(PlaceCheckPlan.Brand.HUAWEI, PlaceCheckPlan.brand("HONOR", "HONOR"));
        assertEquals(PlaceCheckPlan.Brand.OTHER, PlaceCheckPlan.brand("Google", "google"));
        assertEquals(PlaceCheckPlan.Brand.OTHER, PlaceCheckPlan.brand(null, null));
    }

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
