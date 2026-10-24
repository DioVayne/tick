package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Iterator;

public class ArrivalStatsTest {
    /** Meting met een gegeven "te laat" (straal 200, afstand 200 - late). */
    private static JSONObject meting(long at, boolean exit, String mode, double late) {
        return ArrivalStats.measurement(at, exit, mode, 200, 200, 200 - late, 10.0, 15.0, 1000);
    }

    @Test
    public void afstandKlopt() {
        assertEquals(68.5, ArrivalStats.distanceM(52.0, 5.0, 52.0, 5.001), 0.5);
        assertEquals(0, ArrivalStats.distanceM(52.0, 5.0, 52.0, 5.0), 1e-9);
    }

    @Test
    public void bewaartHooguit30() throws Exception {
        String json = "[]";
        for (int i = 1; i <= 35; i++) json = ArrivalStats.add(json, meting(i, false, "", 0));
        JSONArray arr = new JSONArray(json);
        assertEquals(ArrivalStats.KEEP, arr.length());
        assertEquals(6, arr.getJSONObject(0).getLong("at"));
        assertEquals(35, arr.getJSONObject(29).getLong("at"));
    }

    @Test
    public void kapotteJsonBegintLeeg() throws Exception {
        assertEquals(1, new JSONArray(ArrivalStats.add("onzin", meting(1, false, "", 0))).length());
        assertEquals(1, new JSONArray(ArrivalStats.add(null, meting(1, false, "", 0))).length());
        assertEquals(0, ArrivalStats.summary("onzin", null).count);
        assertEquals(0, ArrivalStats.summary(null, null).count);
    }

    @Test
    public void leegLatenZonderSnelheid() {
        JSONObject m = ArrivalStats.measurement(1, false, "", 200, 200, 50, null, null, 0);
        assertFalse(m.has("speed"));
        assertFalse(m.has("acc"));
        assertEquals(150, ArrivalStats.late(m), 1e-9);
    }

    @Test
    public void gemiddeldAlleenAankomsten() {
        String json = "[]";
        json = ArrivalStats.add(json, meting(1, false, "", 180));
        json = ArrivalStats.add(json, meting(2, false, "", 100));
        json = ArrivalStats.add(json, meting(3, true, "", 500));
        ArrivalStats.Summary s = ArrivalStats.summary(json, null);
        assertEquals(2, s.count);
        assertEquals(140, s.avgLate, 1e-9);
    }

    @Test
    public void negatiefIsErvoor() {
        String json = "[]";
        json = ArrivalStats.add(json, meting(1, false, "", -40));
        json = ArrivalStats.add(json, meting(2, false, "", -20));
        assertEquals(-30, ArrivalStats.summary(json, null).avgLate, 1e-9);
    }

    @Test
    public void perSoort() {
        String json = "[]";
        json = ArrivalStats.add(json, meting(1, false, "car", 50));
        json = ArrivalStats.add(json, meting(2, false, "", 150));
        ArrivalStats.Summary car = ArrivalStats.summary(json, "car");
        assertEquals(1, car.count);
        assertEquals(50, car.avgLate, 1e-9);
        assertEquals(2, ArrivalStats.summary(json, null).count);
        assertEquals(0, ArrivalStats.summary(json, "bike").count);
    }

    @Test
    public void zonderLocatieGeenMeting() {
        assertNull(ArrivalStats.fromFix(1000, false, "", 52.0, 5.0, 200, 200, null, null, 3.0, 10.0, 900L));
    }

    @Test
    public void fixGeeftAfstandMaarGeenCoordinaten() {
        JSONObject m = ArrivalStats.fromFix(1000, false, "", 52.0, 5.0, 200, 200, 52.0, 5.001, 3.0, 10.0, 900L);
        assertEquals(68.5, m.optDouble("dist"), 0.5);
        assertEquals(100, m.optLong("age"));
        for (Iterator<String> it = m.keys(); it.hasNext(); ) {
            String k = it.next().toLowerCase();
            assertFalse(k, k.contains("lat") || k.contains("lng"));
        }
        // Zonder tijdstip van de fix: leeftijd 0.
        assertEquals(0, ArrivalStats.fromFix(1000, false, "", 52.0, 5.0, 200, 200, 52.0, 5.0, null, null, null).optLong("age"));
    }
}
