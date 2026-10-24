package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RoadPlanTest {
    /** Aankomst in de auto: ingestelde straal 200, gebruikte straal 200 + marge, afgegaan op afstand dist. */
    private static String add(String json, String mode, double margin, double dist, Double acc) {
        return ArrivalStats.add(json, ArrivalStats.measurement(1, false, mode, 200, 200 + margin, dist, null, acc, 0));
    }

    @Test
    public void zonderMetingenDeStartwaarde() {
        assertEquals(RoadPlan.CAR_START, RoadPlan.margin("[]", "car"), 1e-9);
        assertEquals(RoadPlan.BIKE_START, RoadPlan.margin("[]", "bike"), 1e-9);
        assertEquals(RoadPlan.BIKE_START, RoadPlan.margin("onzin", "bike"), 1e-9);
    }

    @Test
    public void mediaanVanDeGoedeMarges() {
        // Steeds marge 1000 (gebruikte straal 1200). Goede marge = gebruikte straal - afstand bij afgaan.
        String json = "[]";
        json = add(json, "car", 1000, 400, 10.0);  // goede marge 1200 - 400 = 800
        json = add(json, "car", 1000, 200, 10.0);  // 1000
        json = add(json, "car", 1000, 0, 10.0);    // 1200
        assertEquals(1000, RoadPlan.margin(json, "car"), 1e-9);
    }

    @Test
    public void begrensd() {
        String ver = add("[]", "car", 3000, 0, 10.0);       // goede marge 3200 -> 3000
        assertEquals(RoadPlan.CAR_MAX, RoadPlan.margin(ver, "car"), 1e-9);
        String dicht = add("[]", "car", 200, 390, 10.0);   // goede marge 10 -> 200
        assertEquals(RoadPlan.CAR_MIN, RoadPlan.margin(dicht, "car"), 1e-9);
        String fiets = add("[]", "bike", 1000, 0, 10.0);   // 1200 -> 1000
        assertEquals(RoadPlan.BIKE_MAX, RoadPlan.margin(fiets, "bike"), 1e-9);
    }

    @Test
    public void onnauwkeurigOfAndereSoortTeltNiet() {
        String json = "[]";
        json = add(json, "car", 1000, 0, 150.0);  // te onnauwkeurig
        json = add(json, "car", 1000, 0, null);   // nauwkeurigheid onbekend
        json = add(json, "bike", 1000, 0, 10.0);  // andere soort
        json = add(json, "", 1000, 0, 10.0);      // niet onderweg
        assertEquals(RoadPlan.CAR_START, RoadPlan.margin(json, "car"), 1e-9);
    }

    @Test
    public void alleenDeLaatsteTien() {
        String json = "[]";
        for (int i = 0; i < 5; i++) json = add(json, "car", 1000, 0, 10.0);    // 1200
        for (int i = 0; i < 10; i++) json = add(json, "car", 1000, 400, 10.0); // 800
        assertEquals(800, RoadPlan.margin(json, "car"), 1e-9);
    }

    @Test
    public void onderwegStraal() {
        assertEquals(750f, RoadPlan.roadRadius(200, 1000, 800.0), 1e-6);
        assertEquals(1200f, RoadPlan.roadRadius(200, 1000, 5000.0), 1e-6);
        assertEquals(200f, RoadPlan.roadRadius(200, 1000, 150.0), 1e-6); // je bent er al
        assertEquals(200f, RoadPlan.roadRadius(200, 1000, 230.0), 1e-6); // vlak buiten: niet kleiner dan r
        assertEquals(200f, RoadPlan.roadRadius(200, 1000, null), 1e-6);  // locatie onbekend
    }

    @Test
    public void soortUitActiviteit() {
        assertEquals("car", RoadPlan.modeFor(0));   // DetectedActivity.IN_VEHICLE
        assertEquals("bike", RoadPlan.modeFor(1));  // DetectedActivity.ON_BICYCLE
        assertEquals("", RoadPlan.modeFor(7));      // WALKING
    }

    @Test
    public void standVerloopt() {
        long uur = 60 * 60 * 1000L;
        assertTrue(RoadPlan.isActive("car", 1000, 1000 + 2 * uur));
        assertFalse(RoadPlan.isActive("car", 1000, 1000 + 4 * uur));
        assertFalse(RoadPlan.isActive("", 1000, 1000));
        assertFalse(RoadPlan.isActive(null, 1000, 1000));
    }
}
