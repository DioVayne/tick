package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Batterij: merk herkennen en wat er na het koppelen gebeurt. */
public class BatteryPlanTest {
    @Test
    public void herkentMerkenOokViaBrand() {
        assertEquals(BatteryPlan.Brand.XIAOMI, BatteryPlan.brand("Xiaomi", "Redmi"));
        assertEquals(BatteryPlan.Brand.XIAOMI, BatteryPlan.brand("", "POCO"));
        assertEquals(BatteryPlan.Brand.SAMSUNG, BatteryPlan.brand("samsung", "samsung"));
        assertEquals(BatteryPlan.Brand.ONEPLUS, BatteryPlan.brand("OnePlus", "OnePlus"));
        assertEquals(BatteryPlan.Brand.ONEPLUS, BatteryPlan.brand("realme", "realme"));
        assertEquals(BatteryPlan.Brand.VIVO, BatteryPlan.brand("vivo", "iQOO"));
        assertEquals(BatteryPlan.Brand.HUAWEI, BatteryPlan.brand("HONOR", "HONOR"));
        assertEquals(BatteryPlan.Brand.OTHER, BatteryPlan.brand("Google", "google"));
        assertEquals(BatteryPlan.Brand.OTHER, BatteryPlan.brand(null, null));
    }

    @Test
    public void naHetKoppelen() {
        assertEquals(BatteryPlan.AfterPair.NOTHING, BatteryPlan.afterPair(true, true));
        assertEquals(BatteryPlan.AfterPair.NOTHING, BatteryPlan.afterPair(false, true));
        assertEquals(BatteryPlan.AfterPair.SYSTEM_PROMPT, BatteryPlan.afterPair(false, false));
        assertEquals(BatteryPlan.AfterPair.EXPLAIN, BatteryPlan.afterPair(true, false));
    }
}
