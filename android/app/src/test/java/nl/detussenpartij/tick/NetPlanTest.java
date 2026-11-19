package nl.detussenpartij.tick;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class NetPlanTest {
    // Thuis, en punten op een bekende afstand ten noorden ervan (1 graad breedte is ongeveer 111 195 m).
    private static final double LAT = 51.588271, LNG = 6.038869;
    private static final double M = 1 / 111_195.0;

    private static JSONObject plek(double lat, double lng, int radius, String trigger) throws Exception {
        return new JSONObject().put("name", "Thuis").put("lat", lat).put("lng", lng).put("radius", radius).put("trigger", trigger);
    }

    private static JSONObject taak(String id, JSONObject loc) throws Exception {
        return new JSONObject().put("id", id).put("title", "Taak " + id).put("done", false)
                .put("location", loc).put("location_notified", false);
    }

    private static List<GeoPlan.Fence> fences(JSONObject... tasks) {
        JSONArray arr = new JSONArray();
        for (JSONObject t : tasks) arr.put(t);
        return GeoPlan.select(arr, new JSONObject(), GeoPlan.MAX);
    }

    private static NetPlan.Result kijk(List<GeoPlan.Fence> f, JSONObject before, double metersNorth, double acc) {
        return NetPlan.check(f, before, LAT + metersNorth * M, LNG, acc);
    }

    @Test
    public void buitenDanBinnenGeeftMelding() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        NetPlan.Result werk = kijk(f, new JSONObject(), 50_000, 30);
        assertTrue(werk.arrived.isEmpty());
        assertEquals(f.get(0).key, werk.outside.getString("a"));
        assertEquals(1, werk.tasks);

        NetPlan.Result thuis = kijk(f, werk.outside, 100, 40);
        assertEquals(1, thuis.arrived.size());
        assertEquals("a", GeoPlan.taskId(thuis.arrived.get(0)));
        assertEquals(f.get(0).key, GeoPlan.fenceKey(thuis.arrived.get(0)));
        assertFalse(thuis.outside.has("a"));
    }

    @Test
    public void alBinnenBijDeEersteKeerGeeftGeenMelding() throws Exception {
        // Net als een geofence: sta je er al als de plek gezet wordt, dan pas bij de volgende aankomst.
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        NetPlan.Result r = kijk(f, new JSONObject(), 100, 20);
        assertTrue(r.arrived.isEmpty());
        assertFalse(r.outside.has("a"));
        // Weg en weer terug: dan wel.
        NetPlan.Result weg = kijk(f, r.outside, 5_000, 20);
        assertTrue(kijk(f, weg.outside, 0, 20).arrived.size() == 1);
    }

    @Test
    public void netBuitenDeRandTeltNietAlsBuiten() throws Exception {
        // 550 m van een cirkel van 500 m: binnen de marge van 100 m, dus nog geen "buiten".
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        NetPlan.Result r = kijk(f, new JSONObject(), 550, 20);
        assertFalse(r.outside.has("a"));
        // Maar een eerder "buiten" blijft staan in die tussenzone.
        JSONObject voor = new JSONObject().put("a", f.get(0).key);
        assertTrue(kijk(f, voor, 550, 20).outside.has("a"));
    }

    @Test
    public void groveLocatieTeltNietAlsBinnen() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        JSONObject voor = new JSONObject().put("a", f.get(0).key);
        NetPlan.Result r = kijk(f, voor, 100, 400);
        assertTrue(r.arrived.isEmpty());
        assertTrue(r.outside.has("a")); // stand blijft, de volgende nauwkeurige keer telt
        // Onbekende nauwkeurigheid ook niet.
        assertTrue(kijk(f, voor, 100, Double.NaN).arrived.isEmpty());
    }

    @Test
    public void groveLocatieVerWegTeltWelAlsBuiten() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        // 3 km weg met een nauwkeurigheid van 1 km: zeker buiten.
        assertTrue(kijk(f, new JSONObject(), 3_000, 1_000).outside.has("a"));
        // 1,2 km weg met een nauwkeurigheid van 1 km: niet zeker.
        assertFalse(kijk(f, new JSONObject(), 1_200, 1_000).outside.has("a"));
    }

    @Test
    public void vertrekplekkenDoetHetVangnetNiet() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "exit")));
        NetPlan.Result r = kijk(f, new JSONObject(), 50_000, 20);
        assertEquals(0, r.tasks);
        assertFalse(r.outside.has("a"));
    }

    @Test
    public void andereKeyVergeetDeOudeStand() throws Exception {
        // De plek is veranderd sinds je buiten was: niet melden op grond van de oude plek.
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        JSONObject voor = new JSONObject().put("a", "oude-key");
        assertTrue(kijk(f, voor, 0, 20).arrived.isEmpty());
    }

    @Test
    public void takenDieWegZijnVerdwijnenUitDeStand() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")));
        JSONObject voor = new JSONObject().put("weg", "x").put("a", f.get(0).key);
        NetPlan.Result r = kijk(f, voor, 50_000, 20);
        assertFalse(r.outside.has("weg"));
        assertTrue(r.outside.has("a"));
    }

    @Test
    public void meerPlekkenEenMeldingBijDePlekWaarJeBent() throws Exception {
        JSONObject loc = plek(LAT, LNG, 500, "enter");
        loc.put("more", new JSONArray().put(new JSONObject().put("name", "Ver").put("lat", LAT + 20_000 * M)
                .put("lng", LNG).put("radius", 500)));
        List<GeoPlan.Fence> f = fences(taak("a", loc));
        assertEquals(2, f.size());
        NetPlan.Result weg = kijk(f, new JSONObject(), 10_000, 20);
        assertTrue(weg.outside.has("a"));
        NetPlan.Result r = kijk(f, weg.outside, 20_000, 20); // bij de tweede plek
        assertEquals(1, r.arrived.size());
        assertEquals(1, GeoPlan.placeIndex(r.arrived.get(0)));
        // Binnen bij de ene plek telt niet als "ver van alle plekken".
        assertFalse(kijk(f, new JSONObject(), 0, 20).outside.has("a"));
    }

    @Test
    public void meerdereTakenApart() throws Exception {
        List<GeoPlan.Fence> f = fences(taak("a", plek(LAT, LNG, 500, "enter")),
                taak("b", plek(LAT + 30_000 * M, LNG, 500, "enter")));
        NetPlan.Result weg = kijk(f, new JSONObject(), 10_000, 20);
        assertTrue(weg.outside.has("a"));
        assertTrue(weg.outside.has("b"));
        NetPlan.Result thuis = kijk(f, weg.outside, 0, 20);
        assertEquals(1, thuis.arrived.size());
        assertEquals("a", GeoPlan.taskId(thuis.arrived.get(0)));
        assertTrue(thuis.outside.has("b"));
    }
}
